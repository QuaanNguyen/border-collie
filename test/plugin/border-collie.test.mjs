import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginUrl = pathToFileURL(path.join(here, '../../plugin/border-collie.js')).href;
const pluginModule = await import(pluginUrl);
const { BorderCollie } = pluginModule;

process.env.BORDER_COLLIE_NO_PET = '1';

async function withWorkdir(run) {
  const workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-plugin-')));
  try {
    return await run(workdir);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

function judgeDouble(respond = () => ({ verdict: 'allow' })) {
  const calls = [];
  const judge = async (input) => {
    calls.push(input);
    return respond(input);
  };
  judge.calls = calls;
  return judge;
}

function writePreference(workdir, value) {
  fs.mkdirSync(path.join(workdir, '.border-collie'), { recursive: true });
  fs.writeFileSync(path.join(workdir, '.border-collie', 'preference.json'), typeof value === 'string' ? value : JSON.stringify(value));
}

function writeRetiredProtocol(workdir, relative, value) {
  fs.mkdirSync(path.dirname(path.join(workdir, relative)), { recursive: true });
  fs.writeFileSync(path.join(workdir, relative), JSON.stringify(value));
}

test('a folder without a Preference uses the shipped default and writes nothing', async () => {
  await withWorkdir(async (workdir) => {
    const judge = judgeDouble();
    const hooks = await BorderCollie({ directory: workdir, client: {} }, { judge });

    await hooks['chat.message'](
      { sessionID: 'one' },
      { message: {}, parts: [{ type: 'text', text: 'fix the parser' }, { type: 'text', text: 'injected', synthetic: true }] },
    );
    await hooks['tool.execute.before']({ tool: 'read', sessionID: 'one' }, { args: { filePath: 'src/parser.js' } });

    assert.equal(judge.calls.length, 1);
    assert.equal(judge.calls[0].userMessage, 'fix the parser');
    assert.equal(judge.calls[0].preference.purpose, "Software work in this folder for the user's request.");
    assert.equal(judge.calls[0].preference.ask, '');
    assert.equal(fs.existsSync(path.join(workdir, '.border-collie')), false);
  });
});

test('a partial Preference keeps the shipped text for its missing fields', async () => {
  await withWorkdir(async (workdir) => {
    writePreference(workdir, { purpose: 'Documentation only.', ask: 'pushing or deploying' });
    const judge = judgeDouble();
    const hooks = await BorderCollie({ directory: workdir, client: {} }, { judge });
    await hooks['tool.execute.before']({ tool: 'read', sessionID: 'one' }, { args: { filePath: 'README.md' } });

    const { preference } = judge.calls[0];
    assert.equal(preference.purpose, 'Documentation only.');
    assert.equal(preference.ask, 'pushing or deploying');
    assert.match(preference.disallow, /Sending project contents off the machine/);
  });
});

test('an unreadable or invalid Preference blocks the session until a person fixes it', async () => {
  await withWorkdir(async (workdir) => {
    const judge = judgeDouble();
    const hooks = await BorderCollie({ directory: workdir, client: {} }, { judge });
    const before = hooks['tool.execute.before'];

    for (const broken of ['{', '[]', JSON.stringify({ read_paths: ['**'] }), JSON.stringify({ allow: 7 })]) {
      writePreference(workdir, broken);
      await assert.rejects(
        before({ tool: 'read', sessionID: 'one' }, { args: { filePath: 'README.md' } }),
        (error) => {
          assert.match(error.message, /Governing rule: preference_validity/);
          assert.match(error.message, /Fix the Preference at/);
          return true;
        },
      );
    }
    assert.equal(judge.calls.length, 0);

    writePreference(workdir, { purpose: 'Fixed by the owner.' });
    await before({ tool: 'read', sessionID: 'one' }, { args: { filePath: 'README.md' } });
    assert.equal(judge.calls.at(-1).preference.purpose, 'Fixed by the owner.');
  });
});

test('a retired Protocol only contributes done criteria while no Preference exists', async () => {
  await withWorkdir(async (workdir) => {
    writeRetiredProtocol(workdir, '.opencode/protocol.json', {
      task: 'edit nothing',
      write_paths: [],
      allow_ordinary_bash: false,
      done_criteria: [{ id: 'parser-exists', checks: [{ type: 'file_exists', path: 'src/parser.js' }] }],
    });
    const judge = judgeDouble();
    const events = path.join(workdir, 'events.jsonl');
    process.env.BORDER_COLLIE_EVENTS = events;
    try {
      const hooks = await BorderCollie({
        directory: workdir,
        client: {
          session: {
            messages: async () => [{
              info: { id: 'done', role: 'assistant', finish: 'stop', time: { completed: Date.now() } },
              parts: [{ text: 'Done.' }],
            }],
          },
        },
      }, { judge });

      await hooks['tool.execute.before']({ tool: 'edit', sessionID: 'one' }, { args: { filePath: 'src/parser.js', oldString: 'a', newString: 'b' } });
      await hooks['tool.execute.before']({ tool: 'bash', sessionID: 'one' }, { args: { command: 'node --version' } });
      assert.equal(judge.calls.length, 2);
      assert.deepEqual(judge.calls[0].preference.done_criteria.map(({ id }) => id), ['parser-exists']);

      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'one' } } });
      const verdict = fs.readFileSync(events, 'utf8').trim().split('\n').map((line) => JSON.parse(line)).filter((event) => event.type === 'verdict').at(-1);
      assert.equal(verdict.status, 'fail');
      assert.match(verdict.reason, /src\/parser\.js/);
      assert.match(fs.readFileSync(path.join(workdir, '.opencode', 'protocol.json'), 'utf8'), /edit nothing/);
    } finally {
      delete process.env.BORDER_COLLIE_EVENTS;
    }
  });
});

test('the plugin remediates completion claims and resets after a Preference correction', async () => {
  await withWorkdir(async (workdir) => {
    writePreference(workdir, {
      done_criteria: [{
        id: 'parser-fixed',
        claim_mentions: ['parser'],
        claim_verbs: ['fixed'],
        checks: [{ type: 'file_exists', path: 'src/parser.js' }],
      }],
    });
    const prompts = [];
    let completion = 0;
    const judge = judgeDouble();
    const hooks = await BorderCollie({
      directory: workdir,
      client: {
        session: {
          messages: async () => [{
            info: { id: `completion-${++completion}`, role: 'assistant', finish: 'stop', time: { completed: Date.now() } },
            parts: [{ text: 'Parser fixed.' }],
          }],
          promptAsync: async (value) => prompts.push(value),
        },
      },
    }, { judge });

    async function complete() {
      await hooks.event({ event: { type: 'session.status', properties: { sessionID: 'two', status: 'busy' } } });
      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'two', status: 'idle' } } });
      await new Promise((resolve) => setImmediate(resolve));
    }

    await complete();
    await complete();
    await complete();

    assert.equal(prompts.length, 3);
    assert.match(prompts[2].body.parts[0].text, /Tell the user/i);

    await hooks['chat.message']({ sessionID: 'two' }, { parts: [{ type: 'text', text: prompts[2].body.parts[0].text }] });
    await assert.rejects(
      hooks['tool.execute.before']({ tool: 'edit', sessionID: 'two' }, { args: { filePath: 'src/parser.js' } }),
      /stopped this session/i,
    );

    fs.mkdirSync(path.join(workdir, 'src'));
    fs.writeFileSync(path.join(workdir, 'src', 'parser.js'), 'export const parser = true;\n');
    writePreference(workdir, { done_criteria: [{ id: 'parser-exists', checks: [{ type: 'file_exists', path: 'src/parser.js' }] }] });

    await hooks['tool.execute.before']({ tool: 'edit', sessionID: 'two' }, { args: { filePath: 'src/parser.js' } });
    assert.equal(judge.calls.at(-1).userMessage, '', 'Guard feedback is not treated as the owner speaking');
  });
});

test('a Preference change made during an agent tool run is quarantined', async () => {
  await withWorkdir(async (workdir) => {
    writePreference(workdir, { purpose: 'First purpose.' });
    const hooks = await BorderCollie({ directory: workdir, client: {} }, { judge: judgeDouble() });
    const before = hooks['tool.execute.before'];
    const after = hooks['tool.execute.after'];

    await before({ tool: 'bash', sessionID: 'three' }, { args: { command: 'node script.js' } });
    writePreference(workdir, { purpose: 'Rewritten by a script.' });
    await after({ tool: 'bash', sessionID: 'three' }, { output: '' });

    await assert.rejects(
      before({ tool: 'edit', sessionID: 'three' }, { args: { filePath: 'lib/a.js' } }),
      /changed during an agent tool/i,
    );

    writePreference(workdir, { purpose: 'Corrected by the owner.' });
    await before({ tool: 'edit', sessionID: 'three' }, { args: { filePath: 'lib/a.js' } });
  });
});

test('the latest user message is read from the session when the hook missed it', async () => {
  await withWorkdir(async (workdir) => {
    const judge = judgeDouble();
    const hooks = await BorderCollie({
      directory: workdir,
      client: {
        session: {
          messages: async () => [
            { info: { role: 'user' }, parts: [{ type: 'text', text: 'first request' }] },
            { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'working' }] },
            { info: { role: 'user' }, parts: [{ type: 'text', text: 'second request' }] },
          ],
        },
      },
    }, { judge });
    await hooks['tool.execute.before']({ tool: 'read', sessionID: 'four' }, { args: { filePath: 'README.md' } });
    assert.equal(judge.calls[0].userMessage, 'second request');
  });
});

test('without a retrieved Judge every call is refused with the install remedy', async () => {
  await withWorkdir(async (workdir) => {
    process.env.BORDER_COLLIE_JUDGE_ROOT = path.join(workdir, 'no-judge');
    try {
      const hooks = await BorderCollie({ directory: workdir, client: {} });
      await assert.rejects(
        hooks['tool.execute.before']({ tool: 'read', sessionID: 'five' }, { args: { filePath: 'README.md' } }),
        (error) => {
          assert.match(error.message, /Governing rule: judge_unavailable/);
          assert.match(error.message, /bdc install/);
          return true;
        },
      );
    } finally {
      delete process.env.BORDER_COLLIE_JUDGE_ROOT;
    }
  });
});

test('OpenCode V2 applies the Guard to live tool input', async () => {
  await withWorkdir(async (workdir) => {
    const previous = process.env.BORDER_COLLIE_NO_PET;
    process.env.BORDER_COLLIE_NO_PET = '1';
    try {
      writePreference(workdir, { purpose: 'Documentation work.' });
      process.env.BORDER_COLLIE_JUDGE_ROOT = path.join(workdir, 'no-judge');
      const registered = {};
      assert.equal(pluginModule.default.id, 'border-collie');
      const cleanup = await pluginModule.default.setup({
        location: { directory: workdir },
        session: { context: async () => [] },
        tool: {
          hook: async (name, callback) => {
            registered[name] = callback;
          },
        },
        event: {
          subscribe() {
            return (async function* () {})();
          },
        },
      });
      await assert.rejects(
        registered['execute.before']({
          tool: 'edit',
          sessionID: 'session-v2',
          callID: 'call-1',
          agent: 'build',
          messageID: 'msg-1',
          id: 'call-1',
          input: { path: '.opencode/protocol.json', update: true },
        }),
        /Decided by: folder boundary/i,
      );
      await assert.rejects(
        registered['execute.before']({
          tool: 'read',
          sessionID: 'session-v2',
          callID: 'call-2',
          input: { path: 'README.md' },
        }),
        /judge_unavailable/i,
      );
      cleanup();
    } finally {
      delete process.env.BORDER_COLLIE_JUDGE_ROOT;
      if (previous === undefined) delete process.env.BORDER_COLLIE_NO_PET;
      else process.env.BORDER_COLLIE_NO_PET = previous;
    }
  });
});
