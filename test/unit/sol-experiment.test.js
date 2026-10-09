'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { prepare, selectFamilies } = require('../../guard/prototype/prepare-sol-experiment');
const { runtimeRequest } = require('../../guard/prototype/finetune-pipeline');
const { DEFAULT_PREFERENCE } = require('../../guard/lib/preference');

test('pilot selection is reproducible, independent of source ordering, and keeps complete families', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ id: `case-${index}`, family: `family-${Math.floor(index / 2)}` }));
  const selected = selectFamilies(rows, 10, 42);
  assert.deepEqual(selected, selectFamilies([...rows].reverse(), 10, 42));
  assert.equal(selected.length, 10);
  for (const row of selected) assert.equal(selected.filter((other) => other.family === row.family).length, 2);
  assert.throws(() => selectFamilies(rows, 9, 42), /without splitting families/);
});

test('repeating a completed training command preserves the original run record', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-complete-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const record = JSON.stringify({ status: 'complete', slurmJobId: 'previous' });
  fs.writeFileSync(path.join(directory, 'run.json'), record);
  const result = spawnSync('python3', [path.resolve(__dirname, '../../guard/prototype/sol-finetune.py'), directory], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Run already started/);
  assert.equal(fs.readFileSync(path.join(directory, 'run.json'), 'utf8'), record);
});

test('pilot freezes separate reviewed splits and rejects held-out overlap and stale reviews', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-experiment-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const categories = ['ordinary-local', 'requested-destructive', 'unrequested-destructive', 'off-machine-send', 'network-read', 'remote-git', 'injected-instruction', 'owner-reply', 'hard-case'];
  const rows = ['train', 'validation', 'heldOut'].flatMap((split) => categories.map((category, index) => {
    const row = { id: `${split}-${index}`, family: `${split}-family-${index}`, category, split, verdict: ['allow', 'disallow', 'ask'][index % 3], preferenceId: 'default', preference: DEFAULT_PREFERENCE, userMessage: `Inspect ${split}-${index}.txt`, tool: 'read', args: { path: `${split}-${index}.txt` }, source: { model: 'proposer' } };
    const { query, tools } = runtimeRequest(row);
    row.independentReview = { verdict: row.verdict, model: 'labeler', inputHash: crypto.createHash('sha256').update(JSON.stringify({ query, tools })).digest('hex') };
    return row;
  }));
  const source = path.join(directory, 'development.jsonl');
  const evaluation = path.join(directory, 'evaluation.jsonl');
  const save = (file, data) => fs.writeFileSync(file, data.map((row) => JSON.stringify(row)).join('\n') + '\n');
  save(source, rows.filter((row) => row.split !== 'heldOut'));
  save(evaluation, rows.filter((row) => row.split === 'heldOut'));
  const output = path.join(directory, 'run');
  const options = { source, evaluation, output, trainCount: 9, validationCount: 9 };
  const result = prepare(options);
  assert.deepEqual(result.provenance.lineCounts, { train: 9, validation: 9, heldOut: 9 });
  assert.equal(fs.readFileSync(path.join(output, 'train.jsonl'), 'utf8').trim().split('\n').length, 9);
  assert.equal(fs.readFileSync(path.join(output, 'validation.jsonl'), 'utf8').trim().split('\n').length, 9);
  for (const [file, hash] of Object.entries(result.hashes)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(output, file))).digest('hex'), hash);
  assert.throws(() => prepare(options), /already frozen/);
  const contaminated = { ...rows.find((row) => row.split === 'heldOut'), family: rows[0].family };
  save(evaluation, [contaminated]);
  assert.throws(() => prepare({ ...options, output: path.join(directory, 'overlap') }), /evaluation overlap/);
  save(evaluation, rows.filter((row) => row.split === 'heldOut'));
  const stale = rows.filter((row) => row.split !== 'heldOut').map((row, index) => index === 0 ? { ...row, userMessage: 'Changed request' } : row);
  save(source, stale);
  assert.throws(() => prepare({ ...options, output: path.join(directory, 'stale') }), /Review mismatch/);
});
