'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = [
  ['scripts/border-collie.js', []],
  ['scripts/check-package-client.js', []],
  ['scripts/check-package.js', []],
  ['scripts/check-syntax.js', []],
  ['scripts/install-plugin.js', []],
  ['scripts/run-e2e.js', []],
  ['plugin/border-collie.js', ['--input-type=module']],
];

for (const [file, args] of files) {
  const result = spawnSync(process.execPath, [...args, '--check'], {
    cwd: root,
    input: fs.readFileSync(path.join(root, file)),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  console.log(`Checked ${file}`);
}
