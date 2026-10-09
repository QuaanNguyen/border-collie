'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { instructions, loadSet } = require('./review');
const { inputHash } = require('./request-v4');

const artifacts = path.resolve(__dirname, '../artifacts');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

function seed(model) {
  if (!['inkling-small', 'kimi-k2-7-code'].includes(model)) throw new Error('Unknown review model');
  const rows = loadSet('priority-candidate');
  const sourceRows = loadSet('priority-probe');
  const sourceFile = path.join(artifacts, `review-priority-probe-${model}.json`);
  const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  const instructionHash = digest(instructions);
  if (source.model !== model || source.instructionHash !== instructionHash || source.sourceHash !== digest(JSON.stringify(sourceRows)) || source.expected !== sourceRows.length) throw new Error('The probe review provenance does not match');
  if (source.status !== 'complete' || sourceRows.some((row) => !Object.hasOwn(source.reviews, row.id))) throw new Error('The exact-input probe must finish before seeding the complete review');
  const target = new Map(rows.map((row) => [row.id, row]));
  for (const row of sourceRows) {
    const current = target.get(row.id);
    if (!current || inputHash(current.input) !== inputHash(row.input) || source.reviews[row.id].inputHash !== inputHash(row.input) || source.reviews[row.id].model !== model) throw new Error('The seeded review belongs to different visible input');
  }
  const file = path.join(artifacts, `review-priority-candidate-${model}.json`);
  if (fs.existsSync(file)) throw new Error('The full review already exists; never replace an active review record');
  const record = { schemaVersion: 1, set: 'priority-candidate', sourceHash: digest(JSON.stringify(rows)), instructionHash, model, createdAt: new Date().toISOString(), expected: rows.length, reviews: source.reviews, errors: [], completed: sourceRows.length, status: 'incomplete', seededFrom: { file: path.basename(sourceFile), sha256: digest(fs.readFileSync(sourceFile)), exactInputsVerified: true, sourceCases: sourceRows.length }, updatedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ model, exactReviewsReused: record.completed, total: rows.length, originalInputsChanged: false }));
}

if (require.main === module) seed(process.argv[2]);

module.exports = { seed };
