'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runtimeRequest, trainingLines, modelFamily, REQUEST_FORMAT_VERSION } = require('./finetune-pipeline');
const { selectFamilies } = require('./prepare-sol-experiment');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const readRows = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

function prepareStudy({ source, reviews, validationFile, evaluationFile, output, selectionSeed = 20261009 }) {
  if (fs.existsSync(output)) throw new Error('Choose a new immutable study directory');
  const sourceText = fs.readFileSync(source, 'utf8');
  const reviewsText = fs.readFileSync(reviews, 'utf8');
  const reviewMap = JSON.parse(reviewsText).reviews;
  const development = sourceText.trim().split('\n').filter(Boolean).map(JSON.parse).map((row) => ({ ...row, independentReview: row.independentReview || reviewMap[row.id] }));
  const validation = readRows(validationFile);
  const heldOut = readRows(evaluationFile);
  const visible = (row) => { const { query, tools } = runtimeRequest(row); return digest(JSON.stringify({ query, tools })); };
  const excludedFamilies = new Set([...development.filter((row) => row.split !== 'train'), ...validation, ...heldOut].map((row) => row.family));
  const excludedInputs = new Set([...validation, ...heldOut].map(visible));
  const pool = development.filter((row) => row.split === 'train');
  const ids = new Set();
  const inputs = new Set();
  for (const row of pool) {
    const review = row.independentReview;
    const input = visible(row);
    if (ids.has(row.id) || inputs.has(input)) throw new Error('Duplicate training case: ' + row.id);
    if (excludedFamilies.has(row.family) || excludedInputs.has(input)) throw new Error('Evaluation overlap: ' + row.id);
    if (!review?.reason?.trim() || review.verdict !== row.verdict || review.inputHash !== input || !review.model || modelFamily(review.model) === modelFamily(row.source.model)) throw new Error('Independent review mismatch: ' + row.id);
    ids.add(row.id);
    inputs.add(input);
  }
  const validationFamilies = new Set(validation.map((row) => row.family));
  const validationInputs = new Set(validation.map(visible));
  if (validation.length !== 100 || heldOut.length !== 300 || heldOut.some((row) => validationFamilies.has(row.family) || validationInputs.has(visible(row)))) throw new Error('Invalid or overlapping evaluation sets');
  const sizes = [100, 300, 600, 1000, 2000];
  if (pool.length < sizes.at(-1)) throw new Error('Not enough distinct eligible training samples: ' + pool.length);
  const subsets = new Map();
  let selected = [];
  for (const size of sizes) {
    const used = new Set(selected.map((row) => row.id));
    selected = [...selected, ...selectFamilies(pool.filter((row) => !used.has(row.id)), size - selected.length, selectionSeed)].sort((a, b) => a.id.localeCompare(b.id));
    if (new Set(selected.map((row) => row.verdict)).size !== 3 || new Set(selected.map((row) => row.category)).size !== 9) throw new Error('Incomplete class or category coverage: ' + size);
    subsets.set(size, selected);
  }
  fs.mkdirSync(output, { recursive: true });
  const hashes = {};
  const saveRows = (name, rows) => {
    const text = rows.map(JSON.stringify).join('\n') + '\n';
    fs.writeFileSync(path.join(output, name), text);
    hashes[name] = digest(text);
  };
  const targets = (rows) => trainingLines(rows)[rows[0].split].map((line, index) => ({ ...line, reasoning: rows[index].independentReview.reason.trim() }));
  saveRows('validation-scenarios.jsonl', validation);
  saveRows('held-out-scenarios.jsonl', heldOut);
  saveRows('validation.jsonl', targets(validation));
  const selections = {};
  for (const [size, rows] of subsets) {
    saveRows(`train-${size}-scenarios.jsonl`, rows);
    saveRows(`train-${size}.jsonl`, targets(rows));
    selections[size] = { count: size, families: new Set(rows.map((row) => row.family)).size, ids: rows.map((row) => row.id), verdicts: Object.fromEntries(['allow', 'disallow', 'ask'].map((verdict) => [verdict, rows.filter((row) => row.verdict === verdict).length])) };
  }
  const evaluationRequests = (rows) => rows.map((row) => ({ id: row.id, family: row.family, topic: row.family.split(':')[0], tool: row.tool, category: row.category, preference: row.preferenceId, expected: row.verdict, inputHash: visible(row), actionHash: digest(JSON.stringify({ tool: row.tool, args: row.args })), queryHash: digest(runtimeRequest(row).query), ...runtimeRequest(row) }));
  saveRows('validation-requests.jsonl', evaluationRequests(validation));
  saveRows('heldOut-requests.jsonl', evaluationRequests(heldOut));
  const seeds = Array.from({ length: 10 }, (_, index) => index);
  const runs = seeds.flatMap((seed) => [0, ...sizes].map((size) => ({ label: `n${size}-seed${seed}`, size, seed, experiment: 'sample-size', updates: size ? 300 : 0, epochs: size ? 300 / (size / 20) : 0 })));
  runs.push(...seeds.flatMap((seed) => [100, 600].map((updates) => ({ label: `n1000-steps${updates}-seed${seed}`, size: 1000, seed, experiment: 'duration', updates, epochs: updates / 50 }))));
  const plan = {
    schemaVersion: 1, createdAt: new Date().toISOString(), purpose: 'Ten paired repetitions of the official local Cactus 4-bit sample-size experiment.',
    trainer: 'Unmodified cactus-needle 3.1.2 needle finetune on Sol A100; no custom training loop or hosted training.',
    selectionSeed, seeds, sizes: [0, ...sizes], availableTraining: pool.length, validationCount: validation.length, heldOutCount: heldOut.length,
    sourceSha256: digest(sourceText), reviewsSha256: digest(reviewsText), requestFormatVersion: REQUEST_FORMAT_VERSION,
    hashes, selections, runs,
    checkpoint: { path: '/scratch/qnguye19/needle/checkpoints/needle3.safetensors', sha256: 'c234c70dccc7a9115e7c41ac2e41d3655fea3b85c245dd898b46179fb90c6c0c' },
    officialTrainerSourceSha256: '677b2e4aba1fd9ce5ff6e6e19763d0a66b8425eccf626f7107e2e3ace5d99241',
    training: { updateBudget: 300, batchSize: 20, learningRate: 0.0001, loraRank: 16, loraAlpha: 32, maxLength: 1024, exportLayers: 20, quantizedWeightBits: 4, checkpointSelection: 'Official CLI final adapter at the prescribed update budget; it does not restore a best-validation epoch.', reasoningTargets: true },
    baseline: 'Fresh official init_lora with zero B matrices, no optimizer steps; official needle build --lora forces the same 4-bit conversion and confidence-head omission as trained exports.',
    comparison: 'Within the main sample-size comparison each seed uses exactly 300 optimizer updates at batch 20. Epochs are derived solely from sample count: 100/60, 300/20, 600/10, 1000/6, 2000/3. Nested subsets and identical validation, diagnostic held-out cases, initialization seed, total examples processed, learning-rate schedule, target format, depth, export precision and runtime. Baseline receives zero updates. Separate 1000-sample duration controls use 100 and 600 updates, compared with the shared 300-update condition; the official schedule horizon also changes in duration controls.',
    durationControls: { size: 1000, updateBudgets: [100, 300, 600], source: 'Same frozen 1000 examples and validation targets; no resampling across durations.' },
    analysisFollowup: { report: 'guard/prototype/output/needle-official-ladder/mac-runtime/restrictiveness-report.md', implemented: ['Remove optimizer-update confound from sample-size ladder.', 'Test shorter and longer training on the same 1000 examples.', 'Track requested backups, source edits, local report writing and conditional authorization contrasts separately.'], sequence: 'Diagnose duration first. Replacement-data and answers-only experiments remain subsequent distinct controls, so they do not change this sample-size comparison.', evaluationLimit: 'These 300 held-out cases were previously inspected for diagnosis. They remain excluded from training and model selection but are not a fresh blind test for final generalization claims.' },
    evaluation: { runnerSource: '/scratch/qnguye19/needle/experiments/needle-official-ladder/judge-root/2ae11323dc000f5e70c49f7403efa6af12ba9e67/needle', runnerSha256: 'f38dc4b0345d66b4e385734ad0f12af43ac6e2cfa1752d0795af5c137200c8e4', container: '/scratch/qnguye19/needle/experiments/needle-official-ladder/runtime/evaluation-ubuntu22.sif', containerSha256: 'd98a4b4fa6a200e7db0a32fff28265fff5a3d4d03bd905286aad525900e18eb8', threads: 4, maxTokens: 128, caseTimeoutSeconds: 120, forcedCalls: false, semantics: 'Same Verdict parsing as Guard, including recognized suppressed calls. Missing Verdict is scored as an error. No confidence threshold. Fresh engine process per case. Infrastructure failures invalidate the repetition rather than becoming model errors.' },
    statistics: 'Report all ten seeds, mean, sample standard deviation, range, t-based 95% confidence interval for the mean across training seeds, paired differences against the same-seed untuned 4-bit baseline, and per-case decision agreement. Intervals describe training randomness on these fixed generated evaluation cases; they do not estimate new-task generalization.',
    guide: 'https://www.cactuscompute.com/blog/finetuning-needle',
  };
  fs.writeFileSync(path.join(output, 'study-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  return plan;
}

if (require.main === module) {
  const plan = prepareStudy({ source: path.join(__dirname, 'output/stage2/development/accepted.jsonl'), reviews: path.join(__dirname, 'output/stage2/development/labels.json'), validationFile: path.join(__dirname, 'output/needle-official-ladder/validation-scenarios.jsonl'), evaluationFile: path.join(__dirname, 'data/stage2/held-out.jsonl'), output: path.resolve(process.argv[2] || path.join(__dirname, 'output/needle-4bit-repetitions')) });
  console.log(JSON.stringify({ availableTraining: plan.availableTraining, seeds: plan.seeds, selections: Object.fromEntries(Object.entries(plan.selections).map(([size, { count, families, verdicts }]) => [size, { count, families, verdicts }])), tasks: plan.runs.length }, null, 2));
}

module.exports = { prepareStudy };
