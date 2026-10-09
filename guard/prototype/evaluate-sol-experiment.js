'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { diagnoseBase } = require('./base-diagnostic');
const { createNeedleJudge } = require('../lib/judge');
const { NEEDLE_MANIFEST, verifyInstalledJudge, platformKey } = require('../lib/judge-artifacts');

function csv(file, rows) {
  const fields = [...new Set(rows.flatMap(Object.keys))];
  const quote = (value) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  fs.writeFileSync(file, [fields.map(quote).join(','), ...rows.map((row) => fields.map((field) => quote(row[field])).join(','))].join('\n') + '\n');
}

async function evaluate(directory, label, weights = null) {
  const experiment = JSON.parse(fs.readFileSync(path.join(directory, 'experiment.json'), 'utf8'));
  const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  let manifest = NEEDLE_MANIFEST;
  let root;
  if (weights) {
    const base = verifyInstalledJudge(NEEDLE_MANIFEST);
    if (!base.ready) throw new Error(base.reason);
    const digest = hash(weights);
    manifest = { ...NEEDLE_MANIFEST, revision: digest, weights: { path: path.basename(weights), sha256: digest, size: fs.statSync(weights).size } };
    root = process.env.BORDER_COLLIE_EVALUATION_CACHE || path.join(directory, 'evaluation-cache');
    const target = path.join(root, digest);
    fs.mkdirSync(target, { recursive: true });
    for (const [file, source] of [[path.basename(weights), path.resolve(weights)], [path.basename(manifest.runners[platformKey()].path), base.runner]]) {
      if (!fs.existsSync(path.join(target, file))) fs.symlinkSync(source, path.join(target, file));
    }
  }
  const threads = process.env.BORDER_COLLIE_EVALUATION_THREADS ? Number(process.env.BORDER_COLLIE_EVALUATION_THREADS) : undefined;
  const judge = createNeedleJudge({ manifest, ...(root ? { root } : {}), ...(threads !== undefined ? { threads } : {}) });
  const summaries = [];
  const decisions = [];
  try {
    for (const [split, file] of [['validation', 'validation-scenarios.jsonl'], ['heldOut', 'held-out-scenarios.jsonl']]) {
      const source = path.join(directory, file);
      if (hash(source) !== experiment.hashes[file]) throw new Error('Evaluation set hash mismatch');
      const scenarios = fs.readFileSync(source, 'utf8').trim().split('\n').map(JSON.parse);
      const times = [];
      const timedJudge = async (input) => {
        const start = performance.now();
        const result = await judge(input);
        times.push(performance.now() - start);
        return result;
      };
      const report = await diagnoseBase(scenarios, { judge: timedJudge, manifest, evaluation: split === 'heldOut', progress: (message) => console.log(`${label} ${split}: ${message}`) });
      report.purpose = `${label} Judge on the frozen ${split} set for the Sol seed-${experiment.seed} experiment.`;
      report.seed = experiment.seed;
      report.evaluationSetSha256 = experiment.hashes[file];
      report.platform = platformKey();
      report.workerThreads = threads ?? 'native default';
      report.rows.forEach((row, index) => { row.latencyMs = times[index]; });
      fs.writeFileSync(path.join(directory, `${label}-${split}.json`), JSON.stringify(report, null, 2) + '\n');
      const summary = (group, name, metrics) => ({
        model: label, split, group, name, seed: experiment.seed, train_samples: weights ? experiment.distributions.train.count : 0,
        total: metrics.total, correct: metrics.correct, accuracy: metrics.total ? metrics.correct / metrics.total : null,
        harmful_allowed_count: metrics.harmfulAllowed.count, harmful_total: metrics.harmfulAllowed.total, harmful_allowed_rate: metrics.harmfulAllowed.rate,
        ordinary_refused_count: metrics.ordinaryRefused.count, ordinary_total: metrics.ordinaryRefused.total, ordinary_refused_rate: metrics.ordinaryRefused.rate,
        ask_precision: metrics.askPrecision.rate, ask_recall: metrics.askRecall.rate, no_verdict: metrics.noVerdict,
        infrastructure_errors: metrics.infrastructureErrors, weights_sha256: manifest.weights.sha256, evaluation_set_sha256: experiment.hashes[file],
      });
      summaries.push(summary('overall', 'all', report.metrics));
      for (const [group, results] of [['category', report.byCategory], ['preference', report.byPreference]]) {
        for (const [name, metrics] of Object.entries(results)) summaries.push(summary(group, name, metrics));
      }
      decisions.push(...report.rows.map((row) => ({ model: label, split, id: row.id, family: row.family, category: row.category, preference: row.preferenceId, expected: row.expected, observed: row.observed, correct: row.expected === row.observed, latency_ms: row.latencyMs, error: row.error, infrastructure_error: row.infrastructureError, input_hash: row.inputHash })));
      if (report.status !== 'complete') throw new Error(`Incomplete ${split} evaluation; inspect saved report`);
    }
  } finally {
    judge.dispose();
    csv(path.join(directory, `${label}-summary.csv`), summaries);
    csv(path.join(directory, `${label}-decisions.csv`), decisions);
  }
  console.log(JSON.stringify(summaries.filter((row) => row.group === 'overall'), null, 2));
}

if (require.main === module) {
  const directory = path.resolve(process.argv[2] || path.join(__dirname, 'output/sol-300-seed42'));
  const label = process.argv[3] || 'base';
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a simple filename-safe evaluation label');
  evaluate(directory, label, process.argv[4] ? path.resolve(process.argv[4]) : null).catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { evaluate };
