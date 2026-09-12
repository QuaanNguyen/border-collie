'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const test = require('node:test');

const { runCheck } = require('../../guard/lib/verify');

test('command evidence uses explicit argv and a sanitized environment', () => {
  const previous = process.env.BORDER_COLLIE_TEST_SECRET;
  process.env.BORDER_COLLIE_TEST_SECRET = 'must-not-leak';
  try {
    const passed = runCheck({
      type: 'command',
      argv: [
        process.execPath,
        '-e',
        "process.stdout.write(`${process.env.DECLARED}:${String(process.env.BORDER_COLLIE_TEST_SECRET)}`)",
      ],
      env: { DECLARED: 'declared' },
      stdout_matches: 'declared:undefined',
      timeout_ms: 1_000,
      repeats: 2,
    }, os.tmpdir());

    assert.equal(passed.pass, true);

    const globalMatcher = runCheck({
      type: 'command',
      argv: [process.execPath, '-e', "process.stdout.write('verified')"],
      stdout_matches: 'verified',
      stdout_flags: 'g',
      timeout_ms: 1_000,
      repeats: 2,
    }, os.tmpdir());

    assert.equal(globalMatcher.pass, true);

    const missingSignal = runCheck({
      type: 'command',
      argv: [process.execPath, '-e', "process.stdout.write('0 tests')"],
      stdout_matches: '[1-9] tests passed',
      timeout_ms: 1_000,
    }, os.tmpdir());

    assert.equal(missingSignal.pass, false);
    assert.match(missingSignal.evidence, /does not match/i);

    const invalid = runCheck({
      type: 'command',
      argv: 'node test.js',
      timeout_ms: 1_000,
    }, os.tmpdir());

    assert.equal(invalid.pass, false);
    assert.match(invalid.evidence, /argv/i);
  } finally {
    if (previous === undefined) delete process.env.BORDER_COLLIE_TEST_SECRET;
    else process.env.BORDER_COLLIE_TEST_SECRET = previous;
  }
});
