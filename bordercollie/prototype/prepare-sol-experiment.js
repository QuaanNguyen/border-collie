'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runtimeRequest, trainingLines, provenance, REQUEST_FORMAT_VERSION } = require('./finetune-pipeline');
const { NEEDLE_MANIFEST } = require('../lib/judge-artifacts');

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function selectFamilies(rows, count, seed) {
  const families = new Map();
  for (const row of rows) {
    const family = families.get(row.family) || [];
    family.push(row);
    families.set(row.family, family);
  }
  const ordered = [...families].sort(([a], [b]) => digest(`${seed}:${a}`).localeCompare(digest(`${seed}:${b}`)));
  const selections = new Map([[0, []]]);
  for (const [family, group] of ordered) {
    for (const [size, selected] of [...selections].sort(([a], [b]) => b - a)) {
      const next = size + group.length;
      if (next <= count && !selections.has(next)) selections.set(next, [...selected, family]);
    }
    if (selections.has(count)) break;
  }
  if (!selections.has(count)) throw new Error(`Cannot select exactly ${count} samples without splitting families`);
  const selected = new Set(selections.get(count));
  return rows.filter((row) => selected.has(row.family)).sort((a, b) => a.id.localeCompare(b.id));
}

function prepare({ source, reviews, evaluation, output, seed = 42, trainCount = 300, validationCount = 100 }) {
  if (fs.existsSync(path.join(output, 'experiment.json'))) throw new Error('Experiment already frozen; use its existing files or choose a new output directory');
  const sourceText = fs.readFileSync(source, 'utf8');
  const evaluationText = fs.readFileSync(evaluation, 'utf8');
  const read = (text) => text.trim().split('\n').filter(Boolean).map(JSON.parse);
  const reviewText = reviews ? fs.readFileSync(reviews, 'utf8') : null;
  const savedReviews = reviewText ? JSON.parse(reviewText).reviews : {};
  const development = read(sourceText).map((row) => ({ ...row, independentReview: row.independentReview || savedReviews[row.id] }));
  const heldOut = read(evaluationText);
  const train = selectFamilies(development.filter((row) => row.split === 'train'), trainCount, seed);
  const validation = selectFamilies(development.filter((row) => row.split === 'validation'), validationCount, seed);
  const selected = [...train, ...validation];
  const evaluationFamilies = new Set(heldOut.map((row) => row.family));
  const evaluationInputs = new Set(heldOut.map((row) => digest(JSON.stringify(runtimeRequest(row)))));
  const trainFamilies = new Set(train.map((row) => row.family));
  const inputs = new Set();
  for (const row of selected) {
    const request = runtimeRequest(row);
    const visibleHash = digest(JSON.stringify({ query: request.query, tools: request.tools }));
    if (row.independentReview?.verdict !== row.verdict || row.independentReview.inputHash !== visibleHash) throw new Error(`Review mismatch for ${row.id}`);
    const inputHash = digest(JSON.stringify(request));
    if (inputs.has(inputHash) || evaluationInputs.has(inputHash) || evaluationFamilies.has(row.family)) throw new Error(`Duplicate or evaluation overlap for ${row.id}`);
    if (row.split === 'validation' && trainFamilies.has(row.family)) throw new Error(`Family crosses training and validation: ${row.family}`);
    inputs.add(inputHash);
  }
  const distribution = (rows, field) => Object.fromEntries([...new Set(rows.map((row) => row[field]))].sort().map((value) => [value, rows.filter((row) => row[field] === value).length]));
  for (const rows of [train, validation]) {
    if (Object.keys(distribution(rows, 'category')).length !== 9 || Object.keys(distribution(rows, 'verdict')).length !== 3) throw new Error('Selection is missing a category or Verdict');
  }
  fs.mkdirSync(output, { recursive: true });
  const hashes = {};
  const saveRows = (file, rows) => {
    const text = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
    fs.writeFileSync(path.join(output, file), text);
    hashes[file] = digest(text);
  };
  saveRows('train-scenarios.jsonl', train);
  saveRows('validation-scenarios.jsonl', validation);
  saveRows('held-out-scenarios.jsonl', heldOut);
  const lines = trainingLines(selected);
  saveRows('train.jsonl', lines.train);
  saveRows('validation.jsonl', lines.validation);
  const experiment = {
    status: 'prepared', seed, createdAt: new Date().toISOString(),
    purpose: '300-sample Sol interactive pilot with a frozen, separate 100-sample development validation set.',
    comparison: 'Reuse this validation set, held-out set, seed, base checkpoint, request format, training settings, and runner for the full-data run. Compare both epoch and optimizer-step axes.',
    validationSource: 'Existing development validation split; the 300 frozen held-out evaluation samples remain separate from training and model selection.',
    source: { path: source, sha256: digest(sourceText), available: development.length, reviews, reviewsSha256: reviewText ? digest(reviewText) : null },
    evaluationSource: { path: evaluation, sha256: digest(evaluationText) },
    requestFormatVersion: REQUEST_FORMAT_VERSION,
    provenance: provenance([...selected, ...heldOut]), hashes,
    selection: { method: 'Seeded SHA-256 family ordering with exact-count subset selection; preserves existing splits and includes every available member of a selected family.', trainIds: train.map((row) => row.id), validationIds: validation.map((row) => row.id) },
    distributions: Object.fromEntries([['train', train], ['validation', validation], ['heldOut', heldOut]].map(([split, rows]) => [split, { count: rows.length, families: new Set(rows.map((row) => row.family)).size, verdict: distribution(rows, 'verdict'), category: distribution(rows, 'category'), preference: distribution(rows, 'preferenceId') }])),
    training: { epochs: 10, batchSize: 16, learningRate: 0.0001, loraRank: 16, loraAlpha: 32, maxLength: 1024, validationSplit: 0, weightDecay: 0.0001, gradientClipNorm: 1, exportLayers: 20, checkpoint: '/scratch/qnguye19/needle/checkpoints/needle3.safetensors', checkpointSelection: 'Lowest separate validation loss across epochs 1 through 10' },
    sol: { host: 'sol', account: 'grp_dmunnerl', partition: 'public', gpu: 'a100:1', memory: '32G', cpus: 4, time: '02:00:00', mode: 'interactive srun --pty' },
    baseArtifact: NEEDLE_MANIFEST,
  };
  fs.writeFileSync(path.join(output, 'experiment.json'), JSON.stringify(experiment, null, 2) + '\n');
  return experiment;
}

if (require.main === module) {
  const output = path.resolve(process.argv[2] || path.join(__dirname, 'output/sol-300-seed42'));
  const result = prepare({ source: path.join(__dirname, 'output/stage2/development/accepted.jsonl'), reviews: path.join(__dirname, 'output/stage2/development/labels.json'), evaluation: path.join(__dirname, 'data/stage2/held-out.jsonl'), output });
  console.log(JSON.stringify({ output, seed: result.seed, distributions: result.distributions, hashes: result.hashes }, null, 2));
}

module.exports = { selectFamilies, prepare };
