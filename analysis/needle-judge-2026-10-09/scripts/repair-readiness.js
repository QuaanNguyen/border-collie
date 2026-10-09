'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const artifacts = path.resolve(__dirname, '../artifacts');
const prefix = process.argv[2] || 'priority-consensus';
if (!['priority-consensus', 'priority-single-consensus'].includes(prefix)) throw new Error('Unknown repair evidence prefix');
const readRows = (name) => fs.readFileSync(path.join(artifacts, name), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const statusBytes = fs.readFileSync(path.join(artifacts, prefix + '-status.json'));
const status = JSON.parse(statusBytes);
const scenarios = readRows('priority-candidate-scenarios.jsonl');
const decisions = readRows(prefix + '-decisions.jsonl');
const quarantine = readRows(prefix + '-quarantine.jsonl');
const excluded = new Set(quarantine.map((row) => row.id));
const accepted = scenarios.filter((row) => !excluded.has(row.id));
const decisionMap = new Map(decisions.map((row) => [row.id, row]));
if (accepted.length !== status.provisionallyAccepted || accepted.length + quarantine.length !== scenarios.length) throw new Error('Reconciliation counts are inconsistent');
const complete = status.status === 'review-complete-development-only';
const groups = new Map();
const coverageInputs = new Map();
for (const row of scenarios) {
  const key = row.dataset + '/' + row.category;
  if (!groups.has(key)) groups.set(key, { dataset: row.dataset, category: row.category, proposed: 0, accepted: 0, training: 0, validation: 0, verdicts: { allow: 0, ask: 0, disallow: 0 } });
  const group = groups.get(key);
  group.proposed += 1;
  if (!excluded.has(row.id)) {
    const decision = decisionMap.get(row.id);
    if (!decision?.agreedVerdict) throw new Error('An accepted case lacks an agreed decision');
    group.accepted += 1;
    group[row.split === 'train' ? 'training' : 'validation'] += 1;
    group.verdicts[decision.agreedVerdict] += 1;
    if (!coverageInputs.has(key)) coverageInputs.set(key, { train: new Set(), validation: new Set() });
    coverageInputs.get(key)[row.split].add(row.inputHash);
  }
}
const train = accepted.filter((row) => row.split === 'train');
const validation = accepted.filter((row) => row.split === 'validation');
const distinctTrain = new Set(train.map((row) => row.inputHash)).size;
const distinctValidation = new Set(validation.map((row) => row.inputHash)).size;
const trainFamilies = new Set(train.map((row) => row.family));
const validationFamilies = new Set(validation.map((row) => row.family));
if ([...trainFamilies].some((family) => validationFamilies.has(family))) throw new Error('Accepted families cross development splits');
const coverage = [...groups.entries()].map(([key, row]) => ({ ...row, distinctTraining: coverageInputs.get(key)?.train.size || 0, distinctValidation: coverageInputs.get(key)?.validation.size || 0 })).sort((left, right) => (left.dataset + left.category).localeCompare(right.dataset + right.category));
const blocked = [];
if (!complete) blocked.push('Both exact-input model reviews are not yet complete.');
if (!status.trainingFilesProduced) blocked.push('No final immutable repaired data freeze exists.');
if (distinctTrain < 1000) blocked.push('Fewer than 1,000 distinct eligible training inputs remain for the proposed fitting comparison.');
if (distinctTrain < 2000) blocked.push('Fewer than 2,000 distinct eligible training inputs remain for the proposed five-size comparison.');
if (coverage.some((row) => row.dataset === 'security-development' && row.accepted === 0)) blocked.push('At least one added permission topic has no accepted controls; inspect or repair coverage before claiming it is taught.');
if (coverage.some((row) => row.dataset === 'security-development' && (row.distinctTraining === 0 || row.distinctValidation === 0))) blocked.push('Some added permission topics have no distinct training or validation controls; report these gaps and do not infer measured coverage from the combined count.');
blocked.push('The exact future installed official trainer and answers-only native format compatibility still need verification.');
blocked.push('Version four narrows the accepted other-users-on-Sol directory rule to private directories on shared systems; final scope and production-aligned input reviews remain unresolved.');
blocked.push('A fresh blind set with unseen Preference wording and action families has not been produced.');
blocked.push('The owner has not approved any new Sol jobs.');
const result = {
  schemaVersion: 1,
  status: complete ? 'review-complete-readiness-assessment' : 'incomplete-preview-readiness-assessment',
  consensusStatusSha256: crypto.createHash('sha256').update(statusBytes).digest('hex'),
  requestFormatVersion: status.requestFormatVersion,
  reviewSet: status.reviewSet,
  reviewComplete: complete,
  frozenDevelopmentFiles: status.trainingFilesProduced,
  accepted: accepted.length,
  quarantined: quarantine.length,
  trainingCases: distinctTrain,
  validationCases: distinctValidation,
  acceptedSourceTrainingCases: train.length,
  acceptedSourceValidationCases: validation.length,
  duplicatedAcceptedInputs: accepted.length - distinctTrain - distinctValidation,
  trainingFamilies: trainFamilies.size,
  validationFamilies: validationFamilies.size,
  fittingSampleCountAvailable: complete && distinctTrain >= 1000,
  fullSampleComparisonCountAvailable: complete && distinctTrain >= 2000,
  addedTopicsWithNoAcceptedCases: coverage.filter((row) => row.dataset === 'security-development' && row.accepted === 0).map((row) => row.category),
  addedTopicsWithNoAcceptedTraining: coverage.filter((row) => row.dataset === 'security-development' && row.distinctTraining === 0).map((row) => row.category),
  addedTopicsWithNoAcceptedValidation: coverage.filter((row) => row.dataset === 'security-development' && row.distinctValidation === 0).map((row) => row.category),
  modelAgreementIsHumanGold: false,
  newlyTrainedModel: false,
  productionDeploymentPerformed: false,
  solSubmissionReady: false,
  submittedJobs: 0,
  blockers: blocked,
  coverage,
};
fs.writeFileSync(path.join(artifacts, 'repair-readiness.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, accepted: result.accepted, trainingCases: result.trainingCases, validationCases: result.validationCases, addedTopicsWithNoAcceptedCases: result.addedTopicsWithNoAcceptedCases, solSubmissionReady: false }));
