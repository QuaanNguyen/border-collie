'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { resolveReviews } = require('../scripts/resolve-control-reviews');

const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function setup() {
  const requests = ['a', 'b', 'c'].map((id) => ({ id, input: { query: id, tools: [] } }));
  const scenarios = requests.map((row) => ({ id: row.id, family: row.id === 'c' ? 'development:ordinary' : 'security:contrast', dataset: row.id === 'c' ? 'development' : 'security-development', category: 'ordinary-work', inputHash: hash(row.input) }));
  const singleRequests = requests.slice(0, 2);
  const makeRecord = (model, inputRows, verdicts) => ({ model, instructionHash: 'unchanged-rubric', sourceHash: hash(inputRows), expected: inputRows.length, completed: inputRows.length, status: 'complete', reviews: Object.fromEntries(inputRows.map((row, index) => [row.id, { model, inputHash: hash(row.input), verdict: verdicts[index], reason: row.id }])) });
  const baseRecords = ['reviewer-a', 'reviewer-b'].map((model) => makeRecord(model, requests, ['allow', 'ask', 'disallow']));
  const singleRecords = ['reviewer-a', 'reviewer-b'].map((model) => makeRecord(model, singleRequests, ['disallow', 'allow']));
  const selection = { parentSourceHash: hash(requests), sourceHash: hash(singleRequests), cases: 2, families: ['security:contrast'] };
  return { scenarios, requests, baseRecords, singleRequests, singleRecords, selection, resolvedAt: '2026-10-09T00:00:00.000Z' };
}

test('singleton resolution replaces the entire preselected contrast while preserving other evidence', () => {
  const inputs = setup();
  const originals = JSON.stringify(inputs.baseRecords);
  const resolved = resolveReviews(inputs);
  assert.equal(JSON.stringify(inputs.baseRecords), originals);
  for (let index = 0; index < resolved.length; index++) {
    assert.equal(resolved[index].reviews.a, inputs.singleRecords[index].reviews.a);
    assert.equal(resolved[index].reviews.b, inputs.singleRecords[index].reviews.b);
    assert.equal(resolved[index].reviews.c, inputs.baseRecords[index].reviews.c);
    assert.equal(resolved[index].resolution.replacedCases, 2);
    assert.equal(resolved[index].resolution.replacedFamilies, 1);
  }
});

test('a favorable singleton verdict cannot replace only part of its related family', () => {
  const inputs = setup();
  inputs.singleRequests = inputs.singleRequests.slice(0, 1);
  inputs.selection.sourceHash = hash(inputs.singleRequests);
  inputs.selection.cases = 1;
  assert.throws(() => resolveReviews(inputs), /every member/);
});

test('a changed visible request cannot borrow a previous singleton review', () => {
  const inputs = setup();
  inputs.singleRequests = structuredClone(inputs.singleRequests);
  inputs.singleRequests[0].input.query = 'changed action';
  inputs.selection.sourceHash = hash(inputs.singleRequests);
  assert.throws(() => resolveReviews(inputs), /original visible input/);
});

test('incomplete audits, stale fingerprints and changed reviewer identities reject resolution', () => {
  const incomplete = setup();
  incomplete.baseRecords[0].status = 'incomplete';
  assert.throws(() => resolveReviews(incomplete), /must be complete/);
  const stale = setup();
  stale.singleRecords[0].reviews.a.inputHash = 'stale';
  assert.throws(() => resolveReviews(stale), /fingerprint/);
  const identity = setup();
  identity.singleRecords[0].model = 'different-reviewer';
  assert.throws(() => resolveReviews(identity), /identity/);
});
