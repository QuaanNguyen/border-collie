'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-pack-'));

try {
  const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', output], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const parsedReport = JSON.parse(packed.stdout);
  const report = Array.isArray(parsedReport) ? parsedReport : Object.values(parsedReport);
  assert.equal(report.length, 1, 'npm pack should create exactly one package');

  const files = new Set(report[0].files.map(({ path: file }) => file));
  for (const required of [
    'package.json',
    'scripts/border-collie.js',
    'scripts/install-plugin.js',
    'plugin/border-collie.js',
    'guard/lib/session.js',
    'events/index.js',
    'pet/package.json',
  ]) {
    assert(files.has(required), `packed artifact is missing ${required}`);
  }
  assert(![...files].some((file) => file.includes('node_modules/')), 'packed artifact contains node_modules');
  console.log(`Verified ${report[0].filename} (${files.size} files, ${report[0].size} bytes)`);
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
