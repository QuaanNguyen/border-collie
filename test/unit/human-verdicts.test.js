'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { prepare } = require('../../xor/prototype/prepare-critical-evaluation');
const { record } = require('../../xor/prototype/record-human-verdicts');

test('human verification preserves exact inputs, excludes uncertainty and cannot replace existing decisions', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-human-verdicts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'cases');
  prepare(directory, path.join(root, 'packet.md'));
  const input = fs.readFileSync(path.join(directory, 'requests.jsonl'));
  const values = ['ask', 'disallow', 'disallow', 'disallow', 'allow', 'allow', 'disallow', 'unclear'];
  assert.throws(() => record(directory, values.slice(1), { chat: 'fixture', exactReply: 'fixture' }), /Complete human decisions/);
  const result = record(directory, values, { chat: 'fixture', exactReply: values.join(' ') });
  assert.equal(result.labels.filter((row) => row.humanVerified).length, 7);
  assert.equal(result.labels.at(-1).verdict, null);
  assert.equal(result.trainingEligible, false);
  assert.ok(fs.readFileSync(path.join(directory, 'requests.jsonl')).equals(input));
  const plan = JSON.parse(fs.readFileSync(path.join(directory, 'study-plan.json')));
  assert.equal(plan.humanVerifiedCases, 7);
  assert.equal(plan.solJobsAllowed, false);
  assert.throws(() => record(directory, values, { chat: 'fixture', exactReply: 'changed' }), /Preserve the existing/);
});

test('changed human review inputs cannot acquire verified labels', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-human-tampering-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'cases');
  prepare(directory, path.join(root, 'packet.md'));
  fs.appendFileSync(path.join(directory, 'requests.jsonl'), '\n');
  assert.throws(() => record(directory, Array(8).fill('allow'), { chat: 'fixture', exactReply: 'fixture' }), /input changed/);
  assert.equal(fs.existsSync(path.join(directory, 'human-verdicts.json')), false);
});

test('critical human labels follow the frozen packet order and require isolation evidence', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-human-selection-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'cases');
  prepare(directory, path.join(root, 'packet.md'));
  const scenarios = fs.readFileSync(path.join(directory, 'scenarios.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const selection = [scenarios[6], scenarios[0]];
  const orderFile = path.join(directory, 'human-review-order.json');
  fs.writeFileSync(orderFile, JSON.stringify(selection.map((row, index) => ({ number: index + 1, id: row.id, inputHash: row.inputHash }))));
  const original = JSON.parse(fs.readFileSync(path.join(directory, 'human-verification.json')));
  const manifest = { ...original, status: 'rejected-contract-defects', trainingExamplesProvidedToAuthor: false, isolatedFromTrainingReviewFeedback: true, hashes: { ...original.hashes, 'human-review-order.json': crypto.createHash('sha256').update(fs.readFileSync(orderFile)).digest('hex') } };
  const isolationFile = path.join(directory, 'isolation.json');
  fs.writeFileSync(isolationFile, JSON.stringify(manifest));
  assert.throws(() => record(directory, ['disallow', 'unclear'], { chat: 'fixture', exactReply: '1 disallow 2 unclear' }), /isolated frozen evaluation/);
  manifest.status = 'frozen-inputs-awaiting-independent-and-human-labels';
  fs.writeFileSync(isolationFile, JSON.stringify(manifest));
  const result = record(directory, ['disallow', 'unclear'], { chat: 'fixture', exactReply: '1 disallow 2 unclear' });
  assert.deepEqual(result.labels.map((row) => [row.id, row.verdict]), [[selection[0].id, 'disallow'], [selection[1].id, null]]);
  const requests = fs.readFileSync(path.join(directory, 'human-critical-requests.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(requests.map((row) => row.id), [selection[0].id]);
  assert.equal(result.blind, true);
  assert.equal(fs.existsSync(path.join(directory, 'study-plan.json')), false);
});
