'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const artifacts = path.resolve(__dirname, '../artifacts');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const readRows = (name) => fs.readFileSync(path.join(artifacts, name), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const scenarios = readRows('priority-candidate-scenarios.jsonl');
const requests = readRows('priority-candidate-requests.jsonl');
const quarantineBytes = fs.readFileSync(path.join(artifacts, 'priority-consensus-quarantine.jsonl'));
const quarantine = quarantineBytes.toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
const selectedFamilies = new Set(quarantine.filter((row) => row.dataset === 'security-development' && !row.familyReasons.includes('third-party-sharing-authority-unresolved')).map((row) => row.family));
const selectedScenarios = scenarios.filter((row) => selectedFamilies.has(row.family));
if (selectedScenarios.some((row) => row.dataset !== 'security-development')) throw new Error('The bounded recheck must contain only control families');
const selectedIds = new Set(selectedScenarios.map((row) => row.id));
const selectedMap = new Map(selectedScenarios.map((row) => [row.id, row]));
const selectedRequests = requests.filter((row) => selectedIds.has(row.id));
if (selectedRequests.length !== selectedIds.size || selectedRequests.length === 0) throw new Error('The bounded recheck selection is inconsistent');
const destination = path.join(artifacts, 'priority-control-single-requests.jsonl');
const bytes = selectedRequests.map((row) => JSON.stringify(row)).join('\n') + '\n';
const provenance = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  purpose: 'Independently recheck all members of preselected disputed security families with one visible request per API call; no prior verdict or reason is sent.',
  parentSourceHash: hash(JSON.stringify(requests)),
  parentQuarantineSha256: hash(quarantineBytes),
  sourceHash: hash(JSON.stringify(selectedRequests)),
  requestFileSha256: hash(bytes),
  families: [...selectedFamilies].sort(),
  cases: selectedRequests.length,
  batchSize: 1,
  inputHashesUnchanged: selectedRequests.every((row) => hash(JSON.stringify(row.input)) === selectedMap.get(row.id).inputHash),
  thirdPartyPrivateScopeExcluded: true,
  modelTrainingPerformed: false,
  solJobsSubmitted: 0,
};
if (!provenance.inputHashesUnchanged) throw new Error('A recheck changed the exact input');
if (fs.existsSync(destination) && fs.readFileSync(destination, 'utf8') !== bytes) throw new Error('The preselected singleton recheck must not be regenerated');
if (!fs.existsSync(destination)) fs.writeFileSync(destination, bytes, { flag: 'wx' });
fs.writeFileSync(path.join(artifacts, 'priority-control-single-provenance.json'), JSON.stringify(provenance, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ cases: provenance.cases, families: provenance.families.length, batchSize: 1, inputHashesUnchanged: true }));
