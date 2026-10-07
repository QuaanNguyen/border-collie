'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CONFIG_SCHEMA_VERSION, PET_SCALES, configPath, defaultConfigRoot, writeConfig } = require('../guard/lib/config');
const {
  DEFAULT_PREFERENCE,
  preferencePath,
  readJsonObject,
  retiredProtocolPaths,
  validatePreference,
} = require('../guard/lib/preference');

function retiredOwnerPolicyPath() {
  const dir = process.env.BORDER_COLLIE_OWNER_CONFIG || path.join(os.homedir(), '.config', 'opencode', 'border-collie');
  return path.join(dir, 'policy.json');
}

function readOrThrow(file, label) {
  const source = readJsonObject(file);
  if (source.error) throw new Error(`${label} at ${file} is unreadable (${source.error.message}). Fix or remove it, then run bdc migrate again. Nothing was changed.`);
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

function migrate(opts = {}) {
  const workdir = opts.workdir || process.cwd();
  const configRoot = opts.configRoot || defaultConfigRoot();
  const ownerPolicy = opts.ownerPolicyPath || retiredOwnerPolicyPath();

  const preferenceFile = preferencePath(workdir);
  const preference = readOrThrow(preferenceFile, 'The Preference');
  if (preference.exists) {
    try {
      validatePreference(preference.value);
    } catch (error) {
      throw new Error(`The Preference at ${preferenceFile} is invalid (${error.message}). Nothing was changed.`);
    }
  }
  const protocols = retiredProtocolPaths(workdir).map((file) => ({ file, source: readOrThrow(file, 'The retired Protocol') }));
  const doneCriteria = retiredDoneCriteria(protocols);
  const config = readOrThrow(configPath(configRoot), 'The Border Collie configuration');

  const report = { preferenceFile, wrotePreference: false, carriedDoneCriteria: 0, removed: [], configFile: null };

  const current = preference.exists ? preference.value : { ...DEFAULT_PREFERENCE };
  const next = { ...current };
  if (!next.done_criteria?.length && doneCriteria.length) {
    next.done_criteria = doneCriteria;
    report.carriedDoneCriteria = doneCriteria.length;
  }
  if (!preference.exists || report.carriedDoneCriteria) {
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

module.exports = { migrate, retiredOwnerPolicyPath };
