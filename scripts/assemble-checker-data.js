#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verify } = require('./verify-checker-data');
const { localFile, selection } = require('../xor/prototype/checker-composition');
const { digest, reviewPacket, REVIEW_INSTRUCTIONS, REVIEW_INSTRUCTION_HASH } = require('../xor/prototype/checker-data');
const { GATE_REQUEST_VERSION } = require('../xor/lib/gate');

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function sourceSnapshot(inventoryFile, directory) {
  const reviewFiles = fs.readdirSync(directory).filter((name) => /^review-(?!packet).*\.json$/.test(name)).sort();
  const report = verify(inventoryFile, directory, reviewFiles.map((name) => path.join(directory, name)));
  if (report.integrity !== 'passed' || !report.currentProductionBuilderMatches) throw new Error('Source must pass exact-input integrity verification: ' + directory);
  const reviews = reviewFiles.map((name) => read(path.join(directory, name)));
  if (reviews.length !== 2 || reviews.some((review) => review.decisions.length !== report.cases || review.composedFrom)) throw new Error('Source needs two complete original independent reviews');
  const manifest = read(path.join(directory, 'manifest.json'));
  if (manifest.composedFrom) throw new Error('Nested composition is unsupported');
  const files = new Set(['manifest.json', 'review-packet.json', 'proposals.jsonl', ...reviewFiles]);
  for (const review of reviews) if (review.importedFrom) files.add(review.importedFrom.evidenceFile);
  const bytes = new Map([...files].map((name) => [name, fs.readFileSync(localFile(directory, name))]));
  return { manifest, reviews, reviewFiles, bytes, rows: bytes.get('proposals.jsonl').toString('utf8').trim().split('\n').map(JSON.parse) };
}

function assemble(inventoryFile, originalDirectory, supplementDirectory, remediationStudy, output) {
  output = path.resolve(output);
  if (fs.existsSync(output)) throw new Error('Preserve existing snapshots; choose a new assembly directory');
  const original = sourceSnapshot(inventoryFile, originalDirectory);
  const supplement = sourceSnapshot(inventoryFile, supplementDirectory);
  const remediationFile = path.join(remediationStudy, 'remediation.json');
  const remediation = read(remediationFile);
  if (path.resolve(remediation.snapshot) !== path.resolve(originalDirectory)) throw new Error('Remediation identifies a different source snapshot');
  const ancestryPaths = { remediation: remediationFile, sourcePlan: path.join(remediation.source, 'plan.json'), sourceState: path.join(remediation.source, 'state.json'), supplementPlan: path.join(remediationStudy, 'plan.json') };
  const ancestry = Object.fromEntries(Object.entries(ancestryPaths).map(([name, filename]) => [name, fs.readFileSync(filename)]));
  if (digest(ancestry.sourceState.toString('utf8')) !== remediation.sourceStateSha256 || digest(original.bytes.get('manifest.json').toString('utf8')) !== remediation.sourceManifestSha256) throw new Error('Remediation source receipt hash changed');
  const chosen = selection(original, supplement, remediation, JSON.parse(ancestry.sourcePlan), JSON.parse(ancestry.sourceState), JSON.parse(ancestry.supplementPlan));
  const staging = output + '.pending-' + crypto.randomUUID();
  fs.mkdirSync(staging, { recursive: true });
  try {
    const composition = { version: 1, sources: [] };
    for (const [name, source] of Object.entries({ original, supplement })) {
      const directory = path.join('composition-evidence', name);
      const hashes = {};
      for (const [filename, bytes] of source.bytes) {
        const target = path.join(staging, directory, filename);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o444 });
        hashes[filename] = digest(bytes.toString('utf8'));
      }
      composition.sources.push({ name, directory, reviews: source.reviewFiles, files: hashes });
    }
    for (const [name, bytes] of Object.entries(ancestry)) {
      const file = path.join('composition-evidence', name + '.json');
      fs.writeFileSync(path.join(staging, file), bytes, { flag: 'wx', mode: 0o444 });
      composition[name] = { file, sha256: digest(bytes.toString('utf8')) };
    }
    const rows = chosen.selected.map((entry) => entry.row);
    const requests = reviewPacket(rows);
    const contents = rows.map(JSON.stringify).join('\n') + '\n';
    const manifest = { requestFormatVersion: GATE_REQUEST_VERSION, inventorySha256: original.manifest.inventorySha256, proposalsSha256: digest(contents), requestsSha256: digest(requests), cases: rows.length, trainingEligible: false, humanVerified: false, blind: false, promotionAllowed: false, composedFrom: composition };
    const save = (name, value) => fs.writeFileSync(path.join(staging, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o444 });
    save('proposals.jsonl', contents);
    save('review-packet.json', { instructions: REVIEW_INSTRUCTIONS, instructionHash: REVIEW_INSTRUCTION_HASH, requests });
    save('manifest.json', manifest);
    for (const reviewer of original.reviews) {
      const decisions = chosen.selected.map(({ row, source }) => ({ original, supplement })[source].reviews.find((review) => review.model === reviewer.model).decisions.find((decision) => decision.id === row.id));
      const composedFrom = composition.sources.map((source) => ({ source: source.name, reviewFile: path.join(source.directory, source.reviews.find((name) => read(path.join(staging, source.directory, name)).model === reviewer.model)), caseIds: chosen.selected.filter((entry) => entry.source === source.name).map((entry) => entry.row.id) }));
      for (const entry of composedFrom) entry.reviewSha256 = composition.sources.find((source) => source.name === entry.source).files[path.basename(entry.reviewFile)];
      save('review-' + reviewer.model.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json', { model: reviewer.model, modelFamily: reviewer.modelFamily, instructionHash: REVIEW_INSTRUCTION_HASH, inputHash: manifest.requestsSha256, expected: rows.length, status: 'complete', decisions, responses: [], errors: [], composedFrom });
    }
    const report = verify(inventoryFile, staging);
    if (report.integrity !== 'passed') throw new Error('Assembled snapshot failed integrity: ' + report.failures.join('; '));
    for (const [name, source] of Object.entries({ original, supplement })) for (const [filename, bytes] of source.bytes) {
      const directory = name === 'original' ? originalDirectory : supplementDirectory;
      if (!fs.readFileSync(localFile(directory, filename)).equals(bytes)) throw new Error('Source changed during assembly');
    }
    for (const [name, filename] of Object.entries(ancestryPaths)) if (!fs.readFileSync(filename).equals(ancestry[name])) throw new Error('Remediation ancestry changed during assembly');
    if (fs.existsSync(output)) throw new Error('Assembly destination appeared during preparation');
    fs.renameSync(staging, output);
    return { output, cases: rows.length, retainedOriginalCases: chosen.retained, replacedOriginalCases: chosen.replaced.length, supplementalCases: supplement.rows.length, accepted: report.accepted, excluded: report.excluded, coverageGaps: report.coverage.missing.length, trainingEligible: false };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 5) throw new Error('Usage: assemble-checker-data.js <inventory.json> <original-snapshot> <supplement-snapshot> <remediation-study> <new-output>');
    console.log(JSON.stringify(assemble(...args)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { assemble };
