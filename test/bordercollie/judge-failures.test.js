'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const childProcess = require('node:child_process');
const { createBordercollieAdapter } = require('../../bordercollie/lib/adapter');
const { platformKey } = require('../../bordercollie/lib/judge-artifacts');
const { DEFAULT_PREFERENCE } = require('../../bordercollie/lib/preference');

test('runner failures withhold execution even when failed output contains an allow call', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-runner-failures-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runner = path.join(root, 'fixture', 'needle');
  fs.mkdirSync(path.dirname(runner));
  const weights = path.join(path.dirname(runner), 'needle3.cact');
  fs.writeFileSync(weights, 'fictional test model');
  const spawn = childProcess.spawn;
  t.mock.method(childProcess, 'spawn', (executable, args, options) => executable === runner ? spawn(process.execPath, [executable, ...args], options) : spawn(executable, args, options));
  const { createNeedleJudge } = require('../../bordercollie/lib/judge');
  const artifact = (file) => ({ path: path.basename(file), size: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
  const allowed = JSON.stringify({ success: true, function_calls: [{ name: 'approve', arguments: {} }] });
  for (const [mode, program] of [
    ['nonzero-with-allow', `process.stdout.write(${JSON.stringify(allowed)});process.exitCode=7;`],
    ['crash', 'process.exit(9);'],
    ['malformed', "process.stdout.write('not JSON');"],
    ['missing-verdict', "process.stdout.write(JSON.stringify({success:true,function_calls:[]}));"],
    ['conflicting-verdicts', "process.stdout.write(JSON.stringify({success:true,function_calls:[{name:'approve',arguments:{}},{name:'deny',arguments:{}}]}));"],
    ['timeout', 'setInterval(() => {}, 1000);'],
    ['startup', ''],
    ['missing-runner', ''],
  ]) {
    fs.writeFileSync(runner, program);
    const manifest = { revision: 'fixture', weights: artifact(weights), runners: { [platformKey()]: artifact(runner) } };
    if (mode === 'missing-runner') fs.unlinkSync(runner);
    const judge = createNeedleJudge({ root, manifest });
    if (mode === 'startup') t.mock.method(childProcess, 'spawn', (executable, args, options) => spawn(path.join(root, 'does-not-exist'), args, options));
    const bordercollie = createBordercollieAdapter({ workdir: root, preference: DEFAULT_PREFERENCE, judge });
    if (mode === 'timeout') t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = bordercollie.proposedAction({ tool: 'shell', args: { command: 'touch side-effect.txt' }, userMessage: 'Create the local marker.' });
    if (mode === 'timeout') {
      await new Promise(setImmediate);
      t.mock.timers.tick(15000);
    }
    const result = await pending;
    if (mode === 'timeout') t.mock.timers.reset();
    if (result.decision === 'allow') fs.writeFileSync(path.join(root, 'side-effect.txt'), 'unexpected execution');
    assert.equal(result.decision, 'disallow', mode);
    assert.equal(fs.existsSync(path.join(root, 'side-effect.txt')), false, mode);
    judge.dispose();
    t.mock.restoreAll();
    t.mock.method(childProcess, 'spawn', (executable, args, options) => executable === runner ? spawn(process.execPath, [executable, ...args], options) : spawn(executable, args, options));
  }
});

test('an ask always withholds the action and hands back for owner confirmation', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-unsupported-ask-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bordercollie = createBordercollieAdapter({ workdir: root, preference: DEFAULT_PREFERENCE, judge: async () => ({ verdict: 'ask' }) });
  assert.equal((await bordercollie.proposedAction({ tool: 'read', args: { path: 'notes.txt' }, userMessage: 'Read notes.' })).decision, 'ask');
});
