'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-research-safe-'));
}

let queue = Promise.resolve();

function runTest(name, fn) {
  queue = queue.then(async () => {
    try {
      await fn();
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (error) {
      console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${error.message}`);
      process.exitCode = 1;
    }
  });
  return queue;
}

async function hooksFor(projectDir, ownerConfigDir, runDir) {
  process.env.BORDER_COLLIE_NO_PET = '1';
  process.env.BORDER_COLLIE_EVENTS = path.join(runDir, 'events.jsonl');
  process.env.BORDER_COLLIE_OWNER_CONFIG = ownerConfigDir;
  const { BorderCollie } = await import(pathToFileURL(path.join(ROOT, 'plugin/border-collie.js')).href);
  return BorderCollie({ client: {}, directory: projectDir });
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

runTest('a Custom owner policy applies its configured session capabilities', async () => {
  const root = temporaryDirectory();
  const projectDir = path.join(root, 'project');
  const ownerConfigDir = path.join(root, 'owner-config');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(ownerConfigDir, { recursive: true });
  fs.writeFileSync(path.join(ownerConfigDir, 'policy.json'), JSON.stringify({
    schema_version: 1,
    setup_package: 'custom',
    allow_ordinary_bash: true,
  }));
  const hooks = await hooksFor(projectDir, ownerConfigDir, path.join(root, 'run'));

  await hooks['tool.execute.before']({ tool: 'bash' }, { args: { command: 'node --version' } });
});
