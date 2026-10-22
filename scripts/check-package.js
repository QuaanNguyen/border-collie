'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'xor-pack-'));

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
    'scripts/xor.js',
    'scripts/check-package-client.js',
    'scripts/check-package.js',
    'scripts/check-syntax.js',
    'scripts/install-plugin.js',
    'scripts/migrate.js',
    'scripts/run-e2e.js',
    'plugin/xor.js',
    'plugin/tui.mjs',
    'plugin/pet-rpc.mjs',
    'plugin/runtime-root.mjs',
    'pet/runtime.mjs',
    'plugin/package.json',
    'xor/lib/session.js',
    'xor/lib/gate.js',
    'xor/lib/gate-artifacts.js',
    'xor/lib/preference.js',
    'events/index.js',
    'pet/package.json',
  ]) {
    assert(files.has(required), `packed artifact is missing ${required}`);
  }
  assert(![...files].some((file) => file.includes('node_modules/')), 'packed artifact contains node_modules');
  assert(![...files].some((file) => file.startsWith('xor/prototype/')), 'packed artifact contains research files');
  console.log(`Verified ${report[0].filename} (${files.size} files, ${report[0].size} bytes)`);
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
