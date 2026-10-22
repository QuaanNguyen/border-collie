'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { REVIEW_INSTRUCTIONS, REVIEW_INSTRUCTION_HASH, digest, reviewPacket } = require('./checker-data');
const { GATE_REQUEST_VERSION } = require('../lib/gate');

function frozenPacket(directory) {
  const contents = fs.readFileSync(path.join(directory, 'proposals.jsonl'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (digest(contents) !== manifest.proposalsSha256 || String(manifest.requestFormatVersion) !== String(GATE_REQUEST_VERSION)) throw new Error('Frozen proposals are incompatible');
  const rows = contents.trim().split('\n').map(JSON.parse);
  const packets = reviewPacket(rows);
  const stored = JSON.parse(fs.readFileSync(path.join(directory, 'review-packet.json'), 'utf8'));
  if (manifest.cases !== packets.length || digest(packets) !== manifest.requestsSha256 || new Set(packets.map((packet) => packet.id)).size !== packets.length || packets.some((packet) => !/^case-[a-f0-9]{24}$/.test(packet.id)) || stored.instructions !== REVIEW_INSTRUCTIONS || stored.instructionHash !== REVIEW_INSTRUCTION_HASH || digest(stored.instructions) !== stored.instructionHash || digest(stored.requests) !== digest(packets)) throw new Error('Frozen production packet is incompatible');
  if (!/^[a-f0-9]{64}$/.test(manifest.inventorySha256) || Object.hasOwn(manifest, 'planSha256') && !/^[a-f0-9]{64}$/.test(manifest.planSha256)) throw new Error('Frozen study identity is incompatible');
  return { manifest, packets };
}

function compatibleCheckpoint(directory, filename, model, modelFamily, target, targetManifest) {
  const source = frozenPacket(directory);
  if (source.manifest.inventorySha256 !== targetManifest.inventorySha256 || source.manifest.planSha256 !== targetManifest.planSha256) throw new Error('Frozen study identity changed');
  if (source.packets.some((packet) => !target.has(packet.id) || digest(packet) !== digest(target.get(packet.id)))) throw new Error('Source inputs changed');
  const bytes = fs.readFileSync(path.join(directory, filename));
  const saved = JSON.parse(bytes);
  if (saved.model !== model || saved.modelFamily !== modelFamily || saved.instructionHash !== REVIEW_INSTRUCTION_HASH || saved.inputHash !== source.manifest.requestsSha256 || saved.expected !== source.packets.length || !['complete', 'incomplete'].includes(saved.status) || !Array.isArray(saved.decisions) || !Array.isArray(saved.responses) || !Array.isArray(saved.errors)) throw new Error('Reviewer checkpoint is incompatible');
  const inputs = new Map(source.packets.map((packet) => [packet.id, packet]));
  const decisionIds = new Set();
  for (const decision of saved.decisions) {
    if (!inputs.has(decision.id) || decision.inputHash !== inputs.get(decision.id).inputHash || !['approve', 'deny', 'ask', 'abstain'].includes(decision.verdict) || decisionIds.has(decision.id) || Object.keys(decision).some((key) => !['id', 'inputHash', 'verdict'].includes(key))) throw new Error('Reviewer decisions are invalid');
    decisionIds.add(decision.id);
  }
  if ((saved.status === 'complete') !== (saved.decisions.length === source.packets.length)) throw new Error('Reviewer completion is invalid');
  const received = new Set();
  for (const response of saved.responses) {
    if (response.requestedModel !== model || typeof response.reportedModel !== 'string' || response.reportedModel !== model && !response.reportedModel.startsWith(model + '-') || Object.hasOwn(response, 'finishReason') && response.finishReason !== 'stop' || !Array.isArray(response.inputIds) || !response.inputIds.length || new Set(response.inputIds).size !== response.inputIds.length || response.inputIds.some((id) => !inputs.has(id))) throw new Error('Reviewer receipt is invalid');
    for (const id of response.inputIds) received.add(id);
  }
  if (saved.decisions.some((decision) => !received.has(decision.id))) throw new Error('Reviewer decisions have no receipt');
  return { directory, bytes, saved, manifest: source.manifest };
}

function seedReview(directory, model, modelFamily) {
  directory = path.resolve(directory);
  if (path.basename(path.dirname(directory)) !== 'dev-reviews') return false;
  const reviewer = model.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `review-${reviewer}.json`;
  const destination = path.join(directory, filename);
  if (fs.existsSync(destination)) return false;
  const target = frozenPacket(directory);
  const targetInputs = new Map(target.packets.map((packet) => [packet.id, packet]));
  let best = null;
  for (const entry of fs.readdirSync(path.dirname(directory), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === path.basename(directory)) continue;
    try {
      const candidate = compatibleCheckpoint(path.join(path.dirname(directory), entry.name), filename, model, modelFamily, targetInputs, target.manifest);
      if (candidate.saved.decisions.length && (!best || candidate.saved.decisions.length > best.saved.decisions.length)) best = candidate;
    } catch {}
  }
  if (!best) return false;
  const reviewSha256 = digest(best.bytes.toString('utf8'));
  const evidenceFile = path.join('seed-evidence', reviewer, reviewSha256 + '.json');
  const evidence = path.join(directory, evidenceFile);
  fs.mkdirSync(path.dirname(evidence), { recursive: true });
  try {
    fs.writeFileSync(evidence, best.bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST' || !fs.readFileSync(evidence).equals(best.bytes)) throw error;
  }
  const seeded = {
    model,
    modelFamily,
    instructionHash: REVIEW_INSTRUCTION_HASH,
    decisions: best.saved.decisions,
    responses: best.saved.responses,
    errors: best.saved.errors,
    inputHash: target.manifest.requestsSha256,
    expected: target.packets.length,
    status: best.saved.decisions.length === target.packets.length ? 'complete' : 'incomplete',
    updatedAt: new Date().toISOString(),
    importedFrom: {
      directory: best.directory,
      proposalsSha256: best.manifest.proposalsSha256,
      requestsSha256: best.manifest.requestsSha256,
      reviewSha256,
      evidenceFile,
    },
  };
  const temporary = destination + `.seed-${process.pid}-${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(seeded, null, 2) + '\n', { flag: 'wx' });
    try {
      fs.linkSync(temporary, destination);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return false;
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return true;
}

if (require.main === module) {
  const [directory, model, modelFamily] = process.argv.slice(2);
  if (!directory || !model || !modelFamily) throw new Error('Usage: seed-checker-reviews.js <directory> <model> <model-family>');
  console.log(JSON.stringify({ seeded: seedReview(directory, model, modelFamily) }));
}

module.exports = { seedReview };
