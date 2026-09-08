'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

async function hooksFor(projectDir, ownerConfigDir, runDir) {
  process.env.RICE_NO_PET = '1';
  process.env.RICE_EVENTS = path.join(runDir, 'events.jsonl');
  process.env.RICE_RUNS = path.join(runDir, 'runs');
  process.env.RICE_OWNER_CONFIG = ownerConfigDir;
  const { Rice } = await import(pathToFileURL(path.join(ROOT, 'plugin/rice.js')).href);
  return Rice({ client: {}, directory: projectDir });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rice-remediation-'));
  const projectDir = path.join(root, 'project');
  const outsideFile = path.join(root, 'outside', 'private.md');
  const ownerConfigDir = path.join(root, 'owner-config');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.dirname(outsideFile), { recursive: true });
  fs.mkdirSync(ownerConfigDir, { recursive: true });
  fs.writeFileSync(path.join(ownerConfigDir, 'policy.json'), JSON.stringify({ schema_version: 1, setup_package: 'research-safe', trusted_workspace_roots: [] }));
  const hooks = await hooksFor(projectDir, ownerConfigDir, path.join(root, 'run'));
  await assert.rejects(
    hooks['tool.execute.before']({ tool: 'read' }, { args: { path: outsideFile } }),
    (error) => /Requested action: read/.test(error.message) &&
      error.message.includes(`Target: ${outsideFile}`) &&
      /Governing rule: read_paths/.test(error.message) &&
      /Policy layer: resolved Rice policy/.test(error.message) &&
      error.message.includes(`Use a path within the active project: ${projectDir}`) &&
      /Retry: do not retry this target/.test(error.message),
  );
  console.log('  \x1b[32m✓\x1b[0m ordinary denial explains action, target, rule, layer, and alternative');
}

main().catch((error) => {
  console.log(`  \x1b[31m✗\x1b[0m denial remediation\n      ${error.message}`);
  process.exitCode = 1;
});
