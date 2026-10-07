'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { installPlugin } = require('../../scripts/install-plugin');
const { fakeJudgeManifest } = require('../fixtures/fake-judge');

test('Global bind stages a complete package without downloading a runtime', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-install-'));
  const destDir = path.join(temp, 'plugins');

  try {
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, 'border-collie.js'), 'legacy\n');
    const result = await installPlugin({
      destDir,
      judgeRoot: path.join(temp, 'judge'),
      judgeManifest: fakeJudgeManifest(path.join(temp, 'source')).manifest,
      skipRuntimeSetup: true,
    });
    assert.equal(result.dest, path.join(result.packageDir, 'index.mjs'));
    assert.equal(fs.existsSync(path.join(destDir, 'border-collie.js')), false);
    assert(fs.existsSync(path.join(result.packageDir, 'index.mjs')));
    assert(fs.existsSync(path.join(result.packageDir, 'guard', 'lib', 'session.js')));
    assert(fs.existsSync(path.join(result.packageDir, 'events', 'index.js')));
    assert(fs.existsSync(path.join(result.petDir, 'package.json')));
    assert(fs.existsSync(path.join(result.judgeDir, 'needle3.cact')));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
