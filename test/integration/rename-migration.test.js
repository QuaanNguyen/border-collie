'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { migrate } = require('../../scripts/migrate');
const { readProjectProtocol } = require('../../bordercollie/lib/live-protocol');
const { replaceInstallation } = require('../../scripts/install-plugin');

test('rename preserves complete existing project and owner settings', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-rename-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = path.join(root, '.border-collie');
  fs.mkdirSync(legacy);
  const contents = '{"write_paths":["docs/**"],"done_criteria":[{"id":"review","text":"Owner review"}]}\n';
  fs.writeFileSync(path.join(legacy, 'protocol.json'), contents);
  assert.deepEqual(readProjectProtocol(root).protocol.write_paths, ['docs/**']);
  const owner = path.join(root, '.config', 'border-collie');
  fs.mkdirSync(owner, { recursive: true });
  fs.writeFileSync(path.join(owner, 'config.json'), '{"pet":{"scale":1.35},"profiles":{"owner":"unchanged"}}');
  assert.equal(migrate({ workdir: root, home: root }).moved.length, 2);
  assert.equal(fs.readFileSync(path.join(root, '.bordercollie', 'protocol.json'), 'utf8'), contents);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.config', 'bordercollie', 'config.json'))).pet.scale, 1.35);
  assert.deepEqual(migrate({ workdir: root, home: root }).moved, []);
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, 'preference.json'), '{"allow":"docs"}');
  assert.throws(() => migrate({ workdir: root, home: root }), /Nothing was changed/);
  assert.equal(fs.existsSync(path.join(legacy, 'preference.json')), true);
});

test('renamed installation restores the previous plugin after verification failure', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-plugin-rename-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const oldPackage = path.join(root, 'border-collie');
  const oldEntry = path.join(root, 'border-collie.js');
  fs.mkdirSync(oldPackage);
  fs.writeFileSync(path.join(oldPackage, 'original'), 'original package');
  fs.writeFileSync(oldEntry, 'original entry');
  const stage = path.join(root, 'stage');
  fs.mkdirSync(stage);
  const input = { stagePackage: stage, packageDir: path.join(root, 'bordercollie'), entry: path.join(root, 'bordercollie.js'), pluginsDir: root };
  assert.throws(() => replaceInstallation({ ...input, verify: () => { throw new Error('readiness failed'); } }), /readiness failed/);
  assert.equal(fs.readFileSync(oldEntry, 'utf8'), 'original entry');
  assert.equal(fs.readFileSync(path.join(oldPackage, 'original'), 'utf8'), 'original package');
  fs.mkdirSync(stage);
  replaceInstallation(input);
  assert.equal(fs.existsSync(oldEntry), false);
  assert.equal(fs.existsSync(oldPackage), false);
  assert.equal(fs.existsSync(input.packageDir), true);
});
