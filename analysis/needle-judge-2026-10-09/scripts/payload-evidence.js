'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { connection } = require('./gateway');
const { requestFor, inputHash } = require('./request-v2');

const workspace = path.resolve(__dirname, '..');
const artifacts = path.join(workspace, 'artifacts');
const readRows = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const original = readRows(path.join(workspace, 'snapshot/guard/prototype/data/stage2/accepted.jsonl'));
const scenarios = ['candidate-development-scenarios.jsonl', 'security-scenarios.jsonl'].flatMap((file) => readRows(path.join(artifacts, file)));
const requests = readRows(path.join(artifacts, 'candidate-all-requests.jsonl'));
const conn = connection();
const visibleText = JSON.stringify(requests.map((row) => row.input));
const payloadMatchesScenarios = scenarios.length === requests.length && scenarios.every((row, index) => inputHash(requestFor(row)) === inputHash(requests[index].input));
const credentials = {
  actualApiKeyInPayload: visibleText.includes(conn.key),
  privateKeyBlockInPayload: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(visibleText),
  credentialAssignmentInPayload: /(?:AIR_API_KEY|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|GITHUB_TOKEN|PASSWORD)\s*[=:]\s*["']?[A-Za-z0-9_+/.-]{16,}/i.test(visibleText),
};
const proof = {
  checkedAt: new Date().toISOString(),
  gateway: new URL(conn.baseUrl).hostname,
  syntheticDevelopmentScenarios: original.length,
  allDevelopmentProvenanceIsExistingProposer: original.every((row) => row.source?.agent === 'proposer' && row.source?.model === 'inkling-small'),
  syntheticHandAuthoredControls: scenarios.filter((row) => row.dataset === 'security-development').length,
  allControlsProvenanceIsAnalysisFixture: scenarios.filter((row) => row.dataset === 'security-development').every((row) => row.source?.agent === 'analysis-fixture' && row.source?.model === 'hand-authored'),
  visibleInputsContainOnlyQueryAndTools: requests.every((row) => Object.keys(row.input).sort().join(',') === 'query,tools'),
  payloadMatchesScenarios,
  payloadSha256: crypto.createHash('sha256').update(visibleText).digest('hex'),
  actualFileContentsLoadedForPayload: false,
  repositorySourceFilesSentForReview: false,
  previousLabelsOrReviewReasonsSent: false,
  credentials,
  scope: 'Independent review of generated fictional permission examples using the same configured ASU gateway and model families as the existing data pipeline. Sensitive paths are proposed action strings, not the contents of those files.',
};
fs.writeFileSync(path.join(artifacts, 'review-payload-evidence.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify(proof, null, 2));
if (!proof.allDevelopmentProvenanceIsExistingProposer || !proof.allControlsProvenanceIsAnalysisFixture || !proof.visibleInputsContainOnlyQueryAndTools || !payloadMatchesScenarios || Object.values(credentials).some(Boolean)) process.exitCode = 1;
