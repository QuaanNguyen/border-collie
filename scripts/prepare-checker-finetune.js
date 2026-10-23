#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const digest = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

function prepare(datasetDir, humanDecisionsPath, outputDir) {
  datasetDir = path.resolve(datasetDir);
  humanDecisionsPath = path.resolve(humanDecisionsPath);
  outputDir = path.resolve(outputDir);

  if (fs.existsSync(outputDir)) {
    throw new Error('Destination directory already exists: ' + outputDir);
  }

  const proposalsFile = path.join(datasetDir, 'proposals.jsonl');
  const reviewPacketFile = path.join(datasetDir, 'review-packet.json');
  const manifestFile = path.join(datasetDir, 'manifest.json');

  const proposals = fs.readFileSync(proposalsFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const packet = JSON.parse(fs.readFileSync(reviewPacketFile, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const humanRecord = JSON.parse(fs.readFileSync(humanDecisionsPath, 'utf8'));

  const reviewFiles = fs.readdirSync(datasetDir).filter((file) => /^review-(?!packet).*\.json$/.test(file)).sort();
  const reviews = reviewFiles.map((file) => JSON.parse(fs.readFileSync(path.join(datasetDir, file), 'utf8')));

  const r1Map = new Map(reviews[0].decisions.map((d) => [d.id, d.verdict]));
  const r2Map = new Map(reviews[1].decisions.map((d) => [d.id, d.verdict]));
  const humanMap = new Map((humanRecord.human?.labels || []).map((l) => [l.id, l.verdict]));
  const requestMap = new Map(packet.requests.map((r) => [r.id, r]));

  const resolved = [];
  for (const proposal of proposals) {
    const request = requestMap.get(proposal.id);
    if (!request) throw new Error('Missing request packet for proposal ' + proposal.id);

    const hv = humanMap.get(proposal.id);
    const v1 = r1Map.get(proposal.id);
    const v2 = r2Map.get(proposal.id);

    let verdict = null;
    let resolutionSource = null;

    if (hv) {
      verdict = hv;
      resolutionSource = 'human_adjudication';
    } else if (v1 && v2 && v1 === v2 && ['approve', 'deny', 'ask'].includes(v1)) {
      verdict = v1;
      resolutionSource = 'reviewer_agreement';
    } else {
      throw new Error('Unresolved verdict for proposal ' + proposal.id);
    }

    resolved.push({
      proposal,
      request,
      verdict,
      resolutionSource,
      trainingExample: {
        query: request.query,
        tools: request.tools,
        answers: [{ name: verdict, arguments: {} }],
      },
      scenarioExample: {
        id: proposal.id,
        family: proposal.family,
        agent: proposal.agent,
        split: proposal.split,
        tool: proposal.tool,
        args: proposal.args,
        preference: proposal.preference,
        userMessage: proposal.userMessage,
        verdict,
        inputHash: proposal.inputHash,
        resolutionSource,
      },
    });
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const splits = { train: [], validation: [], test: [] };
  for (const item of resolved) {
    splits[item.proposal.split].push(item);
  }

  const writeJsonl = (filePath, items) => {
    const text = items.map((i) => JSON.stringify(i)).join('\n') + '\n';
    fs.writeFileSync(filePath, text, { mode: 0o444 });
    return digest(text);
  };

  const hashes = {};
  hashes['train-answers.jsonl'] = writeJsonl(
    path.join(outputDir, 'train-answers.jsonl'),
    splits.train.map((i) => i.trainingExample)
  );
  hashes['validation-answers.jsonl'] = writeJsonl(
    path.join(outputDir, 'validation-answers.jsonl'),
    splits.validation.map((i) => i.trainingExample)
  );
  hashes['test-answers.jsonl'] = writeJsonl(
    path.join(outputDir, 'test-answers.jsonl'),
    splits.test.map((i) => i.trainingExample)
  );

  hashes['train-scenarios.jsonl'] = writeJsonl(
    path.join(outputDir, 'train-scenarios.jsonl'),
    splits.train.map((i) => i.scenarioExample)
  );
  hashes['validation-scenarios.jsonl'] = writeJsonl(
    path.join(outputDir, 'validation-scenarios.jsonl'),
    splits.validation.map((i) => i.scenarioExample)
  );
  hashes['test-scenarios.jsonl'] = writeJsonl(
    path.join(outputDir, 'test-scenarios.jsonl'),
    splits.test.map((i) => i.scenarioExample)
  );

  hashes['all-answers.jsonl'] = writeJsonl(
    path.join(outputDir, 'all-answers.jsonl'),
    resolved.map((i) => i.trainingExample)
  );
  hashes['all-scenarios.jsonl'] = writeJsonl(
    path.join(outputDir, 'all-scenarios.jsonl'),
    resolved.map((i) => i.scenarioExample)
  );

  fs.copyFileSync(proposalsFile, path.join(outputDir, 'proposals.jsonl'));
  fs.copyFileSync(reviewPacketFile, path.join(outputDir, 'review-packet.json'));
  for (const file of reviewFiles) {
    fs.copyFileSync(path.join(datasetDir, file), path.join(outputDir, file));
  }
  fs.copyFileSync(humanDecisionsPath, path.join(outputDir, 'human-critical-decisions.json'));

  const exportManifest = {
    requestFormatVersion: manifest.requestFormatVersion,
    cases: resolved.length,
    splits: {
      train: splits.train.length,
      validation: splits.validation.length,
      test: splits.test.length,
    },
    verdicts: {
      approve: resolved.filter((r) => r.verdict === 'approve').length,
      deny: resolved.filter((r) => r.verdict === 'deny').length,
      ask: resolved.filter((r) => r.verdict === 'ask').length,
    },
    resolutions: {
      reviewerAgreement: resolved.filter((r) => r.resolutionSource === 'reviewer_agreement').length,
      humanAdjudication: resolved.filter((r) => r.resolutionSource === 'human_adjudication').length,
    },
    hashes,
    sourceSnapshot: datasetDir,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(outputDir, 'export-manifest.json'),
    JSON.stringify(exportManifest, null, 2) + '\n',
    { mode: 0o444 }
  );

  return exportManifest;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const datasetDir = args[0] || 'xor/prototype/output/checker-integrated-2026-10-22';
  const humanPath = args[1] || 'docs/experiments/human-critical-decisions-2026-10-23.json';
  const outputDir = args[2] || 'xor/prototype/output/v3-integrated-2026-10-23';

  try {
    const report = prepare(datasetDir, humanPath, outputDir);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { prepare };
