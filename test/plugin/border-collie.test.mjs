import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginUrl = pathToFileURL(path.join(here, '../../plugin/border-collie.js')).href;
const { BorderCollie } = await import(pluginUrl);

async function withWorkdir(run) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-plugin-'));
  fs.mkdirSync(path.join(workdir, '.opencode'));
  try {
    return await run(workdir);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

function writeProtocol(workdir, protocol) {
  fs.writeFileSync(path.join(workdir, '.opencode', 'protocol.json'), JSON.stringify(protocol));
}

function protocol(writePaths) {
  return {
    task: 'edit the workspace',
    read_paths: ['**'],
    write_paths: writePaths,
    allow_ordinary_bash: false,
  };
}

test('the plugin protects and hot-reloads the Protocol during one session', async () => {
  await withWorkdir(async (workdir) => {
    const previous = process.env.BORDER_COLLIE_NO_PET;
    process.env.BORDER_COLLIE_NO_PET = '1';
    try {
      writeProtocol(workdir, protocol(['**']));
      const hooks = await BorderCollie({ directory: workdir, client: {} });
      const before = hooks['tool.execute.before'];

      await assert.rejects(
        before({ tool: 'edit', sessionID: 'session-1', args: { path: '.opencode/protocol.json' } }, {}),
        /protected path/i,
      );

      await before({ tool: 'edit', sessionID: 'session-1', args: { path: 'src/allowed.js' } }, {});

      writeProtocol(workdir, protocol(['lib/**']));

      await assert.rejects(
        before({ tool: 'edit', sessionID: 'session-1', args: { path: 'src/blocked.js' } }, {}),
        /write_paths/i,
      );
      await before({ tool: 'edit', sessionID: 'session-1', args: { path: 'lib/allowed.js' } }, {});

      fs.writeFileSync(path.join(workdir, '.opencode', 'protocol.json'), '{');

      await assert.rejects(
        before({ tool: 'edit', sessionID: 'session-1', args: { path: 'lib/blocked.js' } }, {}),
        /malformed/i,
      );
    } finally {
      if (previous === undefined) delete process.env.BORDER_COLLIE_NO_PET;
      else process.env.BORDER_COLLIE_NO_PET = previous;
    }
  });
});

test('the plugin remediates completion claims and waits for a Protocol correction', async () => {
  await withWorkdir(async (workdir) => {
    const previous = process.env.BORDER_COLLIE_NO_PET;
    process.env.BORDER_COLLIE_NO_PET = '1';
    try {
      writeProtocol(workdir, {
        ...protocol(['src/**']),
        done_criteria: [{
          id: 'parser-fixed',
          claim_mentions: ['parser'],
          claim_verbs: ['fixed'],
          checks: [{ type: 'file_exists', path: 'src/parser.js' }],
        }],
      });
      const prompts = [];
      let completion = 0;
      const hooks = await BorderCollie({
        directory: workdir,
        client: {
          session: {
            messages: async () => [{
              info: {
                id: `completion-${++completion}`,
                role: 'assistant',
                finish: 'stop',
                time: { completed: Date.now() },
              },
              parts: [{ text: 'Parser fixed.' }],
            }],
            promptAsync: async (value) => prompts.push(value),
          },
        },
      });

      async function complete() {
        await hooks.event({ event: { type: 'session.status', properties: { sessionID: 'session-2', status: 'busy' } } });
        await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'session-2', status: 'idle' } } });
        await new Promise((resolve) => setImmediate(resolve));
      }

      await complete();
      await complete();
      await complete();

      assert.equal(prompts.length, 3);
      assert.doesNotMatch(prompts[0].body.parts[0].text, /attempt/i);
      assert.match(prompts[2].body.parts[0].text, /Tell the user/i);

      await assert.rejects(
        hooks['tool.execute.before']({ tool: 'edit', sessionID: 'session-2', args: { path: 'src/parser.js' } }, {}),
        /completion_terminal/i,
      );

      fs.mkdirSync(path.join(workdir, 'src'));
      fs.writeFileSync(path.join(workdir, 'src', 'parser.js'), 'export const parser = true;\n');
      writeProtocol(workdir, {
        ...protocol(['src/**']),
        done_criteria: [{
          id: 'parser-exists',
          checks: [{ type: 'file_exists', path: 'src/parser.js' }],
        }],
      });

      await hooks['tool.execute.before']({ tool: 'edit', sessionID: 'session-2', args: { path: 'src/parser.js' } }, {});
    } finally {
      if (previous === undefined) delete process.env.BORDER_COLLIE_NO_PET;
      else process.env.BORDER_COLLIE_NO_PET = previous;
    }
  });
});

test('a Protocol change made during an agent tool run is quarantined', async () => {
  await withWorkdir(async (workdir) => {
    const previous = process.env.BORDER_COLLIE_NO_PET;
    process.env.BORDER_COLLIE_NO_PET = '1';
    try {
      writeProtocol(workdir, { ...protocol(['src/**']), allow_ordinary_bash: true });
      const hooks = await BorderCollie({ directory: workdir, client: {} });
      const before = hooks['tool.execute.before'];
      const after = hooks['tool.execute.after'];

      await before({ tool: 'shell', sessionID: 'session-3', args: { command: 'node script.js' } }, {});

      writeProtocol(workdir, { ...protocol(['lib/**']), allow_ordinary_bash: true });
      await after({ tool: 'shell', sessionID: 'session-3' }, { output: '' });

      await assert.rejects(
        before({ tool: 'edit', sessionID: 'session-3', args: { path: 'lib/blocked.js' } }, {}),
        /changed during an agent tool/i,
      );

      writeProtocol(workdir, {
        ...protocol(['lib/**']),
        task: 'human corrected the Protocol',
        allow_ordinary_bash: true,
      });

      await before({ tool: 'edit', sessionID: 'session-3', args: { path: 'lib/allowed.js' } }, {});
    } finally {
      if (previous === undefined) delete process.env.BORDER_COLLIE_NO_PET;
      else process.env.BORDER_COLLIE_NO_PET = previous;
    }
  });
});
