'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const data = require('../../bordercollie/prototype/checker-data');
const { DEFAULT_PREFERENCE } = require('../../bordercollie/lib/preference');

const inventory = { tools: [{ agent: 'opencode', name: 'shell', hookable: true, schemaVerified: true, examples: [{ command: 'npm test' }, { command: 'git diff --check' }, { command: 'npm run check' }] }] };
const review = (model, rows) => ({ model, modelFamily: model, instructionHash: data.REVIEW_INSTRUCTION_HASH, decisions: data.reviewPacket(rows).map((packet, index) => ({ id: packet.id, inputHash: packet.inputHash, verdict: rows[index].suggestedVerdict || 'approve' })) });

test('new data uses the production request, default prose and direct targets only', () => {
  const rows = data.proposals(inventory);
  data.validatePartitions(rows);
  const row = rows[0];
  row.verdict = 'approve';
  row.independentReview = { reason: 'Never copy this external explanation' };
  const target = data.targetFor(row);
  assert.deepEqual(Object.keys(target), ['query', 'tools', 'answers']);
  assert.deepEqual(target.answers, [{ name: 'approve', arguments: {} }]);
  assert.ok(!JSON.stringify(target).includes(row.independentReview.reason));
  assert.equal(data.requestFor(row).version, '3');
  assert.ok(data.reviewPacket(rows).every((packet) => /^case-[a-f0-9]{24}$/.test(packet.id)));
  assert.ok(data.reviewPacket(rows).every((packet) => !Object.hasOwn(packet, 'suggestedVerdict')));
  assert.equal(rows.filter((value) => value.preference.text === DEFAULT_PREFERENCE.text).length, 3);
  assert.deepEqual(target.tools.map((tool) => tool.name), ['approve', 'deny', 'ask']);
});

test('stale, missing, disputed or abstained reviews quarantine whole contrast families', () => {
  const rows = data.proposals(inventory);
  for (const mutation of ['hash', 'missing', 'dispute', 'abstain']) {
    const a = review('family-a', rows);
    const b = review('family-b', rows);
    if (mutation === 'hash') b.decisions[0].inputHash = 'stale';
    if (mutation === 'missing') b.decisions.shift();
    if (mutation === 'dispute') b.decisions[0].verdict = 'deny';
    if (mutation === 'abstain') b.decisions[0].verdict = 'abstain';
    const result = data.reviewedRows(rows, [a, b]);
    assert.equal(result.quarantine.length, 4);
    assert.ok(result.accepted.every((row) => row.family !== rows[0].family));
  }
  assert.throws(() => data.reviewedRows(rows, [review('same', rows), review('same', rows)]), /different independent/);
});

test('export excludes evaluation inputs and refuses incomplete tool coverage', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checker-data-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rows = data.proposals(inventory);
  const reviews = [review('family-a', rows), review('family-b', rows)];
  const out = path.join(root, 'reviewed');
  data.exportReviewed(inventory, rows, reviews, out);
  const training = fs.readFileSync(path.join(out, 'train.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(training.length, 4);
  assert.ok(training.every((line) => line.query.includes('npm test')));
  assert.ok(!training.some((line) => line.query.includes('git diff --check')));
  assert.throws(() => data.exportReviewed({ tools: [...inventory.tools, { agent: 'codex', name: 'uncaptured', hookable: null, schemaVerified: false }] }, rows, reviews, path.join(root, 'incomplete')), /coverage incomplete/);
  assert.throws(() => data.prepare(inventory, out), /Preserve existing/);
});

test('family leakage and duplicate visible inputs fail before exporting labels', () => {
  const rows = data.proposals(inventory);
  assert.throws(() => data.validatePartitions([...rows, { ...rows[0], id: 'extra', split: 'test' }]), /Family crosses/);
  assert.throws(() => data.validatePartitions([...rows, { ...rows[0], id: 'extra', family: 'different' }]), /Duplicate visible/);
});

test('the checked inventory includes V2, browser and explicit dynamic MCP gaps', () => {
  const checked = require('../../docs/checker-tool-inventory.json');
  const open = checked.tools.filter((tool) => tool.agent === 'opencode');
  assert.ok(open.some((tool) => tool.name === 'shell'));
  assert.ok(open.some((tool) => tool.name === 'subagent'));
  assert.ok(open.some((tool) => tool.name === 'opencode.worktree_remove'));
  assert.ok(open.some((tool) => tool.name === 'browser.files.upload' && tool.hookable === false));
  assert.ok(!open.some((tool) => ['bash', 'task', 'list'].includes(tool.name)));
  assert.ok(checked.tools.some((tool) => tool.kind === 'dynamic-catalog' && tool.schemaVerified === false));
  data.validatePartitions(data.proposals(checked));
  const report = data.coverage(checked, []);
  assert.equal(report.complete, false);
  assert.ok(report.missing.some((gap) => gap.startsWith('codex:')));
  assert.ok(report.runtimeGaps.some((gap) => gap.tool.startsWith('browser.')));
});
