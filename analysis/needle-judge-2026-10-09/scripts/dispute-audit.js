'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const revision = '71bb67d';
const prefix = 'analysis/needle-judge-2026-10-09/artifacts/';
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const countBy = (rows, key) => rows.reduce((result, row) => { const value = key(row); result[value] = (result[value] || 0) + 1; return result; }, {});
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? null;

function audit(directory) {
  const hashes = {};
  const read = (name) => {
    const bytes = execFileSync('git', ['show', `${revision}:${prefix}${name}`], { maxBuffer: 24 * 1024 * 1024 });
    hashes[name] = digest(bytes);
    return bytes.toString().trim().split('\n').map(JSON.parse);
  };
  const rows = read('priority-candidate-scenarios.jsonl');
  const decisions = read('priority-single-consensus-decisions.jsonl');
  const quarantine = read('priority-single-consensus-quarantine.jsonl');
  const excluded = new Set(quarantine.map((row) => row.id));
  const byId = new Map(decisions.map((row) => [row.id, row]));
  if (rows.length !== 3336 || quarantine.length !== 883 || byId.size !== rows.length) throw new Error('Historical source identities differ from the recorded study');
  const describe = (values) => {
    const commands = values.map((row) => String(row.args?.command || ''));
    return {
      cases: values.length,
      families: new Set(values.map((row) => row.family)).size,
      constructionsIgnoringDomainNames: new Set(values.map((row) => row.family.split(':').slice(0, 2).join(':'))).size,
      medianUserCharacters: median(values.map((row) => row.userMessage.length)),
      medianActionCharacters: median(values.map((row) => JSON.stringify(row.args).length)),
      compoundCommands: commands.filter((command) => /&&|\|\||[;\n|]/.test(command)).length,
      variableOrSubstitutionCommands: commands.filter((command) => /\$[({A-Za-z_]|`/.test(command)).length,
      longActions: commands.filter((command) => command.length > 200).length,
      sensitiveActions: values.filter((row) => /\.env|credential|\.ssh|\.pem|\.key|\/etc\/passwd|\/home\/|\/scratch\//i.test(JSON.stringify(row.args))).length,
      categories: countBy(values, (row) => row.category),
      topics: countBy(values, (row) => row.family.split(':').slice(0, 2).join(':')),
      tools: countBy(values, (row) => row.tool),
    };
  };
  const retainedRows = rows.filter((row) => !excluded.has(row.id));
  const excludedRows = rows.filter((row) => excluded.has(row.id));
  const direct = quarantine.filter((row) => row.reviews?.[0]?.verdict !== row.reviews?.[1]?.verdict);
  const pairs = countBy(direct, (row) => row.reviews.map((review) => review.verdict || 'abstain').sort().join('/'));
  const queue = [];
  const queueGroups = new Set();
  for (const decision of direct) {
    const row = rows.find((row) => row.id === decision.id);
    const topic = row.family.split(':').slice(0, 2).join(':');
    if (queueGroups.has(topic)) continue;
    queueGroups.add(topic);
    queue.push({ id: row.id, family: row.family, topic, priority: /sensitive|share|upload|delete|scheduler|outside|delegat/i.test(row.family + row.category) ? 'critical-permission-contract' : 'ordinary-work-and-confirmation', preference: row.preference, userMessage: row.userMessage, tool: row.tool, args: row.args, reviewPair: decision.reviews, familyReasons: decision.familyReasons || [], status: 'requires-fresh-contract-copy-and-human-adjudication-before-any-training', historicalInputHash: row.inputHash });
  }
  queue.sort((a, b) => a.priority.localeCompare(b.priority) || a.topic.localeCompare(b.topic));
  const bounded = queue.slice(0, 8);
  const result = { status: 'historical-exclusion-audit-current-reviews-still-required', revision, hashes, originalCases: rows.length, retained: describe(retainedRows), excluded: describe(excludedRows), directDisagreements: direct.length, excludedDespiteAgreement: quarantine.length - direct.length, reviewPairs: pairs, reasons: countBy(quarantine.flatMap((row) => (row.familyReasons || row.reasons || []).map((reason) => ({ reason }))), (row) => row.reason), queueCases: bounded.length, labelsChanged: 0, limits: ['Lengths and command syntax are difficulty indicators, not measured correctness.', 'Disputed labels do not establish which reviewer was right.', 'Whole-family exclusions also remove agreed ordinary counterparts.', 'These historical inputs use a superseded Preference and request contract; no historical decision may become a current training label without fresh exact-input reviews.', 'Current reviews, retained coverage and the human contract audit remain required before any new freeze.'], solJobsSubmitted: 0 };
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'historical-dispute-audit.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'historical-human-queue.json'), JSON.stringify(bounded, null, 2) + '\n');
  return result;
}

if (require.main === module) {
  const result = audit(path.resolve(process.argv[2]));
  process.stdout.write(JSON.stringify({ cases: result.originalCases, retained: result.retained.cases, excluded: result.excluded.cases, directDisagreements: result.directDisagreements, inheritedExclusions: result.excludedDespiteAgreement, reviewPairs: result.reviewPairs }) + '\n');
}

module.exports = { audit };
