'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const env = { ...process.env };
const skipNative = process.argv.includes('--skip-native');
if (skipNative) env.BORDER_COLLIE_SKIP_NATIVE_TESTS = '1';
if (process.env.CI === 'true') env.BORDER_COLLIE_SKIP_OPENCODE_E2E = env.BORDER_COLLIE_SKIP_OPENCODE_E2E || '1';

const tests = [
  'opencode-session.test.js',
];
if (!skipNative) tests.push('renderer-events.test.js', 'lifecycle-harness.js', 'pet-window-focus.test.js');

const selected = tests.filter((file) => file !== 'opencode-session.test.js' || env.BORDER_COLLIE_SKIP_OPENCODE_E2E !== '1');

if (!selected.length) process.exit(0);

const result = spawnSync(process.execPath, selected.map((file) => path.join(__dirname, '..', 'test', 'e2e', file)), {
  cwd: path.join(__dirname, '..'),
  env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
