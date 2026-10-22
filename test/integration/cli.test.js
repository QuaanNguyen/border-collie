'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const xorCli = path.resolve(__dirname, '..', '..', 'scripts', 'xor.js');
const legacyCli = path.resolve(__dirname, '..', '..', 'scripts', 'bordercollie.js');

function runCli(cliPath, args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
}

test('xor documents install, migrate, and pet size', () => {
  for (const cli of [xorCli, legacyCli]) {
    const result = runCli(cli, ['--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage: xor <command>/);
    for (const command of ['install', 'migrate', 'pet size']) assert.match(result.stdout, new RegExp(command));
    assert.doesNotMatch(result.stdout, /profile (list|show|create|assign)|project setup/);
  }
});

test('xor rejects unknown and retired commands', () => {
  for (const cli of [xorCli, legacyCli]) {
    for (const args of [['unknown'], ['profile', 'list'], ['project', 'setup'], ['migrate', 'extra']]) {
      const result = runCli(cli, args);
      assert.equal(result.status, 2, args.join(' '));
      assert.match(result.stderr, /Usage: xor/);
    }
  }
});
