'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-cross-root-'));
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
  console.log('cross-root enforcement');

  await runTest('denies direct and recognizable shell cross-root actions', async () => {
    const root = temporaryDirectory();
    const projectDir = path.join(root, 'project');
    const outsideDir = path.join(root, 'outside');
    const ownerConfigDir = path.join(root, 'owner-config');
    const runDir = path.join(root, 'run');
    const outsideFile = path.join(outsideDir, 'private.md');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.mkdirSync(ownerConfigDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'notes.md'), 'project notes\n');
    fs.writeFileSync(outsideFile, 'private notes\n');
    fs.writeFileSync(path.join(ownerConfigDir, 'policy.json'), JSON.stringify({
      schema_version: 1,
      setup_package: 'research-safe',
      trusted_workspace_roots: [],
    }));

    const hooks = await hooksFor(projectDir, ownerConfigDir, runDir);
    const before = hooks['tool.execute.before'];
    await before({ tool: 'bash' }, { args: { command: 'node --version' } });
    await assert.rejects(
      before({ tool: 'read' }, { args: { path: outsideFile } }),
      (error) => /refused/.test(error.message) && /Permitted alternative:/.test(error.message) && /Retry: do not retry/.test(error.message),
    );
    await assert.rejects(before({ tool: 'edit' }, { args: { path: outsideFile, oldString: 'private', newString: 'changed' } }), /refused/);
    await assert.rejects(
      before({ tool: 'move' }, { args: { source: path.join(projectDir, 'notes.md'), destination: outsideFile } }),
      /refused/,
    );
    await assert.rejects(
      before({ tool: 'move' }, { args: { source: outsideFile, destination: path.join(projectDir, 'notes.md') } }),
      /refused/,
    );
    for (const command of [
      `cat ${outsideFile}`,
      `echo changed > ${outsideFile}`,
      `cp ${path.join(projectDir, 'notes.md')} ${outsideFile}`,
      `mv ${path.join(projectDir, 'notes.md')} ${outsideFile}`,
      `rm ${outsideFile}`,
      `chmod 600 ${outsideFile}`,
    ]) {
      await assert.rejects(before({ tool: 'bash' }, { args: { command } }), /refused/);
    }

  });
}

main();
