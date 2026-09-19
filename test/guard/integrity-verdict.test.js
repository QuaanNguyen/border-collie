'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createSession } = require('../../guard/lib/session');

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
