'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const artifacts = path.resolve(__dirname, '../artifacts');
const source = fs.readFileSync(path.join(artifacts, 'raw-response-probe.json'));
const record = JSON.parse(source);
if (record.status !== 'complete' || record.observations.length !== 24) throw new Error('Raw-response probe is incomplete');
const names = { allow_call: 'allow', block_call: 'disallow', ask_owner: 'ask' };
const verdict = (response) => [...(response?.function_calls || []), ...(response?.suppressed_calls || [])].map((call) => names[call.name]).find(Boolean) || null;
const pairs = [];
for (const model of record.models) for (const item of record.cases) {
  const observations = record.outputCaps.map((cap) => record.observations.find((row) => row.model === model.label && row.id === item.id && row.maximumTokens === cap));
  if (observations.some((row) => !row)) throw new Error('Output-cap pair is missing');
  pairs.push({ model: model.label, id: item.id, requestVersion: item.requestVersion, observations: observations.map((row) => ({ cap: row.maximumTokens, verdict: verdict(row.response), reasoningCharacters: (row.response?.reasoning || '').length, elapsedMilliseconds: row.elapsedMilliseconds, error: row.response?.error || row.launchError || (row.signal ? 'Stopped by ' + row.signal : null), exitCode: row.exitCode })), verdictChanged: verdict(observations[0].response) !== verdict(observations[1].response), reasoningChanged: observations[0].response?.reasoning !== observations[1].response?.reasoning });
}
const summary = {
  schemaVersion: 1,
  sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
  status: 'complete-bounded-diagnostic',
  models: record.models.map(({ label, weightsSha256, runnerSha256 }) => ({ label, weightsSha256, runnerSha256 })),
  requestsPerModel: record.cases.length,
  observations: record.observations.length,
  outputCaps: record.outputCaps,
  pairedVerdictChanges: pairs.filter((pair) => pair.verdictChanged).length,
  pairedReasoningChanges: pairs.filter((pair) => pair.reasoningChanged).length,
  responsesWithReasoning: record.observations.filter((row) => row.response?.reasoning).length,
  infrastructureFailures: pairs.flatMap((pair) => pair.observations).filter((row) => row.error || row.exitCode !== 0).length,
  modelAccuracyClaimed: false,
  internalTokenEquivalenceEstablished: false,
  interpretation: 'The archived answers-only export still emits reasoning through the pinned native runner. A larger cap changes no Verdict in this small diagnostic; this neither proves prompt equivalence nor rules out truncation on other requests.',
  trainingPerformed: false,
  solJobsSubmitted: 0,
  proposedActionsExecuted: 0,
  pairs,
};
fs.writeFileSync(path.join(artifacts, 'raw-response-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ observations: summary.observations, pairedVerdictChanges: summary.pairedVerdictChanges, responsesWithReasoning: summary.responsesWithReasoning, infrastructureFailures: summary.infrastructureFailures }));
