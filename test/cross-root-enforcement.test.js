'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rice-cross-root-'));
}

async function hooksFor(projectDir, ownerConfigDir, runDir) {
  process.env.RICE_NO_PET = '1';
  process.env.RICE_EVENTS = path.join(runDir, 'events.jsonl');
  process.env.RICE_RUNS = path.join(runDir, 'runs');
  process.env.RICE_OWNER_CONFIG = ownerConfigDir;
  const { Rice } = await import(pathToFileURL(path.join(ROOT, 'plugin/rice.js')).href);
  return Rice({ client: {}, directory: projectDir });
}

async function readRunEvents(runDir) {
  await new Promise((resolve) => setTimeout(resolve, 10));
  const [record] = fs.readdirSync(path.join(runDir, 'runs'));
  return fs.readFileSync(path.join(runDir, 'runs', record), 'utf8')
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
  console.log('cross-root enforcement');

  await runTest('quietly records and denies direct and recognizable shell cross-root actions', async () => {
    const root = temporaryDirectory();
    const projectDir = path.join(root, 'project');
    const outsideDir = path.join(root, 'outside');
    const ownerConfigDir = path.join(root, 'owner-config');
    const runDir = path.join(root, 'run');
    const outsideFile = path.join(outsideDir, 'private.md');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.mkdirSync(ownerConfigDir, { recursive: true });
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

    const events = await readRunEvents(runDir);
    assert.ok(events.some((event) => event.type === 'action' && event.status === 'allow'));
    const ordinaryDenial = events.find((event) => event.type === 'excursion');
    assert.equal(ordinaryDenial.rule, 'read_paths');
    assert.match(ordinaryDenial.reason, /outside the working directory/);
    assert.match(ordinaryDenial.summary, /read/);
    assert.ok(events.filter((event) => event.type === 'excursion').length >= 8);
    assert.equal(events.some((event) => event.type === 'notification' || event.type === 'ask'), false);
  });
}

main();
