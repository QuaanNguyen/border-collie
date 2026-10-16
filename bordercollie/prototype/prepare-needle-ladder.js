'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runtimeRequest, trainingLines, modelFamily, REQUEST_FORMAT_VERSION } = require('./finetune-pipeline');
const { selectFamilies } = require('./prepare-sol-experiment');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readRows(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

function prepareLadder({ source, reviews, pilot, output }) {
  if (fs.existsSync(output)) throw new Error('Choose a new ladder directory; existing experiments are immutable');
  const sourceText = fs.readFileSync(source, 'utf8');
  const savedReviews = JSON.parse(fs.readFileSync(reviews, 'utf8')).reviews;
  const development = sourceText.trim().split('\n').filter(Boolean).map(JSON.parse).map((row) => ({ ...row, independentReview: row.independentReview || savedReviews[row.id] }));
  const validation = readRows(path.join(pilot, 'validation-scenarios.jsonl'));
  const heldOut = readRows(path.join(pilot, 'held-out-scenarios.jsonl'));
  const original = readRows(path.join(pilot, 'train-scenarios.jsonl'));
  const pilotExperiment = JSON.parse(fs.readFileSync(path.join(pilot, 'experiment.json'), 'utf8'));
  const priorRun = JSON.parse(fs.readFileSync(path.join(pilot, 'run.json'), 'utf8'));
  for (const file of ['train-scenarios.jsonl', 'validation-scenarios.jsonl', 'held-out-scenarios.jsonl']) {
    if (sha256(fs.readFileSync(path.join(pilot, file))) !== pilotExperiment.hashes[file]) throw new Error(`Frozen pilot source changed: ${file}`);
  }
  const visible = (row) => { const { query, tools } = runtimeRequest(row); return sha256(JSON.stringify({ query, tools })); };
  const excludedFamilies = new Set([...development.filter((row) => row.split !== 'train'), ...validation, ...heldOut].map((row) => row.family));
  const excludedInputs = new Set([...validation, ...heldOut].map(visible));
  const pool = development.filter((row) => row.split === 'train');
  const ids = new Map(pool.map((row) => [row.id, row]));
  if (ids.size !== pool.length) throw new Error('Duplicate training Scenario identities');
  for (const row of pool) {
    const review = row.independentReview;
    if (!review?.model || !review.reason?.trim() || review.verdict !== row.verdict || review.inputHash !== visible(row) || modelFamily(review.model) === modelFamily(row.source.model)) throw new Error(`Unverified independent review for ${row.id}`);
    if (excludedFamilies.has(row.family) || excludedInputs.has(visible(row))) throw new Error(`Evaluation or validation overlap for ${row.id}`);
  }
  for (const row of original) {
    if (!ids.has(row.id) || visible(ids.get(row.id)) !== visible(row) || ids.get(row.id).verdict !== row.verdict) throw new Error(`Original pilot data changed: ${row.id}`);
  }
  const snapshots = new Map([[100, selectFamilies(original, 100, 42)], [300, original]]);
  let selected = original;
  const skipped = [];
  for (const count of [600, 1000]) {
    if (pool.length < count) { skipped.push({ count, availableTraining: pool.length }); continue; }
    const used = new Set(selected.map((row) => row.id));
    selected = [...selected, ...selectFamilies(pool.filter((row) => !used.has(row.id)), count - selected.length, 42)].sort((a, b) => a.id.localeCompare(b.id));
    snapshots.set(count, selected);
  }
  const distributions = (rows) => Object.fromEntries(['verdict', 'category', 'preferenceId'].map((field) => [field, Object.fromEntries([...new Set(rows.map((row) => row[field]))].sort().map((value) => [value, rows.filter((row) => row[field] === value).length]))]));
  fs.mkdirSync(output, { recursive: true });
  const hashes = {};
  const save = (file, rows) => {
    const contents = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
    fs.writeFileSync(path.join(output, file), contents);
    hashes[file] = sha256(contents);
  };
  save('validation-scenarios.jsonl', validation);
  save('validation.jsonl', trainingLines(validation).validation);
  save('held-out-scenarios.jsonl', heldOut);
  const selections = {};
  let preceding = [];
  for (const [count, rows] of snapshots) {
    const rowIds = new Set(rows.map((row) => row.id));
    if (rows.length !== count || rowIds.size !== count || preceding.some((row) => !rowIds.has(row.id))) throw new Error(`Non-nested or incorrectly sized training subset: ${count}`);
    const mix = distributions(rows);
    if (Object.keys(mix.verdict).length !== 3 || Object.keys(mix.category).length !== 9) throw new Error(`Missing Verdict or category in ${count}-sample subset`);
    save(`train-${count}-scenarios.jsonl`, rows);
    save(`train-${count}.jsonl`, trainingLines(rows).train);
    selections[count] = { count, ids: rows.map((row) => row.id), families: new Set(rows.map((row) => row.family)).size, distributions: mix };
    preceding = rows;
  }
  if (hashes['train-300.jsonl'] !== pilotExperiment.hashes['train.jsonl']) throw new Error('300-sample CLI control must match the original training data byte for byte');
  const plan = {
    status: 'prepared', createdAt: new Date().toISOString(), availableDevelopment: development.length, availableTraining: pool.length,
    sourceSha256: sha256(sourceText), requestFormatVersion: REQUEST_FORMAT_VERSION, hashes, selections, skipped,
    validationCount: validation.length, heldOutCount: heldOut.length,
    selectionSeed: 42, trainingSeeds: [42, 0], sizes: [...snapshots.keys()],
    purpose: 'Official Cactus CLI sample-size and seed ladder; nested data; fixed validation; no held-out data in training or model selection.',
    training: { ...pilotExperiment.training, epochs: 10, validationSplit: 'Official seeded split arranged to reproduce the frozen 100 validation cases exactly; verified before each invocation.' },
    guides: ['https://www.cactuscompute.com/blog/finetuning-needle', 'https://www.cactuscompute.com/blog/designing-tools-for-needle', 'https://www.cactuscompute.com/blog/needle-python-docs'],
    priorCustomRun: { directory: pilot, needleTrainerSourceSha256: priorRun.needleTrainerSourceSha256, checkpointSha256: priorRun.checkpointSha256, candidateSha256: priorRun.outputHashes['best.cact'] },
    baseArtifact: pilotExperiment.baseArtifact,
    controls: ['Pinned shipped base', 'Untuned zero-adapter export through official needle build'],
    modelSelection: 'Compare validation decisions, harmful approvals, ordinary refusals, and confirmation recall; report all settings, including failures. Held-out evaluation reports performance and does not choose settings.',
  };
  fs.writeFileSync(path.join(output, 'ladder-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  return plan;
}

if (require.main === module) {
  const plan = prepareLadder({ source: path.join(__dirname, 'output/stage2/development/accepted.jsonl'), reviews: path.join(__dirname, 'output/stage2/development/labels.json'), pilot: path.join(__dirname, 'output/sol-300-seed42'), output: path.join(__dirname, 'output/needle-official-ladder') });
  console.log(JSON.stringify({ availableTraining: plan.availableTraining, sizes: plan.sizes, seeds: plan.trainingSeeds, skipped: plan.skipped, distributions: Object.fromEntries(Object.entries(plan.selections).map(([count, selection]) => [count, selection.distributions])) }, null, 2));
}

module.exports = { prepareLadder };
