'use strict';

const assert = require('node:assert');
const { SCHEMA_VERSION } = require('../../events');
const { createDevHarness } = require('../../pet/dev-harness');

const harness = createDevHarness();
const scenarios = harness.scenarios();

assert.deepStrictEqual(
  scenarios.map((scenario) => scenario.id),
  ['thinking', 'allowed', 'refused', 'complete', 'incomplete', 'ask', 'error', 'size-115', 'size-100'],
);

for (const scenario of scenarios) {
  const event = harness.trigger(scenario.id);
  assert.strictEqual(event.v, SCHEMA_VERSION);
  assert.strictEqual(event.seq, scenarios.indexOf(scenario) + 1);
  assert.match(event.runId, /^pet-dev-/);
  assert.ok(event.type);
  assert.ok(event.petState);
}

assert.deepStrictEqual(harness.trigger('size-115').detail, { action: 'size', scale: 1.15, percent: 115 });
assert.strictEqual(harness.trigger('missing'), null);

process.stdout.write('ok - Pet development scenarios use production Event stream entries\n');
