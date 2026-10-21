'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runtimeRequest, modelFamily, REQUEST_FORMAT_VERSION } = require('./finetune-pipeline');
const { selectFamilies } = require('./prepare-sol-experiment');
const { proposedCall } = require('../lib/toolcalls');
const { boundaryDecision } = require('../lib/boundary');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const readRows = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map(JSON.parse);
const countBy = (rows, field) => Object.fromEntries([...new Set(rows.map((row) => row[field]))].sort().map((value) => [value, rows.filter((row) => row[field] === value).length]));

function reconcile(rows, reviews) {
  if (reviews.length !== 2 || modelFamily(reviews[0].model) === modelFamily(reviews[1].model) || reviews.some((review) => review.status !== 'complete' || review.completed !== rows.length || review.inputHash !== digest(JSON.stringify(rows)))) throw new Error('Two complete independent reviews of these exact inputs are required');
  const excludedFamilies = new Map();
  const proposed = [];
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error('Duplicate source id: ' + row.id);
    ids.add(row.id);
    const { query, tools } = runtimeRequest(row);
    const inputHash = digest(JSON.stringify({ query, tools }));
    const pair = reviews.map((review) => review.reviews[row.id]);
    if (pair.some((review) => !review || review.inputHash !== inputHash)) throw new Error('Stale or missing review: ' + row.id);
    if (!['allow', 'disallow', 'ask'].includes(pair[0].verdict) || pair[0].verdict !== pair[1].verdict) {
      excludedFamilies.set(row.family, 'Reviewer disagreement or abstention');
      continue;
    }
    if (pair[0].verdict === 'ask' && !tools.some((tool) => tool.name === 'ask_owner')) {
      excludedFamilies.set(row.family, 'The request does not offer an ask Verdict');
      continue;
    }
    if (boundaryDecision({ call: proposedCall(row.tool, row.args), workdir: process.cwd() })) {
      excludedFamilies.set(row.family, 'The folder boundary blocks this call before the Judge');
      continue;
    }
    proposed.push({ ...row, inputHash, verdict: pair[0].verdict, independentReview: pair[1], proposalReview: pair[0] });
  }
  const inputs = new Map();
  for (const row of proposed) {
    const matches = inputs.get(row.inputHash) || [];
    matches.push(row);
    inputs.set(row.inputHash, matches);
  }
  for (const matches of inputs.values()) {
    if (new Set(matches.map((row) => row.verdict)).size > 1 || new Set(matches.map((row) => row.dataset === 'diagnostic' ? 'diagnostic' : row.split)).size > 1) {
      matches.forEach((row) => excludedFamilies.set(row.family, 'Identical input has conflicting labels or appears across splits'));
    }
  }
  const seen = new Set();
  const accepted = proposed.filter((row) => {
    if (excludedFamilies.has(row.family) || seen.has(row.inputHash)) return false;
    seen.add(row.inputHash);
    return true;
  });
  const partitions = new Map();
  for (const row of accepted) {
    const partition = row.dataset === 'diagnostic' ? 'diagnostic' : row.split;
    if (partitions.has(row.family) && partitions.get(row.family) !== partition) throw new Error('Family overlap: ' + row.family);
    partitions.set(row.family, partition);
  }
  return { accepted, quarantine: rows.filter((row) => excludedFamilies.has(row.family)).map((row) => ({ id: row.id, family: row.family, topic: row.topic, reason: excludedFamilies.get(row.family) })), duplicateInputsRemoved: proposed.length - accepted.length - proposed.filter((row) => excludedFamilies.has(row.family)).length };
}

function prepareStudy(directory) {
  const planPath = path.join(directory, 'study-plan.json');
  if (fs.existsSync(planPath)) throw new Error('Study is already frozen');
  const rows = readRows(path.join(directory, 'scenarios.jsonl'));
  const reviews = ['inkling-small', 'kimi-k2-7-code'].map((model) => JSON.parse(fs.readFileSync(path.join(directory, `review-${model}.json`), 'utf8')));
  const reconciled = reconcile(rows, reviews);
  const pool = reconciled.accepted.filter((row) => row.dataset !== 'diagnostic' && row.split === 'train');
  const validationPool = reconciled.accepted.filter((row) => row.dataset !== 'diagnostic' && row.split === 'validation');
  if (pool.length < 1000 || validationPool.length < 100) throw new Error(`Insufficient eligible data: ${pool.length} train, ${validationPool.length} validation`);
  const train = selectFamilies(pool, 1000, 20261013);
  const validation = selectFamilies(validationPool, 100, 20261013);
  const diagnostic = reconciled.accepted.filter((row) => row.dataset === 'diagnostic');
  if (!diagnostic.length) throw new Error('No reviewed diagnostic cases remain');
  if (new Set(train.map((row) => row.verdict)).size !== 3) throw new Error('Training lacks a Verdict class');
  const hashes = {};
  const saveRows = (name, values) => {
    const contents = values.map(JSON.stringify).join('\n') + '\n';
    fs.writeFileSync(path.join(directory, name), contents);
    hashes[name] = digest(contents);
  };
  const target = (row) => {
    const { query, tools } = runtimeRequest(row);
    return { query, tools, answers: [{ name: { allow: 'allow_call', disallow: 'block_call', ask: 'ask_owner' }[row.verdict], arguments: {} }] };
  };
  for (const [name, values] of [['train', train], ['validation', validation]]) {
    saveRows(`${name}-scenarios.jsonl`, values);
    saveRows(`${name}-answers.jsonl`, values.map(target));
  }
  const request = (row) => ({ id: row.id, family: row.family, topic: row.topic, tool: row.tool, category: row.category, preference: row.preferenceId || 'sensitive-scope-pilot', expected: row.verdict, inputHash: row.inputHash, actionHash: digest(JSON.stringify({ tool: row.tool, args: row.args })), queryHash: digest(runtimeRequest(row).query), ...runtimeRequest(row) });
  for (const [name, values] of [['fit', selectFamilies(train, 100, 20261013)], ['validation', validation], ['diagnostic', diagnostic]]) saveRows(`${name}-requests.jsonl`, values.map(request));
  saveRows('quarantine.jsonl', reconciled.quarantine);
  const seeds = [0, 1, 2];
  const runs = seeds.flatMap((seed) => [
    { label: `untuned-seed${seed}`, size: 0, seed, updates: 0, epochs: 0, experiment: 'matched-4bit-baseline' },
    ...[16, 32].flatMap((rank) => [300, 1500, 3000].map((updates) => ({ label: `answers-r${rank}-u${updates}-seed${seed}`, size: 1000, seed, updates, epochs: updates / 50, experiment: 'answers-only-fitting', training: { loraRank: rank, loraAlpha: rank * 2, reasoningTargets: false }, trainingFile: 'train-answers.jsonl', validationFile: 'validation-answers.jsonl' }))),
  ]);
  const evidence = JSON.parse(fs.readFileSync(path.join(directory, 'preparation.json'), 'utf8'));
  const firstWave = runs.flatMap((run, index) => run.updates <= 300 ? [index] : []);
  const plan = {
    schemaVersion: 1, status: 'frozen-diagnostic-pilot', createdAt: new Date().toISOString(), requestFormatVersion: REQUEST_FORMAT_VERSION,
    purpose: 'Incremental issue-driven V2 answers-only fitting pilot, not a promotion study.', issues: [54, 57, 58, 59, 60, 61, 65],
    seeds, runs, hashes, customPreferenceContract: evidence.customPreferenceContract,
    wrapperHashes: Object.fromEntries(['needle-4bit-study.py', 'preflight-v2-pilot.py', 'summarize-v2-pilot.py', 'submit-v2-pilot.py'].map((name) => [name, digest(fs.readFileSync(path.join(__dirname, name)))])),
    training: { batchSize: 20, learningRate: 0.0001, loraRank: 16, loraAlpha: 32, maxLength: 1024, exportLayers: 20, quantizedWeightBits: 4, reasoningTargets: false },
    checkpoint: { path: '/scratch/qnguye19/needle/checkpoints/needle3.safetensors', sha256: 'c234c70dccc7a9115e7c41ac2e41d3655fea3b85c245dd898b46179fb90c6c0c' },
    baseArchive: { path: '/scratch/qnguye19/needle/needle3.cact', sha256: 'c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38' },
    officialTrainerSourceSha256: '677b2e4aba1fd9ce5ff6e6e19763d0a66b8425eccf626f7107e2e3ace5d99241',
    expectedTokenizerSha256: '9f839cd44027ea9203738897da2bac572a5cc77aec7fceacd4391fc412a3249f',
    expectedUntunedExportSha256: '3bde318ede183eb06eb65524c9139f83d749e929f46feadfe516cefa3c8e8863',
    evaluationSplits: ['fit', 'validation', 'diagnostic'],
    evaluation: { runnerSha256: 'f38dc4b0345d66b4e385734ad0f12af43ac6e2cfa1752d0795af5c137200c8e4', container: '/scratch/qnguye19/needle/experiments/needle-official-ladder/runtime/evaluation-ubuntu22.sif', containerSha256: 'd98a4b4fa6a200e7db0a32fff28265fff5a3d4d03bd905286aad525900e18eb8', threads: 1, maxTokens: 128, caseTimeoutSeconds: 15 },
    executionWaves: [firstWave, runs.map((_, index) => index).filter((index) => !firstWave.includes(index))],
    reviewHashes: Object.fromEntries(reviews.map((review) => [review.model, digest(fs.readFileSync(path.join(directory, `review-${review.model}.json`)))])),
    data: { eligibleTrain: pool.length, eligibleValidation: validationPool.length, selectedTrain: train.length, selectedValidation: validation.length, diagnosticCases: diagnostic.length, quarantinedCases: reconciled.quarantine.length, duplicateInputsRemoved: reconciled.duplicateInputsRemoved, trainVerdicts: countBy(train, 'verdict'), trainTopics: countBy(train, 'topic'), validationTopics: countBy(validation, 'topic') },
    selectionRule: 'Use family-separated development validation only. Never select a seed or setting using historical diagnostic results. Report all three seeds; extend the selected design to ten seeds later.',
    limits: ['No fresh blind test exists yet; promotion is prohibited.', 'Worktree and patch contracts are not included in this pilot.', 'Coverage gaps and disputed families remain explicit follow-up work, not silently relabeled.', 'Training uses a custom Preference contract through the unchanged production request builder; the shipped default is unchanged.', 'The official trainer has no external validation-file option; a verified seed permutation places the registered family-separated validation cases into its internal split.'],
  };
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
  return plan;
}

if (require.main === module) {
  try {
    const plan = prepareStudy(path.resolve(process.argv[2]));
    console.log(JSON.stringify({ tasks: plan.runs.length, data: plan.data }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { reconcile, prepareStudy };
