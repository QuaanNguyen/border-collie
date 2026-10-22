'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const artifacts = path.resolve(__dirname, '../artifacts');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const readRows = (name) => fs.readFileSync(path.join(artifacts, name), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const models = ['inkling-small', 'kimi-k2-7-code'];

function resolveReviews({ scenarios, requests, baseRecords, singleRequests, singleRecords, selection, resolvedAt }) {
  const sourceHash = hash(JSON.stringify(requests));
  const singleHash = hash(JSON.stringify(singleRequests));
  if (sourceHash !== selection.parentSourceHash || singleHash !== selection.sourceHash || singleRequests.length !== selection.cases) throw new Error('The selected recheck inputs changed');
  if (baseRecords.length !== 2 || singleRecords.length !== 2 || new Set(baseRecords.map((row) => row.model)).size !== 2) throw new Error('Two independent reviewers are required');
  const instructions = new Set([...baseRecords, ...singleRecords].map((row) => row.instructionHash));
  if (instructions.size !== 1) throw new Error('The review rubric changed during the singleton recheck');
  const scenarioMap = new Map(scenarios.map((row) => [row.id, row]));
  const requestMap = new Map(requests.map((row) => [row.id, row]));
  const selected = new Map(singleRequests.map((row) => [row.id, row]));
  if (scenarioMap.size !== scenarios.length || requestMap.size !== requests.length || selected.size !== singleRequests.length || scenarios.length !== requests.length) throw new Error('Candidate identifiers or counts are inconsistent');
  const families = new Set(selection.families);
  for (const row of scenarios) {
    if (selected.has(row.id) !== families.has(row.family)) throw new Error('A singleton recheck must replace every member of its preselected family');
    if (selected.has(row.id) && (row.dataset !== 'security-development' || row.category === 'shared-private-read')) throw new Error('Unresolved private access or original development entered the bounded control recheck');
  }
  for (const row of singleRequests) {
    const original = requestMap.get(row.id);
    if (!original || JSON.stringify(original.input) !== JSON.stringify(row.input) || hash(JSON.stringify(row.input)) !== scenarioMap.get(row.id)?.inputHash) throw new Error('A singleton recheck changed the original visible input');
  }
  const resolved = baseRecords.map((base) => {
    const single = singleRecords.find((record) => record.model === base.model);
    if (!single) throw new Error('Singleton reviewer identity differs from the complete audit');
    for (const [record, inputs, expectedHash] of [[base, requests, sourceHash], [single, singleRequests, singleHash]]) {
      if (record.status !== 'complete' || record.sourceHash !== expectedHash || record.expected !== inputs.length || Object.keys(record.reviews).length !== inputs.length) throw new Error('Both source reviews must be complete before resolution');
      for (const row of inputs) {
        const review = record.reviews[row.id];
        if (!review || review.model !== base.model || review.inputHash !== hash(JSON.stringify(row.input))) throw new Error('A review fingerprint or identity differs from its exact input');
      }
    }
    const reviews = Object.fromEntries(requests.map((row) => [row.id, selected.has(row.id) ? single.reviews[row.id] : base.reviews[row.id]]));
    return { ...base, set: 'priority-single-resolved', reviews, completed: requests.length, status: 'complete', updatedAt: resolvedAt, abstained: Object.values(reviews).filter((row) => row.verdict === null).length, changedFromPreviousVerdict: requests.filter((row) => row.previousVerdict && reviews[row.id].verdict !== row.previousVerdict).length, resolution: { resolvedAt, batchSourceRecordHash: hash(JSON.stringify(base)), singletonSourceRecordHash: hash(JSON.stringify(single)), replacedCases: selected.size, replacedFamilies: families.size, policy: 'Replace all members of the preselected families with their fresh independent singleton reviews, whether the outcome improves agreement or not.' } };
  });
  return resolved;
}

function build() {
  const scenarios = readRows('priority-candidate-scenarios.jsonl');
  const inputBytes = fs.readFileSync(path.join(artifacts, 'priority-candidate-requests.jsonl'));
  const requests = inputBytes.toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
  const singleRequests = readRows('priority-control-single-requests.jsonl');
  const selection = JSON.parse(fs.readFileSync(path.join(artifacts, 'priority-control-single-provenance.json'), 'utf8'));
  const baseFiles = models.map((model) => `review-priority-candidate-${model}.json`);
  const singleFiles = models.map((model) => `review-priority-control-single-${model}.json`);
  const baseRecords = baseFiles.map((name) => JSON.parse(fs.readFileSync(path.join(artifacts, name), 'utf8')));
  const singleRecords = singleFiles.map((name) => JSON.parse(fs.readFileSync(path.join(artifacts, name), 'utf8')));
  const provenanceFile = path.join(artifacts, 'priority-single-resolved-provenance.json');
  const existing = fs.existsSync(provenanceFile) ? JSON.parse(fs.readFileSync(provenanceFile, 'utf8')) : null;
  const resolvedAt = existing?.resolvedAt || new Date().toISOString();
  const resolved = resolveReviews({ scenarios, requests, baseRecords, singleRequests, singleRecords, selection, resolvedAt });
  const provenance = { schemaVersion: 1, resolvedAt, inputSourceHash: hash(JSON.stringify(requests)), inputFileSha256: hash(inputBytes), parentFiles: [...baseFiles, ...singleFiles].map((file) => ({ file, sha256: hash(fs.readFileSync(path.join(artifacts, file))) })), selectedFamilies: selection.families, replacedCases: selection.cases, policy: resolved[0].resolution.policy, visibleInputsChanged: false, targetLabelsSelectedByMajority: false, originalFilesWritten: false, solJobsSubmitted: 0 };
  const save = (name, body) => {
    const file = path.join(artifacts, name);
    if (fs.existsSync(file) && !fs.readFileSync(file).equals(Buffer.from(body))) throw new Error('Resolved review evidence cannot be replaced');
    if (!fs.existsSync(file)) fs.writeFileSync(file, body, { flag: 'wx' });
  };
  save('priority-single-resolved-provenance.json', JSON.stringify(provenance, null, 2) + '\n');
  save('priority-single-resolved-requests.jsonl', inputBytes);
  for (const record of resolved) save(`review-priority-single-resolved-${record.model}.json`, JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'complete-independent-singleton-resolution', replacedCases: selection.cases, replacedFamilies: selection.families.length, fullInputs: requests.length, visibleInputsChanged: false }));
  return resolved;
}

if (require.main === module) build();

module.exports = { resolveReviews, build };
