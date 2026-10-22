'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { audit } = require('../../scripts/audit-legacy-checker-data');
const { digest, reviewPacket, REVIEW_INSTRUCTION_HASH } = require('../../xor/prototype/checker-data');

test('legacy audit preserves source bytes and excludes heldout and validation cases from current unreviewed requests', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-checker-test-'));
  try {
    const development = path.join(scratch, 'xor/prototype/output/stage2/development');
    const evaluation = path.join(scratch, 'xor/prototype/output/stage2/evaluation');
    const docs = path.join(scratch, 'docs');
    for (const directory of [development, evaluation, docs]) fs.mkdirSync(directory, { recursive: true });
    const inventory = require('../../docs/checker-tool-inventory.json');
    fs.writeFileSync(path.join(docs, 'checker-tool-inventory.json'), JSON.stringify(inventory));
    const source = { id: 'training-edit', family: 'original-train-family', split: 'train', preference: { purpose: 'Maintain this folder.', allow: 'Requested local edits.', disallow: 'Remote uploads.', ask: '' }, userMessage: 'Fix the incorrect total.', tool: 'edit', args: { filePath: 'src/total.js', oldString: 'a + b', newString: 'a - b' }, verdict: 'allow', source: { model: 'inkling-small' } };
    const heldout = { ...source, id: 'heldout-edit', family: 'reserved-family', userMessage: 'Correct the heldout calculation.' };
    const validation = { ...source, id: 'validation-edit', family: 'validation-family', split: 'validation', userMessage: 'Fix the validation calculation.' };
    fs.writeFileSync(path.join(development, 'accepted.jsonl'), [source, heldout, validation].map(JSON.stringify).join('\n') + '\n');
    for (const file of [path.join(development, 'held-out.jsonl'), path.join(evaluation, 'proposed.jsonl'), path.join(evaluation, 'held-out.jsonl')]) fs.writeFileSync(file, JSON.stringify({ ...heldout, split: 'heldOut' }) + '\n');
    const sourceBytes = fs.readFileSync(path.join(development, 'accepted.jsonl'));
    const output = path.join(scratch, 'audit');
    const result = audit(scratch, output);
    assert.deepEqual(fs.readFileSync(path.join(development, 'accepted.jsonl')), sourceBytes);
    const rows = fs.readFileSync(path.join(output, 'proposals.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].family, source.family);
    assert.match(rows[0].id, /^case-[a-f0-9]{24}$/);
    assert.equal(rows[0].id.includes(source.id), false);
    assert.equal(rows[0].split, 'train');
    assert.deepEqual(rows[0].args, { path: 'src/total.js', oldString: 'a + b', newString: 'a - b' });
    assert.equal(rows[0].preference.text, 'Purpose: Maintain this folder.\nAllow: Requested local edits.\nDeny: Remote uploads.');
    assert.equal(rows[0].trainingEligible, false);
    assert.equal(Object.hasOwn(rows[0], 'verdict'), false);
    assert.equal(Object.hasOwn(rows[0], 'independentReview'), false);
    assert.equal(result.heldoutProtection.trainingOverlapCases, 1);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
    const packet = JSON.parse(fs.readFileSync(path.join(output, 'review-packet.json')));
    assert.equal(manifest.proposalsSha256, digest(fs.readFileSync(path.join(output, 'proposals.jsonl'), 'utf8')));
    assert.equal(manifest.requestsSha256, digest(reviewPacket(rows)));
    assert.equal(packet.instructionHash, REVIEW_INSTRUCTION_HASH);
    assert.equal(digest(packet.instructions), REVIEW_INSTRUCTION_HASH);
    assert.deepEqual(packet.requests, reviewPacket(rows));
    assert.throws(() => audit(scratch, output), /Preserve previous/);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
