'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const data = require('../../xor/prototype/checker-data');
const { review } = require('../../xor/prototype/review-checker-data');

test('offline reviews are blind, checkpoint failures and resume only missing exact inputs', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checker-review-'));
  const directory = path.join(root, 'draft');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  data.prepare({ tools: [{ agent: 'opencode', name: 'shell', schemaVerified: true, hookable: true, examples: [{ command: 'npm test' }, { command: 'git diff' }, { command: 'npm run check' }] }] }, directory);
  let fail = true;
  let truncate = false;
  const requested = [];
  const server = http.createServer((req, res) => {
    let text = '';
    req.on('data', (chunk) => { text += chunk; });
    req.on('end', () => {
      const body = JSON.parse(text);
      assert.equal(body.max_tokens, 8192);
      assert.deepEqual(body.response_format, { type: 'json_object' });
      const packets = JSON.parse(body.messages[1].content);
      assert.equal(req.headers.authorization, 'Bearer test-credential');
      assert.ok(packets.every((packet) => /^case-[a-f0-9]{24}$/.test(packet.id)));
      assert.ok(packets.every((packet) => !Object.hasOwn(packet, 'suggestedVerdict') && !Object.hasOwn(packet, 'expected')));
      requested.push(packets.map((packet) => packet.id));
      res.setHeader('content-type', 'application/json');
      if (fail) {
        fail = false;
        res.writeHead(503);
        res.end(JSON.stringify({ error: { message: 'temporary review outage' } }));
        return;
      }
      res.end(JSON.stringify({ id: 'test-response', model: body.model, choices: [{ finish_reason: truncate ? 'length' : 'stop', message: { content: JSON.stringify({ decisions: packets.map((packet) => ({ id: packet.id, inputHash: packet.inputHash, verdict: 'approve' })) }) } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const previous = { AIR_API_KEY: process.env.AIR_API_KEY, OPENAI_BASE_URL: process.env.OPENAI_BASE_URL };
  process.env.AIR_API_KEY = 'test-credential';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const first = await review(directory, 'test-reviewer', 'test-family', 1);
  assert.equal(first.status, 'incomplete');
  assert.equal(first.reviewed, 4);
  const second = await review(directory, 'test-reviewer', 'test-family', 1);
  assert.equal(second.status, 'complete');
  assert.equal(second.reviewed, 12);
  assert.deepEqual(requested[2], requested[0]);
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'review-test-reviewer.json')));
  assert.equal(saved.errors.length, 1);
  assert.ok(saved.decisions.every((row) => Object.keys(row).sort().join(',') === 'id,inputHash,verdict'));
  const truncated = path.join(root, 'truncated');
  fs.mkdirSync(truncated);
  for (const file of ['manifest.json', 'proposals.jsonl', 'review-packet.json']) fs.copyFileSync(path.join(directory, file), path.join(truncated, file));
  truncate = true;
  assert.equal((await review(truncated, 'test-reviewer', 'test-family', 1)).reviewed, 0);
  const rejected = JSON.parse(fs.readFileSync(path.join(truncated, 'review-test-reviewer.json')));
  assert.ok(rejected.errors.every((entry) => entry.error.includes('truncated')));
  const proposals = path.join(directory, 'proposals.jsonl');
  fs.appendFileSync(proposals, '\n');
  await assert.rejects(review(directory, 'test-reviewer', 'test-family', 1), /Frozen proposals changed/);
});
