'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const artifacts = path.resolve(__dirname, '../artifacts');
const prefix = process.argv[2] || 'priority-consensus';
if (!['priority-consensus', 'priority-single-consensus'].includes(prefix)) throw new Error('Unknown scope recheck evidence prefix');
const readRows = (name) => fs.readFileSync(path.join(artifacts, name), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const findings = readRows('audit-findings.jsonl');
const decisionsBytes = fs.readFileSync(path.join(artifacts, prefix + '-decisions.jsonl'));
const decisions = decisionsBytes.toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
const decisionMap = new Map(decisions.map((row) => [row.id, row]));
const excluded = new Set(readRows(prefix + '-quarantine.jsonl').map((row) => row.id));
const rows = findings.map((finding) => {
  const decision = decisionMap.get(finding.id);
  const bothReviewed = Boolean(decision && decision.reviews.every(Boolean));
  return { ...finding, freshInputHash: decision?.inputHash || null, bothReviewed, agreedVerdict: decision?.agreedVerdict || null, freshReviews: decision?.reviews || [], includedInRepairedDevelopment: Boolean(decision && !excluded.has(finding.id)), reviewState: !decision ? 'old-held-out-not-relabeled' : !bothReviewed ? 'pending' : decision.agreedVerdict ? 'two-model-agreement' : 'disagreement-or-abstention' };
});
const summary = {};
for (const row of rows) {
  const key = row.dataset + '/' + row.code;
  if (!summary[key]) summary[key] = { flagged: 0, bothReviewed: 0, pending: 0, originalHeldOutUntouched: 0, agreedVerdicts: {}, agreedLabelChanges: 0, includedInRepairedDevelopment: 0 };
  const item = summary[key];
  item.flagged += 1;
  item.bothReviewed += Number(row.bothReviewed);
  item.pending += Number(row.reviewState === 'pending');
  item.originalHeldOutUntouched += Number(row.reviewState === 'old-held-out-not-relabeled');
  item.includedInRepairedDevelopment += Number(row.includedInRepairedDevelopment);
  if (row.agreedVerdict) {
    item.agreedVerdicts[row.agreedVerdict] = (item.agreedVerdicts[row.agreedVerdict] || 0) + 1;
    item.agreedLabelChanges += Number(row.agreedVerdict !== row.existingVerdict);
  }
}
const record = { schemaVersion: 1, decisionSourceSha256: crypto.createHash('sha256').update(decisionsBytes).digest('hex'), role: 'Recheck original scope flags under the copied refined permission input; branch-name flags are candidates rather than proven errors.', originalHeldOutModified: false, summary, rows };
fs.writeFileSync(path.join(artifacts, 'source-flag-recheck.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ summary }, null, 2));
