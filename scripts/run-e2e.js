'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const env = { ...process.env };
const skipNative = process.argv.includes('--skip-native');
if (skipNative) env.BORDER_COLLIE_SKIP_NATIVE_TESTS = '1';

const tests = [
  'renderer-events.test.js',
];
if (!skipNative) tests.push('pet-window-focus.test.js');

const result = spawnSync(process.execPath, tests.map((file) => path.join(__dirname, '..', 'test', 'e2e', file)), {
  cwd: path.join(__dirname, '..'),
  env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
