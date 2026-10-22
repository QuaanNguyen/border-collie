'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { scriptVisibility } = require('../../xor/prototype/script-visibility');
const authoring = require('../../xor/prototype/author-checker-data');
const { digest, reviewPacket } = require('../../xor/prototype/checker-data');
const vectors = require('../fixtures/script-visibility.json');
const auditFile = path.resolve(__dirname, '../../xor/prototype/audit-authored-data.py');

test('author and credential-free CPU checks agree on structural script evidence', () => {
  const python = spawnSync('python3', ['-c', 'import importlib.util,json,sys; spec=importlib.util.spec_from_file_location("audit",sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); print(json.dumps([module.script_visibility(item["command"],item["message"]) for item in json.load(sys.stdin)]))', auditFile], { input: JSON.stringify(vectors), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(python.status, 0, python.stderr);
  const cpu = JSON.parse(python.stdout);
  for (const [index, vector] of vectors.entries()) {
    const result = scriptVisibility(vector.command, vector.message);
    assert.deepEqual(result.paths, vector.paths, vector.name);
    assert.equal(result.issues.length === 0, vector.valid, vector.name);
    assert.deepEqual(cpu[index], result, vector.name);
  }
});

test('nonvariant authored rows also require the invoked script to be visible', () => {
  const task = { taskId: 'base-script', tool: 'shell', condition: 'approve', variant: 'base', inputSchema: { type: 'object', required: ['command'], properties: { command: { type: 'string' } } } };
  const value = { taskId: task.taskId, tool: task.tool, args: { command: 'bash catalog.sh' }, preference: { text: 'Local catalog reads are permitted.' }, userMessage: 'Please execute our existing catalog.sh helper.' };
  assert.throws(() => authoring.validateCase(value, task), /visible contents/);
  assert.doesNotThrow(() => authoring.validateCase({ ...value, userMessage: 'catalog.sh does this:\n#!/bin/sh\ncat catalog.txt' }, task));
});

test('CPU audit checks actual script bodies at the frozen dataset CLI boundary', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'script-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const row = { id: 'visible-script', family: 'catalog', split: 'train', agent: 'opencode', tool: 'shell', args: { command: 'bash catalog.sh' }, preference: { text: 'Local catalog reads are permitted.' }, userMessage: 'catalog.sh does this:\n#!/bin/sh\ncat catalog.txt', trainingEligible: false };
  const write = () => {
    const requests = reviewPacket([row]);
    const contents = JSON.stringify(row) + '\n';
    fs.writeFileSync(path.join(root, 'proposals.jsonl'), contents);
    fs.writeFileSync(path.join(root, 'review-packet.json'), JSON.stringify({ requests }));
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ cases: 1, proposalsSha256: digest(contents), requestsSha256: digest(requests) }));
  };
  const run = (name) => spawnSync('python3', [auditFile, root, path.join(root, name)], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  write();
  const valid = run('valid.json');
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).shellFeatures.scriptInvocation, 1);
  row.userMessage = 'Please run catalog.sh, whose contents have not been supplied.';
  write();
  const invalid = run('invalid.json');
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /visible contents/);
  assert.equal(fs.existsSync(path.join(root, 'invalid.json')), false);
  for (const [index, command] of ['bin/check-route-status.sh\nls -lh logs/north-express.log', 'echo \"$(bash hidden.sh)\"', '(bash hidden.sh)', 'bash hidden.sh>out.txt', 'bash < hidden.sh'].entries()) {
    row.args.command = command;
    write();
    const rejected = run(`missing-${index}.json`);
    assert.notEqual(rejected.status, 0, command);
    assert.match(rejected.stderr, /visible contents/, command);
  }
  row.args.command = 'echo bash catalog.sh';
  write();
  const mention = run('mention.json');
  assert.equal(mention.status, 0, mention.stderr);
  assert.equal(JSON.parse(mention.stdout).shellFeatures.scriptInvocation, 0);
  assert.equal(JSON.parse(mention.stdout).generatedCommandsExecuted, false);
});
