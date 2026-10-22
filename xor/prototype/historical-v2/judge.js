'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { defaultJudgeRoot, judgeManifest, verifyInstalledJudge } = require('../../lib/judge-artifacts');

const JUDGE_REQUEST_VERSION = '2';
const VERDICT_BY_TOOL = Object.freeze({ allow_call: 'allow', block_call: 'disallow', ask_owner: 'ask' });
const NO_ARGUMENTS = Object.freeze({ type: 'object', properties: {}, required: [] });
const JUDGE_TIMEOUT_MS = 15000;

function clip(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

function judgeTools(preference) {
  const tools = [
    {
      name: 'allow_call',
      description: `Run the coding agent's action. Folder purpose: ${preference.purpose} Allowed: ${preference.allow}`,
      parameters: NO_ARGUMENTS,
    },
    {
      name: 'block_call',
      description: `Block the coding agent's action. Disallowed: ${preference.disallow}`,
      parameters: NO_ARGUMENTS,
    },
  ];
  if (preference.ask.trim()) {
    tools.push({
      name: 'ask_owner',
      description: `Ask the owner before the coding agent's action. Ask about: ${preference.ask}`,
      parameters: NO_ARGUMENTS,
    });
  }
  return tools;
}

function effects(call) {
  const parts = [];
  if (call.readPaths.length) parts.push(`reads ${call.readPaths.join(', ')}`);
  if (call.writePaths.length) parts.push(`writes ${call.writePaths.join(', ')}`);
  if (call.urls.length) parts.push(`network ${call.urls.join(', ')}`);
  if (call.deletePaths?.length) parts.push(`deletes ${call.deletePaths.join(', ')}`);
  if (call.environmentDisclosure) parts.push('environment disclosure');
  if (call.sharedMachineActions?.length) parts.push(...call.sharedMachineActions);
  return parts.length ? parts.join('; ') : 'no statically identified effects; inspect the complete action';
}

function judgePrompt({ userMessage, call }) {
  const action = `${call.tool} ${JSON.stringify(call.args)}`;
  return `User request: ${userMessage || '(none)'}. Agent action: ${action}. Effects: ${effects(call)}.`;
}

function judgeRequest({ userMessage, preference, call }) {
  return {
    version: JUDGE_REQUEST_VERSION,
    query: judgePrompt({ userMessage, call }),
    tools: judgeTools(preference),
  };
}

function verdictFrom(response) {
  if (!response || response.success === false) return null;
  if (response.function_calls !== undefined && !Array.isArray(response.function_calls)) return null;
  if (response.suppressed_calls !== undefined && !Array.isArray(response.suppressed_calls)) return null;
  const calls = [...(response.function_calls || []), ...(response.suppressed_calls || [])];
  if (calls.length !== 1 || !Object.hasOwn(VERDICT_BY_TOOL, calls[0]?.name)) return null;
  return VERDICT_BY_TOOL[calls[0].name];
}

function runnerEnvironment() {
  const env = { NEEDLE_TELEMETRY: '0', DO_NOT_TRACK: '1', HF_HUB_OFFLINE: '1' };
  for (const key of ['SystemRoot', 'TEMP', 'TMP', 'PATH']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function runNeedle(runner, args) {
  return new Promise((resolve) => {
    const child = spawn(runner, args, { env: runnerEnvironment(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), JUDGE_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ error: error.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (signal) return resolve({ error: `the Judge was stopped by ${signal}` });
      if (code !== 0) return resolve({ error: clip(stderr || `the Judge exited with ${code}`, 200) });
      try {
        resolve({ response: JSON.parse(stdout) });
      } catch {
        resolve({ error: clip(stderr || `the Judge exited with ${code} and no verdict`, 200) });
      }
    });
  });
}

function createNeedleJudge(opts = {}) {
  const manifest = opts.manifest || judgeManifest();
  const root = opts.root || defaultJudgeRoot();
  let installed = null;
  let toolDir = null;
  let queue = Promise.resolve();

  function ensureInstalled() {
    if (installed?.ready) return installed;
    try {
      installed = verifyInstalledJudge(manifest, root);
    } catch (error) {
      installed = { ready: false, reason: error.message.replace(/\.$/, '') };
    }
    return installed;
  }

  function toolsFile(tools) {
    const contents = JSON.stringify(tools);
    toolDir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-judge-'));
    const file = path.join(toolDir, crypto.createHash('sha256').update(contents).digest('hex') + '.json');
    if (!fs.existsSync(file)) fs.writeFileSync(file, contents);
    return file;
  }

  async function decide(input) {
    const ready = ensureInstalled();
    if (!ready.ready) return { verdict: null, unavailable: true, reason: `${ready.reason}. Run bordercollie install` };
    const request = judgeRequest(input);
    const args = [
      '--model', ready.weights,
      '--tools', toolsFile(request.tools),
      '--prompt', request.query,
      '--max', '128',
      '--fail-input-overflow',
    ];
    if (opts.threads !== undefined) {
      if (!Number.isInteger(opts.threads) || opts.threads < 1) throw new Error('Judge thread count must be a positive integer');
      args.push('--threads', String(opts.threads));
    }
    const result = await runNeedle(ready.runner, args);
    if (result.error) return { verdict: null, reason: result.error };
    return {
      verdict: verdictFrom(result.response),
      confidence: result.response.confidence ?? null,
      reason: result.response.error || null,
    };
  }

  function judge(input) {
    const next = queue.then(() => decide(input));
    queue = next.catch(() => {});
    return next;
  }

  judge.dispose = () => {
    if (toolDir) fs.rmSync(toolDir, { recursive: true, force: true });
    toolDir = null;
  };
  return judge;
}

module.exports = { createNeedleJudge, judgeRequest, verdictFrom, JUDGE_REQUEST_VERSION };
