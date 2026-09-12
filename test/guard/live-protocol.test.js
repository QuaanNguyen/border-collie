'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createLiveProtocol } = require('../../guard/lib/live-protocol');

function withWorkdir(run) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-live-protocol-'));
  fs.mkdirSync(path.join(workdir, '.opencode'));
  try {
    return run(workdir);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

function writeProtocol(workdir, value) {
  fs.writeFileSync(path.join(workdir, '.opencode', 'protocol.json'), value);
}

test('a live Protocol accepts valid updates and fails closed for invalid ones', () => {
  withWorkdir((workdir) => {
    writeProtocol(workdir, JSON.stringify({ task: 'first task', write_paths: ['src/**'] }));
    const live = createLiveProtocol({
      workdir,
      owner: {
        task: 'owner task',
        read_paths: ['**'],
        write_paths: ['src/**'],
        allow_ordinary_bash: false,
      },
    });

    const first = live.refresh();
    assert.equal(first.valid, true);
    assert.equal(first.changed, true);
    assert.equal(first.protocol.task, 'first task');

    writeProtocol(workdir, JSON.stringify({ task: 'second task', write_paths: ['src/lib/**'] }));
    const second = live.refresh();
    assert.equal(second.valid, true);
    assert.equal(second.changed, true);
    assert.ok(second.revision > first.revision);
    assert.equal(second.protocol.task, 'second task');

    writeProtocol(workdir, '{');
    const malformed = live.refresh();
    assert.equal(malformed.valid, false);
    assert.match(malformed.reason, /malformed/i);

    writeProtocol(workdir, JSON.stringify({ task: 'broadened task', write_paths: ['**'] }));
    const broadening = live.refresh();
    assert.equal(broadening.valid, false);
    assert.match(broadening.reason, /broaden/i);
  });
});
