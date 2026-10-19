'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { requestFor, requestVersion, preferenceWithDefaults, inputHash } = require('./request-v3');
const { immutableSave } = require('./build-candidate');

const artifacts = path.resolve(__dirname, '../artifacts');
const readRows = (name) => fs.readFileSync(path.join(artifacts, name), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const encode = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n';

function build() {
  const previous = ['candidate-development-scenarios.jsonl', 'security-scenarios.jsonl'].flatMap(readRows);
  const scenarios = previous.map((row) => {
    const revised = { ...row, preference: preferenceWithDefaults(row.preference), requestFormatVersion: requestVersion, reviewStatus: 'pending-two-model-review' };
    revised.inputHash = inputHash(requestFor(revised));
    return revised;
  });
  const requests = scenarios.map((row) => {
    const { query, tools } = requestFor(row);
    return { id: row.id, dataset: row.dataset, previousVerdict: row.previousVerdict || null, input: { query, tools } };
  });
  const controls = requests.filter((row) => row.dataset === 'security-development');
  immutableSave('final-candidate-scenarios.jsonl', encode(scenarios));
  immutableSave('final-candidate-requests.jsonl', encode(requests));
  immutableSave('final-controls-requests.jsonl', encode(controls));
  immutableSave('final-candidate-provenance.json', JSON.stringify({ requestFormatVersion: requestVersion, scenarios: scenarios.length, originalDevelopmentCopies: scenarios.filter((row) => row.dataset === 'development').length, controls: controls.length, sourceSha256: crypto.createHash('sha256').update(encode(requests)).digest('hex'), originalJobInputsChanged: false, previousCandidateInputsChanged: false, previousReviewsReusable: false, modelTrainingPerformed: false, solJobsSubmitted: 0, changes: ['Explicit prohibition and ask-first precedence over broad allow.', 'Sensitive reads without specific Preference permission block rather than ask.', 'Default history changes are forbidden only when unauthorized.'] }, null, 2) + '\n');
  console.log(JSON.stringify({ version: requestVersion, scenarios: scenarios.length, controls: controls.length, earlierInputsPreserved: true }));
}

if (require.main === module) build();

module.exports = { build };
