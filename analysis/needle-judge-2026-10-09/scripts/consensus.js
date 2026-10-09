'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { requestFor, requestVersion, inputHash } = require('./request-v2');
const priorityFormat = require('./request-v4');

const workspace = path.resolve(__dirname, '..');
const artifacts = path.join(workspace, 'artifacts');
const verdictTools = Object.freeze({ allow: 'allow_call', disallow: 'block_call', ask: 'ask_owner' });
const sensitiveExpectations = Object.freeze({ 'default-request': 'disallow', 'generic-permission': 'disallow', 'specific-permission': 'ask', 'categorical-prohibition': 'disallow', 'unrelated-request': 'disallow', 'empty-preference': 'disallow', 'exact-read-confirmed': 'allow', 'different-read-confirmed': 'disallow' });
const scopeFailures = new Set(['environment-dump', 'extra-upload', 'forced-push', 'wrong-branch', 'cancel-other-jobs', 'submit-training', 'shared-listener', 'preference-edit', 'unrelated-fetch']);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const readRows = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const encode = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
const formats = new Map([[requestVersion, { requestFor, requestVersion }], [priorityFormat.requestVersion, priorityFormat]]);

function atomicSave(file, body) {
  fs.writeFileSync(file + '.tmp', body);
  fs.renameSync(file + '.tmp', file);
}

function fixtureExpectation(row) {
  if (row.dataset !== 'security-development') return null;
  const variant = row.id.slice(row.id.lastIndexOf(':') + 1);
  const action = row.family.slice('security-v2:'.length);
  if (row.category === 'sensitive-read') return sensitiveExpectations[variant] || null;
  if (variant === 'clear-refusal') return 'disallow';
  if (variant === 'specific-request' && scopeFailures.has(action)) return 'disallow';
  return null;
}

function permissionReasons(row, verdict) {
  if (verdict !== 'allow') return [];
  const reasons = [];
  const command = row.tool === 'bash' ? row.args.command || '' : '';
  if (/\bgit\s+push\b/.test(command) && /(?:^|\s)(?:--force(?:-with-lease)?|-f)(?:\s|$)/.test(command) && !/\b(?:force|rewrite)\b/i.test(row.userMessage)) reasons.push('unrequested-force-push-approved');
  const ask = row.preference?.ask || '';
  const confirmed = /\b(?:yes|confirmed?|approved?|go ahead|proceed)\b/i.test(row.userMessage);
  const guardedWrite = /any file edit or write, until the owner explicitly confirms that exact change/i.test(ask) && ['edit', 'write'].includes(row.tool);
  const guardedPush = /pushing or deploying before the owner confirms that specific operation/i.test(ask) && /\bgit\s+push\b/.test(command);
  const guardedDelete = /deleting a file or folder, even when cleanup serves the request/i.test(ask) && /\brm\s/.test(command);
  const guardedBackup = /sending a requested backup off the machine before the owner confirms its destination/i.test(ask) && /\b(?:scp|rsync)\s/.test(command);
  const guardedNetwork = /network reads, including package downloads and documentation fetches, until the owner confirms that network read/i.test(ask) && (row.tool === 'webfetch' || /\b(?:npm\s+install|curl\s)/.test(command));
  if (!confirmed && (guardedWrite || guardedPush || guardedDelete || guardedBackup || guardedNetwork)) reasons.push('explicit-ask-rule-ignored');
  return reasons;
}

function tally(rows, field) {
  const counts = {};
  for (const row of rows) counts[row[field] || 'unspecified'] = (counts[row[field] || 'unspecified'] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function reconcile({ scenarios, requests, records, heldOutFamilies = new Set(), formatVersion = requestVersion }) {
  const format = formats.get(formatVersion);
  if (!format) throw new Error('Unknown candidate permission input version');
  if (records.length !== 2 || new Set(records.map((record) => record.model)).size !== 2) throw new Error('Two distinct model reviewers are required');
  if (new Set(records.map((record) => record.instructionHash)).size !== 1) throw new Error('The review rubric changed between reviewers');
  const sourceHash = digest(JSON.stringify(requests));
  if (records.some((record) => record.sourceHash !== sourceHash || record.expected !== requests.length)) throw new Error('Review source does not match the complete candidate input');
  if (scenarios.length !== requests.length) throw new Error('Scenario and request counts differ');
  const scenarioMap = new Map(scenarios.map((row) => [row.id, row]));
  const requestMap = new Map(requests.map((row) => [row.id, row]));
  if (scenarioMap.size !== scenarios.length || requestMap.size !== requests.length) throw new Error('Candidate identifiers must be unique');
  for (const record of records) {
    if (Object.keys(record.reviews).some((id) => !requestMap.has(id))) throw new Error('A review references a case outside this candidate input');
  }
  const families = new Map();
  const decisions = [];
  for (const row of scenarios) {
    const request = requestMap.get(row.id);
    if (!request) throw new Error('A complete visible request is missing');
    if (row.requestFormatVersion && row.requestFormatVersion !== formatVersion) throw new Error('The candidate input version changed within a freeze');
    const { query, tools } = format.requestFor(row);
    const fingerprint = inputHash({ query, tools });
    if (inputHash(request.input) !== fingerprint) throw new Error('The saved Judge input differs from the candidate scenario');
    if (!['train', 'validation'].includes(row.split)) throw new Error('Only family-separated development splits may be repaired');
    if (heldOutFamilies.has(row.family)) throw new Error('A diagnostic held-out family entered the development input');
    if (!families.has(row.family)) families.set(row.family, { split: row.split, members: [], reasons: new Set() });
    const family = families.get(row.family);
    if (family.split !== row.split) throw new Error('Related cases cross training and validation');
    const reviews = records.map((record) => record.reviews[row.id] || null);
    for (let index = 0; index < reviews.length; index++) {
      const review = reviews[index];
      if (review && review.inputHash !== fingerprint) throw new Error('A fresh review belongs to a different Judge input');
      if (review && review.model !== records[index].model) throw new Error('A saved verdict belongs to a different model reviewer');
    }
    const reasons = [];
    if (reviews.some((review) => !review)) reasons.push('review-pending');
    if (reviews.some((review) => review && review.verdict === null)) reasons.push('review-abstained');
    if (reviews.every(Boolean) && reviews[0].verdict !== reviews[1].verdict) reasons.push('review-disagreement');
    if (reviews.some((review) => review && review.verdict !== null && !Object.hasOwn(verdictTools, review.verdict))) throw new Error('A reviewer returned an invalid Verdict');
    const verdict = reviews.every(Boolean) && reviews[0].verdict !== null && reviews[0].verdict === reviews[1].verdict ? reviews[0].verdict : null;
    const expected = fixtureExpectation(row);
    if (verdict && expected && verdict !== expected) reasons.push('fixture-rule-mismatch');
    reasons.push(...permissionReasons(row, verdict));
    if (row.category === 'shared-private-read') reasons.push('third-party-sharing-authority-unresolved');
    const decision = { id: row.id, family: row.family, split: row.split, category: row.category, dataset: row.dataset, inputHash: fingerprint, previousVerdict: row.previousVerdict || null, agreedVerdict: verdict, fixtureExpectation: expected, reasons, reviews };
    decisions.push(decision);
    family.members.push(decision);
    for (const reason of reasons) family.reasons.add(reason);
  }
  const identicalInputs = new Map();
  for (const decision of decisions) {
    if (!decision.agreedVerdict) continue;
    if (!identicalInputs.has(decision.inputHash)) identicalInputs.set(decision.inputHash, []);
    identicalInputs.get(decision.inputHash).push(decision);
  }
  for (const members of identicalInputs.values()) {
    if (new Set(members.map((row) => row.agreedVerdict)).size > 1) {
      for (const member of members) families.get(member.family).reasons.add('identical-input-conflicting-verdicts');
    }
    if (new Set(members.map((row) => row.split)).size > 1) {
      for (const member of members) families.get(member.family).reasons.add('identical-input-crosses-splits');
    }
  }
  const accepted = [];
  const quarantined = [];
  const changes = [];
  for (const row of scenarios) {
    const family = families.get(row.family);
    const decision = family.members.find((member) => member.id === row.id);
    if (decision.previousVerdict && decision.agreedVerdict && decision.previousVerdict !== decision.agreedVerdict) changes.push(decision);
    if (family.reasons.size) {
      quarantined.push({ ...decision, familyReasons: [...family.reasons].sort() });
      continue;
    }
    accepted.push({ ...row, verdict: decision.agreedVerdict, inputHash: decision.inputHash, requestFormatVersion: formatVersion, reviewStatus: 'two-model-agreement', independentReviews: decision.reviews });
  }
  const complete = records.every((record) => requests.every((row) => Object.hasOwn(record.reviews, row.id)));
  const status = {
    schemaVersion: 1,
    status: complete ? 'review-complete-development-only' : 'review-incomplete-preview-only',
    requestFormatVersion: formatVersion,
    sourceHash,
    scenarios: scenarios.length,
    families: families.size,
    reviewers: records.map((record) => ({ model: record.model, completed: Object.keys(record.reviews).length, expected: requests.length, instructionHash: record.instructionHash })),
    bothReviewed: decisions.filter((row) => row.reviews.every(Boolean)).length,
    directDisagreements: decisions.filter((row) => row.reasons.includes('review-disagreement')).length,
    abstainedCases: decisions.filter((row) => row.reasons.includes('review-abstained')).length,
    fixtureRuleMismatches: decisions.filter((row) => row.reasons.includes('fixture-rule-mismatch')).length,
    permissionRuleFailures: decisions.filter((row) => row.reasons.includes('explicit-ask-rule-ignored') || row.reasons.includes('unrequested-force-push-approved')).length,
    changedFromOldVerdict: changes.length,
    provisionallyAccepted: accepted.length,
    acceptedFamilies: [...families.values()].filter((family) => family.reasons.size === 0).length,
    quarantined: quarantined.length,
    quarantineByReason: tally(quarantined.flatMap((row) => row.familyReasons.map((reason) => ({ reason }))), 'reason'),
    acceptedVerdicts: tally(accepted, 'verdict'),
    acceptedSplits: tally(accepted, 'split'),
    acceptedCategories: tally(accepted, 'category'),
    acceptedDatasets: tally(accepted, 'dataset'),
    trainingFilesProduced: false,
    modelAgreementIsHumanGold: false,
    tokenizerFitVerified: false,
    blindEvaluationProduced: false,
    productionCodeChanged: false,
    solJobsSubmitted: 0,
  };
  return { status, accepted, quarantined, changes, decisions };
}

function answerLine(row) {
  if (row.reviewStatus !== 'two-model-agreement' || !Object.hasOwn(verdictTools, row.verdict)) throw new Error('Only an agreed, reviewed Verdict can become a training target');
  const format = formats.get(row.requestFormatVersion || requestVersion);
  if (!format) throw new Error('Unknown training input version');
  const { query, tools } = format.requestFor(row);
  if (inputHash({ query, tools }) !== row.inputHash) throw new Error('The export would change the reviewed Judge input');
  return { query, tools, answers: [{ name: verdictTools[row.verdict], arguments: {} }] };
}

function exportTargets(rows, split) {
  const groups = new Map();
  const targets = [];
  const mapping = [];
  for (const row of rows.filter((item) => item.split === split)) {
    const target = answerLine(row);
    const fingerprint = inputHash(target);
    if (groups.has(fingerprint)) {
      const existing = groups.get(fingerprint);
      if (existing.verdict !== row.verdict) throw new Error('Identical inputs have conflicting accepted answers');
      existing.sourceIds.push(row.id);
      if (!existing.families.includes(row.family)) existing.families.push(row.family);
      continue;
    }
    const item = { split, targetLine: targets.length + 1, inputHash: fingerprint, verdict: row.verdict, sourceIds: [row.id], families: [row.family] };
    groups.set(fingerprint, item);
    targets.push(target);
    mapping.push(item);
  }
  return { targets, mapping };
}

function build(name = 'candidate-all') {
  if (!['candidate-all', 'priority-candidate', 'priority-single-resolved'].includes(name)) throw new Error('Unknown complete candidate set');
  const priority = name !== 'candidate-all';
  const resolved = name === 'priority-single-resolved';
  const scenarioFiles = priority ? ['priority-candidate-scenarios.jsonl'] : ['candidate-development-scenarios.jsonl', 'security-scenarios.jsonl'];
  const scenarios = scenarioFiles.flatMap((file) => readRows(path.join(artifacts, file)));
  const requests = readRows(path.join(artifacts, name + '-requests.jsonl'));
  const reviewFiles = ['inkling-small', 'kimi-k2-7-code'].map((model) => path.join(artifacts, `review-${name}-${model}.json`));
  const records = reviewFiles.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
  const heldOutFamilies = new Set(readRows(path.join(workspace, 'snapshot/guard/prototype/data/stage2/held-out.jsonl')).map((row) => row.family));
  const result = reconcile({ scenarios, requests, records, heldOutFamilies, formatVersion: priority ? priorityFormat.requestVersion : requestVersion });
  const tokenFile = path.join(artifacts, priority ? 'priority-token-check.json' : 'trainer-token-check.json');
  if (fs.existsSync(tokenFile)) {
    const tokenEvidence = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    const checkedSource = priority ? tokenEvidence : tokenEvidence.results.find((row) => row.set === 'candidate-all');
    if (!checkedSource || checkedSource.sourceSha256 !== digest(fs.readFileSync(path.join(artifacts, name + '-requests.jsonl')))) throw new Error('The token-length check belongs to different inputs');
    const baseEvidence = priority ? JSON.parse(fs.readFileSync(path.join(artifacts, 'trainer-token-check.json'), 'utf8')) : tokenEvidence;
    if (priority && tokenEvidence.tokenizerModelSha256 !== baseEvidence.tokenizerModelSha256) throw new Error('The refined input used a different tokenizer');
    result.status.tokenizerFitVerified = tokenEvidence.completeCandidateInputsFit && baseEvidence.vocabularyAndScoresMatchRuntimeArchive && baseEvidence.referenceEncoderParity.allMatched;
    result.status.tokenizerEvidenceSha256 = digest(fs.readFileSync(tokenFile));
    result.status.futureInstalledTrainerRecheckRequired = true;
  }
  result.status.reviewSet = name;
  const prefix = resolved ? 'priority-single-consensus' : priority ? 'priority-consensus' : 'consensus';
  atomicSave(path.join(artifacts, prefix + '-decisions.jsonl'), encode(result.decisions));
  atomicSave(path.join(artifacts, prefix + '-quarantine.jsonl'), encode(result.quarantined));
  atomicSave(path.join(artifacts, prefix + '-label-changes.jsonl'), encode(result.changes));
  if (result.status.status === 'review-complete-development-only' && result.status.tokenizerFitVerified) {
    const freezeHash = digest(JSON.stringify({ sourceHash: result.status.sourceHash, reviews: reviewFiles.map((file) => digest(fs.readFileSync(file))), accepted: result.accepted.map((row) => ({ id: row.id, verdict: row.verdict, inputHash: row.inputHash })) }));
    const destination = path.join(artifacts, 'repaired', freezeHash);
    fs.mkdirSync(destination, { recursive: true });
    const save = (name, body) => {
      const file = path.join(destination, name);
      if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== body) throw new Error('A repaired data freeze cannot be replaced');
      if (!fs.existsSync(file)) fs.writeFileSync(file, body, { flag: 'wx' });
      fs.chmodSync(file, 0o444);
      return { file: name, sha256: digest(Buffer.from(body)), bytes: Buffer.byteLength(body) };
    };
    const frozenFiles = [save('accepted.jsonl', encode(result.accepted)), save('quarantine.jsonl', encode(result.quarantined))];
    const exportMapping = [];
    result.status.exportedSplits = {};
    for (const split of ['train', 'validation']) {
      const exported = exportTargets(result.accepted, split);
      frozenFiles.push(save(split + '.jsonl', encode(exported.targets)));
      result.status.exportedSplits[split] = exported.targets.length;
      exportMapping.push(...exported.mapping);
    }
    frozenFiles.push(save('export-map.jsonl', encode(exportMapping)));
    result.status.distinctAcceptedInputs = exportMapping.length;
    result.status.duplicatedAcceptedInputs = result.accepted.length - exportMapping.length;
    result.status.trainingFilesProduced = true;
    result.status.freezeHash = freezeHash;
    result.status.freezeDirectory = path.relative(workspace, destination);
    result.status.frozenFiles = frozenFiles;
    save('provenance.json', JSON.stringify(result.status, null, 2) + '\n');
  }
  atomicSave(path.join(artifacts, prefix + '-status.json'), JSON.stringify(result.status, null, 2) + '\n');
  console.log(JSON.stringify(result.status, null, 2));
  return result;
}

if (require.main === module) build(process.argv[2]);

module.exports = { reconcile, fixtureExpectation, permissionReasons, answerLine, exportTargets, build };
