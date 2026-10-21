'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { judgeRequest, verdictFrom } = require('../../xor/lib/judge');
const { DEFAULT_PREFERENCE, withDefaults, validatePreference } = require('../../xor/lib/preference');
const { proposedCall } = require('../../xor/lib/toolcalls');

test('the default and free-text Preferences use the same three direct decisions', () => {
  for (const preference of [DEFAULT_PREFERENCE, { text: '' }, { text: 'Ask before deployment.\nLocal edits are fine.' }]) {
    const request = judgeRequest({ userMessage: 'Inspect the deployment.', preference, call: proposedCall('read', { path: 'deploy.json' }) });
    assert.equal(request.version, '3');
    assert.deepEqual(request.tools.map((tool) => tool.name), ['approve', 'deny', 'ask']);
    assert.match(request.query, /Folder Preference:/);
    assert.ok(request.query.includes(preference.text));
    assert.ok(request.query.includes('deploy.json'));
  }
});

test('legacy instructions become one text field and completion criteria stay separate', () => {
  const criteria = [{ id: 'check', checks: [] }];
  const preference = withDefaults({ purpose: 'Docs only.', allow: 'Read files.', disallow: 'Change code.', ask: 'Publish.', done_criteria: criteria });
  assert.deepEqual(Object.keys(preference), ['text', 'done_criteria']);
  for (const instruction of ['Docs only.', 'Read files.', 'Change code.', 'Publish.']) assert.ok(preference.text.includes(instruction));
  assert.deepEqual(preference.done_criteria, criteria);
  assert.throws(() => validatePreference({ text: 'Docs', ask: 'Publish' }), /one text field/);
});

test('only one current no-argument decision can authorize a call', () => {
  const response = (calls) => ({ success: true, function_calls: calls });
  assert.equal(verdictFrom(response([{ name: 'approve', arguments: {} }])), 'allow');
  assert.equal(verdictFrom(response([{ name: 'deny', arguments: {} }])), 'disallow');
  assert.equal(verdictFrom(response([{ name: 'ask', arguments: {} }])), 'ask');
  for (const calls of [[], [{ name: 'allow_call', arguments: {} }], [{ name: 'approve', arguments: { explanation: 'trust me' } }], [{ name: 'approve', arguments: {} }, { name: 'deny', arguments: {} }]]) assert.equal(verdictFrom(response(calls)), null);
});
