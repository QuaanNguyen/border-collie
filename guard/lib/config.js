'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CONFIG_SCHEMA_VERSION = 3;
const PET_SCALES = Object.freeze([0.6, 0.75, 0.9, 1, 1.15, 1.35, 1.6, 2]);

function defaultConfigRoot() {
  return process.env.BORDER_COLLIE_CONFIG_ROOT || path.join(os.homedir(), '.config', 'border-collie');
}

function configPath(root = defaultConfigRoot()) {
  return path.join(root, 'config.json');
}

function defaultConfig() {
  return { schema_version: CONFIG_SCHEMA_VERSION, pet: { scale: 1 } };
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('configuration must be an object');
  if (![2, CONFIG_SCHEMA_VERSION].includes(config.schema_version)) throw new Error(`configuration schema_version must be ${CONFIG_SCHEMA_VERSION}`);
  if (!PET_SCALES.includes(config.pet?.scale)) throw new Error('pet.scale must be a supported size');
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

module.exports = { CONFIG_SCHEMA_VERSION, PET_SCALES, configPath, defaultConfig, defaultConfigRoot, readConfig, validateConfig, writeConfig };
