'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createNeedleJudge } = require('../../guard/lib/judge');
const { platformKey } = require('../../guard/lib/judge-artifacts');
const { DEFAULT_PREFERENCE } = require('../../guard/lib/preference');
const { proposedCall } = require('../../guard/lib/toolcalls');

test('native evaluation can pin workers without changing default runtime arguments or verdict parsing', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-workers-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'test-workers');
  fs.mkdirSync(directory);
  const recorded = path.join(root, 'arguments.json');
  const runner = path.join(directory, 'needle');
  const weights = path.join(directory, 'needle3.cact');
  fs.writeFileSync(runner, '#!/usr/bin/env node\n' + `require('node:fs').writeFileSync(${JSON.stringify(recorded)}, JSON.stringify(process.argv.slice(2))); process.stdout.write(JSON.stringify({ success: true, function_calls: [{ name: 'allow_call', arguments: {} }] }));\n`);
  fs.chmodSync(runner, 0o755);
  fs.writeFileSync(weights, 'test weights');
  const artifact = (file) => ({ path: path.basename(file), size: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
  const manifest = { revision: 'test-workers', weights: artifact(weights), runners: { [platformKey()]: artifact(runner) } };
  const input = { userMessage: 'Read a.txt', preference: DEFAULT_PREFERENCE, call: proposedCall('read', { path: 'a.txt' }) };
  const defaults = createNeedleJudge({ manifest, root });
  const configured = createNeedleJudge({ manifest, root, threads: 4 });
  const invalid = createNeedleJudge({ manifest, root, threads: 0 });
  t.after(() => { defaults.dispose(); configured.dispose(); invalid.dispose(); });
  assert.equal((await defaults(input)).verdict, 'allow');
  const defaultArguments = JSON.parse(fs.readFileSync(recorded, 'utf8'));
  assert.equal(defaultArguments.includes('--threads'), false);
  assert.equal((await configured(input)).verdict, 'allow');
  const configuredArguments = JSON.parse(fs.readFileSync(recorded, 'utf8'));
  assert.deepEqual(configuredArguments.filter((_, index) => index !== 3), [...defaultArguments.filter((_, index) => index !== 3), '--threads', '4']);
  await assert.rejects(invalid(input), /positive integer/);
});
