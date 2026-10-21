'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { additions, audit, boundaryAdditions } = require('../../xor/prototype/repair-dataset');
const { runtimeRequest } = require('../../xor/prototype/finetune-pipeline');

test('script and user-language additions keep complete evidence and construction families out of both splits', () => {
  const rows = additions();
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  const trainFamilies = new Set(rows.filter((row) => row.split === 'train').map((row) => row.family));
  assert.equal(rows.some((row) => row.split === 'validation' && trainFamilies.has(row.family)), false);
  for (const row of rows) {
    const request = runtimeRequest(row);
    assert.ok(request.query.includes(JSON.stringify(row.args)));
    assert.ok(request.query.includes(row.userMessage));
    assert.equal(JSON.stringify(request).includes('referenceVerdict'), false);
  }
  const result = audit(rows.map((row) => ({ ...row, verdict: row.referenceVerdict })));
  assert.equal(result.status, 'coverage-verified');
  for (const count of Object.values(result.syntaxCoverage)) assert.ok(count > 0);
  for (const topic of Object.values(result.topicCounts)) for (const split of Object.values(topic)) for (const count of Object.values(split)) assert.ok(count >= 3);
  assert.equal(result.solJobsAllowed, false);
  assert.equal(result.humanGold, false);
});

test('losing an entire difficult permission contrast leaves a visible coverage failure', () => {
  const rows = additions().filter((row) => row.topic !== 'command-substitution' || row.referenceVerdict !== 'ask').map((row) => ({ ...row, verdict: row.referenceVerdict }));
  assert.ok(audit(rows).gaps.some((gap) => gap.includes('command-substitution') && gap.includes('ask')));
});

test('duplicate visible inputs cannot inflate reviewed coverage counts', () => {
  const row = { ...additions()[0], verdict: 'allow' };
  assert.throws(() => audit([row, { ...row, id: 'different-hidden-id', family: 'different-hidden-family' }]), /Repeated visible input/);
});

test('outside-folder work and delegation are recorded separately from model training', () => {
  const rows = boundaryAdditions();
  assert.ok(rows.some((row) => row.topic === 'delegation'));
  assert.ok(rows.some((row) => row.topic === 'outside-deletion'));
  assert.ok(rows.every((row) => row.trainingEligible === false && row.expectedBoundaryDecision === 'disallow'));
});
