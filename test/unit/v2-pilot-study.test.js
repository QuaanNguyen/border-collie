'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { reconcile, prepareStudy } = require('../../xor/prototype/prepare-v2-pilot-study');
const { runtimeRequest } = require('../../xor/prototype/finetune-pipeline');
const { DEFAULT_PREFERENCE } = require('../../xor/prototype/historical-v2/preference');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const row = (id, family = id) => ({ id, family, topic: 'ordinary', dataset: 'development', split: 'train', userMessage: `Read ${id}.txt`, tool: 'read', args: { path: `${id}.txt` }, preference: DEFAULT_PREFERENCE });

function reviews(rows) {
  return ['inkling-small', 'kimi-k2-7-code'].map((model) => ({
    model, status: 'complete', completed: rows.length, inputHash: hash(JSON.stringify(rows)),
    reviews: Object.fromEntries(rows.map((item) => {
      const { query, tools } = runtimeRequest(item);
      return [item.id, { model, inputHash: hash(JSON.stringify({ query, tools })), verdict: 'allow', reason: 'The requested local read is permitted.' }];
    })),
  }));
}

test('pilot reconciliation quarantines the whole disputed family and rejects stale reviews', () => {
  const rows = [row('first', 'pair'), row('second', 'pair'), row('retained')];
  const audited = reviews(rows);
  audited[1].reviews.first.verdict = 'disallow';
  const result = reconcile(rows, audited);
  assert.deepEqual(result.accepted.map((item) => item.id), ['retained']);
  assert.equal(result.quarantine.length, 2);
  audited[1].reviews.retained.inputHash = 'stale';
  assert.throws(() => reconcile(rows, audited), /Stale/);
});

test('pilot reconciliation rejects duplicate inputs across training and diagnostic splits', () => {
  const training = row('shared');
  const diagnostic = { ...training, id: 'diagnostic', family: 'diagnostic', dataset: 'diagnostic', split: 'heldOut' };
  const rows = [training, diagnostic];
  const result = reconcile(rows, reviews(rows));
  assert.equal(result.accepted.length, 0);
  assert.equal(result.quarantine.length, 2);
});

test('pilot reconciliation cannot reuse incomplete or same-family reviews', () => {
  const rows = [row('one')];
  const audited = reviews(rows);
  audited[1].status = 'incomplete';
  assert.throws(() => reconcile(rows, audited), /complete independent/);
  audited[1].status = 'complete';
  audited[1].model = 'inkling-small';
  assert.throws(() => reconcile(rows, audited), /complete independent/);
});

test('pilot freezing uses reviewed disjoint data, answers-only targets, and registered fitting controls', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-pilot-study-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const rows = [
    ...Array.from({ length: 1000 }, (_, index) => row(`training-${index}`)),
    ...Array.from({ length: 100 }, (_, index) => ({ ...row(`validation-${index}`), split: 'validation' })),
    ...Array.from({ length: 12 }, (_, index) => ({ ...row(`diagnostic-${index}`), dataset: 'diagnostic', split: 'heldOut' })),
  ].map((item) => ({ ...item, preference: { ...DEFAULT_PREFERENCE, ask: 'Ask before the listed special operation.' } }));
  const audited = reviews(rows);
  for (const review of audited) {
    rows.forEach((item, index) => { review.reviews[item.id].verdict = ['allow', 'disallow', 'ask'][index % 3]; });
    fs.writeFileSync(path.join(directory, `review-${review.model}.json`), JSON.stringify(review));
  }
  fs.writeFileSync(path.join(directory, 'scenarios.jsonl'), rows.map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(path.join(directory, 'preparation.json'), JSON.stringify({ customPreferenceContract: 'fixture' }));
  const plan = prepareStudy(directory);
  assert.equal(plan.runs.length, 21);
  assert.equal(plan.data.selectedTrain, 1000);
  assert.equal(plan.data.selectedValidation, 100);
  assert.equal(plan.data.diagnosticCases, 12);
  assert.deepEqual(new Set(plan.runs.filter((run) => run.experiment === 'answers-only-fitting').map((run) => run.updates)), new Set([300, 1500, 3000]));
  assert.equal(plan.runs.filter((run) => run.experiment === 'target-format-control').length, 0);
  assert(plan.executionWaves[0].every((index) => plan.runs[index].updates <= 300));
  assert(plan.executionWaves[1].every((index) => plan.runs[index].updates > 300));
  assert.deepEqual(plan.executionWaves.flat().sort((left, right) => left - right), plan.runs.map((_, index) => index));
  const training = fs.readFileSync(path.join(directory, 'train-answers.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert(training.every((line) => line.answers.length === 1 && !Object.hasOwn(line, 'reasoning')));
  const selected = fs.readFileSync(path.join(directory, 'train-scenarios.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert(selected.every((item) => !item.id.startsWith('diagnostic-') && !item.id.startsWith('validation-')));
  assert.throws(() => prepareStudy(directory), /already frozen/);
});
