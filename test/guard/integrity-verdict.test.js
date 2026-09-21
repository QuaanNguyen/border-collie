'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createSession } = require('../../guard/lib/session');

function withRepository(run) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-integrity-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: workdir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workdir });
    execFileSync('git', ['config', 'user.name', 'Border Collie Test'], { cwd: workdir });
    fs.writeFileSync(path.join(workdir, 'proof.txt'), 'proof\n');
    execFileSync('git', ['add', '.'], { cwd: workdir });
    execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: workdir });
    return run(workdir);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

test('a terminal Guard verdict separates unavailable environment evidence from completion state', () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-integrity-'));
  try {
    const session = createSession({
      workdir,
      protocol: {
        task: 'verify an environment-dependent result',
        done_criteria: [{
          id: 'environment-proof',
          checks: [{ type: 'command', dimension: 'environment', argv: ['border-collie-missing-command'] }],
        }],
      },
    });
    const result = session.handle({ kind: 'assistant', completed: true, text: 'Done.' });
    const verdict = result.events.at(-1);
    assert.equal(verdict.status, 'fail');
    assert.equal(verdict.detail.criteria[0].integrity.environment.status, 'inconclusive');
    assert.equal(verdict.detail.criteria[0].integrity.completion.status, 'failed');
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('a terminal Guard verdict treats an unavailable repository as inconclusive evidence', () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-integrity-'));
  try {
    const session = createSession({
      workdir,
      protocol: {
        task: 'verify repository state',
        done_criteria: [{
          id: 'repository-proof',
          checks: [{ type: 'repository_state', require_changes: true }],
        }],
      },
    });
    const result = session.handle({ kind: 'assistant', completed: true, text: 'Done.' });
    const verdict = result.events.at(-1);
    assert.equal(verdict.status, 'fail');
    assert.equal(verdict.detail.criteria[0].integrity.repository.status, 'inconclusive');
    assert.equal(verdict.detail.criteria[0].integrity.completion.status, 'failed');
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('a terminal Guard verdict reports each verified integrity dimension separately', () => {
  withRepository((workdir) => {
    const command = [process.execPath, '-e', 'process.stdout.write("proof\\n")'];
    const session = createSession({
      workdir,
      protocol: {
        task: 'verify a scoped implementation',
        done_criteria: [{
          id: 'complete-proof',
          checks: [
            { type: 'repository_state', dimension: 'repository' },
            { type: 'repository_state', dimension: 'patch_scope', allowed_paths: ['proof.txt'] },
            { type: 'command', dimension: 'test', argv: command },
            { type: 'command', dimension: 'environment', argv: command },
            { type: 'command', dimension: 'reproduction', argv: command },
            { type: 'command', dimension: 'behavioral_regression', argv: command },
          ],
        }],
      },
    });
    const result = session.handle({ kind: 'assistant', completed: true, text: 'Done.' });
    const integrity = result.events.at(-1).detail.criteria[0].integrity;
    for (const dimension of ['repository', 'test', 'environment', 'reproduction', 'patch_scope', 'behavioral_regression', 'completion']) {
      assert.equal(integrity[dimension].status, 'verified', dimension);
    }
  });
});

test('a zero-test command cannot verify test integrity', () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-integrity-'));
  try {
    const session = createSession({
      workdir,
      protocol: {
        task: 'verify a test run',
        done_criteria: [{
          id: 'test-proof',
          checks: [{
            type: 'command',
            dimension: 'test',
            argv: [process.execPath, '-e', 'process.stdout.write("0 tests passed\\n")'],
          }],
        }],
      },
    });
    const result = session.handle({ kind: 'assistant', completed: true, text: 'Done.' });
    const integrity = result.events.at(-1).detail.criteria[0].integrity;
    assert.equal(integrity.test.status, 'failed');
    assert.equal(integrity.completion.status, 'failed');
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('a passing command cannot overwrite a failed integrity dimension', () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-integrity-'));
  try {
    const session = createSession({
      workdir,
      protocol: {
        task: 'verify a test run',
        done_criteria: [{
          id: 'test-proof',
          checks: [
            { type: 'command', dimension: 'test', argv: [process.execPath, '-e', 'process.stdout.write("0 tests passed\\n")'] },
            { type: 'command', integrity_dimension: 'test', argv: [process.execPath, '-e', 'process.stdout.write("1 test passed\\n")'] },
          ],
        }],
      },
    });
    const result = session.handle({ kind: 'assistant', completed: true, text: 'Done.' });
    const integrity = result.events.at(-1).detail.criteria[0].integrity;
    assert.equal(integrity.test.status, 'failed');
    assert.equal(integrity.completion.status, 'failed');
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});
