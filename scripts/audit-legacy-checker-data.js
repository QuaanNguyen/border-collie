#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Ajv = require('ajv');
const { requestFor, digest, reviewPacket, REVIEW_INSTRUCTIONS, REVIEW_INSTRUCTION_HASH } = require('../xor/prototype/checker-data');
const { GATE_REQUEST_VERSION } = require('../xor/lib/gate');

const hash = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const readRows = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map(JSON.parse);
const tally = (values) => values.reduce((result, value) => { result[value] = (result[value] || 0) + 1; return result; }, {});
const visible = (row) => hash({ userMessage: row.userMessage, preference: row.preference, tool: row.tool, args: row.args });
const action = (row) => hash({ userMessage: row.userMessage, tool: row.tool, args: row.args });

function groups(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const value = key(row);
    if (!result.has(value)) result.set(value, []);
    result.get(value).push(row);
  }
  return [...result.values()];
}

function audit(root, destination) {
  root = path.resolve(root);
  destination = path.resolve(destination);
  if (fs.existsSync(destination)) throw new Error('Preserve previous audits by selecting a new output directory');
  const input = path.join(root, 'xor/prototype/output/stage2/development/accepted.jsonl');
  const inventoryFile = path.join(root, 'docs/checker-tool-inventory.json');
  const inventory = JSON.parse(fs.readFileSync(inventoryFile, 'utf8'));
  const protectedFiles = [input, inventoryFile, ...['development/held-out.jsonl', 'evaluation/proposed.jsonl', 'evaluation/held-out.jsonl'].map((file) => path.join(root, 'xor/prototype/output/stage2', file))];
  const sources = Object.fromEntries(protectedFiles.map((file) => [path.relative(root, file), hash(fs.readFileSync(file, 'utf8'))]));
  const rows = readRows(input);
  const heldout = protectedFiles.slice(2).flatMap(readRows);
  const reservedIds = new Set(heldout.map((row) => row.id));
  const reservedFamilies = new Set(heldout.map((row) => row.family));
  const reservedInputs = new Set(heldout.map(visible));
  const reservedActions = new Set(heldout.map(action));
  const duplicateGroups = groups(rows, visible).filter((group) => group.length > 1);
  const crossSplitGroups = duplicateGroups.filter((group) => new Set(group.map((row) => row.split)).size > 1);
  const crossSplitFamilies = groups(rows, (row) => row.family).filter((group) => new Set(group.map((row) => row.split)).size > 1);
  const repeatedTemplateGroups = groups(rows, (row) => row.family.split(':').slice(0, -1).join(':')).filter((group) => new Set(group.map((row) => row.split)).size > 1);
  const unsafeFamilies = new Set([...crossSplitGroups.flatMap((group) => group.map((row) => row.family)), ...crossSplitFamilies.flatMap((group) => group.map((row) => row.family))]);
  const validators = new Map();
  const ajv = new Ajv({ strict: false, allErrors: true });
  const contracts = new Map(inventory.tools.filter((tool) => tool.schemaVerified).map((tool) => [`${tool.agent}:${tool.name}`, tool]));
  const directTools = new Set(['edit', 'read', 'write', 'grep', 'glob', 'webfetch']);
  const issues = [];
  let migrated = [];
  const emitted = new Set();
  for (const row of rows) {
    const flags = [];
    const body = JSON.stringify({ userMessage: row.userMessage, args: row.args });
    if (/\bplaceholder\b|\bTODO\b|\bTBD\b/i.test(body)) flags.push('placeholder-content');
    if (row.tool === 'edit' && row.args.oldString === row.args.newString) flags.push('no-op-edit');
    if (/\.\.\.|…|\[(?:truncated|omitted|rest of)[^\]]*\]/i.test(body)) flags.push('possible-truncation');
    if (row.tool === 'bash' && /(?:\b(?:bash|sh|python\d*|node|ruby)\s+|\.\/)[^\s;&|]+\.(?:sh|py|js|rb)\b/.test(row.args.command || '')) flags.push('script-without-proven-complete-contents');
    if (row.split !== 'train') flags.push('preserved-non-training-split');
    if (reservedIds.has(row.id) || reservedFamilies.has(row.family) || reservedInputs.has(visible(row)) || reservedActions.has(action(row))) flags.push('heldout-overlap');
    if (unsafeFamilies.has(row.family)) flags.push('cross-split-family-or-input');
    if (!directTools.has(row.tool)) flags.push(row.tool === 'bash' ? 'shell-needs-explicit-semantic-reconstruction' : 'obsolete-tool-without-direct-current-contract');
    const preference = row.preference;
    if (!preference || typeof preference !== 'object' || Object.keys(preference).some((key) => !['purpose', 'allow', 'disallow', 'ask'].includes(key)) || !['purpose', 'allow', 'disallow', 'ask'].every((key) => typeof preference[key] === 'string')) flags.push('ambiguous-preference-shape');
    const args = { ...row.args };
    if (['edit', 'read', 'write'].includes(row.tool)) {
      if (!Object.hasOwn(args, 'filePath') || Object.hasOwn(args, 'path')) flags.push('ambiguous-path-mapping');
      else { args.path = args.filePath; delete args.filePath; }
    }
    const key = `opencode:${row.tool}`;
    const contract = contracts.get(key);
    if (directTools.has(row.tool)) {
      if (!contract) flags.push('unverified-contract');
      else {
        if (Object.keys(args).some((name) => !Object.hasOwn(contract.inputSchema.properties || {}, name))) flags.push('unknown-modern-argument');
        if (!validators.has(key)) validators.set(key, ajv.compile(contract.inputSchema));
        if (!validators.get(key)(args)) flags.push('invalid-modern-arguments');
      }
    }
    if (emitted.has(visible(row))) flags.push('duplicate-input');
    if (flags.length) { issues.push({ id: row.id, family: row.family, split: row.split, tool: row.tool, flags }); continue; }
    const text = [`Purpose: ${preference.purpose}`, `Allow: ${preference.allow}`, `Deny: ${preference.disallow}`, ...(preference.ask ? [`Ask first: ${preference.ask}`] : [])].join('\n');
    const converted = { id: `case-${digest({ source: sources[path.relative(root, input)], id: row.id }).slice(0, 24)}`, family: row.family, split: row.split, agent: 'opencode', userMessage: row.userMessage, preference: { text }, tool: row.tool, args, origin: 'legacy-migration-unreviewed', trainingEligible: false, provenance: { sourceFile: path.relative(root, input), sourceFileSha256: sources[path.relative(root, input)], sourceId: row.id, sourceRowSha256: hash(row), originalFamily: row.family, originalSplit: row.split, originalModel: row.source?.model || null, argumentMapping: ['edit', 'read', 'write'].includes(row.tool) ? 'filePath -> path; other arguments unchanged' : 'arguments unchanged', preferenceMapping: 'Preserved purpose, allow, disallow and nonempty ask text in a single labeled free-text Preference. No old answer or review is reused.' } };
    converted.inputHash = digest(requestFor(converted));
    migrated.push(converted);
    emitted.add(visible(row));
  }
  const incompleteFamilies = new Set(issues.filter((row) => row.split === 'train').map((row) => row.family));
  const incomplete = migrated.filter((row) => incompleteFamilies.has(row.family));
  migrated = migrated.filter((row) => !incompleteFamilies.has(row.family));
  for (const row of incomplete) issues.push({ id: row.provenance.sourceId, family: row.family, split: row.split, tool: row.tool, flags: ['incomplete-original-training-family'] });
  const mappedTools = new Set(migrated.map((row) => `${row.agent}:${row.tool}`));
  const report = { createdAt: new Date().toISOString(), sources, original: { cases: rows.length, families: new Set(rows.map((row) => row.family)).size, tools: tally(rows.map((row) => row.tool)), splits: tally(rows.map((row) => row.split)), labels: tally(rows.map((row) => row.verdict)), models: tally(rows.map((row) => row.source?.model || 'unknown')), duplicateInputs: duplicateGroups.length, duplicateRowsBeyondFirst: duplicateGroups.reduce((sum, group) => sum + group.length - 1, 0), crossSplitInputGroups: crossSplitGroups.map((group) => group.map((row) => ({ id: row.id, split: row.split, family: row.family }))), crossSplitFamilies: crossSplitFamilies.map((group) => ({ family: group[0].family, splits: [...new Set(group.map((row) => row.split))] })) }, heldoutProtection: { files: protectedFiles.slice(2).map((file) => path.relative(root, file)), reservedIds: reservedIds.size, reservedFamilies: reservedFamilies.size, trainingOverlapCases: issues.filter((row) => row.flags.includes('heldout-overlap')).length, policy: 'Heldout bodies are read solely to detect overlap. They are never copied, relabeled, reviewed for training or migrated.' }, migration: { cases: migrated.length, families: new Set(migrated.map((row) => row.family)).size, tools: tally(migrated.map((row) => `${row.agent}:${row.tool}`)), checkedInventoryTools: contracts.size, checkedIdentitiesRepresented: mappedTools.size, excludedCases: issues.length, exclusions: tally(issues.flatMap((row) => row.flags)), freeTextConversionNeedsFreshReview: true, modelReviewsReused: false, labelsReused: false, trainingEligible: false, blockers: ['Fresh independent Gemma and GLM reviews of these exact requests', 'Human critical safety decisions', 'Semantic near-duplicate and template-family leakage audit beyond exact matches', 'Pinned-tokenizer audit', 'Fresh blind evaluation remains separate from all repair and review work', 'Full current tool, split and risk-topic coverage'] }, issues };
  report.original.templateFamiliesSharedAcrossSplits = repeatedTemplateGroups.map((group) => ({ template: group[0].family.split(':').slice(0, -1).join(':'), cases: group.length, splits: [...new Set(group.map((row) => row.split))] }));
  report.original.requestFormat = 'Legacy V1 exports with structured purpose/allow/disallow/ask Preference and allow/disallow/ask labels. Migration rebuilds the current production request and never copies legacy query text.';
  report.original.noOpEdits = rows.filter((row) => row.tool === 'edit' && row.args.oldString === row.args.newString).length;
  const migratedFamilyCounts = tally(migrated.map((row) => row.family));
  report.migration.partialOriginalTrainingFamilies = groups(rows.filter((row) => row.split === 'train'), (row) => row.family).filter((group) => migratedFamilyCounts[group[0].family] && migratedFamilyCounts[group[0].family] !== group.length).map((group) => ({ family: group[0].family, originalCases: group.length, migratedCases: migratedFamilyCounts[group[0].family] }));
  if (report.migration.partialOriginalTrainingFamilies.length) report.migration.blockers.push('Partially migrated original families need reconstruction before agreement can establish retained-family completeness');
  report.migration.mapping = { edit: 'filePath -> path; oldString/newString retained', read: 'filePath -> path', write: 'filePath -> path; complete content retained', grep: 'pattern/path unchanged', glob: 'pattern/path unchanged', webfetch: 'url unchanged', list: 'Excluded because no current OpenCode list contract exists', bash: 'Excluded because renaming bash to shell alone does not prove complete visible script contents or equivalent shell semantics' };
  for (const [file, expected] of Object.entries(sources)) if (hash(fs.readFileSync(path.join(root, file), 'utf8')) !== expected) throw new Error(`Source changed during audit: ${file}`);
  fs.mkdirSync(destination, { recursive: true });
  const contents = migrated.map((row) => JSON.stringify(row)).join('\n') + '\n';
  const requests = reviewPacket(migrated);
  fs.writeFileSync(path.join(destination, 'proposals.jsonl'), contents);
  fs.writeFileSync(path.join(destination, 'review-packet.json'), JSON.stringify({ instructionHash: REVIEW_INSTRUCTION_HASH, instructions: REVIEW_INSTRUCTIONS, requests }, null, 2) + '\n');
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({ requestFormatVersion: GATE_REQUEST_VERSION, inventorySha256: digest(inventory), proposalsSha256: digest(contents), requestsSha256: digest(requests), cases: migrated.length, trainingEligible: false, humanVerified: false, blind: false, promotionAllowed: false, solJobsAllowed: false, sources, legacyAuditRequired: true }, null, 2) + '\n');
  fs.writeFileSync(path.join(destination, 'legacy-audit.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (require.main === module) {
  try {
    const [destination, root = path.resolve(__dirname, '..')] = process.argv.slice(2);
    if (!destination || process.argv.length > 4) throw new Error('Usage: node scripts/audit-legacy-checker-data.js <new-output-directory> [repository-root]');
    const report = audit(root, destination);
    console.log(JSON.stringify({ original: report.original.cases, migration: report.migration, output: path.resolve(destination) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { audit };
