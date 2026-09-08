'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rice-policy-narrowing-'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
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

function ownerPolicy(overrides = {}) {
  return {
    schema_version: 1,
    setup_package: 'research-safe',
    trusted_workspace_roots: [],
    ...overrides,
  };
}

async function main() {
  console.log('policy narrowing');

  await runTest('project allow-lists cannot broaden owner path authority', async () => {
    const root = temporaryDirectory();
    const projectDir = path.join(root, 'project');
    const ownerConfigDir = path.join(root, 'owner-config');
    fs.mkdirSync(projectDir, { recursive: true });
    writeJson(path.join(ownerConfigDir, 'policy.json'), ownerPolicy({
      read_paths: ['allowed.md'],
      write_paths: [],
    }));
    writeJson(path.join(projectDir, '.opencode', 'protocol.json'), {
      read_paths: ['**'],
      write_paths: [],
    });
    const hooks = await hooksFor(projectDir, ownerConfigDir, path.join(root, 'run'));

    await assert.rejects(
      hooks['tool.execute.before']({ tool: 'read' }, { args: { path: path.join(projectDir, 'allowed.md') } }),
      /project policy.*owner policy.*read_paths/i,
    );
  });

  await runTest('omitted project fields inherit owner restrictions and project denials accumulate', async () => {
    const root = temporaryDirectory();
    const projectDir = path.join(root, 'project');
    const ownerConfigDir = path.join(root, 'owner-config');
    fs.mkdirSync(projectDir, { recursive: true });
    writeJson(path.join(ownerConfigDir, 'policy.json'), ownerPolicy({
      read_paths: ['notes.md'],
      deny_commands: ['node'],
    }));
    writeJson(path.join(projectDir, '.opencode', 'protocol.json'), { write_paths: [] });
    const hooks = await hooksFor(projectDir, ownerConfigDir, path.join(root, 'run'));

    await hooks['tool.execute.before']({ tool: 'read' }, { args: { path: path.join(projectDir, 'notes.md') } });
    await assert.rejects(
      hooks['tool.execute.before']({ tool: 'bash' }, { args: { command: 'node --version' } }),
      /refused/,
    );
  });

  await runTest('a project cannot enable ordinary Bash disabled by the owner', async () => {
    const root = temporaryDirectory();
    const projectDir = path.join(root, 'project');
    const ownerConfigDir = path.join(root, 'owner-config');
    fs.mkdirSync(projectDir, { recursive: true });
    writeJson(path.join(ownerConfigDir, 'policy.json'), ownerPolicy({ allow_ordinary_bash: false }));
    writeJson(path.join(projectDir, '.opencode', 'protocol.json'), { allow_ordinary_bash: true });
    const hooks = await hooksFor(projectDir, ownerConfigDir, path.join(root, 'run'));

    await assert.rejects(
      hooks['tool.execute.before']({ tool: 'bash' }, { args: { command: 'node --version' } }),
      /project policy.*owner policy.*allow_ordinary_bash/i,
    );
  });
}

main();
