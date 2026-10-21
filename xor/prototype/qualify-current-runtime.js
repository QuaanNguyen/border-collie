'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runtimeRequest } = require('./finetune-pipeline');
const { evaluate } = require('./evaluate-pilot-native');
const { NEEDLE_MANIFEST } = require('../lib/judge-artifacts');

const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function qualify(source, directory, label, weights, runner) {
  if (!fs.existsSync(directory)) {
    const scenarios = fs.readFileSync(path.join(source, 'scenarios.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const rows = [];
    for (const topic of new Set(scenarios.filter((row) => row.dataset === 'repair-additions').map((row) => row.topic))) {
      for (const verdict of ['allow', 'disallow', 'ask']) {
        const match = scenarios.filter((row) => row.topic === topic && row.referenceVerdict === verdict).sort((a, b) => runtimeRequest(b).query.length - runtimeRequest(a).query.length)[0];
        rows.push(match);
      }
    }
    rows.push(...scenarios.filter((row) => row.dataset !== 'repair-additions').sort((a, b) => runtimeRequest(b).query.length - runtimeRequest(a).query.length).slice(0, 12));
    fs.mkdirSync(directory, { recursive: true });
    const requests = rows.map((row) => ({ id: row.id, family: row.family, topic: row.topic, tool: row.tool, expected: null, inputHash: row.inputHash, ...runtimeRequest(row) }));
    const file = path.join(directory, 'qualification-requests.jsonl');
    fs.writeFileSync(file, requests.map(JSON.stringify).join('\n') + '\n');
    fs.writeFileSync(path.join(directory, 'study-plan.json'), JSON.stringify({ status: 'local-input-qualification-only', sourceScenariosSha256: hash(path.join(source, 'scenarios.jsonl')), sourceRequestsSha256: hash(path.join(source, 'requests.jsonl')), hashes: { 'qualification-requests.jsonl': hash(file) }, evaluationSplits: ['qualification'], selection: 'Longest complete query per new topic and authored contrast plus twelve longest copied inputs; expected decisions deliberately unset until review.', solJobsSubmitted: 0 }, null, 2) + '\n');
  }
  const plan = JSON.parse(fs.readFileSync(path.join(directory, 'study-plan.json')));
  if (plan.sourceRequestsSha256 !== hash(path.join(source, 'requests.jsonl')) || plan.sourceScenariosSha256 !== hash(path.join(source, 'scenarios.jsonl'))) throw new Error('Qualification source changed');
  const evidence = await evaluate({ directory, label, weights, weightsSha256: hash(weights), runner, runnerSha256: NEEDLE_MANIFEST.runners['darwin-arm64'].sha256 });
  const latencies = evidence.rows.map((row) => row.latencySeconds).sort((a, b) => a - b);
  const summary = { label, rows: evidence.rows.length, weightsBytes: fs.statSync(weights).size, weightsSha256: hash(weights), runnerSha256: hash(runner), medianSeconds: latencies[Math.floor(latencies.length * 0.5)], p95Seconds: latencies[Math.ceil(latencies.length * 0.95) - 1], maximumSeconds: latencies.at(-1), maximumReportedRamMb: Math.max(...evidence.rows.map((row) => row.response?.peak_ram_mb || 0)), missingVerdicts: evidence.rows.filter((row) => !row.observed).length, infrastructureErrors: evidence.rows.filter((row) => row.infrastructureError).length, reasoningOutputs: evidence.rows.filter((row) => Boolean(row.response?.reasoning?.trim())).length, correctnessClaimed: false, solJobsSubmitted: 0 };
  fs.writeFileSync(path.join(directory, `${label}-summary.json`), JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(JSON.stringify(summary) + '\n');
  return summary;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 5) throw new Error('Usage: qualify-current-runtime.js <source> <evidence-directory> <label> <weights> <runner>');
  qualify(...args.map((arg, index) => index === 2 ? arg : path.resolve(arg))).catch((error) => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}

module.exports = { qualify };
