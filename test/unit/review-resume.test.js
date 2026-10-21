'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { review } = require('../../xor/prototype/review-v2-pilot');
const { runtimeRequest } = require('../../xor/prototype/finetune-pipeline');

test('review service failures preserve completed decisions and stop new requests until a resume', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-review-resume-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const rows = [0, 1, 2, 3].map((index) => {
    const row = { id: `case-${index}`, tool: 'read', args: { path: `docs/${index}.md` }, userMessage: 'Read local docs.', preference: { purpose: 'Local work.', allow: 'Read requested docs.', disallow: 'Unrelated work.', ask: '' } };
    const { query, tools } = runtimeRequest(row);
    row.inputHash = crypto.createHash('sha256').update(JSON.stringify({ query, tools })).digest('hex');
    return row;
  });
  fs.writeFileSync(path.join(directory, 'scenarios.jsonl'), rows.map(JSON.stringify).join('\n') + '\n');
  let calls = 0;
  const connection = { key: 'fictional-key' };
  await assert.rejects(review(directory, 'fixture', 1, 1, { connection, chat: async () => {
    calls++;
    if (calls === 2) throw new Error('getaddrinfo ENOTFOUND fictional.example');
    return [{ verdict: 'allow', reason: 'Requested local read.' }];
  } }), /service connection failed/);
  assert.equal(calls, 2);
  const partial = JSON.parse(fs.readFileSync(path.join(directory, 'review-fixture.json')));
  assert.equal(partial.completed, 1);
  assert.equal(partial.errors.length, 1);
  calls = 0;
  await review(directory, 'fixture', 1, 1, { connection, chat: async () => { calls++; return [{ verdict: 'allow', reason: 'Requested local read.' }]; } });
  assert.equal(calls, 3);
  const resumed = JSON.parse(fs.readFileSync(path.join(directory, 'review-fixture.json')));
  assert.equal(resumed.completed, 4);
  assert.deepEqual(resumed.reviews['case-0'], partial.reviews['case-0']);
});
