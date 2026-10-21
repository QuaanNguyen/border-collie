'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { LEGACY_DIRECTORY } = require('./legacy-paths');

const DEFAULT_PREFERENCE = Object.freeze({ text: "Work on the user's request in this folder. Ordinary local reads, edits, and commands that serve that request are approved. Do not send project contents off the machine or take destructive actions the user did not request. Ask the owner when permission is unclear." });
const LEGACY_DEFAULTS = Object.freeze({ purpose: "Software work in this folder for the user's request.", allow: "Ordinary local reads, edits, and commands inside this folder that serve the user's request.", disallow: "Sending project contents off the machine, and destructive actions the user's request did not ask for.", ask: '' });
const PROSE_FIELDS = Object.freeze(['purpose', 'allow', 'disallow', 'ask']);
const PREFERENCE_FIELDS = Object.freeze(['text', 'done_criteria', ...PROSE_FIELDS]);
const PREFERENCE_RELATIVE_PATH = '.xor/preference.json';
const LEGACY_PREFERENCE_RELATIVE_PATH = '.bordercollie/preference.json';
const RETIRED_PROTOCOL_RELATIVE_PATHS = Object.freeze(['.xor/protocol.json', '.bordercollie/protocol.json', `${LEGACY_DIRECTORY}/protocol.json`, '.opencode/protocol.json']);

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
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Preference must be an object');
  for (const field of Object.keys(value)) {
    if (!PREFERENCE_FIELDS.includes(field)) throw new Error(`'${field}' is not a Preference field; use text and done_criteria`);
  }
  for (const field of ['text', ...PROSE_FIELDS]) {
    if (Object.hasOwn(value, field) && typeof value[field] !== 'string') throw new Error(`'${field}' must be a string`);
  }
  if (Object.hasOwn(value, 'text') && PROSE_FIELDS.some((field) => Object.hasOwn(value, field))) throw new Error('Use one text field without the retired structured fields');
  if (Object.hasOwn(value, 'done_criteria') && !Array.isArray(value.done_criteria)) throw new Error("'done_criteria' must be an array");
}

function preferenceText(value) {
  if (typeof value === 'string') return value;
  validatePreference(value);
  if (Object.hasOwn(value, 'text')) return value.text;
  if (!PROSE_FIELDS.some((field) => Object.hasOwn(value, field))) return DEFAULT_PREFERENCE.text;
  const labels = { purpose: 'Purpose', allow: 'Approve', disallow: 'Deny', ask: 'Ask the owner before' };
  return PROSE_FIELDS.map((field) => {
    const text = Object.hasOwn(value, field) ? value[field] : LEGACY_DEFAULTS[field];
    return text ? `${labels[field]}: ${text}` : '';
  }).filter(Boolean).join('\n');
}

function withDefaults(value, doneCriteria = value.done_criteria || []) {
  return { text: preferenceText(value), done_criteria: doneCriteria };
}

function retiredDoneCriteria(workdir) {
  let first = null;
  let hasInstructions = false;
  const contents = [];
  for (const file of retiredProtocolPaths(workdir)) {
    const source = readJsonObject(file);
    if (!source.exists) continue;
    if (source.error) return { file, error: source.error, doneCriteria: [], contents: source.contents };
    const criteria = source.value.done_criteria;
    if (criteria !== undefined && !Array.isArray(criteria)) return { file, error: new Error("'done_criteria' must be an array"), doneCriteria: [], contents: source.contents };
    first ||= { file, error: null, doneCriteria: criteria || [] };
    hasInstructions ||= Object.keys(source.value).some((key) => key !== 'done_criteria');
    contents.push(source.contents);
  }
  return { ...(first || { file: null, error: null, doneCriteria: [] }), hasInstructions, contents: contents.length ? contents.join('\0') : 'missing' };
}

function readPreference(workdir) {
  const canonical = preferencePath(workdir);
  const legacy = path.join(workdir, LEGACY_PREFERENCE_RELATIVE_PATH);
  const file = !fs.existsSync(canonical) && fs.existsSync(legacy) ? legacy : canonical;
  const source = readJsonObject(file);
  if (file === canonical && fs.existsSync(legacy)) {
    const previous = readJsonObject(legacy);
    if (previous.error || source.error || JSON.stringify(previous.value) !== JSON.stringify(source.value)) {
      return { valid: false, fingerprint: fingerprint(`${source.contents}\0${previous.contents}`), file, preference: null, reason: 'Both Preference locations exist with different or unreadable instructions. Resolve them before continuing.' };
    }
  }
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
  if (retired.hasInstructions) return { valid: false, fingerprint: print, file: retired.file, preference: null, reason: 'Run xor migrate to preserve the previous project instructions before using the verifier.' };
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
  LEGACY_PREFERENCE_RELATIVE_PATH,
  RETIRED_PROTOCOL_RELATIVE_PATHS,
  createLivePreference,
  preferencePath,
  preferenceText,
  readJsonObject,
  readPreference,
  retiredProtocolPaths,
  validatePreference,
  withDefaults,
};
