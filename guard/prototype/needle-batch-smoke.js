'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { diagnoseBase } = require('./evaluation-code/guard/prototype/base-diagnostic');
const { createNeedleJudge } = require('./evaluation-code/guard/lib/judge');
const { NEEDLE_MANIFEST, verifyInstalledJudge } = require('./evaluation-code/guard/lib/judge-artifacts');

async function smoke() {
  const directory = path.resolve(process.argv[2]);
  const installed = verifyInstalledJudge();
  if (!installed.ready) throw new Error(installed.reason);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'needle-smoke-'));
  const baseDirectory = path.join(temporary, 'base', NEEDLE_MANIFEST.revision);
  fs.mkdirSync(baseDirectory, { recursive: true });
  fs.copyFileSync(installed.runner, path.join(baseDirectory, 'needle'));
  fs.copyFileSync(installed.weights, path.join(baseDirectory, 'needle3.cact'));
  process.env.BORDER_COLLIE_JUDGE_ROOT = path.join(temporary, 'base');
  const base = verifyInstalledJudge();
  const scenarios = fs.readFileSync(path.join(directory, 'validation-scenarios.jsonl'), 'utf8').trim().split('\n').slice(0, 3).map(JSON.parse);
  const weights = path.join(temporary, 'candidate.cact');
  fs.copyFileSync(path.join(directory, 'base-local-export/candidate.cact'), weights);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(weights)).digest('hex');
  const manifest = { ...NEEDLE_MANIFEST, revision: digest, weights: { path: 'candidate.cact', sha256: digest, size: fs.statSync(weights).size } };
  const root = path.join(temporary, 'cache');
  const target = path.join(root, digest);
  fs.mkdirSync(target, { recursive: true });
  for (const [name, source] of [['candidate.cact', weights], ['needle', base.runner]]) {
    if (!fs.existsSync(path.join(target, name))) fs.symlinkSync(source, path.join(target, name));
  }
  const results = [];
  for (const [label, configuration] of [['shipped-base', {}], ['base-local-export', { manifest, root }]]) {
    const judge = createNeedleJudge({ ...configuration, threads: 4 });
    try {
      const report = await diagnoseBase(scenarios, { judge, manifest: configuration.manifest || NEEDLE_MANIFEST });
      results.push({ label, metrics: report.metrics, rows: report.rows.map(({ id, expected, observed, error }) => ({ id, expected, observed, error })) });
      console.log(JSON.stringify(results.at(-1), null, 2));
      if (report.status !== 'complete' || report.metrics.infrastructureErrors) throw new Error('Native batch evaluation failed');
    } finally {
      judge.dispose();
    }
  }
  fs.writeFileSync(path.join(directory, 'batch-smoke.json'), JSON.stringify({ status: 'complete', purpose: 'Linux evaluation infrastructure check on three validation cases per control, not an accuracy estimate.', jobId: process.env.SLURM_JOB_ID, results }, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
}

smoke().catch((error) => { console.error(error); process.exitCode = 1; });
