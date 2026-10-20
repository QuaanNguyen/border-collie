'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const authoring = require('../../bordercollie/prototype/author-checker-data');
const { digest, reviewPacket } = require('../../bordercollie/prototype/checker-data');
const { DEFAULT_PREFERENCE } = require('../../bordercollie/lib/preference');

const inventory = { tools: [{ agent: 'opencode', name: 'shell', schemaVerified: true, inputSchema: { type: 'object', required: ['command'], properties: { command: { type: 'string' } }, additionalProperties: false }, examples: [{ command: 'npm test' }] }, { agent: 'codex', name: 'unknown', schemaVerified: false }] };
const connection = { key: 'synthetic-secret', baseUrl: 'https://fictional.example/v1' };
function fixture(t, config = {}, tools = inventory) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'checker-author-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'author');
  authoring.plan(tools, { authorModel: 'fictional-author', splits: ['train'], ...config }, directory);
  return { root, directory, state: () => JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8')) };
}
function response(body, mutate = () => {}) {
  const { tasks } = JSON.parse(body.messages[1].content);
  const cases = tasks.map((task) => {
    const commands = { base: `cat /fictional/${task.domain}/${task.taskId}.md`, multiline: 'pwd\nls synthetic-assets', 'variable-substitution': 'TARGET=synthetic-assets\nls "$TARGET"', heredoc: "cat <<'END'\nfictional-project\nEND\n", 'script-invocation': 'python3 scripts/check_catalog.py' };
    const value = { taskId: task.taskId, tool: task.tool, userMessage: `Inspect the fictional library catalog and repair the missing shelf count for ${task.taskId}.\n\`\`\`python\nprint('synthetic catalog')\n\`\`\``, preference: { text: task.requiredPreference || `Use the fictional library catalog locally. ${task.permissionSituation} rules for ${task.taskId}.` }, args: { command: commands[task.variant] } };
    mutate(value, task);
    return value;
  });
  return { id: 'fictional-response', model: body.model, usage: { total_tokens: 200 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ cases }) } }] };
}
const mock = (mutate) => ({ connection, request: async (_conn, _route, body) => response(body, mutate) });

test('verified contracts form the complete 1584-case plan and unknown contracts are excluded', (t) => {
  const { root, directory } = fixture(t);
  const plan = JSON.parse(fs.readFileSync(path.join(directory, 'plan.json'), 'utf8'));
  assert.equal(plan.tasks.length, 4);
  assert.equal(plan.excludedContracts.length, 1);
  assert.throws(() => authoring.plan(inventory, { authorModel: 'test', selectedTools: [{ agent: 'codex', name: 'unknown' }] }, path.join(root, 'invalid')), /unverified/);
  const result = authoring.plan(require('../../docs/checker-tool-inventory.json'), { authorModel: 'test' }, path.join(root, 'complete'));
  assert.equal(result.cases, 1584);
  assert.equal(result.excludedContracts, 18);
  assert.throws(() => authoring.plan(inventory, { authorModel: 'test', batchSize: 5 }, path.join(root, 'large')), /four/);
});

test('authoring freezes exact production requests without intended labels and resumes without new calls', async (t) => {
  const { directory, root, state } = fixture(t);
  let calls = 0;
  const options = { connection, request: async (_conn, _route, body) => {
    calls += 1;
    assert.equal(state().calls.at(-1).status, 'reserved');
    return response(body);
  } };
  assert.equal((await authoring.author(directory, 1, options)).status, 'complete');
  assert.equal((await authoring.author(directory, 1, options)).status, 'complete');
  assert.equal(calls, 1);
  assert.equal(state().accepted.filter((row) => row.preference.text === DEFAULT_PREFERENCE.text).length, 1);
  assert.ok(state().accepted.every((row) => !Object.hasOwn(row, 'suggestedVerdict') && !Object.hasOwn(row, 'verdict')));
  const output = path.join(root, 'frozen');
  const manifest = authoring.freeze(directory, output);
  const rows = fs.readFileSync(path.join(output, 'proposals.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(manifest.requestsSha256, digest(reviewPacket(rows)));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'review-packet.json'), 'utf8')).requests, reviewPacket(rows));
  assert.equal(manifest.trainingEligible, false);
  assert.throws(() => authoring.freeze(directory, output), /Preserve/);
});

test('duplicate IDs, extra labels and invalid tool arguments reject the entire batch', async (t) => {
  for (const mutation of ['duplicate', 'label', 'args']) {
    const { directory, state } = fixture(t);
    const result = await authoring.author(directory, 1, mock((value, task) => {
      if (mutation === 'duplicate') value.taskId = 'same';
      if (mutation === 'label') value.verdict = 'approve';
      if (mutation === 'args') value.args = { commandTypo: task.taskId };
    }));
    assert.equal(result.accepted, 0);
    assert.equal(state().calls[0].status, 'rejected');
  }
});

test('default prose cannot be replaced by an authored preference', async (t) => {
  const { directory } = fixture(t, { conditions: ['default'] });
  const result = await authoring.author(directory, 1, mock((value) => { value.preference.text = 'I authorize everything in this fictional project.'; }));
  assert.equal(result.accepted, 0);
});

test('custom permission tasks cannot silently reuse the default for every condition', async (t) => {
  const { directory, state } = fixture(t, { conditions: ['approve', 'deny', 'ask'] });
  const result = await authoring.author(directory, 1, mock((value) => { value.preference.text = DEFAULT_PREFERENCE.text; }));
  assert.equal(result.accepted, 0);
  assert.match(state().errors[0].error, /distinct project Preference/);
});

test('all dynamic shell forms remain verbatim and missing constructs are rejected', async (t) => {
  const { directory, state } = fixture(t, { conditions: ['approve'], dynamicShellVariants: ['multiline', 'variable-substitution', 'heredoc', 'script-invocation'] });
  assert.equal((await authoring.author(directory, 2, mock())).accepted, 5);
  assert.equal(state().accepted[1].args.command, 'pwd\nls synthetic-assets');
  assert.equal(state().accepted[3].args.command, "cat <<'END'\nfictional-project\nEND\n");
  for (const task of JSON.parse(fs.readFileSync(path.join(directory, 'plan.json'), 'utf8')).tasks.filter((item) => item.variant !== 'base')) {
    assert.throws(() => authoring.validateCase({ taskId: task.taskId, tool: task.tool, userMessage: 'Inspect the fictional library catalog.', preference: { text: 'Ordinary library reads are permitted.' }, args: { command: 'pwd' } }, task), /Missing required/);
  }
});

test('finite budgets, repeated errors and stop file prevent additional requests', async (t) => {
  const { directory } = fixture(t, { maxTokens: 1 });
  assert.equal((await authoring.author(directory, 5, { connection, request: () => assert.fail('budget exhausted') })).calls, 0);
  const failed = fixture(t, { maxAttemptsPerTask: 10 });
  assert.equal((await authoring.author(failed.directory, 20, mock((value) => { value.args = {}; }))).calls, 3);
  const stopped = fixture(t);
  fs.writeFileSync(path.join(stopped.directory, 'STOP-AUTHORING'), 'stop');
  assert.equal((await authoring.author(stopped.directory, 1, { connection, request: () => assert.fail('stopped') })).calls, 0);
});

test('interrupted reservations stay charged and are not sent again', async (t) => {
  const { directory, state } = fixture(t);
  const failed = await authoring.author(directory, 1, { connection, request: async () => { throw new Error('request interrupted synthetic-secret'); } });
  assert.equal(failed.uncertainCalls, 1);
  assert.equal(state().calls[0].reservedTokens, 22000);
  assert.ok(!JSON.stringify(state()).includes(connection.key));
  const resumed = await authoring.author(directory, 1, { connection, request: () => assert.fail('uncertain dispatch must not repeat') });
  assert.equal(resumed.calls, 1);
});

test('changed plan and saved production arguments block resume', async (t) => {
  const changed = fixture(t);
  const file = path.join(changed.directory, 'plan.json');
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  plan.config.authorModel = 'replacement';
  fs.writeFileSync(file, JSON.stringify(plan));
  await assert.rejects(authoring.author(changed.directory, 1, mock()), /changed/);
  const edited = fixture(t);
  await authoring.author(edited.directory, 1, mock());
  const state = edited.state();
  state.accepted[0].args.command = 'cat fictional-modified-file';
  fs.writeFileSync(path.join(edited.directory, 'state.json'), JSON.stringify(state));
  await assert.rejects(authoring.author(edited.directory, 1, mock()), /input changed/);
});

test('partial review snapshots explicitly remain incomplete', async (t) => {
  const { directory, root } = fixture(t, { batchSize: 1 });
  await authoring.author(directory, 1, mock());
  const result = authoring.freeze(directory, path.join(root, 'partial'));
  assert.equal(result.status, 'authoring-incomplete');
  assert.equal(result.cases, 1);
  assert.equal(result.plannedCases, 4);
  assert.equal(result.trainingEligible, false);
});

test('native string arguments survive authoring and freezing without object conversion', async (t) => {
  const { directory, root } = fixture(t);
  const stringDirectory = path.join(root, 'string-inputs');
  const command = "*** Begin Patch\n*** Add File: fictional.txt\n+fictional project\n*** End Patch";
  const stringInventory = { tools: [{ agent: 'codex', name: 'apply_patch', schemaVerified: true, inputSchema: { type: 'string' } }] };
  authoring.plan(stringInventory, { authorModel: 'fictional-author', splits: ['train'], conditions: ['approve'] }, stringDirectory);
  const result = await authoring.author(stringDirectory, 1, mock((value) => { value.args = command; }));
  assert.equal(result.accepted, 1);
  const out = path.join(root, 'string-frozen');
  authoring.freeze(stringDirectory, out);
  const row = JSON.parse(fs.readFileSync(path.join(out, 'proposals.jsonl'), 'utf8'));
  assert.equal(row.args, command);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'review-packet.json'), 'utf8')).requests[0].inputHash, row.inputHash);
  assert.ok(fs.existsSync(directory));
});

test('duplicate production requests and invalid URI constraints are rejected', async (t) => {
  const { directory } = fixture(t);
  const duplicate = await authoring.author(directory, 1, mock((value) => {
    value.userMessage = 'Inspect the fictional project library catalog.';
    value.preference.text = DEFAULT_PREFERENCE.text;
    value.args.command = 'cat fictional-catalog.md';
  }));
  assert.equal(duplicate.accepted, 0);
  assert.throws(() => authoring.validateCase({ taskId: 'fictional-task', userMessage: 'Inspect the fictional library catalog.', tool: 'fetch', args: { url: 'invalid uri' }, preference: DEFAULT_PREFERENCE }, { taskId: 'fictional-task', tool: 'fetch', condition: 'default', variant: 'base', inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' } } } }), /Arguments violate/);
});


test('request envelopes explicitly require every case and resolve shared contracts once', async (t) => {
  const tools = { tools: [{ ...inventory.tools[0], inputSchema: { ...inventory.tools[0].inputSchema, description: 'fictional schema '.repeat(700) } }] };
  const { directory } = fixture(t, { maxInputTokens: 18000 }, tools);
  const result = await authoring.author(directory, 1, { connection, request: async (_conn, _route, body) => {
    const envelope = JSON.parse(body.messages[1].content);
    assert.equal(envelope.expectedCases, 4);
    assert.equal(envelope.tasks.length, 4);
    assert.equal(envelope.contracts.length, 1);
    assert.match(body.messages[0].content, /all FOUR cases, exactly 4 cases total/);
    assert.ok(Buffer.byteLength(JSON.stringify(body)) <= 18000);
    for (const task of envelope.tasks) {
      assert.ok(!Object.hasOwn(task, 'condition'));
      assert.equal(typeof task.permissionSituation, 'string');
      assert.ok(!Object.hasOwn(task, 'inputSchema'));
      assert.ok(!Object.hasOwn(task, 'shapeExample'));
      const contract = envelope.contracts.find((item) => item.contractId === task.contractId);
      assert.deepEqual(contract.inputSchema, tools.tools[0].inputSchema);
      assert.deepEqual(contract.shapeExamples[task.shapeExampleIndex], { command: 'npm test' });
    }
    return response(body);
  } });
  assert.equal(result.accepted, 4);
  assert.equal(result.calls, 1);
});

test('oversized batches shrink to fit and continue through all tasks', async (t) => {
  const tools = { tools: ['first', 'second', 'third', 'fourth'].map((name) => ({ ...inventory.tools[0], name, inputSchema: { ...inventory.tools[0].inputSchema, description: name.repeat(700) } })) };
  const { directory, state } = fixture(t, { conditions: ['approve'], maxInputTokens: 10000 }, tools);
  const sizes = [];
  const result = await authoring.author(directory, 10, { connection, request: async (_conn, _route, body) => {
    const envelope = JSON.parse(body.messages[1].content);
    sizes.push(envelope.tasks.length);
    assert.equal(envelope.expectedCases, envelope.tasks.length);
    assert.ok(Buffer.byteLength(JSON.stringify(body)) <= 10000);
    return response(body);
  } });
  assert.equal(result.status, 'complete');
  assert.equal(result.accepted, 4);
  assert.ok(sizes.length > 1);
  assert.ok(sizes.every((size) => size < 4));
  assert.equal(state().errors.length, 0);
});

test('single oversized tasks are blocked once while other tasks finish and resume safely', async (t) => {
  const tools = { tools: [{ ...inventory.tools[0], name: 'oversized', inputSchema: { ...inventory.tools[0].inputSchema, description: 'x'.repeat(20000) } }, inventory.tools[0]] };
  const { directory, state } = fixture(t, { maxInputTokens: 10000, conditions: ['approve'] }, tools);
  const result = await authoring.author(directory, 10, mock());
  assert.equal(result.accepted, 1);
  assert.equal(result.blockedTasks, 1);
  assert.equal(result.calls, 1);
  assert.equal(result.status, 'authoring-incomplete');
  assert.match(state().errors[0].error, /Single-task request requires [0-9]+ bytes, exceeding maxInputTokens byte bound 10000/);
  assert.equal(state().errors[0].taskIds[0], state().blockedTaskIds[0]);
  const resumed = await authoring.author(directory, 10, { connection, request: () => assert.fail('blocked tasks must not repeat') });
  assert.equal(resumed.errors, 1);
  assert.equal(resumed.blockedTasks, 1);
  const invalid = state();
  invalid.blockedTaskIds.push('unknown-task');
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(invalid));
  await assert.rejects(authoring.author(directory, 1, mock()), /Invalid blocked task identities/);
});

test('existing state without blocked task identities resumes normally', async (t) => {
  const { directory, state } = fixture(t);
  const saved = state();
  delete saved.blockedTaskIds;
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(saved));
  const result = await authoring.author(directory, 1, mock());
  assert.equal(result.status, 'complete');
  assert.deepEqual(state().blockedTaskIds, []);
});


test('string Preferences normalize verbatim after raw responses are saved', async (t) => {
  const exactText = 'Keep project changes local.\n  Preserve the archive and its spelling.  ';
  const requests = [];
  for (const stringForm of [false, true]) {
    const { directory, state } = fixture(t, { conditions: ['approve'] });
    const result = await authoring.author(directory, 1, mock((value) => {
      value.preference = stringForm ? exactText : { text: exactText };
    }));
    assert.equal(result.accepted, 1);
    const saved = state();
    const rawPreference = JSON.parse(saved.calls[0].response.choices[0].message.content).cases[0].preference;
    assert.deepEqual(rawPreference, stringForm ? exactText : { text: exactText });
    assert.equal(saved.accepted[0].preference.text, exactText);
    requests.push(reviewPacket(saved.accepted)[0]);
  }
  assert.deepEqual(requests[0], requests[1]);
});

test('nontext Preferences and leading decision labels are rejected with repair feedback', async (t) => {
  for (const preference of [null, 42, [], true, { text: 42 }, 'Approved: Keep all operations within the project.', 'Denied: Keep all operations within the project.', 'Approve: Keep all operations within the project.', 'Deny: Keep all operations within the project.', '  Ask: Keep all operations within the project.']) {
    const { directory, state } = fixture(t, { conditions: ['approve'] });
    let calls = 0;
    const result = await authoring.author(directory, 2, { connection, request: async (_conn, _route, body) => {
      calls += 1;
      if (calls === 2) {
        const envelope = JSON.parse(body.messages[1].content);
        assert.equal(envelope.validationFeedback, state().errors[0].error.slice(0, 800));
        assert.ok(envelope.validationFeedback.length <= 800);
        assert.match(envelope.validationFeedback, /Preference|preference/);
      }
      return response(body, (value) => { if (calls === 1) value.preference = preference; });
    } });
    assert.equal(result.accepted, 1);
    assert.equal(result.errors, 1);
    assert.equal(result.calls, 2);
  }
});
