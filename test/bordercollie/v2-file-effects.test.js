'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createSession } = require('../../bordercollie/lib/session');
const { proposedCall } = require('../../bordercollie/lib/toolcalls');

test('V2 patches check every added, updated, moved and deleted path before execution', async (t) => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-v2-patch-'));
  t.after(() => fs.rmSync(workdir, { recursive: true, force: true }));
  for (const operation of ['*** Delete File: .bordercollie/preference.json', '*** Update File: src/main.js\n*** Move to: ../outside.js', '*** Add File: ../outside.js', '*** Update File: .bordercollie/preference.json']) {
    let judged = false;
    const session = createSession({ workdir, judge: async () => { judged = true; return { verdict: 'allow' }; } });
    const patchText = `*** Begin Patch\n*** Add File: docs/notes.md\n+Notes\n${operation}\n*** End Patch`;
    assert.equal((await session.propose({ tool: 'patch', args: { patchText }, userMessage: 'Update the notes.' })).decision, 'disallow');
    assert.equal(judged, false);
  }
  const call = proposedCall('patch', { patchText: '*** Begin Patch\n*** Update File: src/old.js\n*** Move to: src/new.js\n@@\n-old\n+new\n*** End Patch' });
  assert.deepEqual(call.readPaths, ['src/old.js']);
  assert.deepEqual(call.writePaths, ['src/old.js', 'src/new.js']);
});

test('V2 worktree targets preserve the project boundary and inspect force removal', async (t) => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-v2-worktree-'));
  t.after(() => fs.rmSync(workdir, { recursive: true, force: true }));
  const session = createSession({ workdir, judge: async ({ call }) => ({ verdict: call.args.force ? 'disallow' : 'allow' }) });
  for (const [tool, args, expected] of [
    ['worktree_list', {}, 'allow'],
    ['worktree_create', { name: 'repair' }, 'disallow'],
    ['worktree_remove', { directory: '../other', force: true }, 'disallow'],
    ['worktree_remove', { directory: 'worktrees/repair', force: false }, 'allow'],
    ['worktree_remove', { directory: 'worktrees/repair', force: true }, 'disallow'],
    ['worktree_remove', {}, 'disallow'],
    ['patch', { patchText: 'not a complete patch' }, 'disallow'],
  ]) assert.equal((await session.propose({ tool, args, userMessage: 'Inspect the worktrees.' })).decision, expected, tool);
});


test('Codex freeform patches retain their exact source and every affected path', () => {
  const patch = '*** Begin Patch\n*** Update File: src/parser.js\n@@\n-old\n+new\n*** Delete File: docs/old.md\n*** End Patch';
  const call = proposedCall('apply_patch', patch);
  assert.equal(call.args, patch);
  assert.equal(call.effectError, null);
  assert.deepEqual(call.writePaths, ['src/parser.js', 'docs/old.md']);
  assert.deepEqual(call.deletePaths, ['docs/old.md']);
});
