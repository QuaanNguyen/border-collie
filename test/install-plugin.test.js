'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const { installPlugin } = require(path.join(ROOT, 'scripts/install-plugin'));
const temporaryDirectories = [];

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-install-'));
  temporaryDirectories.push(directory);
  return directory;
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (error) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
}

console.log('install plugin');

runTest('first install creates a Research-safe owner policy outside the package', () => {
  const root = temporaryDirectory();
  const pluginsDir = path.join(root, 'plugins');
  const ownerConfigDir = path.join(root, 'owner-config');
  const result = installPlugin({ repoRoot: ROOT, destDir: pluginsDir, ownerConfigDir, skipRuntimeSetup: true });
  const policyPath = path.join(ownerConfigDir, 'policy.json');

  assert.ok(fs.existsSync(result.dest));
  assert.ok(fs.existsSync(policyPath));
  assert.equal(fs.existsSync(path.join(result.packageDir, 'policy.json')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(policyPath, 'utf8')), {
    schema_version: 1,
    setup_package: 'research-safe',
    trusted_workspace_roots: [],
  });
});

runTest('first install accepts Custom only with supported owner settings', () => {
  const root = temporaryDirectory();
  const ownerConfigDir = path.join(root, 'owner-config');
  installPlugin({ repoRoot: ROOT, destDir: path.join(root, 'plugins'), ownerConfigDir, skipRuntimeSetup: true, setupPackage: 'custom', customPolicy: { read_paths: ['src/**'], allow_ordinary_bash: false, high_containment: true } });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ownerConfigDir, 'policy.json'), 'utf8')), { schema_version: 1, setup_package: 'custom', trusted_workspace_roots: [], read_paths: ['src/**'], allow_ordinary_bash: false });
});

runTest('install includes the desktop runtime source and remains importable', () => {
  const root = temporaryDirectory();
  const result = installPlugin({
    repoRoot: ROOT,
    destDir: path.join(root, 'plugins'),
    ownerConfigDir: path.join(root, 'owner-config'),
    skipRuntimeSetup: true,
  });

  assert.equal(result.petDir, path.join(result.packageDir, 'pet'));
  assert.equal(fs.existsSync(path.join(result.packageDir, 'pet', 'package.json')), true);
  const check = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `process.env.BORDER_COLLIE_NO_PET = '1'; import { BorderCollie } from ${JSON.stringify(result.dest)}; const hooks = await BorderCollie({ client: {}, directory: ${JSON.stringify(root)} }); const config = {}; await hooks.config(config); if (config.command === undefined) process.exit(2); process.emit('beforeExit');`,
  ], { encoding: 'utf8' });
  assert.strictEqual(check.status, 0, check.stderr);
});

runTest('reinstall preserves the owner policy across package replacement', () => {
  const root = temporaryDirectory();
  const pluginsDir = path.join(root, 'plugins');
  const ownerConfigDir = path.join(root, 'owner-config');
  const policyPath = path.join(ownerConfigDir, 'policy.json');
  const ownerPolicy = '{\n  "schema_version": 1,\n  "setup_package": "custom",\n  "trusted_workspace_roots": ["/shared/research"]\n}\n';

  installPlugin({ repoRoot: ROOT, destDir: pluginsDir, ownerConfigDir, skipRuntimeSetup: true });
  fs.writeFileSync(policyPath, ownerPolicy);
  const result = installPlugin({ repoRoot: ROOT, destDir: pluginsDir, ownerConfigDir, skipRuntimeSetup: true });

  assert.equal(fs.readFileSync(policyPath, 'utf8'), ownerPolicy);
  assert.ok(fs.existsSync(result.dest));
});

runTest('upgrade previews missing policy fields without changing owner choices', () => {
  const root = temporaryDirectory();
  const pluginsDir = path.join(root, 'plugins');
  const ownerConfigDir = path.join(root, 'owner-config');
  const policyPath = path.join(ownerConfigDir, 'policy.json');
  const ownerPolicy = '{\n  "schema_version": 0,\n  "setup_package": "custom"\n}\n';

  fs.mkdirSync(ownerConfigDir, { recursive: true });
  fs.writeFileSync(policyPath, ownerPolicy);
  const result = installPlugin({ repoRoot: ROOT, destDir: pluginsDir, ownerConfigDir, skipRuntimeSetup: true });

  assert.deepEqual(result.migrationPreview, {
    currentSchemaVersion: 0,
    targetSchemaVersion: 1,
    missingFields: ['trusted_workspace_roots'],
    recommendedPolicy: {
      schema_version: 1,
      setup_package: 'research-safe',
      trusted_workspace_roots: [],
    },
  });
  assert.equal(fs.readFileSync(policyPath, 'utf8'), ownerPolicy);
});

runTest('reinstall preserves malformed owner policy and reports it for repair', () => {
  const root = temporaryDirectory();
  const pluginsDir = path.join(root, 'plugins');
  const ownerConfigDir = path.join(root, 'owner-config');
  const policyPath = path.join(ownerConfigDir, 'policy.json');
  const ownerPolicy = '{ not valid json\n';

  fs.mkdirSync(ownerConfigDir, { recursive: true });
  fs.writeFileSync(policyPath, ownerPolicy);
  const result = installPlugin({ repoRoot: ROOT, destDir: pluginsDir, ownerConfigDir, skipRuntimeSetup: true });

  assert.equal(result.migrationPreview.problem, 'invalid-policy');
  assert.equal(result.migrationPreview.policyPath, policyPath);
  assert.equal(fs.readFileSync(policyPath, 'utf8'), ownerPolicy);
  assert.ok(fs.existsSync(result.dest));
});

for (const directory of temporaryDirectories) {
  fs.rmSync(directory, { recursive: true, force: true });
}
