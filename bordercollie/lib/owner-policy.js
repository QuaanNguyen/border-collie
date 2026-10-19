'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { existingDirectory } = require('./legacy-paths');
const { readConfig, resolveAdapter } = require('./config');

function defaultOwnerConfigDir() {
  return existingDirectory(path.join(os.homedir(), '.config', 'opencode', 'bordercollie'), path.join(os.homedir(), '.config', 'opencode', 'border-collie'));
}

function loadOwnerPolicy(configDir = process.env.BORDERCOLLIE_OWNER_CONFIG || process.env.BORDER_COLLIE_OWNER_CONFIG || defaultOwnerConfigDir()) {
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

function resolveOwnerPolicy(adapter = 'opencode') {
  const canonical = readConfig();
  if (canonical.error) return { active: false, reason: `bordercollie configuration is invalid: ${canonical.error.message}`, file: canonical.file };
  if ((canonical.exists || process.env.BORDERCOLLIE_CONFIG_ROOT) && !process.env.BORDERCOLLIE_OWNER_CONFIG) {
    const resolved = resolveAdapter(canonical.config, adapter);
    if (!resolved.active) return { ...resolved, file: canonical.file };
    return { ...resolved, active: true, protocol: resolved.profile.policy, file: canonical.file, canonical: true };
  }
  const legacy = loadOwnerPolicy();
  return { active: true, protocol: ownerProtocol(legacy), legacy: true, file: legacy ? path.join(process.env.BORDERCOLLIE_OWNER_CONFIG || process.env.BORDER_COLLIE_OWNER_CONFIG || defaultOwnerConfigDir(), 'policy.json') : null };
}

function resolveProjectOwnerPolicy(adapter, projectProfile) {
  const canonical = readConfig();
  if (canonical.error) return { active: false, reason: `bordercollie configuration is invalid: ${canonical.error.message}`, file: canonical.file };
  if ((canonical.exists || process.env.BORDERCOLLIE_CONFIG_ROOT) && !process.env.BORDERCOLLIE_OWNER_CONFIG) {
    const resolved = resolveAdapter(canonical.config, adapter, projectProfile);
    if (!resolved.active) return { ...resolved, file: canonical.file };
    return { ...resolved, active: true, protocol: resolved.profile.policy, file: canonical.file, canonical: true };
  }
  if (projectProfile) return { active: false, reason: 'project profile selection requires canonical bordercollie configuration' };
  const legacy = loadOwnerPolicy();
  return { active: true, protocol: ownerProtocol(legacy), legacy: true, file: legacy ? path.join(process.env.BORDERCOLLIE_OWNER_CONFIG || process.env.BORDER_COLLIE_OWNER_CONFIG || defaultOwnerConfigDir(), 'policy.json') : null };
}

module.exports = { defaultOwnerConfigDir, loadOwnerPolicy, ownerProtocol, resolveOwnerPolicy, resolveProjectOwnerPolicy };
