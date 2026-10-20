'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { installPlugin } = require('../../scripts/install-plugin');
const { assertOpenCodeVersion } = require('../../bordercollie/lib/opencode-version');

test('the public installer refuses old OpenCode before changing an installation', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-version-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const destDir = path.join(root, 'plugins');
  fs.mkdirSync(destDir);
  fs.writeFileSync(path.join(destDir, 'existing'), 'preserved');
  for (const version of ['1.19.2', '2.0.29', 'unknown']) {
    const command = path.join(root, process.platform === 'win32' ? 'opencode.cmd' : 'opencode');
    fs.writeFileSync(command, process.platform === 'win32' ? `@echo off\r\necho ${version}\r\n` : `#!/bin/sh\nprintf '${version}\\n'\n`, { mode: 0o755 });
    await assert.rejects(installPlugin({ destDir, judgeRoot: path.join(root, 'judge'), verifyOpenCode: true, openCodeCommand: command }), version.startsWith('1.') ? /opencode upgrade --major/ : /requires OpenCode 2\.0\.30/);
    assert.deepEqual(fs.readdirSync(destDir), ['existing']);
    assert.equal(fs.existsSync(path.join(root, 'judge')), false);
  }
  for (const version of ['2.0.30', '2.0.32', '2.1.0', 'v2.0.30']) assert.equal(assertOpenCodeVersion(version), version);
  assert.equal(assertOpenCodeVersion('opencode v2.1.1'), 'v2.1.1');
});
