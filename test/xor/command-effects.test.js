'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createSession } = require('../../xor/lib/session');
const { proposedCall } = require('../../xor/lib/toolcalls');
const { judgeRequest } = require('../../xor/lib/judge');
const { DEFAULT_PREFERENCE } = require('../../xor/lib/preference');

test('deletion commands cannot reach the Judge with protected effects omitted', async (t) => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-command-effects-'));
  t.after(() => fs.rmSync(workdir, { recursive: true, force: true }));
  for (const command of ['find .bordercollie -type f -delete', 'find .bordercollie -type f -exec rm -- {} +', 'git clean -fd .bordercollie', 'git -C .bordercollie clean -fd', 'env MODE=test find .bordercollie -delete', 'target=.bordercollie; rm -rf "$target"']) {
    let judged = false;
    const session = createSession({ workdir, judge: async () => { judged = true; return { verdict: 'allow' }; } });
    const result = await session.propose({ tool: 'shell', args: { command }, userMessage: 'Fix the parser.' });
    assert.equal(result.decision, 'disallow', command);
    assert.equal(judged, false, command);
  }
});

test('read-only counterparts preserve ordinary requested work', async (t) => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-command-read-'));
  t.after(() => fs.rmSync(workdir, { recursive: true, force: true }));
  for (const command of ['find src -type f -print', 'git clean -nd .bordercollie', 'target=build/cache; rm -rf "${target}"', "env | awk -F= '/^DEMO_/ {print $1}'"]) {
    const session = createSession({ workdir, judge: async () => ({ verdict: 'allow' }) });
    assert.equal((await session.propose({ tool: 'shell', args: { command }, userMessage: 'Inspect local files.' })).decision, 'allow', command);
  }
});

test('the Judge sees complete commands, user wording, environment disclosure and scheduler effects', () => {
  const command = 'printf ' + 'x'.repeat(250) + '; env; scancel --user=other-owner 123456';
  const userMessage = 'Inspect the parser.\n' + 'Context. '.repeat(100) + 'Do not cancel any jobs.';
  const request = judgeRequest({ userMessage, preference: DEFAULT_PREFERENCE, call: proposedCall('shell', { command }) });
  assert.ok(request.query.includes(JSON.stringify(command)));
  assert.ok(request.query.includes(userMessage));
  assert.match(request.query, /environment disclosure/i);
  assert.match(request.query, /cancel scheduled jobs/i);
});
