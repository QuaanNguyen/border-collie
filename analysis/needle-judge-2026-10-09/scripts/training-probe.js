'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { diagnoseBase } = require('../snapshot/guard/prototype/base-diagnostic');
const { createNeedleJudge } = require('../snapshot/guard/lib/judge');
const { judgeManifest, verifyInstalledJudge, platformKey } = require('../snapshot/guard/lib/judge-artifacts');

const workspace = path.resolve(__dirname, '..');
const repository = path.resolve(workspace, '../..');
const fingerprint = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function evaluate(seed) {
  if (![0, 42].includes(seed)) throw new Error('This probe measures only the two saved historical 1000-example models');
  const label = 'reasoning-1000-seed' + seed;
  const source = path.join(workspace, 'snapshot/guard/prototype/output/needle-official-ladder/train-1000-scenarios.jsonl');
  const scenarios = fs.readFileSync(source, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const history = JSON.parse(fs.readFileSync(path.join(workspace, 'snapshot/guard/prototype/output/needle-official-ladder/mac-runtime', label, label + '-heldOut.json'), 'utf8'));
  const weightsSource = path.join(repository, 'guard/prototype/output/needle-official-ladder/sol-batch-results', label, 'candidate.cact');
  if (fingerprint(weightsSource) !== history.artifact.weightsSha256) throw new Error('Historical weights do not match their evaluation record');
  const shipped = judgeManifest();
  let installed = verifyInstalledJudge(shipped);
  if (!installed.ready) {
    const protection = JSON.parse(fs.readFileSync(path.join(workspace, 'snapshot-manifest.json'), 'utf8'));
    const candidates = protection.records.filter((record) => record.kind === 'symlink' && path.basename(record.path) === 'needle').map((record) => path.resolve(repository, path.dirname(record.path), record.linkTarget));
    for (const candidate of new Set(candidates)) {
      const alternative = verifyInstalledJudge(shipped, path.dirname(path.dirname(candidate)));
      if (alternative.ready) { installed = alternative; break; }
    }
  }
  if (!installed.ready) throw new Error(installed.reason);
  const modelRoot = path.join(workspace, 'artifacts/local-probe-models');
  const revision = history.artifact.weightsSha256;
  const directory = path.join(modelRoot, revision);
  fs.mkdirSync(directory, { recursive: true });
  const runnerName = path.basename(shipped.runners[platformKey()].path);
  const weightsName = 'candidate.cact';
  for (const [name, original, expected, executable] of [[weightsName, weightsSource, revision, false], [runnerName, installed.runner, shipped.runners[platformKey()].sha256, true]]) {
    const target = path.join(directory, name);
    if (!fs.existsSync(target)) fs.copyFileSync(original, target, fs.constants.COPYFILE_EXCL);
    if (fingerprint(target) !== expected) throw new Error('Isolated runtime copy has the wrong hash');
    fs.chmodSync(target, executable ? 0o755 : 0o444);
  }
  const manifest = { ...shipped, revision, weights: { path: weightsName, sha256: revision, size: fs.statSync(path.join(directory, weightsName)).size } };
  const judge = createNeedleJudge({ manifest, root: modelRoot, threads: 1 });
  let report;
  try {
    report = await diagnoseBase(scenarios, { judge, manifest, progress: (message) => console.log(label + ': ' + message) });
  } finally {
    judge.dispose();
  }
  report.purpose = 'Local macOS inference on the complete frozen historical training subset. No training, new weights, remote connection, Sol job, or source changes.';
  report.seed = seed;
  report.trainingSourceSha256 = fingerprint(source);
  report.trainingSamples = scenarios.length;
  report.weightsSha256 = revision;
  report.historicalHeldOutMetrics = history.metrics;
  report.modelRequestVersion = '1';
  const output = path.join(workspace, 'artifacts', label + '-training-probe.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ model: label, status: report.status, trainingSamples: scenarios.length, scored: report.metrics.total, correct: report.metrics.correct, accuracy: report.metrics.correct / report.metrics.total, harmfulAllowed: report.metrics.harmfulAllowed, ordinaryRefused: report.metrics.ordinaryRefused, infrastructureErrors: report.metrics.infrastructureErrors, heldOutAccuracy: history.metrics.correct / history.metrics.total, newTrainingPerformed: false }, null, 2));
  if (report.status !== 'complete') process.exitCode = 1;
}

if (require.main === module) evaluate(Number(process.argv[2] || 0)).catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { evaluate };
