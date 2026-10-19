'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const cli = path.resolve(__dirname, '..', '..', 'scripts', 'bordercollie.js');

test('CLI documents the install command', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /bordercollie <command>/);
  assert.match(result.stdout, /install/);
});

test('CLI rejects an unknown command', () => {
  const result = spawnSync(process.execPath, [cli, 'unknown'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});
