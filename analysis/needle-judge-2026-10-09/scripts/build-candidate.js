'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { requestVersion, preferenceWithDefaults, requestFor, inputHash } = require('./request-v2');

const workspace = path.resolve(__dirname, '..');
const destination = path.join(workspace, 'artifacts');
const fingerprint = (text) => crypto.createHash('sha256').update(text).digest('hex');
const readRows = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);

function immutableSave(name, text) {
  const file = path.join(destination, name);
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== text) throw new Error('Existing candidate inputs differ: ' + name);
    return;
  }
  fs.writeFileSync(file, text, { flag: 'wx' });
}

function build(name = 'candidate-development') {
  fs.mkdirSync(destination, { recursive: true });
  const source = path.join(workspace, 'snapshot/guard/prototype/data/stage2/accepted.jsonl');
  const development = readRows(source);
  const changed = development.map((row) => {
    const { query: previousSavedQuery, independentReview: previousReview, verdict: previousVerdict, ...fields } = row;
    const preference = preferenceWithDefaults(row.preference);
    const { query, tools } = requestFor({ ...row, preference });
    return { ...fields, preference, dataset: 'development', previousVerdict, previousReview, previousSavedQuery, requestFormatVersion: requestVersion, inputHash: inputHash({ query, tools }), reviewStatus: 'pending-two-model-review' };
  });
  const requests = changed.map((row) => {
    const { query, tools } = requestFor(row);
    return { id: row.id, dataset: row.dataset, previousVerdict: row.previousVerdict, input: { query, tools } };
  });
  const encode = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  immutableSave(name + '-scenarios.jsonl', encode(changed));
  immutableSave(name + '-requests.jsonl', encode(requests));
  immutableSave(name + '-provenance.json', JSON.stringify({ schemaVersion: 1, requestFormatVersion: requestVersion, source: path.relative(workspace, source), sourceSha256: fingerprint(fs.readFileSync(source)), candidateSha256: fingerprint(encode(changed)), requestsSha256: fingerprint(encode(requests)), count: changed.length, allReviewsInvalidated: true, heldOutUsedForTraining: false, trainingLinesBuilt: false, sourceFilesChanged: false, confirmationForSensitiveReads: 'Owner confirmed: permit only the exact sensitive-file read after specific Preference permission and explicit approval.' }, null, 2) + '\n');
  console.log(JSON.stringify({ candidateScenarios: changed.length, askAvailableOnEveryRequest: requests.every((row) => row.input.tools.some((tool) => tool.name === 'ask_owner')), sourceFilesChanged: false, trainingLinesBuilt: false }, null, 2));
}

if (require.main === module) build();

module.exports = { build, immutableSave };
