'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { seedReview } = require('../../xor/prototype/seed-checker-reviews');
const { digest, reviewPacket, REVIEW_INSTRUCTIONS, REVIEW_INSTRUCTION_HASH } = require('../../xor/prototype/checker-data');
const { GATE_REQUEST_VERSION } = require('../../xor/lib/gate');

const model = 'gemma4-31b-it';
const modelFamily = 'gemma';
const filename = 'review-gemma4-31b-it.json';
const sample = (suffix) => ({ id: 'case-' + suffix.repeat(24), tool: 'read', args: { path: `catalog-${suffix}.json` }, preference: { text: 'Read local catalog files.' }, userMessage: 'Inspect the catalog.' });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checker-seed-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = path.join(root, 'dev-reviews');
  const source = path.join(base, 'source');
  const target = path.join(base, 'target');
  const rows = [sample('a'), sample('b')];
  freeze(source, rows);
  freeze(target, [...rows, sample('c')]);
  const packets = reviewPacket(rows);
  const saved = { model, modelFamily, instructionHash: REVIEW_INSTRUCTION_HASH, inputHash: digest(packets), expected: rows.length, status: 'complete', decisions: packets.map((packet) => ({ id: packet.id, inputHash: packet.inputHash, verdict: 'approve' })), responses: [{ requestedModel: model, reportedModel: model, finishReason: 'stop', inputIds: packets.map((packet) => packet.id) }], errors: [] };
  fs.writeFileSync(path.join(source, filename), JSON.stringify(saved, null, 2) + '\n');
  return { root, source, target, rows, saved };
}

function freeze(directory, rows) {
  fs.mkdirSync(directory, { recursive: true });
  const contents = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  fs.writeFileSync(path.join(directory, 'proposals.jsonl'), contents);
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ requestFormatVersion: GATE_REQUEST_VERSION, proposalsSha256: digest(contents), requestsSha256: digest(reviewPacket(rows)), inventorySha256: digest('inventory'), cases: rows.length }));
  fs.writeFileSync(path.join(directory, 'review-packet.json'), JSON.stringify({ instructions: REVIEW_INSTRUCTIONS, instructionHash: REVIEW_INSTRUCTION_HASH, requests: reviewPacket(rows) }));
}

test('real seed CLI preserves source bytes and binds copied decisions to the expanded frozen packet', (t) => {
  const { source, target, saved } = fixture(t);
  const original = fs.readFileSync(path.join(source, filename));
  const result = spawnSync(process.execPath, [path.resolve('xor/prototype/seed-checker-reviews.js'), target, model, modelFamily], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { seeded: true });
  const seeded = JSON.parse(fs.readFileSync(path.join(target, filename)));
  assert.deepEqual(seeded.decisions, saved.decisions);
  assert.deepEqual(seeded.responses, saved.responses);
  assert.equal(seeded.status, 'incomplete');
  assert.equal(seeded.expected, 3);
  assert.notEqual(seeded.inputHash, saved.inputHash);
  assert.equal(seeded.importedFrom.requestsSha256, saved.inputHash);
  assert.equal(seeded.importedFrom.reviewSha256, digest(original.toString('utf8')));
  assert.ok(fs.readFileSync(path.join(source, filename)).equals(original));
  const proof = path.join(target, seeded.importedFrom.evidenceFile);
  assert.ok(fs.readFileSync(proof).equals(original));
  fs.writeFileSync(path.join(source, filename), '{}');
  assert.ok(fs.readFileSync(proof).equals(original));
  assert.equal(seedReview(target, model, modelFamily), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, filename))), seeded);
});

test('valid partial checkpoints and legacy receipts without finish metadata can be reused', (t) => {
  const { source, target, saved } = fixture(t);
  saved.decisions.pop();
  saved.status = 'incomplete';
  delete saved.responses[0].finishReason;
  fs.writeFileSync(path.join(source, filename), JSON.stringify(saved));
  assert.equal(seedReview(target, model, modelFamily), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, filename))).decisions.length, 1);
});

test('real reviewer CLI automatically reuses exact decisions and requests only the new case', (t) => {
  const { root, target } = fixture(t);
  const received = path.join(root, 'received.json');
  const bootstrap = path.join(root, 'gateway.cjs');
  const gateway = require.resolve('../../analysis/needle-judge-2026-10-09/scripts/gateway');
  fs.writeFileSync(bootstrap, `const fs = require('node:fs');
const filename = ${JSON.stringify(gateway)};
require.cache[filename] = { id: filename, filename, loaded: true, exports: {
  connection: () => ({}),
  safeError: (error) => error.message,
  request: async (connection, route, body) => {
    const packets = JSON.parse(body.messages[1].content);
    fs.writeFileSync(${JSON.stringify(received)}, JSON.stringify(packets));
    return { model: body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ decisions: packets.map((packet) => ({ id: packet.id, inputHash: packet.inputHash, verdict: 'approve' })) }) } }] };
  }
} };
`);
  const result = spawnSync(process.execPath, ['--require', bootstrap, path.resolve('xor/prototype/review-checker-data.js'), target, model, modelFamily], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(received)).map((packet) => packet.id), [sample('c').id]);
  const saved = JSON.parse(fs.readFileSync(path.join(target, filename)));
  assert.equal(saved.status, 'complete');
  assert.equal(saved.decisions.length, 3);
  assert.equal(saved.responses.length, 2);
  assert.ok(fs.existsSync(path.join(target, saved.importedFrom.evidenceFile)));
});

for (const [name, mutate] of Object.entries({
  'changed Preference': ({ target, rows }) => freeze(target, [{ ...rows[0], preference: { text: 'Do not read files.' } }, rows[1], sample('c')]),
  'renamed case': ({ target, rows }) => freeze(target, [{ ...rows[0], id: sample('d').id }, rows[1], sample('c')]),
  'nonopaque IDs': ({ source, rows }) => freeze(source, [{ ...rows[0], id: 'approve-training-example' }, rows[1]]),
  'stale builder': ({ source }) => {
    const file = path.join(source, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file));
    manifest.requestsSha256 = 'stale';
    fs.writeFileSync(file, JSON.stringify(manifest));
  },
  'unfrozen proposals': ({ source }) => fs.appendFileSync(path.join(source, 'proposals.jsonl'), '\n'),
  'different model': ({ saved }) => { saved.model = 'other'; },
  'different family': ({ saved }) => { saved.modelFamily = 'glm'; },
  'stale instructions': ({ saved }) => { saved.instructionHash = 'old'; },
  'stale packet binding': ({ saved }) => { saved.inputHash = 'old'; },
  'duplicate decisions': ({ saved }) => { saved.decisions[1] = saved.decisions[0]; },
  'invalid answer': ({ saved }) => { saved.decisions[0].verdict = 'yes'; },
  'stale decision hash': ({ saved }) => { saved.decisions[0].inputHash = 'old'; },
  'author label in decisions': ({ saved }) => { saved.decisions[0].suggestedVerdict = 'deny'; },
  'wrong reported model': ({ saved }) => { saved.responses[0].reportedModel = 'other'; },
  'wrong requested model': ({ saved }) => { saved.responses[0].requestedModel = 'other'; },
  'truncated response': ({ saved }) => { saved.responses[0].finishReason = 'length'; },
  'receipt includes unknown case': ({ saved }) => { saved.responses[0].inputIds.push(sample('f').id); },
  'missing receipt': ({ saved }) => { saved.responses = []; },
  'false completion': ({ saved }) => { saved.status = 'incomplete'; },
})) {
  test(`refuses checkpoint reuse with ${name}`, (t) => {
    const context = fixture(t);
    mutate(context);
    fs.writeFileSync(path.join(context.source, filename), JSON.stringify(context.saved));
    assert.equal(seedReview(context.target, model, modelFamily), false);
    assert.equal(fs.existsSync(path.join(context.target, filename)), false);
  });
}

test('only developer review snapshots are eligible and existing checkpoints are never overwritten', (t) => {
  const { root, target } = fixture(t);
  assert.equal(seedReview(root, model, modelFamily), false);
  const existing = '{"untouched":true}\n';
  fs.writeFileSync(path.join(target, filename), existing);
  assert.equal(seedReview(target, model, modelFamily), false);
  assert.equal(fs.readFileSync(path.join(target, filename), 'utf8'), existing);
});

test('selects the compatible checkpoint with most decisions', (t) => {
  const { source, target, rows, saved } = fixture(t);
  const partial = path.join(path.dirname(source), 'partial');
  freeze(partial, rows);
  fs.writeFileSync(path.join(partial, filename), JSON.stringify({ ...saved, status: 'incomplete', decisions: saved.decisions.slice(0, 1) }));
  assert.equal(seedReview(target, model, modelFamily), true);
  const seeded = JSON.parse(fs.readFileSync(path.join(target, filename)));
  assert.equal(seeded.decisions.length, 2);
  assert.equal(seeded.importedFrom.directory, source);
});

for (const side of ['source', 'target']) {
  for (const [name, mutate] of Object.entries({
    instructions: (packet) => { packet.instructions = 'Use a different judging policy.'; packet.instructionHash = digest(packet.instructions); },
    instructionHash: (packet) => { packet.instructionHash = digest('stale rubric'); },
    query: (packet) => { packet.requests[0].query += ' Changed request.'; },
    requestId: (packet) => { packet.requests[0].id = sample('f').id; },
    inputHash: (packet) => { packet.requests[0].inputHash = digest('different input'); },
    missingRequest: (packet) => { packet.requests.pop(); },
  })) {
    test(`rejects changed stored ${side} review packet ${name}`, (t) => {
      const context = fixture(t);
      const file = path.join(context[side], 'review-packet.json');
      const packet = JSON.parse(fs.readFileSync(file));
      mutate(packet);
      fs.writeFileSync(file, JSON.stringify(packet));
      if (side === 'target') assert.throws(() => seedReview(context.target, model, modelFamily), /Frozen production packet/);
      else assert.equal(seedReview(context.target, model, modelFamily), false);
      assert.equal(fs.existsSync(path.join(context.target, filename)), false);
    });
  }
}

for (const side of ['source', 'target']) {
  for (const [name, mutate] of Object.entries({
    inventory: (manifest) => { manifest.inventorySha256 = digest('other inventory'); },
    missingInventory: (manifest) => { delete manifest.inventorySha256; },
    invalidInventory: (manifest) => { manifest.inventorySha256 = 'invalid'; },
    oneSidedPlan: (manifest) => { manifest.planSha256 = digest('plan'); },
    invalidPlan: (manifest) => { manifest.planSha256 = 'invalid'; },
  })) {
    test(`rejects ${side} study identity change ${name}`, (t) => {
      const context = fixture(t);
      const file = path.join(context[side], 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(file));
      mutate(manifest);
      fs.writeFileSync(file, JSON.stringify(manifest));
      if (side === 'target' && ['missingInventory', 'invalidInventory', 'invalidPlan'].includes(name)) assert.throws(() => seedReview(context.target, model, modelFamily), /Frozen study identity/);
      else assert.equal(seedReview(context.target, model, modelFamily), false);
      assert.equal(fs.existsSync(path.join(context.target, filename)), false);
    });
  }
}

test('matching pinned plans reuse checkpoints while distinct pinned plans do not', (t) => {
  const { source, target } = fixture(t);
  for (const directory of [source, target]) {
    const file = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file));
    manifest.planSha256 = digest(directory === source ? 'source plan' : 'target plan');
    fs.writeFileSync(file, JSON.stringify(manifest));
  }
  assert.equal(seedReview(target, model, modelFamily), false);
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
  const targetManifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json')));
  targetManifest.planSha256 = sourceManifest.planSha256;
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(targetManifest));
  assert.equal(seedReview(target, model, modelFamily), true);
});
