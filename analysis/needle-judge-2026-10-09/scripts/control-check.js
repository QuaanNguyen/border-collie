'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fixtureExpectation, permissionReasons } = require('./consensus');

const artifacts = path.resolve(__dirname, '../artifacts');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const readRows = (name) => fs.readFileSync(path.join(artifacts, name), 'utf8').split('\n').filter(Boolean).map(JSON.parse);

function inspect(name, scenarios) {
  const requests = readRows(name + '-requests.jsonl');
  const requestMap = new Map(requests.map((row) => [row.id, row]));
  const records = ['inkling-small', 'kimi-k2-7-code'].map((model) => JSON.parse(fs.readFileSync(path.join(artifacts, `review-${name}-${model}.json`), 'utf8')));
  if (records.some((record) => record.sourceHash !== digest(JSON.stringify(requests)))) throw new Error('Control review source does not match its saved input');
  const cases = scenarios.map((row) => {
    const request = requestMap.get(row.id);
    if (!request) throw new Error('Control input is missing');
    const inputHash = digest(JSON.stringify(request.input));
    const reviews = records.map((record) => record.reviews[row.id] || null);
    if (reviews.some((review) => review && review.inputHash !== inputHash)) throw new Error('Control review input fingerprint changed');
    const expected = fixtureExpectation(row);
    return { id: row.id, family: row.family, category: row.category, variant: row.id.slice(row.id.lastIndexOf(':') + 1), expected, inputHash, reviews, permissionReasons: reviews.map((review) => review ? permissionReasons(row, review.verdict) : []) };
  });
  const reviewers = records.map((record, index) => {
    const reviewed = cases.filter((row) => row.reviews[index]);
    const known = reviewed.filter((row) => row.expected);
    const wrong = known.filter((row) => row.expected !== row.reviews[index].verdict);
    const byVariant = {};
    for (const row of known) {
      if (!byVariant[row.variant]) byVariant[row.variant] = { checked: 0, correct: 0, observedVerdicts: {} };
      const item = byVariant[row.variant];
      const verdict = row.reviews[index].verdict || 'abstained';
      item.checked += 1;
      item.correct += Number(verdict === row.expected);
      item.observedVerdicts[verdict] = (item.observedVerdicts[verdict] || 0) + 1;
    }
    return { model: record.model, reviewedControls: reviewed.length, totalControls: cases.length, knownRuleChecks: known.length, knownRuleCorrect: known.length - wrong.length, knownRuleFailures: wrong.length, additionalPermissionRuleFailures: reviewed.filter((row) => row.permissionReasons[index].length).length, byVariant, mismatches: wrong.map((row) => ({ id: row.id, expected: row.expected, ...row.reviews[index] })) };
  });
  const both = cases.filter((row) => row.reviews.every(Boolean));
  const summary = {
    set: name,
    sourceHash: digest(JSON.stringify(requests)),
    totalControls: cases.length,
    bothReviewed: both.length,
    complete: both.length === cases.length,
    knownRulesAreOwnerContractDiagnostics: true,
    blindEvaluation: false,
    modelTrainingPerformed: false,
    reviewers,
    directDisagreements: both.filter((row) => row.reviews[0].verdict !== row.reviews[1].verdict).length,
    agreedKnownRuleFailures: both.filter((row) => row.expected && row.reviews[0].verdict === row.reviews[1].verdict && row.reviews[0].verdict !== row.expected).length,
  };
  const destination = path.join(artifacts, name + '-control-check.json');
  fs.writeFileSync(destination + '.tmp', JSON.stringify({ ...summary, cases }, null, 2) + '\n');
  fs.renameSync(destination + '.tmp', destination);
  console.log(JSON.stringify({ ...summary, reviewers: reviewers.map(({ mismatches, byVariant, ...row }) => row) }, null, 2));
  return summary;
}

function build() {
  const scenarios = readRows('security-scenarios.jsonl');
  inspect('candidate-all', scenarios);
  if (fs.existsSync(path.join(artifacts, 'review-sensitive-wording-kimi-k2-7-code.json'))) inspect('sensitive-wording', scenarios.filter((row) => row.category === 'sensitive-read'));
  if (fs.existsSync(path.join(artifacts, 'review-priority-probe-kimi-k2-7-code.json'))) {
    const probeIds = new Set(readRows('priority-probe-requests.jsonl').map((row) => row.id));
    inspect('priority-probe', readRows('priority-candidate-scenarios.jsonl').filter((row) => probeIds.has(row.id)));
  }
  if (fs.existsSync(path.join(artifacts, 'review-priority-candidate-kimi-k2-7-code.json'))) inspect('priority-candidate', readRows('priority-candidate-scenarios.jsonl').filter((row) => row.dataset === 'security-development'));
  if (fs.existsSync(path.join(artifacts, 'review-priority-control-single-kimi-k2-7-code.json'))) {
    const singletonIds = new Set(readRows('priority-control-single-requests.jsonl').map((row) => row.id));
    inspect('priority-control-single', readRows('priority-candidate-scenarios.jsonl').filter((row) => singletonIds.has(row.id)));
  }
  if (fs.existsSync(path.join(artifacts, 'review-priority-single-resolved-kimi-k2-7-code.json'))) inspect('priority-single-resolved', readRows('priority-candidate-scenarios.jsonl').filter((row) => row.dataset === 'security-development'));
}

if (require.main === module) build();

module.exports = { inspect, build };
