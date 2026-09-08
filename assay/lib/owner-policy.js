'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultOwnerConfigDir() {
  return path.join(os.homedir(), '.config', 'opencode', 'rice');
}

function loadOwnerPolicy(configDir = process.env.RICE_OWNER_CONFIG || defaultOwnerConfigDir()) {
  const policyPath = path.join(configDir, 'policy.json');
  if (!fs.existsSync(policyPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  } catch {
    return null;
  }
}

function researchSafeProtocol(policy) {
  if (policy?.setup_package !== 'research-safe') return null;
  return {
    task: 'Research-safe OpenCode session',
    read_paths: ['**'],
    write_paths: ['**'],
    allow_ordinary_bash: true,
    deny_commands: ['curl', 'wget', 'nc', 'ncat', 'netcat', 'ssh', 'scp', 'rsync', 'ftp', 'telnet', 'powershell'],
    egress: [],
  };
}

module.exports = { defaultOwnerConfigDir, loadOwnerPolicy, researchSafeProtocol };
