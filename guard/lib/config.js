'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { policyConflicts, resolvePolicy } = require('./policy-resolution');

const BUILTIN_PROFILES = Object.freeze({
  casual: Object.freeze({
    label: 'Casual', requirements: ['preflight'],
    policy: { read_paths: ['**'], write_paths: ['**'], allow_ordinary_bash: true, done_criteria: [] },
  }),
  research: Object.freeze({
    label: 'Research', requirements: ['preflight', 'claims'],
    policy: { read_paths: ['**'], write_paths: ['**'], allow_ordinary_bash: true, done_criteria: [] },
  }),
  governed: Object.freeze({
    label: 'Governed', requirements: ['preflight', 'claims', 'exact-commands'], required_project_fields: ['write_paths'],
    policy: { read_paths: ['**'], write_paths: ['**'], allow_ordinary_bash: false, command_allowlist: [], done_criteria: [] },
  }),
});

function defaultConfigRoot() {
  return process.env.BORDER_COLLIE_CONFIG_ROOT || path.join(os.homedir(), '.config', 'border-collie');
}

function configPath(root = defaultConfigRoot()) {
  return path.join(root, 'config.json');
}

function defaultConfig() {
  return {
    schema_version: 2,
    pet: { scale: 1 },
    profiles: {},
    adapters: {
      opencode: { default_profile: 'research', allowed_project_profiles: ['research', 'governed'] },
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureArray(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${name} must be an array of strings`);
}

function assertPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('profile policy must be an object');
  if (Object.hasOwn(policy, 'allow_commands')) throw new Error('allow_commands is unsupported because Guard does not enforce it');
  for (const field of ['read_paths', 'write_paths', 'command_allowlist', 'allow_tools', 'egress', 'deny_commands', 'protected_paths', 'read_protected_paths']) {
    if (Object.hasOwn(policy, field)) ensureArray(policy[field], field);
  }
  if (Object.hasOwn(policy, 'allow_ordinary_bash') && typeof policy.allow_ordinary_bash !== 'boolean') throw new Error('allow_ordinary_bash must be a boolean');
}

function profile(config, name) {
  if (BUILTIN_PROFILES[name]) return clone({ name, builtin: true, ...BUILTIN_PROFILES[name] });
  const custom = config.profiles?.[name];
  if (!custom || typeof custom !== 'object' || !BUILTIN_PROFILES[custom.extends]) return null;
  assertPolicy(custom.policy || {});
  const base = BUILTIN_PROFILES[custom.extends];
  const conflicts = policyConflicts(base.policy, custom.policy || {});
  if (conflicts.length) throw new Error(`profile '${name}' broadens ${custom.extends} for ${conflicts.map((entry) => entry.field).join(', ')}`);
  return {
    name, builtin: false, extends: custom.extends, label: name,
    requirements: clone(base.requirements), required_project_fields: clone(base.required_project_fields || []),
    policy: resolvePolicy(base.policy, custom.policy || {}),
  };
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('configuration must be an object');
  if (config.schema_version !== 2) throw new Error('configuration schema_version must be 2');
  if (!config.profiles || typeof config.profiles !== 'object' || Array.isArray(config.profiles)) throw new Error('profiles must be an object');
  if (!config.adapters || typeof config.adapters !== 'object' || Array.isArray(config.adapters)) throw new Error('adapters must be an object');
  const scale = config.pet?.scale;
  if (!Number.isFinite(scale) || ![0.6, 0.75, 0.9, 1, 1.15, 1.35, 1.6, 2].includes(scale)) throw new Error('pet.scale must be a supported size');
  for (const name of Object.keys(config.profiles)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`invalid profile name '${name}'`);
    profile(config, name);
  }
  for (const [adapter, assignment] of Object.entries(config.adapters)) {
    if (!assignment || typeof assignment !== 'object') throw new Error(`adapter '${adapter}' must be an object`);
    if (!profile(config, assignment.default_profile)) throw new Error(`adapter '${adapter}' has an unknown default profile`);
    ensureArray(assignment.allowed_project_profiles || [], `adapter '${adapter}' allowed_project_profiles`);
    for (const name of assignment.allowed_project_profiles || []) {
      if (!profile(config, name)) throw new Error(`adapter '${adapter}' approves an unknown profile '${name}'`);
    }
  }
  return config;
}

function readConfig(root = defaultConfigRoot()) {
  const file = configPath(root);
  if (!fs.existsSync(file)) return { config: defaultConfig(), file, exists: false, error: null };
  try {
    const config = validateConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
    return { config, file, exists: true, error: null };
  } catch (error) {
    return { config: null, file, exists: true, error };
  }
}

function writeConfig(config, root = defaultConfigRoot()) {
  validateConfig(config);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = configPath(root);
  const temp = path.join(root, `.config-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
  return file;
}

function resolveAdapter(config, adapter, projectProfile = null, coverage = ['preflight', 'claims', 'exact-commands']) {
  const assignment = config.adapters?.[adapter];
  if (!assignment) return { active: false, reason: `adapter '${adapter}' is not configured` };
  const name = projectProfile || assignment.default_profile;
  if (projectProfile && !(assignment.allowed_project_profiles || []).includes(name)) {
    return { active: false, reason: `project profile '${name}' is not approved for ${adapter}` };
  }
  const selected = profile(config, name);
  if (!selected) return { active: false, reason: `profile '${name}' does not exist` };
  const missing = selected.requirements.filter((requirement) => !coverage.includes(requirement));
  if (missing.length) return { active: false, reason: `${adapter} has not proven coverage for ${missing.join(', ')}`, profile: selected };
  return { active: true, profile: selected, assignment };
}

module.exports = { BUILTIN_PROFILES, defaultConfigRoot, configPath, defaultConfig, readConfig, writeConfig, validateConfig, profile, resolveAdapter };
