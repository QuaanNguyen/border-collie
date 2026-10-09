'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { requestFor, inputHash } = require('./request-v4');

const workspace = path.resolve(__dirname, '..');
const artifacts = path.join(workspace, 'artifacts');
const prefix = process.argv[2] || 'priority-single-consensus';
if (!['priority-consensus', 'priority-single-consensus'].includes(prefix)) throw new Error('Unknown repaired freeze');
const readRows = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const status = JSON.parse(fs.readFileSync(path.join(artifacts, prefix + '-status.json'), 'utf8'));
if (status.status !== 'review-complete-development-only' || !status.trainingFilesProduced || !status.freezeDirectory) throw new Error('A complete repaired development freeze is required');
const directory = path.resolve(workspace, status.freezeDirectory);
if (!directory.startsWith(path.join(artifacts, 'repaired') + path.sep)) throw new Error('The data freeze must stay within this analysis');
const provenance = JSON.parse(fs.readFileSync(path.join(directory, 'provenance.json'), 'utf8'));
if (JSON.stringify(provenance) !== JSON.stringify(status)) throw new Error('The freeze provenance differs from its complete reconciliation');
for (const record of provenance.frozenFiles) {
  const file = path.join(directory, record.file);
  const bytes = fs.readFileSync(file);
  if (hash(bytes) !== record.sha256 || bytes.length !== record.bytes) throw new Error('A repaired file fingerprint changed');
  if (fs.statSync(file).mode & 0o222) throw new Error('A repaired freeze file is still writable');
}
const accepted = readRows(path.join(directory, 'accepted.jsonl'));
const quarantine = readRows(path.join(directory, 'quarantine.jsonl'));
if (accepted.length !== provenance.provisionallyAccepted || quarantine.length !== provenance.quarantined) throw new Error('The frozen case counts differ');
const expectedTools = { allow: 'allow_call', ask: 'ask_owner', disallow: 'block_call' };
const heldOut = readRows(path.join(workspace, 'snapshot/guard/prototype/data/stage2/held-out.jsonl'));
const heldOutIds = new Set(heldOut.map((row) => row.id));
const heldOutFamilies = new Set(heldOut.map((row) => row.family));
const quarantinedFamilies = new Set(quarantine.map((row) => row.family));
const splitFamilies = new Map();
const splitInputs = new Map();
const splitCounts = {};
const exportMapping = readRows(path.join(directory, 'export-map.jsonl'));
for (const split of ['train', 'validation']) {
  const sourceScenarios = accepted.filter((row) => row.split === split);
  for (const row of sourceScenarios) {
    if (heldOutIds.has(row.id) || heldOutFamilies.has(row.family) || quarantinedFamilies.has(row.family)) throw new Error('A held-out or excluded family entered an accepted split');
    if (splitFamilies.has(row.family) && splitFamilies.get(row.family) !== split) throw new Error('A related family crosses development splits');
    splitFamilies.set(row.family, split);
  }
  const scenarioMap = new Map(sourceScenarios.map((row) => [row.id, row]));
  const mappings = exportMapping.filter((row) => row.split === split);
  const coveredIds = new Set(mappings.flatMap((row) => row.sourceIds));
  if (coveredIds.size !== sourceScenarios.length || sourceScenarios.some((row) => !coveredIds.has(row.id))) throw new Error('The deduplicated export lost source traceability');
  const scenarios = mappings.map((row) => scenarioMap.get(row.sourceIds[0]));
  const targets = readRows(path.join(directory, split + '.jsonl'));
  if (targets.length !== scenarios.length || targets.length !== provenance.exportedSplits[split]) throw new Error('A split target count differs');
  scenarios.forEach((row, index) => {
    const target = targets[index];
    if (Object.keys(target).sort().join(',') !== 'answers,query,tools' || target.answers.length !== 1 || target.answers[0].name !== expectedTools[row.verdict] || Object.keys(target.answers[0].arguments).length !== 0) throw new Error('A target contains extra metadata, reasoning or an unreviewed answer');
    const { query, tools } = requestFor(row);
    const fingerprint = inputHash({ query, tools });
    if (fingerprint !== row.inputHash || fingerprint !== inputHash(target)) throw new Error('An exported query or tool description changed');
    if (mappings[index].targetLine !== index + 1 || mappings[index].inputHash !== fingerprint || mappings[index].verdict !== row.verdict || mappings[index].sourceIds.some((id) => scenarioMap.get(id)?.inputHash !== fingerprint || scenarioMap.get(id)?.verdict !== row.verdict)) throw new Error('The deduplicated source mapping changed');
    if (splitInputs.has(fingerprint)) throw new Error('Identical model inputs repeat in an exported split or cross splits');
    splitInputs.set(fingerprint, split);
  });
  splitCounts[split] = targets.length;
}
const result = { status: 'verified-complete-read-only-development-freeze', freezeHash: status.freezeHash, freezeDirectory: status.freezeDirectory, acceptedSourceCases: accepted.length, distinctExportedInputs: splitInputs.size, duplicatedSourceInputs: accepted.length - splitInputs.size, quarantined: quarantine.length, splitCounts, inputVersion: status.requestFormatVersion, answersOnly: true, heldOutCasesExcluded: heldOut.length, relatedFamiliesCrossSplits: false, discardedFamiliesPartiallyAccepted: false, originalFilesWritten: false, solJobsSubmitted: 0 };
fs.writeFileSync(path.join(artifacts, 'repair-verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
