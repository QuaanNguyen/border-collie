'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSession } = require('../../bordercollie/lib/session');

async function withWorkdir(run) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-session-'));
  try {
    return await run(workdir);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

test('a Preference replacement resets completion verification', () => {
  withWorkdir((workdir) => {
    fs.writeFileSync(path.join(workdir, 'first.txt'), 'first');
    const session = createSession({
      workdir,
      preference: {
        text: 'verify the first result',
        done_criteria: [{
          id: 'first-result',
          checks: [{ type: 'file_exists', path: 'first.txt' }],
        }],
      },
    });

    const first = session.handle({ kind: 'assistant', completed: true, text: 'Done.' });
    assert.equal(first.events.at(-1).status, 'pass');

    session.replacePreference({
      text: 'verify the second result',
      done_criteria: [{
        id: 'second-result',
        checks: [{ type: 'file_exists', path: 'second.txt' }],
      }],
    });

    const second = session.handle({ kind: 'assistant', completed: true, text: 'Done.' });
    assert.equal(second.events.at(-1).status, 'fail');
    assert.match(second.events.at(-1).reason, /second\.txt does not exist/);
  });
});

test('completion claims receive bounded remediation and then stop the session', async () => {
  await withWorkdir(async (workdir) => {
    const session = createSession({
      workdir,
      preference: {
        text: 'Fix the parser. Read any local file and edit only src/.',
        done_criteria: [{
          id: 'parser-fixed',
          claim_mentions: ['parser'],
          claim_verbs: ['fixed'],
          checks: [{ type: 'file_exists', path: 'src/parser.js' }],
        }],
      },
    });

    const incomplete = session.handle({ kind: 'assistant', completed: false, text: 'Parser fixed.' });
    assert.deepEqual(incomplete.events, []);

    const unrelated = session.handle({ kind: 'assistant', completed: true, text: 'Documentation updated.' });
    assert.deepEqual(unrelated.events, []);

    const first = session.handle({ kind: 'assistant', completed: true, text: 'Parser fixed.' });
    assert.ok(first.inject);
    assert.doesNotMatch(first.inject, /attempt/i);
    assert.equal(first.events.at(-1).detail.terminal, false);

    const second = session.handle({ kind: 'assistant', completed: true, text: 'Parser fixed.' });
    assert.ok(second.inject);
    assert.equal(second.events.at(-1).detail.terminal, false);

    const terminal = session.handle({ kind: 'assistant', completed: true, text: 'Parser fixed.' });
    assert.match(terminal.inject, /Tell the user/i);
    assert.equal(terminal.events.at(-1).status, 'fail');
    assert.equal(terminal.events.at(-1).detail.terminal, true);

    const blocked = await session.propose({ tool: 'edit', args: { filePath: 'src/parser.js' } });
    assert.equal(blocked.decision, 'disallow');
    assert.equal(blocked.events.at(-1).rule, 'completion_terminal');

    fs.mkdirSync(path.join(workdir, 'src'));
    fs.writeFileSync(path.join(workdir, 'src', 'parser.js'), 'export const parser = true;\n');
    session.replacePreference({
      text: 'verify parser',
      done_criteria: [{
        id: 'parser-exists',
        checks: [{ type: 'file_exists', path: 'src/parser.js' }],
      }],
    });

    const reset = session.handle({ kind: 'assistant', completed: true, text: 'Done.' });
    assert.equal(reset.events.at(-1).status, 'pass');
  });
});
