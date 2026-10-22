'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const data = require('../../xor/prototype/checker-data');

const root = path.resolve(__dirname, '../..');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => {
  if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};

function snapshot(directory, inventory, rows, planHash, disputed = false) {
  fs.mkdirSync(directory, { recursive: true });
  const requests = data.reviewPacket(rows);
  const contents = rows.map(JSON.stringify).join('\n') + '\n';
  fs.writeFileSync(path.join(directory, 'proposals.jsonl'), contents);
  write(path.join(directory, 'review-packet.json'), { instructions: data.REVIEW_INSTRUCTIONS, instructionHash: data.REVIEW_INSTRUCTION_HASH, requests });
  write(path.join(directory, 'manifest.json'), { cases: rows.length, requestFormatVersion: '3', inventorySha256: data.digest(inventory), proposalsSha256: data.digest(contents), requestsSha256: data.digest(requests), planSha256: planHash, trainingEligible: false });
  for (const model of ['gemma', 'glm']) write(path.join(directory, 'review-' + model + '.json'), { model, modelFamily: model, instructionHash: data.REVIEW_INSTRUCTION_HASH, inputHash: data.digest(requests), status: 'complete', expected: rows.length, decisions: requests.map((request, index) => ({ id: request.id, inputHash: request.inputHash, verdict: disputed && index === 0 && model === 'glm' ? 'deny' : rows[index].suggestedVerdict || 'approve' })), responses: [{ requestedModel: model, reportedModel: model, inputIds: rows.map((row) => row.id), finishReason: 'stop' }] });
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'checker-composition-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inventory = { tools: [{ agent: 'opencode', name: 'shell', hookable: true, integrationVerified: true, schemaVerified: true, inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }, examples: [{ command: 'npm test' }, { command: 'git diff' }, { command: 'npm run check' }] }] };
  const inventoryFile = path.join(directory, 'inventory.json');
  write(inventoryFile, inventory);
  const rows = data.proposals(inventory);
  const originalStudy = path.join(directory, 'original-study');
  const original = path.join(originalStudy, 'dev-reviews', 'original');
  const study = path.join(directory, 'remediation-study');
  const supplement = path.join(study, 'dev-reviews', 'supplement');
  const output = path.join(directory, 'assembled');
  const sourcePlan = { inventorySha256: data.digest(inventory), tasks: rows.map((row) => ({ taskId: row.id, family: row.family, split: row.split, agent: row.agent, tool: row.tool })) };
  const replacement = { ...rows[0], id: 'case-' + data.digest('replacement').slice(0, 24), userMessage: 'Run only the requested local parser tests without publishing anything.' };
  const supplementPlan = { inventorySha256: data.digest(inventory), tasks: [{ taskId: replacement.id, family: replacement.family, split: replacement.split, agent: replacement.agent, tool: replacement.tool }] };
  snapshot(original, inventory, rows, data.digest(sourcePlan), true);
  snapshot(supplement, inventory, [replacement], data.digest(supplementPlan));
  write(path.join(originalStudy, 'plan.json'), sourcePlan);
  write(path.join(originalStudy, 'state.json'), { planSha256: data.digest(sourcePlan), accepted: rows });
  write(path.join(study, 'plan.json'), supplementPlan);
  write(path.join(study, 'remediation.json'), { source: originalStudy, snapshot: original, sourcePlanSha256: data.digest(sourcePlan), sourceStateSha256: data.digest(fs.readFileSync(path.join(originalStudy, 'state.json'), 'utf8')), sourceManifestSha256: data.digest(fs.readFileSync(path.join(original, 'manifest.json'), 'utf8')), requiredReplacementIds: [{ sourceTaskId: rows[0].id, sourceInputHash: data.reviewPacket([rows[0]])[0].inputHash }], links: [{ taskId: replacement.id, sourceTaskId: rows[0].id, sourceInputHash: data.reviewPacket([rows[0]])[0].inputHash, purpose: 'replace-disputed-input', family: rows[0].family, split: rows[0].split }] });
  const assemble = () => spawnSync(process.execPath, ['scripts/assemble-checker-data.js', inventoryFile, original, supplement, study, output], { cwd: root, encoding: 'utf8' });
  const verify = () => spawnSync(process.execPath, ['scripts/verify-checker-data.js', inventoryFile, output], { cwd: root, encoding: 'utf8' });
  return { directory, inventoryFile, inventory, original, supplement, study, output, rows, replacement, assemble, verify };
}

function update(file, fn) {
  const value = read(file);
  fn(value);
  write(file, value);
}

test('real assembly CLI preserves unchanged siblings and exact source decisions without modifying either source', (t) => {
  const f = fixture(t);
  const before = [f.original, f.supplement].map((directory) => fs.readdirSync(directory).map((name) => [name, data.digest(fs.readFileSync(path.join(directory, name), 'utf8'))]));
  const run = f.assemble();
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.retainedOriginalCases, 11);
  assert.equal(result.replacedOriginalCases, 1);
  assert.equal(result.cases, 12);
  assert.equal(result.accepted, 12);
  assert.deepEqual([f.original, f.supplement].map((directory) => fs.readdirSync(directory).map((name) => [name, data.digest(fs.readFileSync(path.join(directory, name), 'utf8'))])), before);
  const verified = f.verify();
  assert.equal(verified.status, 2, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).integrity, 'passed');
  assert.equal(JSON.parse(verified.stdout).trainingEligible, false);
  assert.equal(f.assemble().status, 1);
});

test('altered immutable source evidence fails the real gate', (t) => {
  const f = fixture(t);
  assert.equal(f.assemble().status, 0);
  fs.chmodSync(path.join(f.output, 'composition-evidence/original/review-gemma.json'), 0o600);
  fs.appendFileSync(path.join(f.output, 'composition-evidence/original/review-gemma.json'), '\n');
  const result = f.verify();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /source evidence changed/);
});

test('rehashing a substituted visible input cannot preserve composed review provenance', (t) => {
  const f = fixture(t);
  assert.equal(f.assemble().status, 0);
  const rowsFile = path.join(f.output, 'proposals.jsonl');
  const rows = fs.readFileSync(rowsFile, 'utf8').trim().split('\n').map(JSON.parse);
  rows[0].userMessage = 'An entirely different request that no reviewer saw.';
  const requests = data.reviewPacket(rows);
  const text = rows.map(JSON.stringify).join('\n') + '\n';
  fs.chmodSync(rowsFile, 0o600);
  fs.writeFileSync(rowsFile, text);
  update(path.join(f.output, 'manifest.json'), (manifest) => { manifest.proposalsSha256 = data.digest(text); manifest.requestsSha256 = data.digest(requests); });
  update(path.join(f.output, 'review-packet.json'), (packet) => { packet.requests = requests; });
  for (const model of ['gemma', 'glm']) update(path.join(f.output, 'review-' + model + '.json'), (review) => { review.inputHash = data.digest(requests); review.decisions[0].inputHash = requests[0].inputHash; });
  const result = f.verify();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /substituted, missing or unexpected/);
});

test('assembly refuses missing source decisions even when an incomplete review is structurally intact', (t) => {
  const f = fixture(t);
  update(path.join(f.original, 'review-gemma.json'), (review) => { review.decisions.pop(); review.status = 'incomplete'; });
  const result = f.assemble();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /complete original independent reviews/);
  assert.equal(fs.existsSync(f.output), false);
});

test('assembly refuses a missing replacement instead of silently restoring the old disputed input', (t) => {
  const f = fixture(t);
  update(path.join(f.study, 'remediation.json'), (remediation) => { remediation.links = []; });
  const result = f.assemble();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /links do not cover/);
  assert.equal(fs.existsSync(f.output), false);
});

test('a changed replacement split is refused even with internally consistent replacement snapshot hashes', (t) => {
  const f = fixture(t);
  const planFile = path.join(f.study, 'plan.json');
  update(planFile, (plan) => { plan.tasks[0].split = 'validation'; });
  const plan = read(planFile);
  snapshot(f.supplement, f.inventory, [{ ...f.replacement, split: 'validation' }], data.digest(plan));
  const result = f.assemble();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /crosses its source family, split or tool/);
});

test('a planned but ungenerated replacement prevents assembly of apparently complete retained siblings', (t) => {
  const f = fixture(t);
  update(path.join(f.study, 'plan.json'), (plan) => { plan.tasks.push({ ...plan.tasks[0], taskId: 'case-' + data.digest('missing').slice(0, 24) }); });
  const plan = read(path.join(f.study, 'plan.json'));
  update(path.join(f.supplement, 'manifest.json'), (manifest) => { manifest.planSha256 = data.digest(plan); });
  update(path.join(f.study, 'remediation.json'), (remediation) => { remediation.links.push({ ...remediation.links[0], taskId: plan.tasks[1].taskId, purpose: 'additional-coverage-case' }); });
  const run = f.assemble();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /missing a planned replacement/);
  assert.equal(fs.existsSync(f.output), false);
});

test('substituting unchanged disputed content under a new identity is not a repair', (t) => {
  const f = fixture(t);
  const plan = read(path.join(f.study, 'plan.json'));
  snapshot(f.supplement, f.inventory, [{ ...f.rows[0], id: f.replacement.id }], data.digest(plan));
  const run = f.assemble();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /repeats the disputed or invalid input/);
});

test('source ancestry edits invalidate assembly even when frozen source reviews still pass', (t) => {
  const f = fixture(t);
  const remediation = read(path.join(f.study, 'remediation.json'));
  update(path.join(remediation.source, 'state.json'), (state) => { state.accepted.pop(); });
  const run = f.assemble();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /source receipt hash changed/);
});

test('composed source evidence cannot point through a symlink outside the snapshot', (t) => {
  const f = fixture(t);
  assert.equal(f.assemble().status, 0);
  const target = path.join(f.output, 'composition-evidence/original/review-gemma.json');
  fs.unlinkSync(target);
  fs.symlinkSync(path.join(f.original, 'review-gemma.json'), target);
  const result = f.verify();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /escapes its snapshot/);
});

test('new reviewer disagreement stays disputed in the combined snapshot', (t) => {
  const f = fixture(t);
  update(path.join(f.supplement, 'review-glm.json'), (review) => { review.decisions[0].verdict = 'deny'; });
  const run = f.assemble();
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.accepted, 8);
  assert.equal(result.excluded, 4);
});

test('composed reviewer cannot invent a different decision with an unchanged exact input', (t) => {
  const f = fixture(t);
  assert.equal(f.assemble().status, 0);
  update(path.join(f.output, 'review-gemma.json'), (review) => { review.decisions[0].verdict = 'approve'; });
  const result = f.verify();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /decisions differ/);
});

test('an agreed known-bad input cannot survive by changing its replacement to an additional coverage case', (t) => {
  const f = fixture(t);
  update(path.join(f.original, 'review-glm.json'), (review) => { review.decisions[0].verdict = 'approve'; });
  update(path.join(f.study, 'remediation.json'), (remediation) => { remediation.links[0].purpose = 'replace-invalid-tool-semantics'; });
  assert.equal(f.assemble().status, 0);
  fs.rmSync(f.output, { recursive: true });
  update(path.join(f.study, 'remediation.json'), (remediation) => { remediation.links[0].purpose = 'additional-coverage-case'; });
  const run = f.assemble();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /lacks a replacement link for a required/);
  assert.equal(fs.existsSync(f.output), false);
});

test('a replacement cannot disappear from the declared required identities', (t) => {
  const f = fixture(t);
  update(path.join(f.study, 'remediation.json'), (remediation) => { remediation.requiredReplacementIds = []; });
  const run = f.assemble();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /not declared in its required replacement/);
});

test('missing required replacement declarations fail rather than inferring them from links', (t) => {
  const f = fixture(t);
  update(path.join(f.study, 'remediation.json'), (remediation) => { delete remediation.requiredReplacementIds; });
  const run = f.assemble();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /omits its required replacement/);
});

test('duplicate required replacement declarations fail', (t) => {
  const f = fixture(t);
  update(path.join(f.study, 'remediation.json'), (remediation) => { remediation.requiredReplacementIds.push(remediation.requiredReplacementIds[0]); });
  const run = f.assemble();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /required replacement identity is duplicated, missing or changed/);
});

test('required replacement declarations bind the exact original input hash', (t) => {
  const f = fixture(t);
  update(path.join(f.study, 'remediation.json'), (remediation) => { remediation.requiredReplacementIds[0].sourceInputHash = data.digest('wrong input'); });
  const run = f.assemble();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /required replacement identity is duplicated, missing or changed/);
});
