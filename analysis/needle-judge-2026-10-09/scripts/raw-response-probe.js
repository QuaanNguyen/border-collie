'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { runtimeRequest } = require('../snapshot/guard/prototype/finetune-pipeline');
const { requestFor } = require('./request-v4');
const { judgeManifest } = require('../snapshot/guard/lib/judge-artifacts');

const workspace = path.resolve(__dirname, '..');
const repository = path.resolve(workspace, '../..');
const artifactDirectory = path.join(workspace, 'artifacts');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fileHash = (file) => hash(fs.readFileSync(file));
const readRows = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);

function copyModel(label) {
  const history = JSON.parse(fs.readFileSync(path.join(workspace, 'snapshot/guard/prototype/output/needle-official-ladder/mac-runtime', label, label + '-heldOut.json'), 'utf8'));
  const expected = history.artifact.weightsSha256;
  const source = path.join(repository, 'guard/prototype/output/needle-official-ladder/sol-batch-results', label, 'candidate.cact');
  if (fileHash(source) !== expected) throw new Error('Archived model differs from its saved evaluation fingerprint');
  const directory = path.join(artifactDirectory, 'local-probe-models', expected);
  fs.mkdirSync(directory, { recursive: true });
  const weights = path.join(directory, 'candidate.cact');
  if (!fs.existsSync(weights)) fs.copyFileSync(source, weights, fs.constants.COPYFILE_EXCL);
  if (fileHash(weights) !== expected) throw new Error('Copied model fingerprint differs');
  fs.chmodSync(weights, 0o444);
  const manifest = judgeManifest();
  const runner = path.join(artifactDirectory, 'local-probe-models', 'd73eb0c4e90831d18266f30e2d50b72291e270a303d70f9acbad9974acfdd5ec', 'needle');
  const runnerHash = manifest.runners['darwin-arm64'].sha256;
  if (fileHash(runner) !== runnerHash || history.artifact.runnerSha256 !== runnerHash) throw new Error('Copied runner fingerprint differs');
  return { label, weights, weightsSha256: expected, runner, runnerSha256: runnerHash };
}

function run(model, input, toolsFile, maximumTokens) {
  const environment = { NEEDLE_TELEMETRY: '0', DO_NOT_TRACK: '1', HF_HUB_OFFLINE: '1' };
  for (const key of ['SystemRoot', 'TEMP', 'TMP', 'PATH']) if (process.env[key]) environment[key] = process.env[key];
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(model.runner, ['--model', model.weights, '--tools', toolsFile, '--prompt', input.query, '--max', String(maximumTokens), '--fail-input-overflow', '--threads', '1'], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let launchError = null;
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', (error) => { launchError = error.message; });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout);
      let response = null;
      try { response = JSON.parse(stdout); } catch {}
      resolve({ maximumTokens, elapsedMilliseconds: Date.now() - started, exitCode, signal, launchError, response, stdout, stderr });
    });
  });
}

async function probe() {
  const historical = readRows(path.join(workspace, 'snapshot/guard/prototype/output/needle-official-ladder/train-1000-scenarios.jsonl'));
  const candidate = readRows(path.join(artifactDirectory, 'priority-candidate-scenarios.jsonl'));
  const selectedIds = ['security-v2:ordinary-source-read:specific-request', 'security-v2:dotenv-shell:specific-permission', 'security-v2:dotenv-shell:exact-read-confirmed'];
  const cases = ['allow', 'disallow', 'ask'].map((verdict) => {
    const row = historical.find((item) => item.verdict === verdict);
    if (!row) throw new Error('Historical label is missing');
    const { query, tools } = runtimeRequest(row);
    return { id: row.id, requestVersion: '1', input: { query, tools } };
  });
  for (const id of selectedIds) {
    const row = candidate.find((item) => item.id === id);
    if (!row) throw new Error('Candidate control is missing');
    const { query, tools, version } = requestFor(row);
    cases.push({ id, requestVersion: version, input: { query, tools } });
  }
  const models = ['raw-300-seed42', 'reasoning-1000-seed0'].map(copyModel);
  const directory = path.join(artifactDirectory, 'raw-response-probe');
  fs.mkdirSync(directory, { recursive: true });
  const record = { schemaVersion: 1, status: 'incomplete', purpose: 'Local inference only on copied historical exports; proposed tool calls are never dispatched.', originalFilesWritten: false, trainingPerformed: false, solJobsSubmitted: 0, cases, models, outputCaps: [128, 512], timeoutMilliseconds: 15000, internalTokenEquivalenceEstablished: false, observations: [] };
  const destination = path.join(artifactDirectory, 'raw-response-probe.json');
  if (fs.existsSync(destination)) throw new Error('Existing raw-response evidence must not be overwritten');
  const checkpoint = () => {
    fs.writeFileSync(destination + '.tmp', JSON.stringify(record, null, 2) + '\n');
    fs.renameSync(destination + '.tmp', destination);
  };
  checkpoint();
  for (const model of models) for (const item of cases) {
    const toolsFile = path.join(directory, hash(JSON.stringify(item.input.tools)) + '-tools.json');
    if (!fs.existsSync(toolsFile)) fs.writeFileSync(toolsFile, JSON.stringify(item.input.tools));
    for (const maximumTokens of record.outputCaps) {
      record.observations.push({ model: model.label, id: item.id, requestVersion: item.requestVersion, inputHash: hash(JSON.stringify(item.input)), ...await run(model, item.input, toolsFile, maximumTokens) });
      checkpoint();
      console.log(JSON.stringify({ model: model.label, completed: record.observations.length, expected: models.length * cases.length * record.outputCaps.length }));
    }
  }
  record.status = 'complete';
  record.completedAt = new Date().toISOString();
  checkpoint();
  console.log(JSON.stringify({ status: record.status, observations: record.observations.length, outputCaps: record.outputCaps, newTrainingPerformed: false, proposedActionsExecuted: 0 }));
}

if (require.main === module) probe().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { probe };
