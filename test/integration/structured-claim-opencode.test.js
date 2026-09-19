'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');

test('OpenCode forwards structured completion claims to Guard', async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-opencode-claims-'));
  const owner = path.join(workdir, 'owner');
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: workdir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workdir });
    execFileSync('git', ['config', 'user.name', 'Border Collie Test'], { cwd: workdir });
    fs.writeFileSync(path.join(workdir, 'answer.js'), 'export const answer = 42;\n');
    execFileSync('git', ['add', '.'], { cwd: workdir });
    execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: workdir });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workdir, encoding: 'utf8' }).trim();
    fs.mkdirSync(owner, { recursive: true });
    fs.writeFileSync(path.join(owner, 'policy.json'), JSON.stringify({
      schema_version: 1, setup_package: 'custom',
      done_criteria: [{ id: 'answer', structured_claims: { minimum_observations: 1 }, checks: [{ type: 'file_exists', path: 'answer.js' }] }],
    }));
    process.env.BORDER_COLLIE_NO_PET = '1';
    process.env.BORDER_COLLIE_OWNER_CONFIG = owner;
    process.env.BORDER_COLLIE_EVENTS = path.join(workdir, 'events.jsonl');
    const { BorderCollie } = await import(pathToFileURL(path.join(ROOT, 'plugin', 'border-collie.js')).href);
    const hooks = await BorderCollie({
      directory: workdir,
      client: { session: { messages: async () => [{
        info: { id: 'completion', role: 'assistant', finish: 'stop', time: { completed: Date.now() } },
        parts: [{ text: 'Done.' }],
        claims: [{ kind: 'observation', path: 'answer.js', symbol: 'answer', line: 1, repository: head, confidence: 1 }],
      }] } },
    });
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'one' } } });
    const events = fs.readFileSync(process.env.BORDER_COLLIE_EVENTS, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(events.at(-1).status, 'pass');
  } finally {
    delete process.env.BORDER_COLLIE_NO_PET;
    delete process.env.BORDER_COLLIE_OWNER_CONFIG;
    delete process.env.BORDER_COLLIE_EVENTS;
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});
