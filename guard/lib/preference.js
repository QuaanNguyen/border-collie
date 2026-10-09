'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PREFERENCE = Object.freeze({
  purpose: "Software work in this folder for the user's request.",
  allow: "Ordinary local reads, edits, and commands inside this folder that serve the user's request.",
  disallow: "Sending project contents off the machine, and destructive actions the user's request did not ask for.",
  ask: '',
});

const PROSE_FIELDS = Object.freeze(['purpose', 'allow', 'disallow', 'ask']);
const PREFERENCE_FIELDS = Object.freeze([...PROSE_FIELDS, 'done_criteria']);
const PREFERENCE_RELATIVE_PATH = '.border-collie/preference.json';
const RETIRED_PROTOCOL_RELATIVE_PATHS = Object.freeze(['.border-collie/protocol.json', '.opencode/protocol.json']);

function preferencePath(workdir) {
  return path.join(workdir, PREFERENCE_RELATIVE_PATH);
}

function retiredProtocolPaths(workdir) {
  return RETIRED_PROTOCOL_RELATIVE_PATHS.map((relative) => path.join(workdir, relative));
}

function fingerprint(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function readJsonObject(file) {
  if (!fs.existsSync(file)) return { exists: false, contents: 'missing', value: null, error: null };
  let contents;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { exists: true, contents: `read-error:${error.message}`, value: null, error };
  }
  try {
    const value = JSON.parse(contents);
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('it must be a JSON object');
    return { exists: true, contents, value, error: null };
  } catch (error) {
    return { exists: true, contents, value: null, error };
  }
}

function validatePreference(value) {
  for (const field of Object.keys(value)) {
    if (!PREFERENCE_FIELDS.includes(field)) throw new Error(`'${field}' is not a Preference field; use ${PREFERENCE_FIELDS.join(', ')}`);
  }
  for (const field of PROSE_FIELDS) {
    if (Object.hasOwn(value, field) && typeof value[field] !== 'string') throw new Error(`'${field}' must be a string`);
  }
  if (Object.hasOwn(value, 'done_criteria') && !Array.isArray(value.done_criteria)) throw new Error("'done_criteria' must be an array");
}

function withDefaults(value, doneCriteria = value.done_criteria || []) {
  const preference = {};
  for (const field of PROSE_FIELDS) preference[field] = Object.hasOwn(value, field) ? value[field] : DEFAULT_PREFERENCE[field];
  preference.done_criteria = doneCriteria;
  return preference;
}

function retiredDoneCriteria(workdir) {
  for (const file of retiredProtocolPaths(workdir)) {
    const source = readJsonObject(file);
    if (!source.exists) continue;
    if (source.error) return { file, error: source.error, doneCriteria: [], contents: source.contents };
    const criteria = source.value.done_criteria;
    if (criteria !== undefined && !Array.isArray(criteria)) {
      return { file, error: new Error("'done_criteria' must be an array"), doneCriteria: [], contents: source.contents };
    }
    return { file, error: null, doneCriteria: criteria || [], contents: source.contents };
  }
  return { file: null, error: null, doneCriteria: [], contents: 'missing' };
}

function readPreference(workdir) {
  const file = preferencePath(workdir);
  const source = readJsonObject(file);
  const retired = source.exists ? null : retiredDoneCriteria(workdir);
  const print = fingerprint(`${source.contents}\0${retired ? retired.contents : ''}`);

  if (source.error) {
    return { valid: false, fingerprint: print, file, preference: null, reason: `the Preference at ${file} is unreadable: ${source.error.message}` };
  }
  if (source.exists) {
    try {
      validatePreference(source.value);
    } catch (error) {
      return { valid: false, fingerprint: print, file, preference: null, reason: `the Preference at ${file} is invalid: ${error.message}` };
    }
    return { valid: true, fingerprint: print, file, source: 'file', preference: withDefaults(source.value, source.value.done_criteria || []), reason: null };
  }
  if (retired.error) {
    return { valid: false, fingerprint: print, file: retired.file, preference: null, reason: `the retired Protocol at ${retired.file} is unreadable: ${retired.error.message}` };
  }
  return { valid: true, fingerprint: print, file, source: 'default', preference: withDefaults({}, retired.doneCriteria), reason: null };
}

function createLivePreference({ workdir }) {
  let current = null;
  let revision = 0;

  function refresh() {
    const next = readPreference(workdir);
    if (current && current.fingerprint === next.fingerprint) return { ...current, changed: false };
    if (next.valid) revision += 1;
    current = { ...next, revision };
    return { ...current, changed: true };
  }

  return { refresh };
}

module.exports = {
  DEFAULT_PREFERENCE,
  PREFERENCE_RELATIVE_PATH,
  RETIRED_PROTOCOL_RELATIVE_PATHS,
  createLivePreference,
  preferencePath,
  readJsonObject,
  readPreference,
  retiredProtocolPaths,
  validatePreference,
  withDefaults,
};
