'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rice-project-policy-'));
}

function writeProtocol(file, spec) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(spec));
}

function researchSafeOwnerPolicy(ownerConfigDir) {
  fs.mkdirSync(ownerConfigDir, { recursive: true });
  fs.writeFileSync(path.join(ownerConfigDir, 'policy.json'), JSON.stringify({
    schema_version: 1,
    setup_package: 'research-safe',
    trusted_workspace_roots: [],
  }));
}

async function hooksFor(projectDir, ownerConfigDir, runDir) {
  process.env.RICE_NO_PET = '1';
  process.env.RICE_EVENTS = path.join(runDir, 'events.jsonl');
  process.env.RICE_RUNS = path.join(runDir, 'runs');
  process.env.RICE_OWNER_CONFIG = ownerConfigDir;
  const { Rice } = await import(pathToFileURL(path.join(ROOT, 'plugin/rice.js')).href);
  return Rice({ client: {}, directory: projectDir });
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
  console.log('project policy location');

  await runTest('uses the active project OpenCode protocol', async () => {
  const root = temporaryDirectory();
  const projectDir = path.join(root, 'project');
  const ownerConfigDir = path.join(root, 'owner-config');
  fs.mkdirSync(projectDir, { recursive: true });
  researchSafeOwnerPolicy(ownerConfigDir);
  writeProtocol(path.join(projectDir, '.opencode', 'protocol.json'), {
    read_paths: [],
    write_paths: [],
    command_allowlist: [],
    deny_commands: [],
    egress: [],
  });

  const hooks = await hooksFor(projectDir, ownerConfigDir, path.join(root, 'run'));
  await assert.rejects(
    hooks['tool.execute.before']({ tool: 'read' }, { args: { path: path.join(projectDir, 'notes.md') } }),
    /refused/,
  );
  });

  await runTest('uses the owner baseline when active project policy is missing', async () => {
  const root = temporaryDirectory();
  const projectDir = path.join(root, 'project');
  const ownerConfigDir = path.join(root, 'owner-config');
  fs.mkdirSync(projectDir, { recursive: true });
  researchSafeOwnerPolicy(ownerConfigDir);

  const hooks = await hooksFor(projectDir, ownerConfigDir, path.join(root, 'run'));
  await hooks['tool.execute.before']({ tool: 'read' }, { args: { path: path.join(projectDir, 'notes.md') } });
  });

  await runTest('ignores root, ancestor, sibling, and nested project protocols', async () => {
  const root = temporaryDirectory();
  const parentDir = path.join(root, 'parent');
  const projectDir = path.join(parentDir, 'project');
  const ownerConfigDir = path.join(root, 'owner-config');
  fs.mkdirSync(projectDir, { recursive: true });
  researchSafeOwnerPolicy(ownerConfigDir);
  const ignored = {
    read_paths: [],
    write_paths: [],
    command_allowlist: [],
    deny_commands: [],
    egress: [],
  };
  writeProtocol(path.join(projectDir, 'protocol.json'), ignored);
  writeProtocol(path.join(parentDir, '.opencode', 'protocol.json'), ignored);
  writeProtocol(path.join(parentDir, 'sibling', '.opencode', 'protocol.json'), ignored);
  writeProtocol(path.join(projectDir, 'nested', '.opencode', 'protocol.json'), ignored);

  const hooks = await hooksFor(projectDir, ownerConfigDir, path.join(root, 'run'));
  await hooks['tool.execute.before']({ tool: 'read' }, { args: { path: path.join(projectDir, 'notes.md') } });
  });
}

main();
