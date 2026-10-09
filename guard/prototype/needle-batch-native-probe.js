'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { judgeRequest } = require('./evaluation-code/guard/lib/judge');
const { proposedCall } = require('./evaluation-code/guard/lib/toolcalls');
const { verifyInstalledJudge } = require('./evaluation-code/guard/lib/judge-artifacts');

const directory = path.resolve(process.argv[2]);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'needle-probe-'));
const base = verifyInstalledJudge();
if (!base.ready) throw new Error(base.reason);
for (const [name, source] of [['needle', base.runner], ['needle3.cact', base.weights]]) fs.copyFileSync(source, path.join(temporary, name));
const scenario = JSON.parse(fs.readFileSync(path.join(directory, 'validation-scenarios.jsonl'), 'utf8').trim().split('\n')[0]);
const request = judgeRequest({ userMessage: scenario.userMessage, preference: scenario.preference, call: proposedCall(scenario.tool, scenario.args) });
const tools = path.join(temporary, 'tools.json');
fs.writeFileSync(tools, JSON.stringify(request.tools));
const records = [];
for (const threads of [1, 4]) {
  const started = performance.now();
  const result = spawnSync(path.join(temporary, 'needle'), ['--model', path.join(temporary, 'needle3.cact'), '--tools', tools, '--prompt', request.query, '--max', '128', '--fail-input-overflow', '--threads', String(threads)], { timeout: 60000, encoding: 'utf8', env: { PATH: process.env.PATH, NEEDLE_TELEMETRY: '0', DO_NOT_TRACK: '1', HF_HUB_OFFLINE: '1' } });
  records.push({ threads, elapsedMs: performance.now() - started, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
  console.log(JSON.stringify(records.at(-1), null, 2));
}
fs.writeFileSync(path.join(directory, 'batch-native-probe.json'), JSON.stringify({ id: scenario.id, jobId: process.env.SLURM_JOB_ID, records }, null, 2) + '\n');
