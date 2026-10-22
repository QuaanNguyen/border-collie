'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const data = require('../../xor/prototype/checker-data');
const { verify } = require('../../scripts/verify-checker-data');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checker-verification-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inventory = { tools: [{ agent: 'opencode', name: 'shell', hookable: true, integrationVerified: true, schemaVerified: true, inputSchema: { type: 'object', required: ['command'], properties: { command: { type: 'string' } }, additionalProperties: false }, examples: [{ command: 'npm test' }, { command: 'git diff --check' }, { command: 'npm run check' }] }] };
  const inventoryFile = path.join(root, 'inventory.json');
  fs.writeFileSync(inventoryFile, JSON.stringify(inventory));
  const directory = path.join(root, 'snapshot');
  data.prepare(inventory, directory);
  const rows = data.proposals(inventory);
  const requests = data.reviewPacket(rows);
  for (const model of ['gemma', 'glm']) {
    const review = { model, modelFamily: model, instructionHash: data.REVIEW_INSTRUCTION_HASH, inputHash: data.digest(requests), decisions: requests.map((request, index) => ({ id: request.id, inputHash: request.inputHash, verdict: rows[index].suggestedVerdict || 'approve' })), responses: [{ requestedModel: model, reportedModel: model, inputIds: rows.map((row) => row.id) }] };
    fs.writeFileSync(path.join(directory, `review-${model}.json`), JSON.stringify(review));
  }
  return { root, inventoryFile, directory };
}

function change(file, update) {
  const value = JSON.parse(fs.readFileSync(file));
  update(value);
  fs.writeFileSync(file, JSON.stringify(value));
}

test('real verification CLI preserves files and distinguishes integrity from training readiness', (t) => {
  const { inventoryFile, directory } = fixture(t);
  const before = fs.readdirSync(directory).map((file) => [file, data.digest(fs.readFileSync(path.join(directory, file), 'utf8'))]);
  const run = spawnSync(process.execPath, ['scripts/verify-checker-data.js', inventoryFile, directory], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
  assert.equal(run.status, 2, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.integrity, 'passed');
  assert.equal(result.accepted, 12);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.trainingEligible, false);
  assert.ok(result.blockers.some((message) => message.includes('human decisions')));
  assert.deepEqual(fs.readdirSync(directory).map((file) => [file, data.digest(fs.readFileSync(path.join(directory, file), 'utf8'))]), before);
});

test('verification rejects mismatched gateway models, invented human claims and altered proposals', (t) => {
  const { inventoryFile, directory } = fixture(t);
  change(path.join(directory, 'review-glm.json'), (review) => { review.responses[0].reportedModel = 'unexpected'; review.responses[0].finishReason = 'length'; });
  change(path.join(directory, 'manifest.json'), (manifest) => { manifest.humanVerified = true; });
  fs.appendFileSync(path.join(directory, 'proposals.jsonl'), '\n');
  const result = verify(inventoryFile, directory);
  assert.equal(result.integrity, 'failed');
  assert.ok(result.failures.some((message) => message.includes('model receipt')));
  assert.ok(result.failures.some((message) => message.includes('truncated review')));
  assert.ok(result.failures.some((message) => message.includes('humanVerified')));
  assert.ok(result.failures.some((message) => message.includes('proposal bytes')));
});

test('valid historical hashes are reported as stale production inputs without claiming corruption', (t) => {
  const { inventoryFile, directory } = fixture(t);
  const packetFile = path.join(directory, 'review-packet.json');
  change(packetFile, (packet) => {
    for (const request of packet.requests) {
      request.query += ' Historical builder description.';
      const { id, inputHash, ...visible } = request;
      request.inputHash = data.digest(visible);
    }
  });
  const packet = JSON.parse(fs.readFileSync(packetFile));
  change(path.join(directory, 'manifest.json'), (manifest) => { manifest.requestsSha256 = data.digest(packet.requests); });
  for (const model of ['gemma', 'glm']) {
    change(path.join(directory, `review-${model}.json`), (review) => {
      review.inputHash = data.digest(packet.requests);
      review.decisions.forEach((decision, index) => { decision.inputHash = packet.requests[index].inputHash; });
    });
  }
  const result = verify(inventoryFile, directory);
  assert.equal(result.integrity, 'passed');
  assert.equal(result.currentProductionBuilderMatches, false);
  assert.ok(result.blockers.some((message) => message.includes('prepare fresh exact-input reviews')));
  assert.equal(result.accepted, 0);
});

test('rewriting proposal hashes cannot conceal a packet showing another case', (t) => {
  const { inventoryFile, directory } = fixture(t);
  const file = path.join(directory, 'proposals.jsonl');
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  rows[0].userMessage = 'A changed request which the reviewers never saw.';
  const contents = rows.map(JSON.stringify).join('\n') + '\n';
  fs.writeFileSync(file, contents);
  change(path.join(directory, 'manifest.json'), (manifest) => { manifest.proposalsSha256 = data.digest(contents); });
  const result = verify(inventoryFile, directory);
  assert.equal(result.integrity, 'failed');
  assert.ok(result.failures.some((message) => message.includes('complete proposal input')));
});

test('missing response receipts, duplicate receipt ids and unknown receipt cases fail integrity', (t) => {
  const { inventoryFile, directory } = fixture(t);
  const file = path.join(directory, 'review-glm.json');
  change(file, (review) => { review.responses[0].inputIds = [review.decisions[0].id, review.decisions[0].id, 'not-a-case']; });
  const result = verify(inventoryFile, directory);
  assert.equal(result.integrity, 'failed');
  assert.ok(result.failures.some((message) => message.includes('Unknown case')));
  assert.ok(result.failures.some((message) => message.includes('lack recorded gateway')));
});

test('matching hashes and model reviews cannot hide an invoked script with missing contents', (t) => {
  const { inventoryFile, directory } = fixture(t);
  const file = path.join(directory, 'proposals.jsonl');
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  rows[0].args.command = 'bin/check-route-status.sh\nls -lh logs/north-express.log';
  rows[0].userMessage = 'Run the route status check and inspect its saved log.';
  const contents = rows.map(JSON.stringify).join('\n') + '\n';
  const requests = data.reviewPacket(rows);
  fs.writeFileSync(file, contents);
  change(path.join(directory, 'review-packet.json'), (packet) => { packet.requests = requests; });
  change(path.join(directory, 'manifest.json'), (manifest) => { manifest.proposalsSha256 = data.digest(contents); manifest.requestsSha256 = data.digest(requests); });
  for (const model of ['gemma', 'glm']) change(path.join(directory, `review-${model}.json`), (review) => {
    review.inputHash = data.digest(requests);
    review.decisions.forEach((decision, index) => { decision.inputHash = requests[index].inputHash; });
  });
  const report = verify(inventoryFile, directory);
  assert.equal(report.currentProductionBuilderMatches, true);
  assert.equal(report.integrity, 'failed');
  assert.ok(report.failures.some((message) => message.includes('Incomplete script visibility')));
});

test('an intact partial review is pending work rather than corrupted data', (t) => {
  const { inventoryFile, directory } = fixture(t);
  change(path.join(directory, 'review-glm.json'), (review) => { review.decisions.pop(); review.status = 'incomplete'; });
  const pending = verify(inventoryFile, directory);
  assert.equal(pending.integrity, 'passed');
  assert.ok(pending.blockers.some((message) => message.includes('11 of 12 review decisions')));
  change(path.join(directory, 'review-glm.json'), (review) => { review.status = 'complete'; });
  const invalid = verify(inventoryFile, directory);
  assert.equal(invalid.integrity, 'failed');
  assert.ok(invalid.failures.some((message) => message.includes('claims completion')));
});

test('imported review evidence remains independently hash-bound after checkpoint reuse', (t) => {
  const { inventoryFile, directory } = fixture(t);
  const file = path.join(directory, 'review-gemma.json');
  const original = fs.readFileSync(file, 'utf8');
  const review = JSON.parse(original);
  const relative = 'seed-evidence/gemma/original.json';
  fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
  fs.writeFileSync(path.join(directory, relative), original);
  review.importedFrom = { requestsSha256: review.inputHash, reviewSha256: data.digest(original), evidenceFile: relative };
  fs.writeFileSync(file, JSON.stringify(review));
  assert.equal(verify(inventoryFile, directory).integrity, 'passed');
  fs.appendFileSync(path.join(directory, relative), '\n');
  const result = verify(inventoryFile, directory);
  assert.equal(result.integrity, 'failed');
  assert.ok(result.failures.some((message) => message.includes('Imported review evidence changed')));
});
