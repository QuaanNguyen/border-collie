'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultOwnerConfigDir() {
  return path.join(os.homedir(), '.config', 'opencode', 'border-collie');
}

function loadOwnerPolicy(configDir = process.env.BORDER_COLLIE_OWNER_CONFIG || defaultOwnerConfigDir()) {
  const policyPath = path.join(configDir, 'policy.json');
  if (!fs.existsSync(policyPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  } catch {
    return null;
  }
}

function ownerProtocol(policy) {
  if (!['research-safe', 'custom'].includes(policy?.setup_package)) return null;
  const protocol = {
    task: policy.setup_package === 'custom' ? 'Custom OpenCode session' : 'Research-safe OpenCode session',
    read_paths: ['**'],
    write_paths: ['**'],
    allow_ordinary_bash: true,
    deny_commands: ['curl', 'wget', 'nc', 'ncat', 'netcat', 'ssh', 'scp', 'rsync', 'ftp', 'telnet', 'powershell'],
    egress: [],
  };
  for (const field of [
    'task',
    'read_paths',
    'write_paths',
    'allow_commands',
    'command_allowlist',
    'allow_ordinary_bash',
    'allow_tools',
    'egress',
    'done_criteria',
    'protected_paths',
    'read_protected_paths',
  ]) {
    if (Object.hasOwn(policy, field)) protocol[field] = policy[field];
  }
  if (Object.hasOwn(policy, 'deny_commands')) {
    protocol.deny_commands = [...new Set([...protocol.deny_commands, ...policy.deny_commands])];
  }
  return protocol;
}

module.exports = { defaultOwnerConfigDir, loadOwnerPolicy, ownerProtocol };
