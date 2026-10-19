'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { migrate } = require('../../scripts/migrate');
const { readPreference, LEGACY_PREFERENCE_RELATIVE_PATH } = require('../../bordercollie/lib/preference');
const { LEGACY_PLUGIN_DIRECTORY, LEGACY_PLUGIN_ENTRY } = require('../../bordercollie/lib/legacy-paths');
const { replaceInstallation } = require('../../scripts/install-plugin');
const { boundaryDecision } = require('../../bordercollie/lib/boundary');
const { proposedCall } = require('../../bordercollie/lib/toolcalls');

test('renaming preserves existing owner instructions and migrates them without defaults', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-rename-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = path.join(root, LEGACY_PREFERENCE_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(legacy));
  const instructions = { purpose: 'Documentation only.', disallow: 'Changing source code.' };
  fs.writeFileSync(legacy, JSON.stringify(instructions));
  assert.match(readPreference(root).preference.text, /Changing source code/);
  assert.equal(boundaryDecision({ workdir: root, call: proposedCall('write', { path: LEGACY_PREFERENCE_RELATIVE_PATH, content: '{}' }) }).rule, 'preference');
  const result = migrate({ workdir: root, configRoot: path.join(root, 'config'), ownerPolicyPath: path.join(root, 'unused-policy') });
  assert.match(JSON.parse(fs.readFileSync(result.preferenceFile)).text, /Documentation only/);
  assert.match(JSON.parse(fs.readFileSync(result.preferenceFile)).text, /Changing source code/);
  assert.equal(fs.existsSync(legacy), false);
  fs.writeFileSync(legacy, JSON.stringify({ purpose: 'Different instructions.' }));
  assert.equal(readPreference(root).valid, false);
  assert.throws(() => migrate({ workdir: root }), /different instructions/);
  assert.equal(fs.existsSync(legacy), true);
});

test('renamed installation removes duplicate plugin entries and restores them after failure', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-install-rename-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const oldPackage = path.join(root, LEGACY_PLUGIN_DIRECTORY);
  const oldEntry = path.join(root, LEGACY_PLUGIN_ENTRY);
  fs.mkdirSync(oldPackage);
  fs.writeFileSync(path.join(oldPackage, 'original'), 'original package');
  fs.writeFileSync(oldEntry, 'original entry');
  const destination = path.join(root, 'bordercollie');
  const stage = path.join(root, 'stage');
  fs.mkdirSync(stage);
  assert.throws(() => replaceInstallation({ stagePackage: stage, packageDir: destination, entry: path.join(root, 'bordercollie.js'), pluginsDir: root, verify: () => { throw new Error('readiness failed'); } }), /readiness failed/);
  assert.equal(fs.readFileSync(oldEntry, 'utf8'), 'original entry');
  assert.equal(fs.readFileSync(path.join(oldPackage, 'original'), 'utf8'), 'original package');
  fs.mkdirSync(stage);
  replaceInstallation({ stagePackage: stage, packageDir: destination, entry: path.join(root, 'bordercollie.js'), pluginsDir: root });
  assert.equal(fs.existsSync(oldEntry), false);
  assert.equal(fs.existsSync(oldPackage), false);
  assert.equal(fs.existsSync(destination), true);
});
