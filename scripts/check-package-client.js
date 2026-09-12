'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const client = process.argv[2];

if (!['npm', 'pnpm', 'yarn', 'bun'].includes(client)) {
  process.stderr.write('Usage: node scripts/check-package-client.js npm|pnpm|yarn|bun\n');
  process.exit(2);
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-client-'));
const packDir = path.join(workspace, 'pack');
const installDir = path.join(workspace, 'install');

function command(name) {
  if (process.platform !== 'win32') return name;
  if (name === 'npm' || name === 'pnpm' || name === 'yarn') return name + '.cmd';
  return name;
}

function run(cmd, args, cwd) {
  const result = spawnSync(command(cmd), args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

try {
  fs.mkdirSync(packDir);
  fs.mkdirSync(installDir);
  const packed = run('npm', ['pack', '--json', '--pack-destination', packDir], root);
  const parsedReport = JSON.parse(packed.stdout);
  const report = Array.isArray(parsedReport) ? parsedReport : Object.values(parsedReport);
  assert.equal(report.length, 1, 'npm pack should create exactly one package');
  const tarball = path.join(packDir, report[0].filename);
  fs.writeFileSync(path.join(installDir, 'package.json'), '{"private":true}\n');

  if (client === 'npm') run('npm', ['install', '--ignore-scripts', tarball], installDir);
  if (client === 'pnpm') run('pnpm', ['add', '--ignore-scripts', tarball], installDir);
  if (client === 'yarn') run('yarn', ['add', tarball], installDir);
  if (client === 'bun') run('bun', ['add', tarball], installDir);

  assert.ok(fs.existsSync(path.join(installDir, 'node_modules', 'border-collie', 'scripts', 'border-collie.js')));
  assert.ok(fs.existsSync(path.join(installDir, 'node_modules', 'border-collie', 'plugin', 'border-collie.js')));
  process.stdout.write(`ok - ${client} installs the packed Border Collie package\n`);
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
