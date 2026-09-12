'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { captureRepositoryState, evaluateRepositoryState } = require('../../guard/lib/repository');
const { createSession } = require('../../guard/lib/session');

function withRepository(run) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-repository-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: workdir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workdir });
    execFileSync('git', ['config', 'user.name', 'Border Collie Test'], { cwd: workdir });
    fs.mkdirSync(path.join(workdir, 'src'));
    fs.writeFileSync(path.join(workdir, 'src', 'app.js'), 'export const value = 1;\n');
    fs.writeFileSync(path.join(workdir, '.gitignore'), 'generated/\n');
    execFileSync('git', ['add', '.'], { cwd: workdir });
    execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: workdir });
    return run(workdir);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

test('repository checks isolate new mutations from the initial dirty worktree', () => {
  withRepository((workdir) => {
    fs.writeFileSync(path.join(workdir, 'src', 'app.js'), 'export const value = 2;\n');
    const baseline = captureRepositoryState(workdir);

    fs.writeFileSync(path.join(workdir, 'src', 'app.js'), 'export const value = 3;\n');
    fs.writeFileSync(path.join(workdir, 'src', 'new file.js'), 'export const next = true;\n');
    fs.mkdirSync(path.join(workdir, 'generated'));
    fs.writeFileSync(path.join(workdir, 'generated', 'result.js'), 'generated\n');

    const rejected = evaluateRepositoryState({
      type: 'repository_state',
      require_changes: true,
      allowed_paths: ['src/**'],
      forbidden_paths: ['generated/**'],
    }, baseline, captureRepositoryState(workdir));

    assert.equal(rejected.pass, false);
    assert.deepEqual(rejected.where, ['generated/result.js']);

    fs.rmSync(path.join(workdir, 'generated'), { recursive: true, force: true });

    const accepted = evaluateRepositoryState({
      type: 'repository_state',
      require_changes: true,
      allowed_paths: ['src/**'],
      forbidden_paths: ['generated/**'],
    }, baseline, captureRepositoryState(workdir));

    assert.equal(accepted.pass, true);
  });
});

test('a session evaluates repository-state criteria against its initial worktree', () => {
  withRepository((workdir) => {
    const session = createSession({
      workdir,
      protocol: {
        task: 'edit source files',
        done_criteria: [{
          id: 'scoped-patch',
          checks: [{
            type: 'repository_state',
            require_changes: true,
            allowed_paths: ['src/**'],
            forbidden_paths: ['generated/**'],
          }],
        }],
      },
    });

    fs.mkdirSync(path.join(workdir, 'generated'));
    fs.writeFileSync(path.join(workdir, 'generated', 'result.js'), 'generated\n');

    const result = session.handle({ kind: 'assistant', completed: true, text: 'Done.' });
    assert.equal(result.events.at(-1).status, 'fail');
    assert.match(result.events.at(-1).reason, /forbidden changes/i);
  });
});

test('a session detects edits to an ignored file named by a repository criterion', () => {
  withRepository((workdir) => {
    fs.mkdirSync(path.join(workdir, 'generated'));
    fs.writeFileSync(path.join(workdir, 'generated', 'result.js'), 'before\n');
    const session = createSession({
      workdir,
      protocol: {
        task: 'edit source files',
        done_criteria: [{
          id: 'no-generated-output',
          checks: [{
            type: 'repository_state',
            forbidden_paths: ['generated/**'],
          }],
        }],
      },
    });

    fs.writeFileSync(path.join(workdir, 'generated', 'result.js'), 'after\n');

    const result = session.handle({ kind: 'assistant', completed: true, text: 'Done.' });
    assert.equal(result.events.at(-1).status, 'fail');
    assert.match(result.events.at(-1).reason, /forbidden changes/i);
  });
});

test('repository checks can require the original base commit and a live worktree diff', () => {
  withRepository((workdir) => {
    const baseline = captureRepositoryState(workdir);
    fs.writeFileSync(path.join(workdir, 'src', 'app.js'), 'export const value = 2;\n');
    execFileSync('git', ['add', 'src/app.js'], { cwd: workdir });
    execFileSync('git', ['commit', '--quiet', '-m', 'agent commit'], { cwd: workdir });

    const result = evaluateRepositoryState({
      type: 'repository_state',
      require_base_commit: true,
      require_worktree_diff: true,
    }, baseline, captureRepositoryState(workdir));

    assert.equal(result.pass, false);
    assert.match(result.evidence, /base commit changed/i);
    assert.match(result.evidence, /worktree diff/i);
  });
});
