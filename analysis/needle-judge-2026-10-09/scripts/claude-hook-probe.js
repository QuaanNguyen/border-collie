'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

function message(index) {
  return {
    id: `msg_fixture_${index}`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
    content: index < 2 ? [{ type: 'tool_use', id: `toolu_fixture_${index}`, name: 'Bash', input: { command: `touch side-effect-${index}.txt`, description: 'Create a harmless local test marker' } }] : [{ type: 'text', text: 'Local hook test complete.' }],
    stop_reason: index < 2 ? 'tool_use' : 'end_turn', stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}

function respond(res, value, stream) {
  if (!stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send('message_start', { message: { ...value, content: [], stop_reason: null } });
  for (const [index, block] of value.content.entries()) {
    send('content_block_start', { index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
    send('content_block_delta', { index, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    send('content_block_stop', { index });
  }
  send('message_delta', { delta: { stop_reason: value.stop_reason, stop_sequence: null }, usage: { output_tokens: 20 } });
  send('message_stop', {});
  res.end();
}

async function probe(binary, directory, selected) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-claude-hooks-'));
  const results = [];
  let active;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    if (req.url.startsWith('/hook/')) {
      active.hookRequests++;
      if (active.mode === 'http-timeout') return;
      if (active.mode === 'http-error') {
        res.writeHead(503); res.end('fictional hook failure'); return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(active.mode === 'http-invalid-json' ? '{broken' : JSON.stringify({ continue: false, stopReason: 'Test denies this action and stops the turn.', hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Fixture policy refusal' } }));
      return;
    }
    if (req.url.includes('count_tokens')) {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":100}'); return;
    }
    if (req.url.startsWith('/v1/messages')) {
      const body = JSON.parse(text);
      const index = active.modelRequests++;
      respond(res, message(index), body.stream);
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const modes = selected || ['baseline', 'command-missing', 'command-crash', 'command-allow-error', 'command-unstructured-stdout', 'command-invalid-json', 'command-timeout', 'command-stop', 'http-error', 'http-invalid-json', 'http-timeout', 'http-stop'];
  try {
    for (const mode of modes) {
      const cwd = path.join(work, mode);
      fs.mkdirSync(cwd);
      const config = path.join(cwd, 'config');
      fs.mkdirSync(config);
      const hookFile = path.join(cwd, 'policy.cjs');
      const stop = { continue: false, stopReason: 'Test denies this action and stops the turn.', hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Fixture policy refusal' } };
      const allow = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
      const programs = {
        'command-crash': 'process.exit(9)',
        'command-allow-error': `process.stdout.write(${JSON.stringify(JSON.stringify(allow))});process.exitCode=7`,
        'command-unstructured-stdout': 'process.stdout.write("{broken")',
        'command-invalid-json': 'process.stdout.write("{broken}")',
        'command-timeout': 'setInterval(() => {}, 1000)',
        'command-stop': `process.stdout.write(${JSON.stringify(JSON.stringify(stop))})`,
      };
      if (programs[mode]) fs.writeFileSync(hookFile, programs[mode]);
      const hook = mode.startsWith('http-') ? { type: 'http', url: `${origin}/hook/${mode}`, timeout: 1, onFailure: 'block' } : { type: 'command', command: process.execPath, args: [hookFile], timeout: 1, onFailure: 'block' };
      const settings = { autoUpdatesChannel: 'stable', hooks: mode === 'baseline' ? {} : { PreToolUse: [{ matcher: 'Bash', hooks: [hook] }] } };
      const settingsPath = path.join(cwd, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify(settings));
      active = { mode, modelRequests: 0, hookRequests: 0 };
      const env = { PATH: process.env.PATH, TMPDIR: os.tmpdir(), CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: 'fictional-local-test-key', ANTHROPIC_BASE_URL: origin, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', DO_NOT_TRACK: '1' };
      const started = Date.now();
      const child = spawn(binary, ['-p', 'Perform the two harmless local marker actions from the test model.', '--model', 'claude-sonnet-4-6', '--tools', 'Bash', '--allowedTools', 'Bash', '--max-turns', '4', '--output-format', 'json', '--settings', settingsPath, '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--system-prompt', 'You are an isolated command hook test. Only use the supplied Bash tool.'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
      const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
      clearTimeout(timer);
      const markers = [0, 1].map((index) => fs.existsSync(path.join(cwd, `side-effect-${index}.txt`)));
      const result = { ...active, ...exit, elapsedMs: Date.now() - started, markers, stdout, stderr };
      results.push(result);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, `${mode}.json`), JSON.stringify(result, null, 2) + '\n');
      process.stdout.write(JSON.stringify({ ...result, stdout: stdout.slice(-400), stderr: stderr.slice(-400) }) + '\n');
      assert.equal(exit.signal, null, `${mode}: CLI did not finish`);
      assert.ok(active.modelRequests > 0, `${mode}: model transport was never reached`);
      assert.deepEqual(markers, ['baseline', 'command-unstructured-stdout'].includes(mode) ? [true, true] : [false, false], `${mode}: downstream effect mismatch`);
      if (mode.endsWith('-stop')) assert.equal(active.modelRequests, 1, `${mode}: turn continued after explicit stop`);
      if (mode.startsWith('http-')) assert.ok(active.hookRequests > 0, `${mode}: HTTP hook did not run`);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  const receipt = { checkedAt: new Date().toISOString(), version: execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(), binarySha256: crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'), modelTransport: 'local fictional Anthropic protocol server; no external model calls', source: 'https://code.claude.com/docs/en/hooks', shippedAdapter: false, results: results.map(({ stdout, stderr, ...rest }) => rest) };
  fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

if (require.main === module) {
  const [binary, directory, ...modes] = process.argv.slice(2);
  if (!binary || !directory) throw new Error('Usage: claude-hook-probe.js <pinned-Claude-binary> <evidence-directory> [modes]');
  probe(path.resolve(binary), path.resolve(directory), modes.length ? modes : null).catch((error) => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}

module.exports = { probe };
