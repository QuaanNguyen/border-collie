'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { finalize } = require('../../xor/prototype/isolated-evaluation');
const { profiles } = require('../../xor/prototype/evaluation-preferences');
const { runtimeRequest } = require('../../xor/prototype/finetune-pipeline');

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-isolated-evaluation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'training');
  const directory = path.join(root, 'evaluation');
  fs.mkdirSync(source);
  fs.mkdirSync(directory);
  const batches = Array.from({ length: 8 }, (_, batch) => Array.from({ length: 9 }, (_, index) => ({
    userMessage: `Display the local status for sample ${batch}/${index}.`,
    tool: 'shell',
    args: { command: `printf '%s\\n' 'sample ${batch}/${index}'` },
    preference: profiles.development,
    verdict: ['allow', 'disallow', 'ask'][index % 3],
    rationale: 'Fixture proposal, never a verified label.',
    familySummary: `Sample family ${batch}/${Math.floor(index / 3)}`,
  })));
  const trainingInput = runtimeRequest(batches[0][0]);
  fs.writeFileSync(path.join(source, 'requests.jsonl'), JSON.stringify({ id: 'training', input: trainingInput }) + '\n');
  const sourceNames = ['../lib/judge.js', '../lib/toolcalls.js', '../lib/boundary.js', 'finetune-pipeline.js'];
  const manifest = {
    status: 'authoring-isolated-evaluation',
    sourceHashes: Object.fromEntries(sourceNames.map((name) => [name, digest(fs.readFileSync(path.resolve(__dirname, '../../xor/prototype', name)))])),
    trainingProposalRequestsSha256: digest(fs.readFileSync(path.join(source, 'requests.jsonl'))),
    fixedPreferences: true,
    profilesSha256: digest(JSON.stringify(profiles)),
  };
  const persist = () => {
    save(path.join(directory, 'isolation.json'), manifest);
    batches.forEach((cases, index) => save(path.join(directory, `private-author-${index}.json`), { cases }));
  };
  persist();
  return { source, directory, batches, manifest, persist };
}

test('persisted independent author batches resume locally and quarantine overlap and conflicting duplicate families', (t) => {
  const data = fixture(t);
  data.batches[2][0] = { ...data.batches[1][0], verdict: 'disallow', familySummary: data.batches[2][0].familySummary };
  data.batches[4][0] = { ...data.batches[3][0], familySummary: data.batches[4][0].familySummary };
  data.persist();
  const manifest = finalize(data.source, data.directory);
  assert.equal(manifest.rows, 62);
  assert.equal(manifest.status, 'frozen-inputs-awaiting-independent-and-human-labels');
  const rows = fs.readFileSync(path.join(data.directory, 'scenarios.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(new Set(rows.map((row) => row.inputHash)).size, rows.length);
  for (const batch of [0, 1, 2]) for (const index of [0, 1, 2]) assert.ok(!rows.some((row) => row.id === `isolated-${batch}-${index}`));
  assert.ok(rows.some((row) => row.id === 'isolated-3-0'));
  assert.ok(!rows.some((row) => row.id === 'isolated-4-0'));
  assert.ok(rows.some((row) => row.id === 'isolated-4-1'));
  const exclusions = JSON.parse(fs.readFileSync(path.join(data.directory, 'duplicate-exclusions.json')));
  assert.equal(exclusions.duplicates.length, 3);
  assert.equal(exclusions.excludedFamilies.length, 3);
  assert.ok(!fs.existsSync(path.join(data.directory, 'human-verdicts.json')));
  assert.throws(() => finalize(data.source, data.directory), /Preserve an existing frozen/);
});

test('isolated evaluation refuses changed training inputs, request sources and fixed rules before freezing', (t) => {
  for (const change of ['training', 'source', 'rules']) {
    const data = fixture(t);
    if (change === 'training') fs.appendFileSync(path.join(data.source, 'requests.jsonl'), '\n');
    if (change === 'source') data.manifest.sourceHashes['../lib/judge.js'] = 'different';
    if (change === 'rules') data.batches[0][0].preference = { ...profiles.development, allow: 'Different permission.' };
    data.persist();
    assert.throws(() => finalize(data.source, data.directory), /changed|contract changed/);
    assert.ok(!fs.existsSync(path.join(data.directory, 'scenarios.jsonl')));
  }
});
