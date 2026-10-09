'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runtimeRequest } = require('../snapshot/guard/prototype/finetune-pipeline');
const { proposedCall } = require('../snapshot/guard/lib/toolcalls');

const workspace = path.resolve(__dirname, '..');
const snapshot = path.join(workspace, 'snapshot');
const fingerprint = (text) => crypto.createHash('sha256').update(text).digest('hex');
const readRows = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const developmentFile = path.join(snapshot, 'guard/prototype/data/stage2/accepted.jsonl');
const heldOutFile = path.join(snapshot, 'guard/prototype/data/stage2/held-out.jsonl');
const development = readRows(developmentFile);
const heldOut = readRows(heldOutFile);
const domains = [...new Set([...development, ...heldOut].map((row) => row.family.split(':').at(-1)))];
const escapeExpression = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const domainExpression = new RegExp('\\b(?:' + domains.map(escapeExpression).join('|') + ')\\b', 'gi');
const normalizedAction = (row) => JSON.stringify({ tool: row.tool, args: row.args }).replace(domainExpression, '<domain>').replace(/\s+/g, ' ');
const view = (row) => {
  const { query, tools } = runtimeRequest(row);
  return JSON.stringify({ query, tools });
};
const counts = (rows, select) => Object.fromEntries([...new Set(rows.map(select))].sort().map((key) => [key, rows.filter((row) => select(row) === key).length]));

function scopeFindings(rows, dataset) {
  const findings = [];
  for (const row of rows) {
    const command = row.tool === 'bash' ? row.args.command : '';
    if (row.verdict === 'allow' && /\bgit\s+push\b/.test(command) && /(?:--force(?:-with-lease)?\b|(?:^|\s)-f(?:\s|$))/.test(command) && !/\bforce(?:-?push(?:ing)?)?\b|\brewrit(?:e|ing)\b|\boverwrit(?:e|ing)\b/i.test(row.userMessage)) {
      findings.push({ id: row.id, family: row.family, dataset, code: 'force-push-scope', status: 'needs-independent-review', userMessage: row.userMessage, command, existingVerdict: row.verdict, existingReason: row.independentReview?.reason || null });
    }
    if (/\bgit\s+push\b/.test(command)) {
      const mentioned = [...row.userMessage.matchAll(/(?:\b(?:push|delete|publish|update|send)\s+(?:the\s+)?([\w./-]+)\s+branch\b|\bbranch\s+(?:named|called)\s+["'`]?([\w./-]+)|\bbranch\s+["'`]([\w./-]+)["'`])/gi)].map((match) => match[1] || match[2] || match[3]);
      const pushed = command.match(/\bgit\s+push\s+(?:--[\w-]+\s+|-[\w]+\s+)*([\w.-]+)\s+([\w./:-]+)/);
      if (pushed && mentioned.some((branch) => !pushed[2].split(':').includes(branch))) {
        findings.push({ id: row.id, family: row.family, dataset, code: 'named-branch-mismatch', status: 'needs-independent-review', userMessage: row.userMessage, command, namedBranches: mentioned, pushedRef: pushed[2], existingVerdict: row.verdict });
      }
    }
    const stringArguments = Object.entries(row.args).filter(([, value]) => typeof value === 'string' && value.replace(/\s+/g, ' ').trim().length > 200).map(([key]) => key);
    const action = `${row.tool} ${JSON.stringify(Object.fromEntries(Object.entries(row.args).map(([key, value]) => [key, typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value])))}`;
    if (stringArguments.length || action.length > 600 || row.userMessage.replace(/\s+/g, ' ').trim().length > 600) {
      findings.push({ id: row.id, family: row.family, dataset, code: 'visible-input-truncation', status: 'needs-independent-review', stringArguments, actionCharacters: action.length });
    }
    if (row.independentReview && row.independentReview.inputHash !== fingerprint(view(row))) {
      findings.push({ id: row.id, family: row.family, dataset, code: 'stale-independent-review', status: 'invalid-review', savedHash: row.independentReview.inputHash, computedHash: fingerprint(view(row)) });
    }
  }
  return findings;
}

function summary(rows) {
  const commands = rows.filter((row) => row.tool === 'bash').map((row) => row.args.command);
  const withAsk = rows.filter((row) => runtimeRequest(row).tools.some((tool) => tool.name === 'ask_owner'));
  const withoutAsk = rows.filter((row) => !runtimeRequest(row).tools.some((tool) => tool.name === 'ask_owner'));
  const securityPatterns = {
    credentialFilenameInBash: /(?:^|[\s/"'])\.env(?:[.\s/"']|$)|\.ssh|\b(?:id_rsa|id_ed25519|credentials|[\w-]+\.pem|[\w-]+\.key)\b|\.npmrc|\.netrc|\.git-credentials/,
    environmentDump: /\b(?:printenv|env)(?:\s*\||\s*$)|\bset\s*$/,
    processOrPrivilegeCommands: /\b(?:kill|killall|pkill|sudo|su|chmod|chown|crontab)\b/,
    alternateDestructiveCommands: /\b(?:find|xargs|dd|shred|truncate)\b/,
    obfuscatedExecution: /\b(?:base64|eval)\b|\|\s*(?:sh|bash|zsh)\b/,
    reconnaissanceCommands: /\b(?:dig|nmap|wget)\b/,
    schedulerCommands: /\b(?:srun|sbatch|scancel|squeue|sacct|salloc)\b/,
  };
  return {
    total: rows.length,
    families: new Set(rows.map((row) => row.family)).size,
    familyNamingSignatures: new Set(rows.map((row) => row.family.split(':').slice(0, -1).join(':'))).size,
    domains: counts(rows, (row) => row.family.split(':').at(-1)),
    verdicts: counts(rows, (row) => row.verdict),
    categories: counts(rows, (row) => row.category),
    tools: counts(rows, (row) => row.tool),
    splits: counts(rows, (row) => row.split),
    preferences: counts(rows, (row) => row.preferenceId),
    uniquePreferenceTexts: new Set(rows.map((row) => JSON.stringify(row.preference))).size,
    askOffered: { total: withAsk.length, verdicts: counts(withAsk, (row) => row.verdict) },
    askAbsent: { total: withoutAsk.length, verdicts: counts(withoutAsk, (row) => row.verdict) },
    bashFirstWords: counts(commands, (command) => command.trim().split(/\s+/)[0]),
    securityCommandCoverage: Object.fromEntries(Object.entries(securityPatterns).map(([name, expression]) => [name, commands.filter((command) => expression.test(command)).length])),
    normalizedActions: new Set(rows.map(normalizedAction)).size,
    disallowedWebfetch: rows.filter((row) => row.tool === 'webfetch' && row.verdict === 'disallow').length,
    staleSavedQueries: rows.filter((row) => row.query && row.query !== runtimeRequest(row).query).map((row) => row.id),
  };
}

function originalExperiments() {
  const base = path.join(snapshot, 'guard/prototype/output/needle-official-ladder/mac-runtime');
  const reports = fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(base, entry.name, `${entry.name}-heldOut.json`)).filter(fs.existsSync);
  return reports.map((file) => {
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    const metrics = report.metrics;
    const ordinary = metrics.confusion.allow;
    const harmful = metrics.confusion.disallow;
    const expected = new Map(heldOut.map((row) => [row.id, row]));
    const binary = report.rows.filter((row) => {
      const scenario = expected.get(row.id);
      return scenario && !runtimeRequest(scenario).tools.some((tool) => tool.name === 'ask_owner');
    });
    return {
      model: path.basename(path.dirname(file)),
      evidence: path.relative(workspace, file),
      reportSha256: fingerprint(fs.readFileSync(file)),
      total: metrics.total,
      correct: metrics.correct,
      accuracy: metrics.correct / metrics.total,
      harmfulAllowed: metrics.harmfulAllowed,
      ordinaryRefused: metrics.ordinaryRefused,
      askRecall: metrics.askRecall,
      noVerdict: metrics.noVerdict,
      infrastructureErrors: metrics.infrastructureErrors,
      allowDiscrimination: ordinary.allow / Object.values(ordinary).reduce((a, b) => a + b, 0) - harmful.allow / Object.values(harmful).reduce((a, b) => a + b, 0),
      binaryNoAsk: { total: binary.length, correct: binary.filter((row) => row.observed === row.expected).length },
      confidenceIntervals: { accuracy: wilson(metrics.correct, metrics.total), harmfulAllowed: wilson(metrics.harmfulAllowed.count, metrics.harmfulAllowed.total), ordinaryRefused: wilson(metrics.ordinaryRefused.count, metrics.ordinaryRefused.total) },
    };
  });
}

function wilson(successes, total) {
  const z = 1.959963984540054;
  const ratio = successes / total;
  const scale = 1 + z * z / total;
  const center = (ratio + z * z / (2 * total)) / scale;
  const margin = z * Math.sqrt(ratio * (1 - ratio) / total + z * z / (4 * total * total)) / scale;
  return { lower: center - margin, upper: center + margin, assumption: 'Descriptive binomial interval; related synthetic families violate independent-case sampling.' };
}

function main() {
  const findings = [...scopeFindings(development, 'development'), ...scopeFindings(heldOut, 'diagnostic-held-out')];
  const developmentInputs = new Map(development.map((row) => [view(row), row]));
  const developmentActions = new Set(development.map(normalizedAction));
  const developmentFamilies = new Set(development.map((row) => row.family));
  const validationFamilies = new Set(development.filter((row) => row.split === 'validation').map((row) => row.family));
  const originalPoolFile = path.join(snapshot, 'guard/prototype/output/stage2/development/accepted.jsonl');
  const frozenStudyFile = path.join(snapshot, 'guard/prototype/output/needle-4bit-balanced-updates/study-plan.json');
  const frozenStudy = JSON.parse(fs.readFileSync(frozenStudyFile, 'utf8'));
  const inputs = new Map();
  for (const row of [...development, ...heldOut]) {
    const key = view(row);
    if (!inputs.has(key)) inputs.set(key, []);
    inputs.get(key).push(row);
  }
  const duplicateInputs = [...inputs.values()].filter((rows) => rows.length > 1);
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    data: { development: { file: path.relative(workspace, developmentFile), sha256: fingerprint(fs.readFileSync(developmentFile)), ...summary(development) }, heldOut: { file: path.relative(workspace, heldOutFile), sha256: fingerprint(fs.readFileSync(heldOutFile)), ...summary(heldOut) } },
    overlap: {
      heldOutFamiliesInDevelopment: heldOut.filter((row) => developmentFamilies.has(row.family)).map((row) => row.id),
      heldOutVisibleInputsInDevelopment: heldOut.filter((row) => developmentInputs.has(view(row))).map((row) => row.id),
      trainingFamiliesInValidation: development.filter((row) => row.split === 'train' && validationFamilies.has(row.family)).map((row) => row.id),
      normalizedHeldOutActionsWithDevelopmentTwin: heldOut.filter((row) => developmentActions.has(normalizedAction(row))).length,
      exactDuplicateInputGroups: duplicateInputs.map((rows) => ({ ids: rows.map((row) => row.id), verdicts: [...new Set(rows.map((row) => row.verdict))] })),
    },
    findings: { total: findings.length, byCode: counts(findings, (finding) => finding.code), byDataset: counts(findings, (finding) => finding.dataset), evidence: 'audit-findings.jsonl' },
    existingSolStudy: { file: path.relative(workspace, frozenStudyFile), sourceSha256: frozenStudy.sourceSha256, currentSnapshotSourceSha256: fingerprint(fs.readFileSync(originalPoolFile)), matchesCurrentSource: frozenStudy.sourceSha256 === fingerprint(fs.readFileSync(originalPoolFile)), updates: frozenStudy.training.updateBudget, reasoningTargets: frozenStudy.training.reasoningTargets, plannedConditions: frozenStudy.runs.length, currentRemoteStatus: 'Not queried; local submission records do not establish current state.' },
    historicalExperiments: originalExperiments(),
  };
  const destination = path.join(workspace, 'artifacts');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'audit.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(destination, 'audit-findings.jsonl'), findings.map((finding) => JSON.stringify(finding)).join('\n') + '\n');
  console.log(JSON.stringify({ development: report.data.development.total, heldOut: report.data.heldOut.total, findings: report.findings.byCode, overlap: report.overlap, sourceMatchesFrozenStudy: report.existingSolStudy.matchesCurrentSource }, null, 2));
}

if (require.main === module) main();

module.exports = { scopeFindings, normalizedAction, wilson };
