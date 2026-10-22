'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { plan, author } = require('../../xor/prototype/author-checker-data');

const script = path.resolve(__dirname, '../../xor/prototype/dev-generate-data.js');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const inventory = { tools: ['first', 'second'].map((name) => ({ agent: 'codex', name, schemaVerified: true, inputSchema: { type: 'object', required: ['command'], properties: { command: { type: 'string' } }, additionalProperties: false }, examples: [{ command: 'pwd' }] })) };
function response(body, invalid = false) {
  const { tasks } = JSON.parse(body.messages[1].content);
  return { model: body.model, usage: { total_tokens: 20 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ cases: tasks.map((task) => ({ taskId: task.taskId, tool: task.tool, userMessage: `Read the fictional project inventory for ${task.taskId}.`, preference: { text: 'Read files only inside this fictional project.' }, args: invalid ? {} : { command: `cat ${task.taskId}.txt` } })) }) } }] };
}
async function fixture(t, handle) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checker-dev-cli-'));
  const directory = path.join(root, 'study');
  plan(inventory, { authorModel: 'gemma4-31b-it', splits: ['train'], conditions: ['approve'], batchSize: 1, maxAttemptsPerTask: 2 }, directory);
  const requests = [];
  const sockets = new Set();
  const server = http.createServer(async (request, outgoing) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    requests.push(body);
    const result = await handle(body, requests.length);
    if (result === null) return;
    outgoing.setHeader('Content-Type', 'application/json');
    outgoing.end(JSON.stringify(result));
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const environment = { ...process.env, AIR_API_KEY: 'local-fixture-secret', OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` };
  const start = (...args) => {
    const child = spawn(process.execPath, [script, ...args], { env: environment, cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const originalKill = child.kill.bind(child);
    child.kill = (signal) => {
      if (process.platform === 'win32' && (signal === 'SIGINT' || signal === 'SIGTERM')) {
        try { fs.writeFileSync(directory + '.dev-stop', ''); } catch {}
        return true;
      }
      return originalKill(signal);
    };
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code: code ?? (signal === 'SIGINT' ? 130 : null), signal, output }));
    });
    return { child, done };
  };
  return { root, directory, requests, start, environment };
}
function reviewResponse(body) {
  const inputs = JSON.parse(body.messages[1].content);
  return { model: body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ decisions: inputs.map(({ id, inputHash }) => ({ id, inputHash, verdict: 'deny' })) }) } }] };
}
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('Timed out waiting for checkpoint');
}

test('developer CLI skips exhausted invalid tasks and retains agreed denials', async (t) => {
  const fixtureState = await fixture(t, (body) => {
    const payload = JSON.parse(body.messages[1].content);
    return payload.tasks ? response(body, payload.tasks[0].tool === 'first') : reviewResponse(body);
  });
  const { directory, requests, start } = fixtureState;
  const result = await start(directory).done;
  assert.equal(result.code, 1);
  assert.match(result.output, /Generated \[#####\.\.\.\.\.\] 1\/2/);
  assert.match(result.output, /Accepted 1 \| Excluded 0 \| approve 0 deny 1 ask 0/);
  assert.match(result.output, /failed 2 exhausted 1/);
  assert.doesNotMatch(result.output, /\x1b|local-fixture-secret/);
  assert.equal(requests.length, 5);
  assert.equal(fs.existsSync(directory + '.dev-lock'), false);
  const retry = await start(directory).done;
  assert.equal(retry.code, 1);
  assert.equal(requests.length, 5);
  const status = await start(directory, '--status').done;
  assert.equal(status.code, 0);
  assert.match(status.output, /Gemma\s+\[##########\] 1\/1/);
  assert.equal(requests.length, 5);
});

test('new authored rows get new review snapshots without changing old evidence', async (t) => {
  const { directory, start } = await fixture(t, (body) => JSON.parse(body.messages[1].content).tasks ? response(body) : reviewResponse(body));
  await author(directory, 1, { connection: { key: 'mock' }, request: async (_connection, _route, body) => response(body) });
  fs.writeFileSync(path.join(directory, 'STOP-AUTHORING'), '');
  assert.equal((await start(directory).done).code, 1);
  const first = read(path.join(directory, 'dev-runner.json')).activeSnapshot;
  const oldReview = fs.readFileSync(path.join(first, 'review-gemma4-31b-it.json'), 'utf8');
  fs.unlinkSync(path.join(directory, 'STOP-AUTHORING'));
  const result = await start(directory).done;
  assert.equal(result.code, 0);
  assert.match(result.output, /Accepted 2 \| Excluded 0 \| approve 0 deny 2 ask 0/);
  assert.notEqual(read(path.join(directory, 'dev-runner.json')).activeSnapshot, first);
  assert.equal(fs.readFileSync(path.join(first, 'review-gemma4-31b-it.json'), 'utf8'), oldReview);
  assert.equal(fs.readdirSync(path.join(directory, 'dev-reviews')).length, 2);
});

test('interrupt stops the owned child before unlocking and duplicate writers are refused', async (t) => {
  const { directory, requests, start } = await fixture(t, () => null);
  const running = start(directory);
  await waitFor(() => requests.length === 1);
  const duplicate = await start(directory).done;
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.output, /Another runner owns/);
  running.child.kill('SIGINT');
  const result = await running.done;
  assert.ok(result.code === 130 || (process.platform === 'win32' && (result.code === null || result.code === 1)));
  assert.equal(fs.existsSync(directory + '.dev-lock'), false);
  const contents = fs.readFileSync(path.join(directory, 'state.json'), 'utf8');
  assert.equal(JSON.parse(contents).calls[0].status, 'reserved');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(fs.readFileSync(path.join(directory, 'state.json'), 'utf8'), contents);
});

test('unknown arguments fail before creating a study', async (t) => {
  const { root, start, requests } = await fixture(t, () => null);
  const missing = path.join(root, 'never-created');
  assert.equal((await start(missing, '--typo').done).code, 1);
  assert.equal(fs.existsSync(missing), false);
  assert.equal(fs.existsSync(missing + '.dev-lock'), false);
  assert.equal(requests.length, 0);
});

test('review retries are bounded per invocation and later starts resume missing decisions', async (t) => {
  let gemmaReviews = 0;
  const { directory, start, requests } = await fixture(t, (body) => {
    if (JSON.parse(body.messages[1].content).tasks) return response(body);
    if (body.model === 'gemma4-31b-it' && ++gemmaReviews <= 2) return { model: body.model, choices: [{ finish_reason: 'stop', message: { content: '{}' } }] };
    return reviewResponse(body);
  });
  const partial = await start(directory).done;
  assert.equal(partial.code, 1);
  assert.equal(gemmaReviews, 2);
  assert.match(partial.output, /Accepted pending \| Excluded pending/);
  assert.equal((await start(directory).done).code, 0);
  assert.equal(gemmaReviews, 3);
  const count = requests.length;
  const snapshot = read(path.join(directory, 'dev-runner.json')).activeSnapshot;
  const reviewFile = path.join(snapshot, 'review-gemma4-31b-it.json');
  const review = read(reviewFile);
  review.inputHash = 'stale';
  fs.writeFileSync(reviewFile, JSON.stringify(review));
  const stale = await start(directory, '--status').done;
  assert.equal(stale.code, 1);
  assert.match(stale.output, /Invalid or stale/);
  assert.equal(requests.length, count);
});

test('status stays readable while a frozen snapshot is being written', async (t) => {
  const { root, directory, start, environment } = await fixture(t, (body) => reviewResponse(body));
  await author(directory, 2, { connection: { key: 'mock' }, request: async (_connection, _route, body) => response(body) });
  fs.writeFileSync(path.join(directory, 'STOP-AUTHORING'), '');
  const marker = path.join(root, 'freezing');
  const preload = path.join(root, 'slow-freeze.cjs');
  fs.writeFileSync(preload, `const fs = require('node:fs');
if (process.argv[2] === 'freeze') {
  const mkdir = fs.mkdirSync;
  fs.mkdirSync = function (...args) {
    const result = mkdir.apply(this, args);
    fs.writeFileSync(${JSON.stringify(marker)}, '');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1800);
    return result;
  };
}
`);
  environment.NODE_OPTIONS = `--require=${preload}`;
  const running = start(directory);
  await waitFor(() => fs.existsSync(marker));
  const status = await start(directory, '--status').done;
  assert.equal(status.code, 0, status.output);
  assert.match(status.output, /Accepted pending/);
  const result = await running.done;
  assert.equal(result.code, 0, result.output);
  const snapshot = read(path.join(directory, 'dev-runner.json')).activeSnapshot;
  assert.equal(read(path.join(snapshot, 'review-packet.json')).requests.length, 2);
  assert.equal((await start(directory, '--status').done).code, 0);
});

test('narrow terminal frames preserve every metric and redraw their actual rows', async (t) => {
  const { root, directory, start, environment } = await fixture(t, (body) => JSON.parse(body.messages[1].content).tasks ? response(body) : reviewResponse(body));
  const preload = path.join(root, 'terminal.cjs');
  fs.writeFileSync(preload, `Object.defineProperties(process.stdout, { isTTY: { value: true }, columns: { value: 50 } });`);
  environment.NODE_OPTIONS = `--require=${preload}`;
  const result = await start(directory).done;
  assert.equal(result.code, 0, result.output);
  const frames = [...result.output.matchAll(/(?:\x1b\[2K[^\n]*\n)+/g)].map(([frame]) => frame.trimEnd().split('\n').map((line) => line.replace('\x1b[2K', '')));
  assert.ok(frames.length > 1);
  assert.ok(frames.every((frame) => frame.every((line) => line.length <= 49)));
  const movements = [...result.output.matchAll(/\x1b\[(\d+)A/g)].map((match) => Number(match[1]));
  assert.deepEqual(movements, frames.slice(0, -1).map((frame) => frame.length));
  const last = frames.at(-1).join('');
  for (const metric of ['Generated', 'Gemma', 'GLM', 'Accepted', 'Excluded', 'approve', 'deny', 'ask', 'Calls', 'failed', 'exhausted', 'blocked', 'uncertain']) assert.ok(last.includes(metric), metric);
});
