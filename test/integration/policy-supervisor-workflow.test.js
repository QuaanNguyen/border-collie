'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const suites = [
  'integration/research-safe-session.test.js',
  'integration/project-policy-location.test.js',
  'integration/policy-narrowing.test.js',
  'integration/policy-conflict.test.js',
  'integration/invalid-project-policy.test.js',
  'integration/cross-root-enforcement.test.js',
  'integration/protected-paths.test.js',
  'integration/denial-remediation.test.js',
  'integration/subagent-policy.test.js',
  'integration/install-plugin.test.js',
];

for (const suite of suites) {
  execFileSync(process.execPath, [path.join(ROOT, 'test', suite)], { cwd: ROOT, stdio: 'inherit' });
}

console.log('policy-supervisor workflow verified');
