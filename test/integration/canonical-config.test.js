'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const cli = path.join(root, 'scripts', 'border-collie.js');

function run(configRoot, args, cwd = root) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, BORDER_COLLIE_CONFIG_ROOT: configRoot },
  });
}

test('profiles are inspected, copied, and assigned from canonical configuration', () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-config-'));
  const listed = run(configRoot, ['profile', 'list']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /research/);

  const created = run(configRoot, ['profile', 'create', 'lab-research', '--from', 'research']);
  assert.equal(created.status, 0, created.stderr);
  const assigned = run(configRoot, ['profile', 'assign', 'opencode', 'lab-research']);
  assert.equal(assigned.status, 0, assigned.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(configRoot, 'config.json'), 'utf8'));
  assert.equal(config.adapters.opencode.default_profile, 'lab-research');
  assert.equal(config.profiles['lab-research'].extends, 'research');
});

test('project setup writes the harness-neutral Protocol and pet size persists', () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-config-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-project-'));
  const setup = run(configRoot, ['project', 'setup', '--profile', 'governed', '--write-path', 'src/**'], project);
  assert.equal(setup.status, 0, setup.stderr);
  const protocol = JSON.parse(fs.readFileSync(path.join(project, '.border-collie', 'protocol.json'), 'utf8'));
  assert.equal(protocol.profile, 'governed');
  assert.deepEqual(protocol.write_paths, ['src/**']);

  const size = run(configRoot, ['pet', 'size', '115']);
  assert.equal(size.status, 0, size.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(configRoot, 'config.json'), 'utf8'));
  assert.equal(config.pet.scale, 1.15);
});

test('allow_commands is rejected before canonical configuration is persisted', () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-config-'));
  const invalid = run(configRoot, ['profile', 'create', 'invalid', '--from', 'research', '--policy', '{"allow_commands":["node"]}']);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /allow_commands/);
  assert.equal(fs.existsSync(path.join(configRoot, 'config.json')), false);
});

test('governed project scope is required and canonical Protocol takes precedence over legacy', () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-config-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-project-'));
  const missingScope = run(configRoot, ['project', 'setup', '--profile', 'governed'], project);
  assert.equal(missingScope.status, 0, missingScope.stderr);
  const { createLiveProtocol } = require('../../guard/lib/live-protocol');
  const { resolveProjectOwnerPolicy } = require('../../guard/lib/owner-policy');
  const prior = process.env.BORDER_COLLIE_CONFIG_ROOT;
  process.env.BORDER_COLLIE_CONFIG_ROOT = configRoot;
  try {
    const live = createLiveProtocol({ workdir: project, resolveOwner: (selected) => resolveProjectOwnerPolicy('opencode', selected) });
    assert.equal(live.refresh().valid, false);
    fs.mkdirSync(path.join(project, '.opencode'), { recursive: true });
    fs.writeFileSync(path.join(project, '.opencode', 'protocol.json'), JSON.stringify({ read_paths: [] }));
    fs.writeFileSync(path.join(project, '.border-collie', 'protocol.json'), JSON.stringify({ profile: 'governed', write_paths: ['src/**'] }));
    const resolved = live.refresh();
    assert.equal(resolved.valid, true);
    assert.deepEqual(resolved.protocol.writePaths, ['src/**']);
  } finally {
    if (prior === undefined) delete process.env.BORDER_COLLIE_CONFIG_ROOT;
    else process.env.BORDER_COLLIE_CONFIG_ROOT = prior;
  }
});
