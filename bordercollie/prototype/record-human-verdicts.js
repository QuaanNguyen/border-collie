'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function record(directory, values, evidence) {
  const file = path.join(directory, 'human-verdicts.json');
  if (fs.existsSync(file)) throw new Error('Preserve the existing human decisions');
  const selected = fs.existsSync(path.join(directory, 'human-review-order.json'));
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, selected ? 'isolation.json' : 'human-verification.json')));
  if (selected && (manifest.status !== 'frozen-inputs-awaiting-independent-and-human-labels' || manifest.trainingExamplesProvidedToAuthor !== false || manifest.isolatedFromTrainingReviewFeedback !== true)) throw new Error('An isolated frozen evaluation is required before recording blind human decisions');
  for (const [name, expected] of Object.entries(manifest.hashes)) if (digest(fs.readFileSync(path.join(directory, name))) !== expected) throw new Error('Human review input changed');
  const scenarios = fs.readFileSync(path.join(directory, 'scenarios.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const inputs = fs.readFileSync(path.join(directory, 'requests.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const selection = selected ? JSON.parse(fs.readFileSync(path.join(directory, 'human-review-order.json'))).map((entry) => {
    const row = scenarios.find((row) => row.id === entry.id && row.inputHash === entry.inputHash);
    if (!row) throw new Error('Human packet no longer matches its frozen input');
    return row;
  }) : scenarios;
  if (new Set(selection.map((row) => row.id)).size !== selection.length || values.length !== selection.length || values.some((value) => !['allow', 'disallow', 'ask', 'unclear'].includes(value)) || !evidence.chat || !evidence.exactReply) throw new Error('Complete human decisions and their source are required');
  const labels = selection.map((row, index) => ({ id: row.id, inputHash: row.inputHash, verdict: values[index] === 'unclear' ? null : values[index], humanVerified: values[index] !== 'unclear' }));
  const saved = { recordedAt: new Date().toISOString(), evidence, inputHashes: manifest.hashes, labels, trainingEligible: false, blind: selected };
  fs.writeFileSync(file, JSON.stringify(saved, null, 2) + '\n');
  const requests = selection.flatMap((row, index) => labels[index].humanVerified ? [{ id: row.id, family: row.family, topic: row.topic, tool: row.tool, category: row.category, preference: row.preferenceId, expected: labels[index].verdict, inputHash: row.inputHash, ...inputs.find((item) => item.id === row.id).input }] : []);
  const requestFile = path.join(directory, 'human-critical-requests.jsonl');
  fs.writeFileSync(requestFile, requests.map(JSON.stringify).join('\n') + '\n');
  if (!selected) {
    const plan = { status: 'frozen-human-critical-evaluation', evaluationSplits: ['human-critical'], hashes: { ...manifest.hashes, 'human-verdicts.json': digest(fs.readFileSync(file)), 'human-critical-requests.jsonl': digest(fs.readFileSync(requestFile)) }, humanVerifiedCases: requests.length, unclearCases: labels.length - requests.length, blind: false, trainingEligible: false, solJobsAllowed: false };
    fs.writeFileSync(path.join(directory, 'study-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  }
  return saved;
}

if (require.main === module) {
  const [directory, chat, reply, ...values] = process.argv.slice(2);
  const result = record(path.resolve(directory), values, { chat, exactReply: reply });
  process.stdout.write(JSON.stringify({ humanVerified: result.labels.filter((row) => row.humanVerified).length, trainingEligible: false }) + '\n');
}

module.exports = { record };
