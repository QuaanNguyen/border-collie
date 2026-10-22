'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { installPlugin } = require('../../scripts/install-plugin');
const { fakeGateManifest } = require('../fixtures/fake-gate');

test('Global bind stages a complete package without downloading a runtime', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xor-install-'));
  const destDir = path.join(temp, 'plugins');

  try {
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, 'xor.js'), 'legacy\n');
    const result = await installPlugin({
      destDir,
      gateRoot: path.join(temp, 'gate'),
      gateManifest: fakeGateManifest(path.join(temp, 'source')).manifest,
      skipRuntimeSetup: true,
    });
    assert.equal(result.dest, path.join(result.packageDir, 'index.mjs'));
    assert.equal(fs.existsSync(path.join(destDir, 'xor.js')), false);
    assert(fs.existsSync(path.join(result.packageDir, 'index.mjs')));
    assert(fs.existsSync(path.join(result.packageDir, 'xor', 'lib', 'session.js')));
    assert(fs.existsSync(path.join(result.packageDir, 'events', 'index.js')));
    assert(fs.existsSync(path.join(result.petDir, 'package.json')));
    assert(fs.existsSync(path.join(result.gateDir, 'needle3.cact')));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Global bind excludes experiment artifacts and broken research links', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xor-research-install-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const repoRoot = path.join(temp, 'repo');
  for (const [name, contents] of [
    ['plugin/xor.js', 'export function xor() {}\n'],
    ['plugin/tui.mjs', 'export default {}\n'],
    ['plugin/pet-rpc.mjs', 'export default {}\n'],
    ['plugin/runtime-root.mjs', 'export default {}\n'],
    ['xor/lib/session.js', 'module.exports = {};\n'],
    ['events/index.js', 'module.exports = {};\n'],
    ['pet/package.json', '{}\n'],
    ['xor/prototype/output/result.json', '{}\n'],
  ]) {
    const target = path.join(repoRoot, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  fs.symlinkSync(path.join(temp, 'missing-runner'), path.join(repoRoot, 'xor/prototype/output/needle'), process.platform === 'win32' ? 'junction' : 'file');
  const result = await installPlugin({
    repoRoot,
    destDir: path.join(temp, 'plugins'),
    gateRoot: path.join(temp, 'gate'),
    gateManifest: fakeGateManifest(path.join(temp, 'gate-source')).manifest,
    skipRuntimeSetup: true,
  });
  assert(fs.existsSync(path.join(result.packageDir, 'xor/lib/session.js')));
  assert.equal(fs.existsSync(path.join(result.packageDir, 'xor/prototype')), false);
});
