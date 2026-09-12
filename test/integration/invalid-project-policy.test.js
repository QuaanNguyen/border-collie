'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-invalid-project-policy-'));
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
  console.log('invalid project policy');

  await runTest('a malformed active project policy fails closed with a high-priority notification', async () => {
    const root = temporaryDirectory();
    const projectDir = path.join(root, 'project');
    const ownerConfigDir = path.join(root, 'owner-config');
    const runDir = path.join(root, 'run');
    const policyPath = path.join(projectDir, '.opencode', 'protocol.json');
    fs.mkdirSync(path.dirname(policyPath), { recursive: true });
    fs.mkdirSync(ownerConfigDir, { recursive: true });
    fs.writeFileSync(policyPath, '{ not valid json\n');
    fs.writeFileSync(path.join(ownerConfigDir, 'policy.json'), JSON.stringify({
      schema_version: 1,
      setup_package: 'research-safe',
      trusted_workspace_roots: [],
    }));

    const hooks = await hooksFor(projectDir, ownerConfigDir, runDir);
    await assert.rejects(
      hooks['tool.execute.before']({ tool: 'read' }, { args: { path: path.join(projectDir, 'notes.md') } }),
      (error) => {
        assert.match(error.message, /Fix or remove the project policy/);
        assert.match(error.message, new RegExp(policyPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        return true;
      },
    );
  });

  await runTest('a non-object active project policy fails closed', async () => {
    const root = temporaryDirectory();
    const projectDir = path.join(root, 'project');
    const ownerConfigDir = path.join(root, 'owner-config');
    const runDir = path.join(root, 'run');
    const policyPath = path.join(projectDir, '.opencode', 'protocol.json');
    fs.mkdirSync(path.dirname(policyPath), { recursive: true });
    fs.mkdirSync(ownerConfigDir, { recursive: true });
    fs.writeFileSync(policyPath, '[]\n');
    fs.writeFileSync(path.join(ownerConfigDir, 'policy.json'), JSON.stringify({
      schema_version: 1,
      setup_package: 'research-safe',
      trusted_workspace_roots: [],
    }));

    const hooks = await hooksFor(projectDir, ownerConfigDir, runDir);
    await assert.rejects(
      hooks['tool.execute.before']({ tool: 'read' }, { args: { path: path.join(projectDir, 'notes.md') } }),
      /Fix or remove the project policy/,
    );
  });
}

main();
