'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rice-research-safe-'));
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (error) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
}

async function hooksFor(projectDir, ownerConfigDir, runDir) {
  process.env.RICE_NO_PET = '1';
  process.env.RICE_EVENTS = path.join(runDir, 'events.jsonl');
  process.env.RICE_RUNS = path.join(runDir, 'runs');
  process.env.RICE_OWNER_CONFIG = ownerConfigDir;
  const { Rice } = await import(pathToFileURL(path.join(ROOT, 'plugin/rice.js')).href);
  return Rice({ client: {}, directory: projectDir });
}

console.log('Research-safe session');

runTest('a global-only session permits ordinary in-project work and denies outside access', async () => {
  const root = temporaryDirectory();
  const projectDir = path.join(root, 'project');
  const outsideDir = path.join(root, 'outside');
  const ownerConfigDir = path.join(root, 'owner-config');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.mkdirSync(ownerConfigDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'notes.md'), 'project notes\n');
  fs.writeFileSync(path.join(outsideDir, 'private.md'), 'private notes\n');
  fs.writeFileSync(path.join(ownerConfigDir, 'policy.json'), JSON.stringify({
    schema_version: 1,
    setup_package: 'research-safe',
    trusted_workspace_roots: [],
  }));
  const hooks = await hooksFor(projectDir, ownerConfigDir, path.join(root, 'run'));
  const before = hooks['tool.execute.before'];

  await before({ tool: 'read' }, { args: { path: path.join(projectDir, 'notes.md') } });
  await before({ tool: 'edit' }, { args: { path: path.join(projectDir, 'notes.md'), oldString: 'project', newString: 'updated' } });
  await before({ tool: 'bash' }, { args: { command: 'node --version' } });
  await assert.rejects(
    before({ tool: 'read' }, { args: { path: path.join(outsideDir, 'private.md') } }),
    /refused/,
  );
  await assert.rejects(
    before({ tool: 'bash' }, { args: { command: `cat ${path.join(outsideDir, 'private.md')}` } }),
    /refused/,
  );
});
