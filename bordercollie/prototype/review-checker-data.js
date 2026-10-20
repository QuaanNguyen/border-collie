'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { connection, request, safeError } = require('../../analysis/needle-judge-2026-10-09/scripts/gateway');
const { REVIEW_INSTRUCTIONS, REVIEW_INSTRUCTION_HASH, digest, reviewPacket } = require('./checker-data');

async function review(directory, model, modelFamily, concurrency = 3) {
  const conn = connection();
  const contents = fs.readFileSync(path.join(directory, 'proposals.jsonl'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
  if (digest(contents) !== manifest.proposalsSha256) throw new Error('Frozen proposals changed');
  const rows = contents.trim().split('\n').map(JSON.parse);
  const packets = reviewPacket(rows);
  const inputHash = digest(packets);
  if (manifest.requestsSha256 !== inputHash) throw new Error('The production input builder changed; prepare a new exact-input packet');
  const file = path.join(directory, `review-${model.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { model, modelFamily, instructionHash: REVIEW_INSTRUCTION_HASH, inputHash, decisions: [], responses: [], errors: [] };
  if (saved.model !== model || saved.modelFamily !== modelFamily || saved.instructionHash !== REVIEW_INSTRUCTION_HASH || saved.inputHash !== inputHash) throw new Error('Preserve old reviews; inputs or reviewer identity changed');
  const decisions = new Map(saved.decisions.map((row) => [row.id, row]));
  if (decisions.size !== saved.decisions.length || saved.decisions.some((row) => !packets.some((packet) => packet.id === row.id && packet.inputHash === row.inputHash))) throw new Error('Saved review is duplicated or stale');
  const batches = [];
  const missing = packets.filter((packet) => !decisions.has(packet.id));
  for (let start = 0; start < missing.length; start += 8) batches.push(missing.slice(start, start + 8));
  const save = () => {
    saved.decisions = packets.map((packet) => decisions.get(packet.id)).filter(Boolean);
    saved.expected = packets.length;
    saved.status = decisions.size === packets.length ? 'complete' : 'incomplete';
    saved.updatedAt = new Date().toISOString();
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(saved, null, 2) + '\n');
    fs.renameSync(temp, file);
  };
  save();
  let cursor = 0;
  let consecutiveErrors = 0;
  let stopped = false;
  const worker = async () => {
    for (;;) {
      if (stopped || fs.existsSync(path.join(directory, 'STOP-REVIEWS'))) return;
      const batch = batches[cursor++];
      if (!batch) return;
      try {
        const response = await request(conn, '/chat/completions', { model, messages: [{ role: 'system', content: REVIEW_INSTRUCTIONS + ' Return {"decisions":[{"id":"...","inputHash":"...","verdict":"approve|deny|ask|abstain"}]} with exactly one row per input.' }, { role: 'user', content: JSON.stringify(batch) }] }, 120000);
        if (typeof response.model !== 'string' || response.model !== model && !response.model.startsWith(model + '-')) throw new Error('Gateway reported an unexpected reviewer model');
        const raw = response?.choices?.[0]?.message?.content;
        if (typeof raw !== 'string') throw new Error('Reviewer returned no text');
        const decoded = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
        if (!Array.isArray(decoded.decisions) || decoded.decisions.length !== batch.length || new Set(decoded.decisions.map((row) => row.id)).size !== batch.length) throw new Error('Reviewer did not return the exact batch');
        for (const row of decoded.decisions) {
          if (!batch.some((packet) => packet.id === row.id && packet.inputHash === row.inputHash) || !['approve', 'deny', 'ask', 'abstain'].includes(row.verdict)) throw new Error('Reviewer changed an identity or returned an invalid verdict');
        }
        for (const row of decoded.decisions) decisions.set(row.id, { id: row.id, inputHash: row.inputHash, verdict: row.verdict });
        consecutiveErrors = 0;
        saved.responses.push({ id: response.id || null, requestedModel: model, reportedModel: response.model || null, inputIds: batch.map((row) => row.id), usage: response.usage || null });
      } catch (error) {
        saved.errors.push({ inputIds: batch.map((row) => row.id), error: safeError(error, conn) });
        consecutiveErrors += 1;
        if (consecutiveErrors >= 3) stopped = true;
      }
      save();
      process.stdout.write(JSON.stringify({ model, reviewed: decisions.size, expected: packets.length, errors: saved.errors.length }) + '\n');
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  save();
  return { model, status: saved.status, reviewed: decisions.size, expected: packets.length };
}

if (require.main === module) {
  const [directory, model, modelFamily] = process.argv.slice(2);
  if (!directory || !model || !modelFamily) throw new Error('Usage: review-checker-data.js <directory> <model> <model-family>');
  review(path.resolve(directory), model, modelFamily).then((result) => { console.log(JSON.stringify(result)); if (result.status !== 'complete') process.exitCode = 1; }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { review };
