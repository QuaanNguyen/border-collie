'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const { installPlugin } = require(path.join(ROOT, 'scripts/install-plugin'));
const { fakeJudgeManifest } = require('../fixtures/fake-judge');

async function withRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-install-'));
  try {
    return await run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function options(root, extra = {}) {
  return {
    repoRoot: ROOT,
    destDir: path.join(root, 'plugins'),
    judgeRoot: path.join(root, 'judge'),
    judgeManifest: fakeJudgeManifest(path.join(root, 'source')).manifest,
    skipRuntimeSetup: true,
    ...extra,
  };
}

test('install retrieves and verifies the Judge, then reuses it', async () => {
  await withRoot(async (root) => {
    const first = await installPlugin(options(root));
    assert.equal(first.judgeReused, false);
    assert.equal(fs.readFileSync(path.join(first.judgeDir, 'needle3.cact'), 'utf8'), 'fake weights\n');
    if (process.platform !== 'win32') assert.ok(fs.statSync(path.join(first.judgeDir, 'needle')).mode & 0o100);

    const second = await installPlugin(options(root));
    assert.equal(second.judgeReused, true);
    assert.equal(second.judgeDir, first.judgeDir);
  });
});

test('a Judge that fails verification leaves the previous plugin bound', async () => {
  await withRoot(async (root) => {
    const pluginsDir = path.join(root, 'plugins');
    fs.mkdirSync(path.join(pluginsDir, 'border-collie'), { recursive: true });
    fs.writeFileSync(path.join(pluginsDir, 'border-collie.js'), 'old entry\n');
    fs.writeFileSync(path.join(pluginsDir, 'border-collie', 'old-marker'), 'old package\n');

    const tampered = fakeJudgeManifest(path.join(root, 'tampered'), { tamper: true }).manifest;
    await assert.rejects(installPlugin(options(root, { judgeManifest: tampered })), /does not match its pinned SHA-256/);

    const unsupported = fakeJudgeManifest(path.join(root, 'unsupported'), { platform: 'plan9-mips' }).manifest;
    await assert.rejects(installPlugin(options(root, { judgeManifest: unsupported })), /no runner for/);

    assert.equal(fs.readFileSync(path.join(pluginsDir, 'border-collie.js'), 'utf8'), 'old entry\n');
    assert.equal(fs.readFileSync(path.join(pluginsDir, 'border-collie', 'old-marker'), 'utf8'), 'old package\n');
    assert.equal(fs.existsSync(path.join(root, 'judge', 'test-revision')), false);
  });
});

test('install binds an importable plugin and leaves retired policy files alone', async () => {
  await withRoot(async (root) => {
    const project = path.join(root, 'project');
    fs.mkdirSync(path.join(project, '.border-collie'), { recursive: true });
    fs.writeFileSync(path.join(project, '.border-collie', 'protocol.json'), '{"done_criteria":[]}\n');
    const configRoot = path.join(root, 'config');
    fs.mkdirSync(configRoot);
    fs.writeFileSync(path.join(configRoot, 'config.json'), '{"schema_version":2,"pet":{"scale":1.15},"profiles":{},"adapters":{}}\n');

    const previousCwd = process.cwd();
    const previousConfig = process.env.BORDER_COLLIE_CONFIG_ROOT;
    process.chdir(project);
    process.env.BORDER_COLLIE_CONFIG_ROOT = configRoot;
    let result;
    try {
      result = await installPlugin(options(root));
    } finally {
      process.chdir(previousCwd);
      if (previousConfig === undefined) delete process.env.BORDER_COLLIE_CONFIG_ROOT;
      else process.env.BORDER_COLLIE_CONFIG_ROOT = previousConfig;
    }

    assert.ok(fs.existsSync(path.join(project, '.border-collie', 'protocol.json')));
    assert.match(fs.readFileSync(path.join(configRoot, 'config.json'), 'utf8'), /"profiles"/);
    assert.equal(fs.existsSync(path.join(result.packageDir, 'guard', 'lib', 'judge.js')), true);
    assert.equal(fs.existsSync(path.join(result.packageDir, 'pet', 'package.json')), true);
    const check = spawnSync(process.execPath, [
      '--input-type=module',
      '-e',
      `process.env.BORDER_COLLIE_NO_PET = '1'; import { BorderCollie } from ${JSON.stringify(pathToFileURL(result.dest).href)}; const hooks = await BorderCollie({ client: {}, directory: ${JSON.stringify(project)} }); if (typeof hooks['tool.execute.before'] !== 'function') process.exit(2); process.emit('beforeExit');`,
    ], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
  });
});
