'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const cli = path.resolve(__dirname, '..', '..', 'scripts', 'border-collie.js');
const { DEFAULT_PREFERENCE } = require('../../guard/lib/preference');

const CRITERION = { id: 'parser-exists', checks: [{ type: 'file_exists', path: 'src/parser.js' }] };

function withLayout(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-migrate-'));
  const layout = {
    root,
    project: path.join(root, 'project'),
    configRoot: path.join(root, 'config'),
    ownerDir: path.join(root, 'owner'),
  };
  for (const dir of [layout.project, layout.configRoot, layout.ownerDir]) fs.mkdirSync(dir, { recursive: true });
  try {
    return run(layout);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}

function read(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function migrate(layout) {
  return spawnSync(process.execPath, [cli, 'migrate'], {
    cwd: layout.project,
    encoding: 'utf8',
    env: { ...process.env, BORDER_COLLIE_CONFIG_ROOT: layout.configRoot, BORDER_COLLIE_OWNER_CONFIG: layout.ownerDir },
  });
}

test('migrate carries done criteria into a new Preference and removes the retired files', () => {
  withLayout((layout) => {
    const canonical = path.join(layout.project, '.border-collie', 'protocol.json');
    const legacy = path.join(layout.project, '.opencode', 'protocol.json');
    write(canonical, { task: 'fix the parser', write_paths: ['src/**'], done_criteria: [CRITERION] });
    write(legacy, { read_paths: ['**'] });
    write(path.join(layout.configRoot, 'config.json'), {
      schema_version: 2,
      pet: { scale: 1.35 },
      profiles: { lab: { extends: 'research', policy: {} } },
      adapters: { opencode: { default_profile: 'lab', allowed_project_profiles: ['lab'] } },
    });
    write(path.join(layout.ownerDir, 'policy.json'), { setup_package: 'research-safe' });

    const result = migrate(layout);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /with 1 done criteria/);

    assert.deepEqual(read(path.join(layout.project, '.border-collie', 'preference.json')), { ...DEFAULT_PREFERENCE, done_criteria: [CRITERION] });
    assert.equal(fs.existsSync(canonical), false);
    assert.equal(fs.existsSync(legacy), false);
    assert.deepEqual(read(path.join(layout.configRoot, 'config.json')), { schema_version: 3, pet: { scale: 1.35 } });
    assert.equal(fs.existsSync(path.join(layout.ownerDir, 'policy.json')), false);
  });
});

test('migrate keeps an existing Preference and fills done criteria only when it has none', () => {
  withLayout((layout) => {
    const preferenceFile = path.join(layout.project, '.border-collie', 'preference.json');
    write(preferenceFile, { purpose: 'Docs only.' });
    write(path.join(layout.project, '.opencode', 'protocol.json'), { done_criteria: [CRITERION] });

    assert.equal(migrate(layout).status, 0);
    assert.deepEqual(read(preferenceFile), { purpose: 'Docs only.', done_criteria: [CRITERION] });

    write(preferenceFile, { purpose: 'Docs only.', done_criteria: [{ id: 'owner-written', checks: [] }] });
    write(path.join(layout.project, '.border-collie', 'protocol.json'), { done_criteria: [CRITERION] });
    assert.equal(migrate(layout).status, 0);
    assert.deepEqual(read(preferenceFile).done_criteria, [{ id: 'owner-written', checks: [] }]);
    assert.equal(fs.existsSync(path.join(layout.project, '.border-collie', 'protocol.json')), false);
  });
});

test('migrate changes nothing when a file it reads is unreadable', () => {
  withLayout((layout) => {
    const preferenceFile = path.join(layout.project, '.border-collie', 'preference.json');
    const protocol = path.join(layout.project, '.border-collie', 'protocol.json');
    write(preferenceFile, '{ not json');
    write(protocol, { done_criteria: [CRITERION] });

    const broken = migrate(layout);
    assert.equal(broken.status, 2);
    assert.match(broken.stderr, /Nothing was changed/);
    assert.equal(fs.readFileSync(preferenceFile, 'utf8'), '{ not json');
    assert.ok(fs.existsSync(protocol));

    fs.rmSync(preferenceFile);
    write(protocol, '{ not json');
    assert.equal(migrate(layout).status, 2);
    assert.equal(fs.existsSync(preferenceFile), false);
  });
});
