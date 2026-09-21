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

test('OpenCode preserves Guard terminal structured verdicts and remediation', async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-opencode-terminal-'));
  const owner = path.join(workdir, 'owner');
  const prompts = [];
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
      done_criteria: [{ id: 'answer', claim_mentions: ['answer'], structured_claims: { minimum_observations: 1 }, checks: [{ type: 'file_exists', path: 'answer.js' }] }],
    }));
    process.env.BORDER_COLLIE_NO_PET = '1';
    process.env.BORDER_COLLIE_OWNER_CONFIG = owner;
    process.env.BORDER_COLLIE_EVENTS = path.join(workdir, 'events.jsonl');
    let attempt = 0;
    const { BorderCollie } = await import(pathToFileURL(path.join(ROOT, 'plugin', 'border-collie.js')).href);
    const hooks = await BorderCollie({
      directory: workdir,
      client: { session: {
        messages: async () => {
          attempt += 1;
          return [{
            info: { id: `completion-${attempt}`, role: 'assistant', finish: 'stop', time: { completed: Date.now() } },
            parts: [{ text: 'The answer is fixed.' }],
            claims: [{ kind: 'observation', path: 'answer.js', symbol: 'missing', line: 1, repository: head, confidence: 1 }],
          }];
        },
        promptAsync: async (request) => { prompts.push(request); },
      } },
    });
    for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber += 1) {
      await hooks.event({ event: { type: 'session.status', properties: { sessionID: 'one', status: 'busy' } } });
      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'one' } } });
    }
    const events = fs.readFileSync(process.env.BORDER_COLLIE_EVENTS, 'utf8').trim().split('\n').map(JSON.parse);
    const verdict = events.filter((event) => event.type === 'verdict').at(-1);
    assert.equal(verdict.status, 'fail');
    assert.equal(verdict.detail.terminal, true);
    assert.equal(verdict.detail.criteria[0].checks.at(-1).evidence, 'structured claim symbol is unknown at answer.js:1');
    assert.equal(verdict.detail.criteria[0].integrity.completion.status, 'failed');
    assert.equal(prompts.length, 3);
    assert.equal(prompts.at(-1).body.noReply, true);
    assert.match(prompts.at(-1).body.parts[0].text, /Evaluation stopped\. Tell the user:/);
    assert.match(prompts.at(-1).body.parts[0].text, /structured claim symbol is unknown at answer\.js:1/);
  } finally {
    delete process.env.BORDER_COLLIE_NO_PET;
    delete process.env.BORDER_COLLIE_OWNER_CONFIG;
    delete process.env.BORDER_COLLIE_EVENTS;
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});
