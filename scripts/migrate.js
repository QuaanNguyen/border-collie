'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CONFIG_SCHEMA_VERSION, PET_SCALES, configPath, defaultConfigRoot, writeConfig } = require('../xor/lib/config');
const {
  DEFAULT_PREFERENCE,
  preferencePath,
  readJsonObject,
  retiredProtocolPaths,
  validatePreference,
  withDefaults,
} = require('../xor/lib/preference');

function retiredOwnerPolicyPath() {
  if (process.env.XOR_OWNER_CONFIG) return path.join(process.env.XOR_OWNER_CONFIG, 'policy.json');
  const xorDir = path.join(os.homedir(), '.config', 'opencode', 'xor');
  return path.join(xorDir, 'policy.json');
}

function readOrThrow(file, label) {
  const source = readJsonObject(file);
  if (source.error) throw new Error(`${label} at ${file} is unreadable (${source.error.message}). Fix or remove it, then run xor migrate again. Nothing was changed.`);
  return source;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temp, file);
}

function retiredDoneCriteria(protocols) {
  const first = protocols.find(({ source }) => source.exists);
  if (!first) return [];
  const criteria = first.source.value.done_criteria;
  if (criteria === undefined) return [];
  if (!Array.isArray(criteria)) throw new Error(`done_criteria in ${first.file} must be an array. Nothing was changed.`);
  return criteria;
}

function preservedInstructions(sources) {
  const labels = { task: 'Project purpose', read_paths: 'Read only these path patterns', write_paths: 'Write only these path patterns', command_allowlist: 'Permit these exact commands', deny_commands: 'Deny these commands', allow_tools: 'Permit these tools', egress: 'Permit network access only to these destinations', protected_paths: 'Never modify these paths', read_protected_paths: 'Never read these paths' };
  return sources.filter(({ source }) => source.exists).flatMap(({ source }) => Object.entries(source.value).filter(([key]) => key !== 'done_criteria').map(([key, value]) => `${labels[key] || `Preserved owner setting ${key}`}: ${typeof value === 'string' ? value : JSON.stringify(value)}.`)).join('\n');
}

function migratePreference(opts = {}) {
  const workdir = opts.workdir || process.cwd();
  const configRoot = opts.configRoot || defaultConfigRoot();
  const ownerPolicy = opts.ownerPolicyPath || retiredOwnerPolicyPath();

  const preferenceFile = preferencePath(workdir);
  const preference = readOrThrow(preferenceFile, 'The Preference');
  const sourcePreference = preference;
  if (sourcePreference.exists) {
    try {
      validatePreference(sourcePreference.value);
    } catch (error) {
      throw new Error(`The Preference at ${preferenceFile} is invalid (${error.message}). Nothing was changed.`);
    }
  }
  const protocols = retiredProtocolPaths(workdir).map((file) => ({ file, source: readOrThrow(file, 'The retired Protocol') }));
  const doneCriteria = retiredDoneCriteria(protocols);
  const config = readOrThrow(configPath(configRoot), 'The xor configuration');
  const owner = readOrThrow(ownerPolicy, 'The retired owner policy');

  const report = { preferenceFile, wrotePreference: false, carriedDoneCriteria: 0, removed: [], configFile: null };

  const current = sourcePreference.exists ? sourcePreference.value : { ...DEFAULT_PREFERENCE };
  const next = withDefaults(current);
  const previousConfig = { ...config, value: Object.fromEntries(Object.entries(config.value || {}).filter(([key]) => !['schema_version', 'pet'].includes(key))) };
  const instructions = preservedInstructions([...protocols, { source: owner }, { source: previousConfig }]);
  if (instructions) next.text += '\n\nContinue to enforce these previous owner instructions:\n' + instructions;
  if (!next.done_criteria?.length && doneCriteria.length) {
    next.done_criteria = doneCriteria;
    report.carriedDoneCriteria = doneCriteria.length;
  }
  if (!preference.exists || report.carriedDoneCriteria || JSON.stringify(preference.value) !== JSON.stringify(next)) {
    writeJson(preferenceFile, next);
    report.wrotePreference = true;
  }

  for (const { file, source } of protocols) {
    if (!source.exists) continue;
    fs.rmSync(file, { force: true });
    report.removed.push(file);
  }

  if (config.exists) {
    const scale = PET_SCALES.includes(config.value.pet?.scale) ? config.value.pet.scale : 1;
    const petOnly = { schema_version: CONFIG_SCHEMA_VERSION, pet: { scale } };
    if (JSON.stringify(config.value) !== JSON.stringify(petOnly)) {
      report.configFile = writeConfig(petOnly, configRoot);
    }
  }

  if (fs.existsSync(ownerPolicy)) {
    fs.rmSync(ownerPolicy, { force: true });
    report.removed.push(ownerPolicy);
  }

  return report;
}

function migrate(opts = {}) {
  const result = migratePreference(opts);
  return result;
}

module.exports = { migrate, retiredOwnerPolicyPath };
