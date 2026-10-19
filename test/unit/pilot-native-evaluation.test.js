'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { evaluate } = require('../../bordercollie/prototype/evaluate-pilot-native');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-native-evaluation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const weights = path.join(directory, 'model.cact');
  const runner = path.join(directory, 'runner');
  fs.writeFileSync(weights, 'model');
  fs.writeFileSync(runner, 'runner');
  const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const requests = [{ id: 'one', query: 'Exact complete input.', tools: [{ name: 'ask_owner' }], expected: 'ask', inputHash: 'frozen' }];
  const file = path.join(directory, 'validation-requests.jsonl');
  fs.writeFileSync(file, requests.map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(path.join(directory, 'study-plan.json'), JSON.stringify({ hashes: { 'validation-requests.jsonl': hash(file) }, evaluationSplits: ['validation'] }));
  return { directory, label: 'fixture', weights, runner, weightsSha256: hash(weights), runnerSha256: hash(runner) };
}

test('native evaluation preserves exact input, production deadline and suppressed Verdicts', async (t) => {
  const options = fixture(t);
  const result = await evaluate({ ...options, run: async (runner, args, settings) => {
    assert.equal(runner, options.runner);
    assert.equal(args[args.indexOf('--prompt') + 1], 'Exact complete input.');
    assert.equal(settings.timeout, 15000);
    assert.deepEqual(JSON.parse(fs.readFileSync(args[args.indexOf('--tools') + 1], 'utf8')), [{ name: 'ask_owner' }]);
    return { stdout: JSON.stringify({ success: true, function_calls: [], suppressed_calls: [{ name: 'ask_owner', arguments: {} }] }) };
  } });
  assert.equal(result.status, 'complete');
  assert.equal(result.rows[0].observed, 'ask');
  assert.equal(result.rows[0].inputHash, 'frozen');
  await assert.rejects(evaluate({ ...options, run: async () => assert.fail('must not replace a saved evaluation') }), /already exists/);
});

test('native evaluation rejects changed frozen inputs before inference', async (t) => {
  const options = fixture(t);
  fs.appendFileSync(path.join(options.directory, 'validation-requests.jsonl'), '{}\n');
  await assert.rejects(evaluate({ ...options, run: async () => assert.fail('changed inputs must not run') }), /Frozen evaluation input changed/);
});

test('native evaluation withholds conflicting Verdicts like the deployed runner boundary', async (t) => {
  const options = fixture(t);
  const result = await evaluate({ ...options, run: async () => ({ stdout: JSON.stringify({ success: true, function_calls: [{ name: 'allow_call' }, { name: 'block_call' }] }) }) });
  assert.equal(result.rows[0].observed, null);
});

test('native evaluation preserves timeout failure and withholds an observed Verdict', async (t) => {
  const options = fixture(t);
  await assert.rejects(evaluate({ ...options, run: async () => { throw new Error('timeout sentinel'); } }), /invalidates/);
  const evidence = JSON.parse(fs.readFileSync(path.join(options.directory, 'native-evaluations/fixture.json'), 'utf8'));
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.rows[0].observed, null);
  assert.equal(evidence.rows[0].infrastructureError, 'timeout sentinel');
});
