'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { defaultGateRoot, gateManifest, verifyInstalledGate } = require('./gate-artifacts');

const { preferenceText } = require('./preference');

const GATE_REQUEST_VERSION = '3';
const VERDICT_BY_TOOL = Object.freeze({ approve: 'allow', deny: 'disallow', ask: 'ask' });
const NO_ARGUMENTS = Object.freeze({ type: 'object', properties: {}, required: [] });
const GATE_TIMEOUT_MS = 15000;

function clip(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

function gateTools() {
  return [
    { name: 'approve', description: 'Run this proposed action when permitted by the user preference (allowing actions that do not match the denial description).', parameters: NO_ARGUMENTS },
    { name: 'deny', description: 'Withhold this proposed action when it matches the user preference description for denial.', parameters: NO_ARGUMENTS },
    { name: 'ask', description: 'Withhold this proposed action and ask the owner when confirmation is required or permission is unclear.', parameters: NO_ARGUMENTS },
  ];
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

function gatePrompt({ userMessage, call }) {
  const action = `${call.tool} ${JSON.stringify(call.args)}`;
  return `User request: ${userMessage || '(none)'}. Agent action: ${action}. Effects: ${effects(call)}.`;
}

function gateRequest({ userMessage, preference, call }) {
  return {
    version: GATE_REQUEST_VERSION,
    query: `Folder Preference:\n${preferenceText(preference)}\n\n${gatePrompt({ userMessage, call })}`,
    tools: gateTools(preference),
  };
}

function verdictFrom(response) {
  if (!response || response.success === false) return null;
  if (response.function_calls !== undefined && !Array.isArray(response.function_calls)) return null;
  if (response.suppressed_calls !== undefined && !Array.isArray(response.suppressed_calls)) return null;
  const calls = [...(response.function_calls || []), ...(response.suppressed_calls || [])];
  if (calls.length !== 1 || !Object.hasOwn(VERDICT_BY_TOOL, calls[0]?.name)) return null;
  const args = calls[0].arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) return null;
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
    const timer = setTimeout(() => child.kill('SIGKILL'), GATE_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ error: error.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (signal) return resolve({ error: `the Gate was stopped by ${signal}` });
      if (code !== 0) return resolve({ error: clip(stderr || `the Gate exited with ${code}`, 200) });
      try {
        resolve({ response: JSON.parse(stdout) });
      } catch {
        resolve({ error: clip(stderr || `the Gate exited with ${code} and no verdict`, 200) });
      }
    });
  });
}

function createNeedleGate(opts = {}) {
  const manifest = opts.manifest || gateManifest();
  const root = opts.root || defaultGateRoot();
  let installed = null;
  let toolDir = null;
  let queue = Promise.resolve();

  function ensureInstalled() {
    if (installed?.ready) return installed;
    try {
      installed = verifyInstalledGate(manifest, root);
    } catch (error) {
      installed = { ready: false, reason: error.message.replace(/\.$/, '') };
    }
    return installed;
  }

  function toolsFile(tools) {
    const contents = JSON.stringify(tools);
    toolDir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'xor-gate-'));
    const file = path.join(toolDir, crypto.createHash('sha256').update(contents).digest('hex') + '.json');
    if (!fs.existsSync(file)) fs.writeFileSync(file, contents);
    return file;
  }

  async function decide(input) {
    const ready = ensureInstalled();
    if (!ready.ready) return { verdict: null, unavailable: true, reason: `${ready.reason}. Run xor install` };
    const request = gateRequest(input);
    const args = [
      '--model', ready.weights,
      '--tools', toolsFile(request.tools),
      '--prompt', request.query,
      '--max', '128',
      '--fail-input-overflow',
    ];
    if (opts.threads !== undefined) {
      if (!Number.isInteger(opts.threads) || opts.threads < 1) throw new Error('Gate thread count must be a positive integer');
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

  function gate(input) {
    const next = queue.then(() => decide(input));
    queue = next.catch(() => {});
    return next;
  }

  gate.dispose = () => {
    if (toolDir) fs.rmSync(toolDir, { recursive: true, force: true });
    toolDir = null;
  };
  return gate;
}

module.exports = {
  createNeedleGate,
  gateRequest,
  verdictFrom,
  GATE_REQUEST_VERSION,
  createNeedleVerifier: createNeedleGate,
  verifierRequest: gateRequest,
  VERIFIER_REQUEST_VERSION: GATE_REQUEST_VERSION,
};
