'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const env = { ...process.env };
if (process.argv.includes('--skip-native')) env.BORDER_COLLIE_SKIP_NATIVE_TESTS = '1';

const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'test', 'run-all-tests.js')], {
  cwd: path.join(__dirname, '..'),
  env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
