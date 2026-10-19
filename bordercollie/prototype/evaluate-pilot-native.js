'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { NEEDLE_MANIFEST, platformKey } = require('../lib/judge-artifacts');
const { verdictFrom } = require('./historical-v2/judge');

const execute = promisify(execFile);
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readRows = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

function save(file, value) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}

async function evaluate({ directory, label, weights, weightsSha256, runner, runnerSha256 = NEEDLE_MANIFEST.runners[platformKey()]?.sha256, run = execute, sourceRecord = null }) {
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a filename-safe model label');
  if (!weightsSha256 || digest(weights) !== weightsSha256) throw new Error('Model weights changed');
  if (!runnerSha256 || digest(runner) !== runnerSha256) throw new Error('Native runner changed');
  const planFile = path.join(directory, 'study-plan.json');
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  for (const [name, expected] of Object.entries(plan.hashes)) {
    if (digest(path.join(directory, name)) !== expected) throw new Error('Frozen evaluation input changed: ' + name);
  }
  const output = path.join(directory, 'native-evaluations');
  fs.mkdirSync(output, { recursive: true });
  const file = path.join(output, label + '.json');
  if (fs.existsSync(file)) throw new Error('Evaluation already exists; preserve it and choose a new label');
  const tools = path.join(output, label + '-tools.json');
  const evidence = { label, status: 'running', platform: platformKey(), studyPlanSha256: digest(planFile), scriptSha256: digest(__filename), weightsSha256, runnerSha256, sourceRecord, runtime: { maxTokens: 128, threads: 4, caseTimeoutSeconds: 15, semantics: 'Exact frozen query/tools, one-shot native CLI, exactly one recognized function or suppressed call, unchanged production deadline.' }, rows: [] };
  save(file, evidence);
  try {
    for (const split of plan.evaluationSplits) {
      for (const example of readRows(path.join(directory, split + '-requests.jsonl'))) {
        fs.writeFileSync(tools, JSON.stringify(example.tools));
        const args = ['--model', weights, '--tools', tools, '--prompt', example.query, '--max', '128', '--threads', '4', '--fail-input-overflow'];
        const started = performance.now();
        let response = null;
        let infrastructureError = null;
        try {
          const result = await run(runner, args, { timeout: 15000, maxBuffer: 2 * 1024 * 1024, env: { PATH: process.env.PATH, NEEDLE_TELEMETRY: '0', DO_NOT_TRACK: '1', HF_HUB_OFFLINE: '1' } });
          response = JSON.parse(result.stdout);
          if (response.success === false) throw new Error(response.error || 'Native inference failed');
        } catch (error) {
          infrastructureError = String(error.message || error);
        }
        const observed = infrastructureError ? null : verdictFrom(response);
        evidence.rows.push({ ...Object.fromEntries(['id', 'family', 'topic', 'tool', 'category', 'preference', 'expected', 'inputHash', 'actionHash', 'queryHash'].map((key) => [key, example[key]])), split, observed, latencySeconds: (performance.now() - started) / 1000, infrastructureError, response });
        if (evidence.rows.length % 50 === 0 || infrastructureError) {
          save(file, evidence);
          console.log(`${label}: ${evidence.rows.length} cases, failure=${infrastructureError}`);
        }
        if (infrastructureError) throw new Error('Infrastructure failure invalidates this evaluation');
      }
    }
    evidence.status = 'complete';
  } catch (error) {
    evidence.status = 'failed';
    evidence.error = String(error.message || error);
    throw error;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    save(file, evidence);
    fs.rmSync(tools, { force: true });
  }
  console.log(JSON.stringify({ label, status: evidence.status, cases: evidence.rows.length }));
  return evidence;
}

if (require.main === module) {
  const [directory, label, weights, weightsSha256, runner] = process.argv.slice(2);
  if (!directory || !label || !weights || !weightsSha256 || !runner) {
    console.error('Usage: node evaluate-pilot-native.js <study-directory> <label> <weights> <weights-sha256> <native-runner>');
    process.exitCode = 1;
  } else {
    evaluate({ directory: path.resolve(directory), label, weights: path.resolve(weights), weightsSha256, runner: path.resolve(runner) }).catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}

module.exports = { evaluate };
