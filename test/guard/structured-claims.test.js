'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createSession } = require('../../guard/lib/session');

function withRepository(run) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-structured-claim-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: workdir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workdir });
    execFileSync('git', ['config', 'user.name', 'Border Collie Test'], { cwd: workdir });
    fs.mkdirSync(path.join(workdir, 'src'));
    fs.writeFileSync(path.join(workdir, 'src', 'answer.js'), 'export const answer = 42;\n');
    execFileSync('git', ['add', '.'], { cwd: workdir });
    execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: workdir });
    return run(workdir, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workdir, encoding: 'utf8' }).trim());
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

function sessionFor(workdir) {
  return createSession({
    workdir,
    preference: {
      task: 'verify the answer implementation',
      done_criteria: [{
        id: 'answer-verified',
        claim_mentions: ['answer'],
        claim_verbs: ['verified'],
        structured_claims: { minimum_observations: 1 },
        checks: [{ type: 'file_exists', path: 'src/answer.js' }],
      }],
    },
  });
}

test('a structured observed fact verifies against the active repository', () => {
  withRepository((workdir, head) => {
    const result = sessionFor(workdir).handle({
      kind: 'assistant', completed: true, text: 'Answer verified.',
      claims: [{ kind: 'observation', path: 'src/answer.js', symbol: 'answer', line: 1, repository: head, confidence: 0.9 }],
    });
    assert.equal(result.events.at(-1).status, 'pass');
  });
});

test('a stale structured claim cannot support completion', () => {
  withRepository((workdir, head) => {
    const result = sessionFor(workdir).handle({
      kind: 'assistant', completed: true, text: 'Answer verified.',
      claims: [{ kind: 'observation', path: 'src/answer.js', symbol: 'answer', line: 2, repository: head, confidence: 0.9 }],
    });
    assert.equal(result.events.at(-1).status, 'fail');
    assert.match(result.events.at(-1).reason, /line anchor/i);
  });
});

test('a hypothesis cannot satisfy required factual evidence', () => {
  withRepository((workdir, head) => {
    const result = sessionFor(workdir).handle({
      kind: 'assistant', completed: true, text: 'Answer verified.',
      claims: [{ kind: 'hypothesis', path: 'src/answer.js', symbol: 'answer', line: 1, repository: head, confidence: 0.9 }],
    });
    assert.equal(result.events.at(-1).status, 'fail');
    assert.match(result.events.at(-1).reason, /observation/i);
  });
});
