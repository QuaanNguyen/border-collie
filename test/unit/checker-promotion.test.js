'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { assess } = require('../../bordercollie/prototype/checker-promotion');
const { directVerdict } = require('../../bordercollie/prototype/evaluate-checker-native');

const qualification = { blind: true, humanVerified: true, coverageComplete: true, frozenEvaluationSha256: 'frozen', originalModelSha256: 'original', caseIds: ['deny-case'] };
const evidence = (changes = {}) => ({ status: 'complete', platform: 'darwin-arm64', machineId: 'same-mac', requestFormatVersion: '3', evaluationSha256: 'frozen', modelSha256: 'original', runnerSha256: 'runner', settings: { threads: 4 }, deploymentBytes: 100, rows: [{ id: 'deny-case', inputHash: 'same', expected: 'deny', observed: 'deny', directVerdict: true, latenciesMs: [10, 11, 12] }], ...changes });

test('only no-worse calls plus a measured size or Mac speed improvement qualify', () => {
  assert.equal(assess(evidence(), evidence({ deploymentBytes: 90 }), qualification).promotionAllowed, true);
  assert.equal(assess(evidence(), evidence(), qualification).promotionAllowed, false);
  const faster = evidence();
  faster.rows[0].latenciesMs = [8, 9, 10];
  assert.equal(assess(evidence(), faster, qualification).promotionAllowed, true);
  faster.rows[0].observed = 'approve';
  assert.equal(assess(evidence(), faster, qualification).promotionAllowed, false);
});

test('Sol timings, different cases and unverified evaluation cannot promote', () => {
  for (const changes of [{ platform: 'linux-x64' }, { machineId: 'other-mac' }, { evaluationSha256: 'changed' }, { requestFormatVersion: '2' }, { runnerSha256: 'changed' }]) assert.equal(assess(evidence(), evidence({ deploymentBytes: 90, ...changes }), qualification).promotionAllowed, false);
  assert.equal(assess(evidence(), evidence({ deploymentBytes: 90 }), { ...qualification, humanVerified: false }).promotionAllowed, false);
  assert.equal(assess(evidence(), evidence({ deploymentBytes: 90 }), { ...qualification, blind: false }).promotionAllowed, false);
  const missing = evidence({ deploymentBytes: 90 });
  missing.rows[0].directVerdict = false;
  assert.equal(assess(evidence(), missing, qualification).promotionAllowed, false);
});

test('native qualification rejects reasoning, multiple calls and stale verdict names', () => {
  const response = { success: true, function_calls: [{ name: 'approve', arguments: {} }], reasoning: '' };
  assert.equal(directVerdict(response), 'approve');
  assert.equal(directVerdict({ ...response, reasoning: 'external explanation' }), null);
  assert.equal(directVerdict({ ...response, reasoning: false }), null);
  assert.equal(directVerdict({ ...response, reasoning: 0 }), null);
  assert.equal(directVerdict({ ...response, function_calls: [...response.function_calls, { name: 'deny', arguments: {} }] }), null);
  assert.equal(directVerdict({ ...response, function_calls: [{ name: 'allow_call', arguments: {} }] }), null);
});
