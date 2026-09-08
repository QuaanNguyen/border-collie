'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const suites = [
  'research-safe-session.test.js',
  'project-policy-location.test.js',
  'policy-narrowing.test.js',
  'policy-conflict.test.js',
  'invalid-project-policy.test.js',
  'cross-root-enforcement.test.js',
  'protected-paths.test.js',
  'denial-remediation.test.js',
  'install-plugin.test.js',
];

for (const suite of suites) {
  execFileSync(process.execPath, [path.join(ROOT, 'test', suite)], { cwd: ROOT, stdio: 'inherit' });
}

console.log('policy-supervisor workflow verified');
