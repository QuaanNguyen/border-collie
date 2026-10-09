'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const cli = path.resolve(__dirname, '..', '..', 'scripts', 'border-collie.js');

function bdc(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

test('bdc documents install, migrate, and pet size', () => {
  const result = bdc(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: bdc <command>/);
  for (const command of ['install', 'migrate', 'pet size']) assert.match(result.stdout, new RegExp(command));
  assert.doesNotMatch(result.stdout, /profile (list|show|create|assign)|project setup/);
});

test('bdc rejects unknown and retired commands', () => {
  for (const args of [['unknown'], ['profile', 'list'], ['project', 'setup'], ['migrate', 'extra']]) {
    const result = bdc(args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /Usage: bdc/);
  }
});
