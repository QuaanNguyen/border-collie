'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { installPlugin } = require('../../scripts/install-plugin');

test('Global bind stages a complete package without downloading a runtime', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-install-'));
  const destDir = path.join(temp, 'plugins');
  const ownerConfigDir = path.join(temp, 'owner');

  try {
    const result = installPlugin({ destDir, ownerConfigDir, skipRuntimeSetup: true });
    assert.equal(result.dest, path.join(destDir, 'border-collie.js'));
    assert(fs.existsSync(path.join(result.packageDir, 'guard', 'lib', 'session.js')));
    assert(fs.existsSync(path.join(result.packageDir, 'events', 'index.js')));
    assert(fs.existsSync(path.join(result.petDir, 'package.json')));

    const policy = JSON.parse(fs.readFileSync(result.ownerPolicyPath, 'utf8'));
    assert.deepEqual(policy, {
      schema_version: 1,
      setup_package: 'research-safe',
      trusted_workspace_roots: [],
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
