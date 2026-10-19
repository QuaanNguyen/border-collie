'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { requestFor, requestVersion, preferenceWithDefaults, inputHash } = require('./request-v4');
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
  const diagnosticIds = new Set(scenarios.filter((row) => row.dataset === 'security-development').map((row) => row.id));
  const selected = new Set();
  for (const row of scenarios.filter((item) => item.dataset === 'development')) {
    const key = [row.preference.ask, row.tool, row.category, row.previousVerdict].join('|');
    if (selected.has(key)) continue;
    selected.add(key);
    diagnosticIds.add(row.id);
  }
  const probe = requests.filter((row) => diagnosticIds.has(row.id));
  immutableSave('priority-candidate-scenarios.jsonl', encode(scenarios));
  immutableSave('priority-candidate-requests.jsonl', encode(requests));
  immutableSave('priority-probe-requests.jsonl', encode(probe));
  immutableSave('priority-candidate-provenance.json', JSON.stringify({ requestFormatVersion: requestVersion, scenarios: scenarios.length, originalDevelopmentCopies: 3000, controls: 336, diagnosticProbe: probe.length, sourceSha256: crypto.createHash('sha256').update(encode(requests)).digest('hex'), originalJobInputsChanged: false, earlierCandidateInputsChanged: false, earlierReviewsReusable: false, exactProbeReviewsReusable: true, modelTrainingPerformed: false, solJobsSubmitted: 0, changes: ['Explicit prohibition and ask-first precedence over broad allow.', 'Sensitive reads without specific Preference permission block rather than ask.', 'Default history changes are forbidden only when unauthorized.', 'State the complete sensitive rule once without clipping messages or actions.'] }, null, 2) + '\n');
  console.log(JSON.stringify({ version: requestVersion, scenarios: scenarios.length, diagnosticProbe: probe.length, earlierInputsPreserved: true }));
}

if (require.main === module) build();

module.exports = { build };
