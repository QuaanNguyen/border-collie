'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { profiles, materialize } = require('../../xor/prototype/evaluation-preferences');
const { runtimeRequest } = require('../../xor/prototype/finetune-pipeline');

test('an independent author cannot introduce contradictory Preference prose into a fixed-contract evaluation', () => {
  const action = { tool: 'shell', args: { command: 'env' }, userMessage: 'List only variable names.', preferenceId: 'environment' };
  assert.equal(materialize({ ...action, preference: { allow: 'Read every secret.', disallow: 'Read no secrets.', ask: 'Ask before everything.' } }), null);
  assert.equal(materialize({ ...action, preferenceId: 'invented-profile' }), null);
  assert.equal(materialize({ ...action, preferenceId: '__proto__' }), null);
  const canonical = materialize(action);
  assert.equal(canonical.preference, profiles.environment);
  assert.equal(Object.hasOwn(action, 'preference'), false);
  const request = runtimeRequest(canonical);
  assert.ok(request.tools.some((tool) => tool.description.includes(profiles.environment.disallow)));
  assert.ok(Object.values(profiles).every(Object.isFrozen));
});
