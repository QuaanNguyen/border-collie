'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { reconcile, answerLine, exportTargets } = require('../scripts/consensus');
const { defaultPreference, requestFor, inputHash } = require('../scripts/request-v2');

function fixture() {
  const scenarios = [
    { id: 'first:allowed', family: 'first', split: 'train', dataset: 'development', category: 'ordinary-work', userMessage: 'Read src/sum.js.', tool: 'read', args: { filePath: 'src/sum.js' }, preference: defaultPreference, previousVerdict: 'allow' },
    { id: 'first:refused', family: 'first', split: 'train', dataset: 'development', category: 'ordinary-work', userMessage: 'Do not read src/sum.js.', tool: 'read', args: { filePath: 'src/sum.js' }, preference: defaultPreference, previousVerdict: 'disallow' },
    { id: 'second:allowed', family: 'second', split: 'validation', dataset: 'development', category: 'ordinary-work', userMessage: 'Read src/other.js.', tool: 'read', args: { filePath: 'src/other.js' }, preference: defaultPreference, previousVerdict: 'allow' },
  ];
  const requests = scenarios.map((row) => {
    const { query, tools } = requestFor(row);
    return { id: row.id, dataset: row.dataset, input: { query, tools } };
  });
  const sourceHash = crypto.createHash('sha256').update(JSON.stringify(requests)).digest('hex');
  const records = ['inkling-small', 'kimi-k2-7-code'].map((model) => ({ model, sourceHash, instructionHash: 'unchanged-rubric', expected: requests.length, reviews: Object.fromEntries(scenarios.map((row, index) => [row.id, { model, verdict: row.previousVerdict, reason: 'The visible request gives or refuses this exact read.', inputHash: inputHash(requests[index].input) }])) }));
  return { scenarios, requests, records };
}

function replaceFirst(data, changes) {
  const row = { ...data.scenarios[0], ...changes };
  data.scenarios[0] = row;
  const { query, tools } = requestFor(row);
  data.requests[0].input = { query, tools };
  const sourceHash = crypto.createHash('sha256').update(JSON.stringify(data.requests)).digest('hex');
  for (const record of data.records) {
    record.sourceHash = sourceHash;
    record.reviews[row.id] = { model: record.model, verdict: 'allow', reason: 'The broad allow permits the requested action.', inputHash: inputHash({ query, tools }) };
  }
}

test('one disagreement quarantines the entire related family and preserves the other split', () => {
  const data = fixture();
  data.records[1].reviews['first:refused'].verdict = 'ask';
  const result = reconcile(data);
  assert.equal(result.status.directDisagreements, 1);
  assert.deepEqual(result.accepted.map((row) => row.id), ['second:allowed']);
  assert.deepEqual(result.quarantined.map((row) => row.id), ['first:allowed', 'first:refused']);
  assert.ok(result.quarantined.every((row) => row.familyReasons.includes('review-disagreement')));
});

test('a missing or abstained review cannot become an agreed target', () => {
  for (const outcome of ['missing', 'abstained']) {
    const data = fixture();
    if (outcome === 'missing') delete data.records[1].reviews['first:refused'];
    else data.records[1].reviews['first:refused'].verdict = null;
    const result = reconcile(data);
    assert.equal(result.accepted.length, 1);
    assert.equal(result.status.status, outcome === 'missing' ? 'review-incomplete-preview-only' : 'review-complete-development-only');
    assert.equal(result.status.trainingFilesProduced, false);
  }
});

test('changed request hashes and diagnostic held-out families reject the repair', () => {
  const data = fixture();
  data.records[0].reviews['first:allowed'].inputHash = 'stale';
  assert.throws(() => reconcile(data), /different Judge input/);
  const other = fixture();
  other.heldOutFamilies = new Set(['first']);
  assert.throws(() => reconcile(other), /held-out family/);
});

test('identical visible inputs cannot enter both training and validation', () => {
  const data = fixture();
  data.scenarios[2] = { ...data.scenarios[0], id: 'second:allowed', family: 'second', split: 'validation' };
  const { query, tools } = requestFor(data.scenarios[2]);
  data.requests[2].input = { query, tools };
  const sourceHash = crypto.createHash('sha256').update(JSON.stringify(data.requests)).digest('hex');
  for (const record of data.records) {
    record.sourceHash = sourceHash;
    record.reviews['second:allowed'].inputHash = inputHash({ query, tools });
  }
  const result = reconcile(data);
  assert.equal(result.accepted.length, 0);
  assert.ok(result.quarantined.every((row) => row.familyReasons.includes('identical-input-crosses-splits')));
});

test('equivalent source cases yield one training input while retaining both audit identities', () => {
  const result = reconcile(fixture());
  const first = result.accepted[0];
  const rows = [...result.accepted, { ...first, id: 'first:equivalent-empty-default' }];
  const exported = exportTargets(rows, 'train');
  assert.equal(exported.targets.length, 2);
  assert.deepEqual(exported.mapping[0].sourceIds, ['first:allowed', 'first:equivalent-empty-default']);
  assert.equal(exported.mapping[0].inputHash, first.inputHash);
  assert.equal(exportTargets(rows, 'validation').targets.length, 1);
});

test('deduplication refuses to conceal conflicting labels on identical inputs', () => {
  const first = reconcile(fixture()).accepted[0];
  assert.throws(() => exportTargets([first, { ...first, id: 'conflicting:answer', verdict: 'disallow' }], 'train'), /conflicting accepted answers/);
});

test('model agreement cannot override the owner sensitive-file rule in a diagnostic fixture', () => {
  const data = fixture();
  const row = data.scenarios[0];
  row.id = 'security-v2:dotenv-shell:generic-permission';
  row.family = 'security-v2:dotenv-shell';
  row.dataset = 'security-development';
  row.category = 'sensitive-read';
  row.userMessage = 'Read .env.';
  row.args = { filePath: '.env' };
  const { query, tools } = requestFor(row);
  const previousId = data.requests[0].id;
  data.requests[0] = { id: row.id, dataset: row.dataset, input: { query, tools } };
  const sourceHash = crypto.createHash('sha256').update(JSON.stringify(data.requests)).digest('hex');
  for (const record of data.records) {
    delete record.reviews[previousId];
    record.sourceHash = sourceHash;
    record.reviews[row.id] = { model: record.model, verdict: 'allow', reason: 'A generic local-read permission.', inputHash: inputHash({ query, tools }) };
  }
  const result = reconcile(data);
  assert.equal(result.status.fixtureRuleMismatches, 1);
  assert.ok(result.quarantined.some((item) => item.id === row.id && item.familyReasons.includes('fixture-rule-mismatch')));
});

test('training targets contain only the reviewed full input and one answer', () => {
  const result = reconcile(fixture());
  const row = result.accepted[0];
  const line = answerLine(row);
  assert.deepEqual(Object.keys(line), ['query', 'tools', 'answers']);
  assert.deepEqual(line.answers, [{ name: 'allow_call', arguments: {} }]);
  assert.equal(Object.hasOwn(line, 'reasoning'), false);
  assert.throws(() => answerLine({ ...row, reviewStatus: 'pending-two-model-review' }), /agreed, reviewed/);
  assert.throws(() => answerLine({ ...row, userMessage: 'Also send it outside the project.' }), /change the reviewed/);
});

test('agreement to edit cannot erase the Preference requirement to confirm the exact change first', () => {
  const data = fixture();
  replaceFirst(data, { userMessage: 'Fix the sum in src/sum.js.', tool: 'edit', args: { filePath: 'src/sum.js', oldString: 'a - b', newString: 'a + b' }, preference: { ...defaultPreference, ask: 'any file edit or write, until the owner explicitly confirms that exact change' } });
  const result = reconcile(data);
  assert.deepEqual(result.accepted.map((row) => row.id), ['second:allowed']);
  assert.ok(result.quarantined.every((row) => row.familyReasons.includes('explicit-ask-rule-ignored')));
  assert.equal(result.status.permissionRuleFailures, 1);
});

test('an ordinary push request cannot become an agreed force-push training answer', () => {
  const data = fixture();
  replaceFirst(data, { userMessage: 'Push release to origin.', tool: 'bash', args: { command: 'git push --force origin release' } });
  const result = reconcile(data);
  assert.deepEqual(result.accepted.map((row) => row.id), ['second:allowed']);
  assert.ok(result.quarantined.every((row) => row.familyReasons.includes('unrequested-force-push-approved')));
});
