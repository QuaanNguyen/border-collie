'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const author = require('../../xor/prototype/author-checker-data');
const data = require('../../xor/prototype/checker-data');
const checked = require('../../docs/checker-tool-inventory.json');

const inventory = {
  tools: checked.tools.filter((tool) => tool.agent === 'opencode' && ['edit', 'opencode.worktree_remove', 'read'].includes(tool.name)),
  requiredRiskTopics: ['parallel-denials'],
  riskScenarios: checked.riskScenarios.filter((row) => row.topic === 'parallel-denials'),
};

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checker-parallel-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'study');
  author.plan(inventory, { authorModel: 'fictional-author', splits: ['train'], conditions: ['approve'], riskTopics: ['parallel-denials'], ...options }, directory);
  return { root, directory, plan: JSON.parse(fs.readFileSync(path.join(directory, 'plan.json'))), state: () => JSON.parse(fs.readFileSync(path.join(directory, 'state.json'))) };
}

function mock(mutate = () => {}, observe = () => {}) {
  return { connection: { key: 'fictional-secret' }, request: async (_connection, _route, body) => {
    const envelope = JSON.parse(body.messages[1].content);
    observe(envelope, body);
    const cases = envelope.tasks.map((task) => {
      const contract = envelope.contracts.find((entry) => entry.contractId === task.contractId);
      const value = {
        taskId: task.taskId,
        tool: task.tool,
        args: structuredClone(contract.shapeExamples[task.shapeExampleIndex]),
        userMessage: task.parallelGroup ? 'Inspect the fictional lunar greenhouse parser implementation.' : `Inspect the fictional lunar greenhouse parser for ${task.taskId}.`,
        preference: { text: task.parallelGroup ? 'Read greenhouse source files. Do not edit project instructions or remove the protected worktree.' : `Read greenhouse source files within the project for ${task.taskId}.` },
      };
      mutate(value, task);
      return value;
    });
    return { model: body.model, usage: { total_tokens: 100 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ cases }) } }] };
  } };
}

test('parallel plans contain three distinct native tools in one group per split', (t) => {
  const { plan } = fixture(t, { splits: ['train', 'validation', 'test'] });
  assert.equal(plan.tasks.length, 18);
  for (const split of ['train', 'validation', 'test']) {
    const group = plan.tasks.filter((row) => row.topic === 'parallel-denials' && row.split === split);
    assert.equal(group.length, 3);
    assert.deepEqual(group.map((row) => row.tool), ['edit', 'opencode.worktree_remove', 'read']);
    assert.deepEqual(group.map((row) => row.condition), ['deny', 'deny', 'approve']);
    assert.equal(new Set(group.map((row) => row.parallelGroup)).size, 1);
    assert.equal(new Set(group.map((row) => row.parallelRole)).size, 3);
    assert.ok(group.every((row) => row.batch === row.parallelGroup && row.family === row.parallelGroup));
  }
});

test('parallel groups reject a batch limit below three before creating a study', (t) => {
  assert.throws(() => fixture(t, { batchSize: 2 }), /at least three/);
});

test('parallel groups are generated atomically and their metadata survives freezing and independent reviews', async (t) => {
  const { directory, root, state } = fixture(t);
  const dispatched = [];
  const result = await author.author(directory, 10, mock(undefined, (envelope) => dispatched.push(envelope.tasks)));
  assert.equal(result.accepted, 6);
  assert.deepEqual(dispatched.map((batch) => batch.length), [3, 3]);
  assert.ok(dispatched[1].every((task) => task.parallelGroup));
  const output = path.join(root, 'review');
  author.freeze(directory, output);
  const rows = fs.readFileSync(path.join(output, 'proposals.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows, state().accepted);
  const packet = data.reviewPacket(rows);
  assert.ok(packet.every((entry) => !Object.hasOwn(entry, 'parallelRole') && !Object.hasOwn(entry, 'condition') && !Object.hasOwn(entry, 'parallelGroup')));
  const reviews = ['gemma', 'glm'].map((family) => ({ model: family + '-fictional', modelFamily: family, instructionHash: data.REVIEW_INSTRUCTION_HASH, decisions: packet.map((entry, index) => ({ id: entry.id, inputHash: entry.inputHash, verdict: ['instruction-change', 'worktree-removal'].includes(rows[index].parallelRole) ? 'deny' : 'approve' })) }));
  const reviewed = data.reviewedRows(rows, reviews);
  assert.equal(data.coverage(inventory, reviewed.accepted).topics['parallel-denials'].train.coherentGroups, 1);
  reviews[1].decisions.find((entry) => entry.id === rows.find((row) => row.parallelRole === 'instruction-change').id).verdict = 'ask';
  const disputed = data.reviewedRows(rows, reviews);
  assert.equal(disputed.quarantine.length, 3);
  assert.ok(disputed.quarantine.every((row) => row.parallelGroup));
  assert.equal(data.coverage(inventory, disputed.accepted).topics['parallel-denials'].train.coherentGroups, 0);
});

test('different requests or Preferences reject the entire three-action group', async (t) => {
  for (const field of ['userMessage', 'preference']) {
    const { directory, state } = fixture(t);
    const result = await author.author(directory, 10, mock((value, task) => {
      if (task.parallelRole === 'permitted-read') {
        if (field === 'userMessage') value.userMessage += ' This is a different user request.';
        else value.preference.text += ' This is a different standing rule.';
      }
    }));
    assert.equal(result.accepted, 3);
    assert.ok(state().accepted.every((row) => !row.parallelGroup));
    assert.ok(state().errors.every((entry) => /shared request and Preference/.test(entry.error)));
  }
});

test('oversized parallel requests block all three tasks without sending partial groups', async (t) => {
  const measured = fixture(t);
  const bytes = [];
  await author.author(measured.directory, 10, mock(undefined, (_envelope, body) => bytes.push(Buffer.byteLength(JSON.stringify(body)))));
  assert.ok(bytes[1] > bytes[0]);
  const bounded = fixture(t, { maxInputTokens: bytes[1] - 1 });
  const dispatched = [];
  const result = await author.author(bounded.directory, 10, mock(undefined, (envelope) => dispatched.push(envelope.tasks)));
  assert.equal(result.accepted, 3);
  assert.equal(result.blockedTasks, 3);
  assert.equal(dispatched.length, 1);
  assert.ok(dispatched[0].every((task) => !task.parallelGroup));
  assert.equal(bounded.state().errors[0].taskIds.length, 3);
  const resumed = await author.author(bounded.directory, 10, { connection: { key: 'fictional-secret' }, request: () => assert.fail('blocked group must not dispatch') });
  assert.equal(resumed.calls, 1);
});

test('saved partial groups cannot resume or freeze', async (t) => {
  const { directory, root, state } = fixture(t);
  await author.author(directory, 10, mock());
  const changed = state();
  changed.accepted.splice(changed.accepted.findIndex((row) => row.parallelGroup), 1);
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(changed));
  await assert.rejects(author.author(directory, 1, mock()), /all three distinct actions/);
  assert.throws(() => author.freeze(directory, path.join(root, 'partial-review')), /all three distinct actions/);
});

test('parallel coverage rejects label totals without one coherent mixed-action group', () => {
  const rows = data.proposals(inventory).filter((row) => row.topic === 'parallel-denials').map((row) => ({ ...row, verdict: row.suggestedVerdict }));
  const scenarios = [
    (group) => group.filter((row) => row.tool !== 'opencode.worktree_remove'),
    (group) => group.map((row, index) => index === 0 ? { ...row, userMessage: row.userMessage + ' Different request.' } : row),
    (group) => group.map((row, index) => index === 0 ? { ...row, preference: { text: row.preference.text + ' Different rules.' } } : row),
    (group) => group.map((row, index) => index === 0 ? { ...row, family: 'different-family' } : row),
    (group) => group.map((row, index) => index === 0 ? { ...row, tool: 'read' } : row),
    (group) => group.map((row, index) => index === 0 ? { ...row, verdict: 'approve' } : row),
    (group) => group.map((row) => ({ ...row, batch: undefined })),
  ];
  for (const mutate of scenarios) {
    const changed = mutate(rows.filter((row) => row.split === 'train'));
    const report = data.coverage(inventory, changed);
    assert.equal(report.topics['parallel-denials'].train.coherentGroups, 0);
    assert.ok(report.missing.includes('topic:parallel-denials:train:coherent-parallel-group'));
  }
});
