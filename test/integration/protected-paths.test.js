'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-protected-paths-'));
}

async function hooksFor(projectDir, ownerConfigDir, runDir) {
  process.env.BORDER_COLLIE_NO_PET = '1';
  process.env.BORDER_COLLIE_EVENTS = path.join(runDir, 'events.jsonl');
  process.env.BORDER_COLLIE_OWNER_CONFIG = ownerConfigDir;
  const { BorderCollie } = await import(pathToFileURL(path.join(ROOT, 'plugin/border-collie.js')).href);
  return BorderCollie({ client: {}, directory: projectDir });
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

async function main() {
  console.log('protected paths');

  await runTest('the Border Collie hook protects writes while allowing reads unless read protection is configured', async () => {
    const root = temporaryDirectory();
    const projectDir = path.join(root, 'project');
    const ownerConfigDir = path.join(root, 'owner-config');
    const protectedFile = path.join(projectDir, 'protected.md');
    const secretFile = path.join(projectDir, 'secret.md');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(ownerConfigDir, { recursive: true });
    fs.writeFileSync(protectedFile, 'protected\n');
    fs.writeFileSync(secretFile, 'secret\n');
    fs.writeFileSync(path.join(ownerConfigDir, 'policy.json'), JSON.stringify({
      schema_version: 1,
      setup_package: 'research-safe',
      trusted_workspace_roots: [],
      protected_paths: ['protected.md'],
      read_protected_paths: ['secret.md'],
    }));

    const hooks = await hooksFor(projectDir, ownerConfigDir, path.join(root, 'run'));
    const before = hooks['tool.execute.before'];
    await before({ tool: 'read' }, { args: { path: protectedFile } });
    await assert.rejects(before({ tool: 'read' }, { args: { path: secretFile } }), /protected/);
    await assert.rejects(before({ tool: 'edit' }, { args: { path: protectedFile, oldString: 'x', newString: 'y' } }), /protected/);
    await assert.rejects(before({ tool: 'delete' }, { args: { path: protectedFile } }), /protected/);
    await assert.rejects(before({ tool: 'move' }, { args: { source: protectedFile, destination: path.join(projectDir, 'moved.md') } }), /protected/);
    await assert.rejects(before({ tool: 'chmod' }, { args: { path: protectedFile, mode: '600' } }), /protected/);
    for (const command of [
      `echo changed > ${protectedFile}`,
      `mv ${protectedFile} ${path.join(projectDir, 'moved.md')}`,
      `rm ${protectedFile}`,
      `chmod 600 ${protectedFile}`,
      'rm protected.md',
      'echo ok && rm protected.md',
      `cat ${secretFile}`,
    ]) {
      await assert.rejects(before({ tool: 'bash' }, { args: { command } }), /protected/);
    }
  });
}

main();
