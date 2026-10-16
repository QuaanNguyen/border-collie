'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { DEFAULT_PREFERENCE } = require('../../bordercollie/lib/preference');
const pipeline = require('../../bordercollie/prototype/finetune-pipeline');

test('V2 shell proposals pass the same intake and observed-failure checks as live calls', () => {
  const task = pipeline.generationPlan().find((item) => item.failure === 'package-install' && item.variant === 1);
  const proposal = { taskId: task.id, userMessage: 'Install lodash for the requested repair.', tool: 'shell', args: { command: 'npm install lodash' }, verdict: task.verdict };
  const converted = pipeline.convertProposals([proposal], [task], 'inkling-small');
  assert.equal(converted.scenarios.length, 1, JSON.stringify(converted.rejected));
  const scenario = converted.scenarios[0];
  const result = pipeline.intake({ scenarios: [scenario], labels: { [scenario.id]: scenario.verdict }, workdir: process.cwd() });
  assert.equal(result.accepted.length, 1, JSON.stringify(result.dropped));
  assert.match(pipeline.trainingLines(result.accepted).train[0].query, /shell/);
});

test('V2 draft preparation preserves source evidence and withholds historical answers', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-scenario-drafts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.jsonl');
  const output = path.join(root, 'draft');
  const row = (id, tool, args) => ({
    id, family: id, category: 'ordinary-local', userMessage: 'Repair the project.',
    preference: DEFAULT_PREFERENCE, tool, args, verdict: 'allow',
    query: 'old request', independentReview: { verdict: 'allow', inputHash: 'old hash' },
  });
  const scenarios = [
    row('command', 'bash', { command: 'npm test' }),
    row('new-file', 'write', { filePath: 'docs/result.md', content: 'Result' }),
    row('dispatch', 'task', { description: 'Explore', prompt: 'Read the project.' }),
    row('worktree', 'worktree_remove', { directory: '../other', force: true }),
    row('conflicting-paths', 'read', { filePath: 'src/a.js', path: 'src/b.js' }),
  ];
  const original = scenarios.map(JSON.stringify).join('\n') + '\n';
  fs.writeFileSync(source, original);
  const script = path.resolve(__dirname, '../../bordercollie/prototype/prepare-v2-scenario-drafts.js');
  const result = spawnSync(process.execPath, [script, source, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(source, 'utf8'), original);
  const drafts = fs.readFileSync(path.join(output, 'scenarios.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(drafts.map(({ tool, args }) => ({ tool, args })), [
    { tool: 'shell', args: { command: 'npm test' } },
    { tool: 'write', args: { path: 'docs/result.md', content: 'Result' } },
  ]);
  for (const draft of drafts) {
    assert.equal(Object.hasOwn(draft, 'verdict'), false);
    assert.equal(Object.hasOwn(draft, 'independentReview'), false);
    assert.equal(Object.hasOwn(draft, 'query'), false);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'requires-fresh-review');
  assert.equal(manifest.draftCount, 2);
  assert.equal(manifest.excludedCount, 3);
  assert.equal(manifest.records[0].previousVerdict, 'allow');
  assert.notEqual(manifest.records[0].originalRequestHash, manifest.records[0].draftRequestHash);
  const intake = pipeline.intake({ scenarios: drafts, labels: { command: 'allow', 'new-file': 'allow' }, workdir: root });
  assert.equal(intake.accepted.length, 0);
  assert.throws(() => pipeline.trainingLines(drafts.map((draft) => ({ ...draft, split: 'train' }))), /Verdict/i);
  const rerun = spawnSync(process.execPath, [script, source, output], { encoding: 'utf8' });
  assert.notEqual(rerun.status, 0);
  assert.equal(fs.readFileSync(source, 'utf8'), original);
});
