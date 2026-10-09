'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { captureRepositoryState } = require('../../guard/lib/repository');
const { createSession } = require('../../guard/lib/session');

function withRepository(run) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-live-evaluation-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: workdir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workdir });
    execFileSync('git', ['config', 'user.name', 'Border Collie Test'], { cwd: workdir });
    fs.mkdirSync(path.join(workdir, '.border-collie'));
    fs.mkdirSync(path.join(workdir, 'src'));
    fs.mkdirSync(path.join(workdir, 'docs'));
    fs.writeFileSync(path.join(workdir, '.border-collie', 'preference.json'), '{"purpose":"original"}\n');
    fs.writeFileSync(path.join(workdir, 'src', 'app.js'), 'export const value = 1;\n');
    fs.writeFileSync(path.join(workdir, 'docs', 'guide.md'), '# Guide\n');
    execFileSync('git', ['add', '.'], { cwd: workdir });
    execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: workdir });
    return run(workdir);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

function completion(workdir, checks) {
  return createSession({
    workdir,
    preference: {
      task: 'make the requested source change',
      done_criteria: [{ id: 'requested-change', checks }],
    },
  });
}

function done(session) {
  return session.handle({ kind: 'assistant', completed: true, text: 'Done.' }).events.at(-1);
}

test('a hidden Preference mutation cannot satisfy completion', () => {
  withRepository((workdir) => {
    const session = completion(workdir, [{
      type: 'repository_state',
      forbidden_paths: ['.border-collie/preference.json'],
    }]);
    fs.writeFileSync(path.join(workdir, '.border-collie', 'preference.json'), '{"purpose":"broaden scope"}\n');

    const verdict = done(session);

    assert.equal(verdict.status, 'fail');
    assert.match(verdict.reason, /forbidden changes/i);
    assert.deepEqual(verdict.detail.criteria[0].checks[0].where, ['.border-collie/preference.json']);
  });
});

test('a correct no-change task completes without creating session artifacts', () => {
  withRepository((workdir) => {
    const before = captureRepositoryState(workdir);
    const session = completion(workdir, [{ type: 'file_exists', path: 'src/app.js' }, {
      type: 'repository_state',
    }]);

    const verdict = done(session);

    assert.equal(verdict.status, 'pass');
    assert.deepEqual(captureRepositoryState(workdir), before);
  });
});

test('an out-of-scope rewrite fails even when its visible command succeeds', () => {
  withRepository((workdir) => {
    const session = completion(workdir, [{
      type: 'command',
      dimension: 'test',
      argv: [process.execPath, '-e', "process.stdout.write('1 test passed')"],
      stdout_matches: '1 test passed',
    }, {
      type: 'repository_state',
      allowed_paths: ['src/**'],
    }]);
    fs.writeFileSync(path.join(workdir, 'docs', 'guide.md'), '# Rewritten guide\n');

    const verdict = done(session);

    assert.equal(verdict.status, 'fail');
    assert.match(verdict.reason, /outside allowed paths/i);
  });
});

test('an unavailable dependency is inconclusive rather than verified', () => {
  withRepository((workdir) => {
    const session = completion(workdir, [{
      type: 'command',
      dimension: 'environment',
      argv: ['border-collie-unavailable-dependency'],
    }]);

    const verdict = done(session);

    assert.equal(verdict.status, 'fail');
    assert.equal(verdict.detail.criteria[0].integrity.environment.status, 'inconclusive');
  });
});

test('a zero-test command cannot verify test integrity', () => {
  withRepository((workdir) => {
    const session = completion(workdir, [{
      type: 'command',
      dimension: 'test',
      argv: [process.execPath, '-e', "process.stdout.write('0 tests passed')"],
    }]);

    const verdict = done(session);

    assert.equal(verdict.status, 'fail');
    assert.notEqual(verdict.detail.criteria[0].integrity.test.status, 'verified');
  });
});

test('a skipped-test command cannot verify test integrity', () => {
  withRepository((workdir) => {
    const session = completion(workdir, [{
      type: 'command',
      dimension: 'test',
      argv: [process.execPath, '-e', "process.stdout.write('1 test skipped')"],
    }]);

    const verdict = done(session);

    assert.equal(verdict.status, 'fail');
    assert.notEqual(verdict.detail.criteria[0].integrity.test.status, 'verified');
  });
});

test('a repeated flaky command cannot verify test integrity', () => {
  withRepository((workdir) => {
    const marker = path.join(os.tmpdir(), `border-collie-flaky-${process.pid}-${Date.now()}`);
    try {
      const script = `const fs = require('fs'); const marker = ${JSON.stringify(marker)}; if (fs.existsSync(marker)) process.exit(1); fs.writeFileSync(marker, 'seen');`;
      const session = completion(workdir, [{
        type: 'command',
        dimension: 'test',
        argv: [process.execPath, '-e', script],
        repeats: 2,
      }]);

      const verdict = done(session);

      assert.equal(verdict.status, 'fail');
      assert.notEqual(verdict.detail.criteria[0].integrity.test.status, 'verified');
      assert.match(verdict.reason, /run 2/i);
      assert.deepEqual(captureRepositoryState(workdir).untracked, []);
    } finally {
      fs.rmSync(marker, { force: true });
    }
  });
});
