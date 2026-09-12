'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-policy-conflict-'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

async function hooksFor(projectDir, ownerConfigDir, runDir) {
  process.env.BORDER_COLLIE_NO_PET = '1';
  process.env.BORDER_COLLIE_EVENTS = path.join(runDir, 'events.jsonl');
  process.env.BORDER_COLLIE_OWNER_CONFIG = ownerConfigDir;
  const { BorderCollie } = await import(pathToFileURL(path.join(ROOT, 'plugin/border-collie.js')).href);
  return BorderCollie({ client: {}, directory: projectDir });
}

async function readEvents(runDir) {
  await new Promise((resolve) => setTimeout(resolve, 10));
  return fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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
  console.log('policy conflict');

  await runTest('broadening paths, commands, tools, trusted roots, and Bash blocks the session with a high-priority notification', async () => {
    const root = temporaryDirectory();
    const projectDir = path.join(root, 'project');
    const ownerConfigDir = path.join(root, 'owner-config');
    const runDir = path.join(root, 'run');
    fs.mkdirSync(projectDir, { recursive: true });
    writeJson(path.join(ownerConfigDir, 'policy.json'), {
      schema_version: 1,
      setup_package: 'research-safe',
      trusted_workspace_roots: ['/shared/approved'],
      read_paths: ['allowed.md'],
      write_paths: [],
      allow_commands: ['node'],
      command_allowlist: ['node --version'],
      allow_tools: ['safe_tool'],
      allow_ordinary_bash: false,
    });
    writeJson(path.join(projectDir, '.opencode', 'protocol.json'), {
      read_paths: ['private.md'],
      write_paths: ['private.md'],
      allow_commands: ['python'],
      command_allowlist: ['python --version'],
      allow_tools: ['unsafe_tool'],
      trusted_workspace_roots: ['/shared/private'],
      allow_ordinary_bash: true,
    });

    const hooks = await hooksFor(projectDir, ownerConfigDir, runDir);
    await assert.rejects(
      hooks['tool.execute.before']({ tool: 'read' }, { args: { path: path.join(projectDir, 'private.md') } }),
      /project policy.*owner policy.*read_paths/i,
    );

    const events = await readEvents(runDir);
    const notification = events.find((event) => event.type === 'notification');
    assert.equal(notification.status, 'error');
    assert.equal(notification.detail.priority, 'high');
    assert.deepEqual(notification.detail.conflicts.map((conflict) => conflict.field), [
      'read_paths',
      'write_paths',
      'allow_commands',
      'command_allowlist',
      'allow_tools',
      'trusted_workspace_roots',
      'allow_ordinary_bash',
    ]);
    assert.match(notification.detail.remediation, /Remove or narrow/);
  });
}

main();
