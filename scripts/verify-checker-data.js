#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { digest, reviewPacket, reviewedRows, coverage, validatePartitions, REVIEW_INSTRUCTION_HASH } = require('../xor/prototype/checker-data');
const { GATE_REQUEST_VERSION } = require('../xor/lib/gate');
const { scriptVisibility } = require('../xor/prototype/script-visibility');
const { validateComposition } = require('../xor/prototype/checker-composition');

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function verify(inventoryFile, directory, reviewFiles = []) {
  const failures = [];
  const blockers = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const inventory = read(inventoryFile);
  const manifest = read(path.join(directory, 'manifest.json'));
  const packet = read(path.join(directory, 'review-packet.json'));
  const contents = fs.readFileSync(path.join(directory, 'proposals.jsonl'), 'utf8');
  const rows = contents.split('\n').filter((line) => line.trim()).map(JSON.parse);
  const rebuilt = reviewPacket(rows);
  check(rows.length > 0 && manifest.cases === rows.length, 'Snapshot case count is absent or inconsistent');
  check(manifest.inventorySha256 === digest(inventory), 'Inventory differs from frozen inventory hash');
  check(manifest.proposalsSha256 === digest(contents), 'Frozen proposal bytes changed');
  check(Array.isArray(packet.requests) && manifest.requestsSha256 === digest(packet.requests), 'Frozen packet differs from its recorded hash');
  check(packet.instructionHash === REVIEW_INSTRUCTION_HASH && digest(packet.instructions) === REVIEW_INSTRUCTION_HASH, 'Review instructions differ from the current rubric');
  const currentBuilderMatches = manifest.requestFormatVersion === GATE_REQUEST_VERSION && digest(packet.requests) === digest(rebuilt);
  if (!currentBuilderMatches) blockers.push('Frozen requests do not match the current production builder; preserve this snapshot and prepare fresh exact-input reviews');
  try { validatePartitions(rows); } catch (error) { failures.push(error.message); }
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const contracts = new Map(inventory.tools.map((tool) => [`${tool.agent}:${tool.name}`, tool]));
  const validators = new Map();
  for (const row of rows) {
    check(typeof row.id === 'string' && typeof row.family === 'string' && ['train', 'validation', 'test'].includes(row.split), `Invalid identity or split for ${row.id}`);
    check(typeof row.userMessage === 'string' && row.userMessage.length > 0 && typeof row.preference?.text === 'string' && Object.keys(row.preference).length === 1, `Invalid visible request or free-text Preference for ${row.id}`);
    check(row.trainingEligible === false, `Unqualified case claims training eligibility: ${row.id}`);
    const key = `${row.agent}:${row.tool}`;
    const contract = contracts.get(key);
    if (!contract?.schemaVerified || !contract.inputSchema) {
      failures.push(`Case uses an unknown or unverified contract: ${row.id}:${key}`);
      continue;
    }
    if (!validators.has(key)) validators.set(key, ajv.compile(contract.inputSchema));
    check(validators.get(key)(row.args), `Tool arguments violate checked schema: ${row.id}:${key}`);
    const scripts = scriptVisibility(row.args?.command ?? row.args?.cmd, row.userMessage);
    for (const issue of scripts.issues) failures.push(`Incomplete script visibility: ${row.id}: ${issue}`);
  }
  for (const claim of ['trainingEligible', 'humanVerified', 'blind', 'promotionAllowed']) {
    check(manifest[claim] !== true, `Snapshot asserts unsupported ${claim}; a boolean is not case-bound evidence`);
  }
  const packetById = new Map((packet.requests || []).map((request) => [request.id, request]));
  check(packetById.size === rows.length && packet.requests.length === rows.length, 'Packet identities are missing or duplicated');
  for (const row of rows) {
    const request = packetById.get(row.id);
    if (!request) { failures.push(`Packet request missing: ${row.id}`); continue; }
    check(/^case-[a-f0-9]{24}$/.test(request.id), `Reviewer case identity is not opaque: ${row.id}`);
    const { id, inputHash, ...visible } = request;
    check(inputHash === digest(visible), `Recorded request hash changed: ${id}`);
    check(!Object.hasOwn(row, 'inputHash') || row.inputHash === inputHash, `Proposal and packet input hashes differ: ${id}`);
    const prefix = `Folder Preference:\n${row.preference.text}\n\nUser request: ${row.userMessage}. Agent action: ${row.tool} `;
    const action = JSON.stringify(row.args);
    check(typeof request.query === 'string' && request.query.startsWith(prefix + action + '. Effects: '), `Frozen packet does not show the complete proposal input: ${id}`);
    check(request.version === GATE_REQUEST_VERSION, `Frozen request is not current V3 format: ${id}`);
    check(Array.isArray(request.tools) && JSON.stringify(request.tools.map((tool) => tool.name)) === JSON.stringify(['approve', 'deny', 'ask']) && request.tools.every((tool) => JSON.stringify(tool.parameters) === JSON.stringify(rebuilt[0].tools[0].parameters)), `Frozen verdict tools violate the no-arguments contract: ${id}`);
    check(JSON.stringify(Object.keys(visible).sort()) === JSON.stringify(['query', 'tools', 'version']), `Review request leaks non-production fields: ${id}`);
  }
  const files = reviewFiles.length ? reviewFiles : fs.readdirSync(directory).filter((file) => /^review-(?!packet).*\.json$/.test(file)).sort().map((file) => path.join(directory, file));
  const reviews = files.map(read);
  const reviewers = [];
  let composition = null;
  if (manifest.composedFrom) {
    try { composition = validateComposition(inventoryFile, directory, manifest, rows, reviews, verify); }
    catch (error) { failures.push(error.message); }
  } else check(!reviews.some((review) => review.composedFrom), 'Composed review lacks its snapshot provenance');
  for (const review of reviews) {
    check(typeof review.model === 'string' && review.model.length > 0 && typeof review.modelFamily === 'string' && review.modelFamily.length > 0, 'Missing reviewer model identity');
    check(review.instructionHash === REVIEW_INSTRUCTION_HASH && review.inputHash === manifest.requestsSha256, `Stale review envelope: ${review.model}`);
    check(Array.isArray(review.decisions), `Missing review decision list: ${review.model}`);
    const decisions = Array.isArray(review.decisions) ? review.decisions : [];
    check(new Set(decisions.map((decision) => decision.id)).size === decisions.length, `Duplicate review decisions: ${review.model}`);
    if (decisions.length !== rows.length) {
      check(review.status !== 'complete', `Review claims completion with missing decisions: ${review.model}`);
      blockers.push(`${review.model} has ${decisions.length} of ${rows.length} review decisions`);
    }
    for (const decision of decisions) {
      check(packetById.get(decision.id)?.inputHash === decision.inputHash && ['approve', 'deny', 'ask', 'abstain'].includes(decision.verdict), `Invalid review decision: ${review.model}:${decision.id}`);
    }
    const receipts = Array.isArray(review.responses) ? review.responses : [];
    if (manifest.composedFrom) {
      check(Boolean(composition) && Boolean(review.composedFrom), `Invalid composed source evidence: ${review.model}`);
      reviewers.push({ model: review.model, family: review.modelFamily, decisions: decisions.length, receiptCases: composition ? decisions.length : 0, composed: true });
      continue;
    }
    const recorded = new Set();
    for (const receipt of receipts) {
      check(receipt.requestedModel === review.model && typeof receipt.reportedModel === 'string' && (receipt.reportedModel === review.model || receipt.reportedModel.startsWith(review.model + '-')), `Gateway model receipt mismatch: ${review.model}`);
      check(receipt.finishReason === undefined || receipt.finishReason === 'stop', `Gateway receipt records a truncated review: ${review.model}`);
      check(Array.isArray(receipt.inputIds) && receipt.inputIds.length > 0 && new Set(receipt.inputIds).size === receipt.inputIds.length && receipt.inputIds.every((id) => packetById.has(id)), `Unknown case in gateway receipt: ${review.model}`);
      for (const id of receipt.inputIds || []) recorded.add(id);
    }
    check(decisions.every((decision) => recorded.has(decision.id)), `Decisions lack recorded gateway response receipts: ${review.model}`);
    if (review.importedFrom) {
      const seed = review.importedFrom;
      const evidence = path.resolve(directory, seed.evidenceFile || '');
      const local = fs.realpathSync(evidence).startsWith(fs.realpathSync(directory) + path.sep);
      check(local, `Imported review evidence escapes its snapshot: ${review.model}`);
      if (local) {
        const bytes = fs.readFileSync(evidence, 'utf8');
        check(digest(bytes) === seed.reviewSha256, `Imported review evidence changed: ${review.model}`);
        const original = JSON.parse(bytes);
        check(original.model === review.model && original.modelFamily === review.modelFamily && original.instructionHash === REVIEW_INSTRUCTION_HASH && original.inputHash === seed.requestsSha256, `Imported review identity changed: ${review.model}`);
        check(Array.isArray(original.decisions) && original.decisions.every((decision) => decisions.some((current) => digest(current) === digest(decision))), `Imported review decisions changed: ${review.model}`);
        check(Array.isArray(original.responses) && original.responses.every((response) => receipts.some((current) => digest(current) === digest(response))), `Imported gateway receipts changed: ${review.model}`);
      }
    }
    reviewers.push({ model: review.model, family: review.modelFamily, decisions: decisions.length, receiptCases: recorded.size });
  }
  let result = { accepted: [], quarantine: rows, quarantinedFamilies: [...new Set(rows.map((row) => row.family))] };
  if (reviews.length !== 2) blockers.push('Exactly two independent model-family reviews are required');
  else {
    try { result = reviewedRows(rows, reviews); } catch (error) { failures.push(error.message); }
  }
  const report = coverage(inventory, result.accepted);
  if (!report.complete) blockers.push(`Reviewed tool, split, default-Preference and risk-topic coverage has ${report.missing.length} gaps`);
  if (result.quarantine.length) blockers.push(`${result.quarantine.length} cases in ${result.quarantinedFamilies.length} families remain excluded because reviews are missing, abstained, disputed or not current-input`);
  blockers.push('Recorded human decisions for critical safety cases must be checked against exact case hashes');
  blockers.push('Pinned-tokenizer limits and semantic leakage checks are not measured by this command');
  blockers.push('Fresh blind evaluation isolation requires provenance beyond train, validation and test split labels');
  blockers.push('Mac direct-output runtime and training prerequisites require separate qualification evidence');
  const represented = new Set(result.accepted.map((row) => `${row.agent}:${row.tool}`));
  return {
    integrity: failures.length ? 'failed' : 'passed', failures,
    currentProductionBuilderMatches: currentBuilderMatches,
    cases: rows.length, accepted: result.accepted.length, excluded: result.quarantine.length,
    quarantinedFamilies: result.quarantinedFamilies,
    reviewers,
    ...(composition ? { composition } : {}),
    toolCoverage: { inventoryEntries: inventory.tools.length, verifiedContracts: inventory.tools.filter((tool) => tool.schemaVerified && tool.inputSchema).length, acceptedToolIdentities: represented.size, unverifiedContracts: inventory.tools.filter((tool) => !tool.schemaVerified || !tool.inputSchema).map((tool) => `${tool.agent}:${tool.name}`), scope: 'Observed inventory only; dynamic catalogs and tools absent from this inventory are not universally covered.' },
    coverage: report, blockers, trainingEligible: false, humanVerified: false, blind: false,
    generatedCommandsExecuted: false, modelApisCalled: false,
    hashes: { inventory: digest(inventory), proposals: digest(contents), frozenRequests: digest(packet.requests), currentRequests: digest(rebuilt) },
  };
}

if (require.main === module) {
  const [inventory, directory, ...reviews] = process.argv.slice(2);
  if (!inventory || !directory || ![0, 2].includes(reviews.length)) {
    console.error('Usage: node scripts/verify-checker-data.js <inventory.json> <frozen-snapshot> [review-a.json review-b.json]');
    process.exitCode = 1;
  } else {
    try {
      const report = verify(inventory, directory, reviews);
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.integrity === 'failed' ? 1 : report.blockers.length ? 2 : 0;
    } catch (error) {
      console.log(JSON.stringify({ integrity: 'failed', failures: [error.message], trainingEligible: false, generatedCommandsExecuted: false, modelApisCalled: false }, null, 2));
      process.exitCode = 1;
    }
  }
}

module.exports = { verify };
