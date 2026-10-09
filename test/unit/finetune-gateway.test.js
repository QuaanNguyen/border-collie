'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const test = require('node:test');
const pipeline = require('../../guard/prototype/finetune-pipeline');

async function localGateway(t, handler) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push({ body, method: request.method, path: request.url, authorization: request.headers.authorization });
    handler(body, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { requests, conn: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, key: 'fixture-key', proposerModel: 'inkling', labelerModel: 'kimi', requestTimeoutMs: 1000 } };
}

function modelReply(body) {
  const content = body.model === 'inkling'
    ? JSON.parse(body.messages[1].content).map((task) => ({ taskId: task.id, userMessage: 'Read src/example.js.', tool: 'read', args: { filePath: 'src/example.js' }, verdict: 'allow' }))
    : JSON.parse(body.messages[1].content).map(() => ({ verdict: 'allow', reason: 'The requested local read is permitted.' }));
  return JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] });
}

function readPlan() {
  return [pipeline.generationPlan().find((task) => task.family.startsWith('read-search:'))];
}

test('generation accepts delayed HTTP responses and keeps the independent review input blind', async (t) => {
  const { conn, requests } = await localGateway(t, (body, response) => {
    setTimeout(() => response.end(modelReply(body)), 25);
  });
  const result = await pipeline.liveBatch(conn, { plan: readPlan(), attempts: 1 });
  assert.equal(result.intake.accepted.length, 1);
  assert.deepEqual(requests.map((request) => request.body.model), ['inkling', 'kimi']);
  assert(requests.every((request) => request.method === 'POST' && request.path === '/v1/chat/completions' && request.authorization === 'Bearer fixture-key'));
  const labelerInput = JSON.parse(requests[1].body.messages[1].content);
  assert.deepEqual(Object.keys(labelerInput[0]).sort(), ['query', 'tools']);
});

test('the configured gateway deadline aborts a response that has not sent headers', async (t) => {
  const { conn } = await localGateway(t, (body, response) => {
    setTimeout(() => response.end(modelReply(body)), 250).unref();
  });
  const result = await pipeline.liveBatch({ ...conn, requestTimeoutMs: 50 }, { plan: readPlan(), attempts: 1 });
  assert.equal(result.intake.accepted.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /ABORT_ERR/);
});

test('an HTTP review failure preserves the proposal for direct independent review on resume', async (t) => {
  let failing = true;
  const { conn, requests } = await localGateway(t, (body, response) => {
    if (body.model === 'kimi' && failing) {
      response.writeHead(503);
      response.end(JSON.stringify({ error: { message: 'review service unavailable' } }));
    } else {
      response.end(modelReply(body));
    }
  });
  const plan = readPlan();
  const interrupted = await pipeline.liveBatch(conn, { plan, attempts: 1 });
  assert.equal(interrupted.scenarios.length, 1);
  assert.equal(interrupted.intake.accepted.length, 0);
  assert.match(interrupted.errors[0].error, /503 review service unavailable/);
  failing = false;
  const resumed = await pipeline.liveBatch(conn, { plan, initial: interrupted, attempts: 1 });
  assert.equal(resumed.intake.accepted.length, 1);
  assert.deepEqual(requests.map((request) => request.body.model), ['inkling', 'kimi', 'kimi']);
});
