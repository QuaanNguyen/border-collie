'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { verdictFrom, JUDGE_REQUEST_VERSION } = require('../lib/judge');
const { digest } = require('./checker-data');

function directVerdict(response) {
  const verdict = verdictFrom(response);
  if (!verdict || response.reasoning !== undefined && response.reasoning !== null && (typeof response.reasoning !== 'string' || response.reasoning.trim())) return null;
  return { allow: 'approve', disallow: 'deny', ask: 'ask' }[verdict];
}

function evaluate({ requestsFile, runner, weights, output, expectedRunnerSha256, expectedWeightsSha256, threads = 4 }) {
  if (`${process.platform}-${process.arch}` !== 'darwin-arm64') throw new Error('Promotion measurements must run on the Mac');
  if (fs.existsSync(output)) throw new Error('Preserve completed evidence; choose a new output');
  const runnerBytes = fs.readFileSync(runner);
  const weightBytes = fs.readFileSync(weights);
  const hashBytes = (bytes) => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  if (hashBytes(runnerBytes) !== expectedRunnerSha256 || hashBytes(weightBytes) !== expectedWeightsSha256) throw new Error('Runner or model digest differs from the registered artifact');
  const contents = fs.readFileSync(requestsFile, 'utf8');
  const requests = contents.trim().split('\n').map(JSON.parse);
  if (!requests.length || requests.some((row) => row.version !== JUDGE_REQUEST_VERSION || row.inputHash !== digest({ version: row.version, query: row.query, tools: row.tools }))) throw new Error('Evaluation requests changed or use a retired format');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'checker-native-'));
  const settings = { threads, maxTokens: 128, timeoutMs: 15000, repetitions: 3, warmupPasses: 1 };
  const evidence = { status: 'running', platform: 'darwin-arm64', machineId: digest({ hostname: os.hostname(), cpus: os.cpus().map((cpu) => cpu.model) }), requestFormatVersion: JUDGE_REQUEST_VERSION, evaluationSha256: hashBytes(Buffer.from(contents)), runnerSha256: expectedRunnerSha256, modelSha256: expectedWeightsSha256, scriptSha256: hashBytes(fs.readFileSync(__filename)), deploymentBytes: weightBytes.length + runnerBytes.length, settings, rows: [] };
  const env = { PATH: process.env.PATH, NEEDLE_TELEMETRY: '0', DO_NOT_TRACK: '1', HF_HUB_OFFLINE: '1' };
  const save = () => fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  try {
    for (const request of requests) {
      const toolsFile = path.join(temp, digest(request.tools) + '.json');
      fs.writeFileSync(toolsFile, JSON.stringify(request.tools));
      const args = ['--model', weights, '--tools', toolsFile, '--prompt', request.query, '--max', '128', '--threads', String(threads), '--fail-input-overflow'];
      const row = { id: request.id, family: request.family, agent: request.agent, tool: request.tool, inputHash: request.inputHash, expected: request.expected, observed: null, directVerdict: true, latenciesMs: [], infrastructureError: null, responses: [] };
      for (let repetition = 0; repetition <= settings.repetitions; repetition++) {
        const start = performance.now();
        const result = spawnSync(runner, args, { env, encoding: 'utf8', timeout: settings.timeoutMs, maxBuffer: 1024 * 1024 });
        const elapsed = performance.now() - start;
        if (result.error || result.status !== 0) {
          row.infrastructureError = result.error?.message || `Runner exited with ${result.status}`;
          row.directVerdict = false;
          break;
        }
        let response;
        try { response = JSON.parse(result.stdout); } catch { row.infrastructureError = 'Malformed runner response'; row.directVerdict = false; break; }
        if (repetition === 0) continue;
        const observed = directVerdict(response);
        if (!observed || row.observed && row.observed !== observed) row.directVerdict = false;
        row.observed = observed;
        row.latenciesMs.push(elapsed);
        row.responses.push(response);
      }
      evidence.rows.push(row);
      save();
    }
    evidence.status = evidence.rows.some((row) => row.infrastructureError) ? 'infrastructure-failure' : 'complete';
    evidence.breakdowns = Object.fromEntries([...new Set(evidence.rows.map((row) => `${row.agent}:${row.tool}`))].map((key) => {
      const rows = evidence.rows.filter((row) => `${row.agent}:${row.tool}` === key);
      return [key, { cases: rows.length, correct: rows.filter((row) => row.observed === row.expected && row.directVerdict).length, missingOrIndirect: rows.filter((row) => !row.directVerdict || !row.observed).length }];
    }));
    return evidence;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    save();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const [requestsFile, runner, weights, output, expectedRunnerSha256, expectedWeightsSha256] = process.argv.slice(2);
  if (!expectedWeightsSha256) throw new Error('Usage: evaluate-checker-native.js <requests.jsonl> <runner> <weights> <new-output.json> <runner-sha256> <weights-sha256>');
  const result = evaluate({ requestsFile, runner, weights, output, expectedRunnerSha256, expectedWeightsSha256 });
  console.log(JSON.stringify({ status: result.status, cases: result.rows.length, direct: result.rows.filter((row) => row.directVerdict).length }));
}

module.exports = { directVerdict, evaluate };
