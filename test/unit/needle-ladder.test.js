'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { prepareLadder } = require('../../guard/prototype/prepare-needle-ladder');
const { runtimeRequest, trainingLines } = require('../../guard/prototype/finetune-pipeline');
const { DEFAULT_PREFERENCE } = require('../../guard/lib/preference');

function fixture(t, count) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'needle-ladder-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pilot = path.join(root, 'pilot');
  fs.mkdirSync(pilot);
  const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
  const categories = ['ordinary-local', 'requested-destructive', 'unrequested-destructive', 'off-machine-send', 'network-read', 'remote-git', 'injected-instruction', 'owner-reply', 'hard-case'];
  const row = (index, split) => {
    const value = { id: `${split}-${index}`, family: `${split}-${index}`, split, category: categories[index % 9], verdict: ['allow', 'disallow', 'ask'][index % 3], preferenceId: 'default', preference: DEFAULT_PREFERENCE, userMessage: `Inspect ${split}-${index}.txt`, tool: 'read', args: { path: `${split}-${index}.txt` }, source: { model: 'inkling-small' } };
    const { query, tools } = runtimeRequest(value);
    value.independentReview = { model: 'kimi-k2-7-code', verdict: value.verdict, reason: 'Independent explanation.', inputHash: hash(JSON.stringify({ query, tools })) };
    return value;
  };
  const train = Array.from({ length: count }, (_, index) => row(index, 'train'));
  const validation = Array.from({ length: 100 }, (_, index) => row(index, 'validation'));
  const heldOut = Array.from({ length: 300 }, (_, index) => row(index, 'heldOut'));
  const source = path.join(root, 'source.jsonl');
  const reviews = path.join(root, 'reviews.json');
  const saveRows = (file, rows) => { const contents = rows.map((value) => JSON.stringify(value)).join('\n') + '\n'; fs.writeFileSync(file, contents); return hash(contents); };
  saveRows(source, [...train, ...validation]);
  fs.writeFileSync(reviews, JSON.stringify({ reviews: {} }));
  const hashes = {
    'train-scenarios.jsonl': saveRows(path.join(pilot, 'train-scenarios.jsonl'), train.slice(0, 300)),
    'validation-scenarios.jsonl': saveRows(path.join(pilot, 'validation-scenarios.jsonl'), validation),
    'held-out-scenarios.jsonl': saveRows(path.join(pilot, 'held-out-scenarios.jsonl'), heldOut),
    'train.jsonl': hash(trainingLines(train.slice(0, 300)).train.map((value) => JSON.stringify(value)).join('\n') + '\n'),
  };
  fs.writeFileSync(path.join(pilot, 'experiment.json'), JSON.stringify({ hashes, training: {}, baseArtifact: {} }));
  fs.writeFileSync(path.join(pilot, 'run.json'), JSON.stringify({ needleTrainerSourceSha256: 'trainer', checkpointSha256: 'checkpoint', outputHashes: { 'best.cact': 'candidate' } }));
  return { source, reviews, pilot, output: path.join(root, 'output'), train, validation, saveRows };
}

test('official ladder keeps nested sample counts, original 300 control, and unchanged frozen evaluation', (t) => {
  const setup = fixture(t, 1030);
  const plan = prepareLadder(setup);
  assert.deepEqual(plan.sizes, [100, 300, 600, 1000]);
  let prior = [];
  for (const size of plan.sizes) {
    const ids = new Set(plan.selections[size].ids);
    assert.equal(ids.size, size);
    assert.ok(prior.every((id) => ids.has(id)));
    prior = [...ids];
  }
  assert.equal(plan.validationCount, 100);
  assert.equal(plan.heldOutCount, 300);
  assert.equal(plan.hashes['train-300.jsonl'], JSON.parse(fs.readFileSync(path.join(setup.pilot, 'experiment.json'))).hashes['train.jsonl']);
  assert.throws(() => prepareLadder(setup), /immutable/);
});

test('official ladder skips unavailable sample counts and rejects validation-family contamination', (t) => {
  const setup = fixture(t, 620);
  const plan = prepareLadder(setup);
  assert.deepEqual(plan.sizes, [100, 300, 600]);
  assert.deepEqual(plan.skipped, [{ count: 1000, availableTraining: 620 }]);
  const contaminated = setup.train.map((row, index) => index === 619 ? { ...row, family: setup.validation[0].family } : row);
  setup.saveRows(setup.source, [...contaminated, ...setup.validation]);
  assert.throws(() => prepareLadder({ ...setup, output: setup.output + '-contaminated' }), /overlap/);
});

test('official ladder rejects changes to frozen pilot validation cases', (t) => {
  const setup = fixture(t, 620);
  fs.appendFileSync(path.join(setup.pilot, 'validation-scenarios.jsonl'), '\n');
  assert.throws(() => prepareLadder(setup), /Frozen pilot source changed/);
});
