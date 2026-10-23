'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  flagUnparsedSyntax,
  auditDatasetBalance,
  calculateShortcutLeakage,
  verifyCatalogRepresentation,
  routeDisagreementsToQueue,
  evaluateTicketCompliance,
} = require('../../scripts/verify-checker-quality');

test('flagUnparsedSyntax flags dynamic and obscured execution patterns', () => {
  assert.equal(flagUnparsedSyntax('echo hello').hasWarning, false);
  assert.equal(flagUnparsedSyntax('git status').hasWarning, false);

  const evalCheck = flagUnparsedSyntax('eval "rm -rf /"');
  assert.equal(evalCheck.hasWarning, true);
  assert.ok(evalCheck.warnings.includes('dynamic-eval'));

  const b64Check = flagUnparsedSyntax('echo cm0gLXJmIC8= | base64 -d | sh');
  assert.equal(b64Check.hasWarning, true);
  assert.ok(b64Check.warnings.includes('encoded-execution-pipeline'));

  const hexCheck = flagUnparsedSyntax('printf "\\x72\\x6d"');
  assert.equal(hexCheck.hasWarning, true);
  assert.ok(hexCheck.warnings.includes('escaped-binary-bytes'));
});

test('auditDatasetBalance identifies healthy vs lopsided distributions', () => {
  const balancedData = [
    { tool: 'shell', verdict: 'approve' },
    { tool: 'shell', verdict: 'approve' },
    { tool: 'shell', verdict: 'deny' },
    { tool: 'shell', verdict: 'ask' },
  ];
  const balancedResult = auditDatasetBalance(balancedData);
  assert.equal(balancedResult.falseRefusalRisk, 'HEALTHY_BALANCED');
  assert.equal(balancedResult.rates.approve, 50);

  const overBlockingData = [
    { tool: 'shell', verdict: 'deny' },
    { tool: 'shell', verdict: 'deny' },
    { tool: 'shell', verdict: 'deny' },
    { tool: 'shell', verdict: 'ask' },
    { tool: 'shell', verdict: 'approve' },
  ];
  const overBlockingResult = auditDatasetBalance(overBlockingData);
  assert.equal(overBlockingResult.falseRefusalRisk, 'CRITICAL_OVER_BLOCKING_RISK');
  assert.equal(overBlockingResult.rates.approve, 20);
});

test('calculateShortcutLeakage catches predictable surface metadata heuristics', () => {
  const leakedData = Array.from({ length: 20 }, (_, i) => ({
    tool: i % 2 === 0 ? 'shell' : 'read',
    verdict: i % 2 === 0 ? 'deny' : 'approve',
    userMessage: 'Test user message',
    args: { cmd: 'test' },
  }));
  const result = calculateShortcutLeakage(leakedData);
  assert.equal(result.heuristics.toolNamePredictionRate, 100);
  assert.equal(result.status, 'HIGH_LEAKAGE_ALERT');
});

test('routeDisagreementsToQueue categorizes reviewer disputes accurately', () => {
  const proposals = [
    { id: 'c1', family: 'f1', tool: 'shell', userMessage: 'test 1', args: {} },
    { id: 'c2', family: 'f2', tool: 'edit', userMessage: 'test 2', args: {} },
  ];
  const reviews = [
    { model: 'model-a', decisions: [{ id: 'c1', verdict: 'approve' }, { id: 'c2', verdict: 'deny' }] },
    { model: 'model-b', decisions: [{ id: 'c1', verdict: 'ask' }, { id: 'c2', verdict: 'ask' }] },
  ];

  const triage = routeDisagreementsToQueue(proposals, reviews);
  assert.equal(triage.totalDisputedCases, 2);
  assert.equal(triage.categoryCounts.confirmation_ambiguity, 1);
  assert.equal(triage.categoryCounts.strictness_ambiguity, 1);
  assert.equal(triage.queue[0].id, 'c1');
  assert.equal(triage.queue[0].category, 'confirmation_ambiguity');
});

test('verifyCatalogRepresentation verifies 100% paired coverage with complete catalog examples', () => {
  const missing = require('../../xor/prototype/config/missing-catalog-topics.json');
  assert.equal(missing.scenarios.length, 7);

  const sampleRows = [];
  for (const s of missing.scenarios) {
    sampleRows.push({
      tool: s.tool,
      verdict: s.risky.expectedVerdict,
      args: s.risky.args,
      userMessage: s.risky.userMessage,
    });
    sampleRows.push({
      tool: s.counterpart.tool || s.tool,
      verdict: s.counterpart.expectedVerdict,
      args: s.counterpart.args,
      userMessage: s.counterpart.userMessage,
    });
  }

  const catalogResult = verifyCatalogRepresentation('docs/risky-command-catalog.md', sampleRows);
  const matched = catalogResult.topics.filter((t) => t.isPaired);
  assert.ok(matched.length >= 7);
});

test('evaluateTicketCompliance generates a comprehensive scorecard across tickets 56-63', () => {
  const mockQuality = {
    snapshot: 'test-snapshot',
    baseVerification: {
      integrity: 'passed',
      builderMatches: true,
      cases: 100,
      accepted: 90,
      excluded: 10,
      quarantinedFamilies: 0,
      coverageGaps: 0,
      blockers: [],
    },
    qualityAudit: {
      balance: {
        total: 100,
        rates: { approve: 50, deny: 25, ask: 25 },
        shell: { rates: { approve: 48, deny: 26, ask: 26 } },
        falseRefusalRisk: 'HEALTHY_BALANCED',
      },
      shortcutLeakage: { leakageScore: 52.4, status: 'LOW_LEAKAGE' },
      catalogCoverage: { totalCatalogTopics: 27, fullyPairedCount: 27, pairCoveragePercentage: 100 },
      disputeTriage: { totalDisputed: 0, categories: {} },
      humanAdjudication: {
        recordPath: 'docs/experiments/test.json',
        adjudicatedCases: 10,
        unresolvedCases: 0,
        remainingQuarantinedFamilies: 0,
        resultingAcceptedCases: 100,
        resultingBalance: {
          rates: { approve: 50, deny: 25, ask: 25 },
          shell: { rates: { approve: 48, deny: 26, ask: 26 } },
          falseRefusalRisk: 'HEALTHY_BALANCED',
        },
      },
      dynamicSyntaxWarnings: { total: 0, items: [] },
    },
    recommendations: [],
  };

  const scorecard = evaluateTicketCompliance(mockQuality);
  assert.equal(scorecard.tickets.length, 8);
  assert.equal(scorecard.overallScore, 10);
  assert.equal(scorecard.tickets[0].ticket, 56);
  assert.equal(scorecard.tickets[7].ticket, 63);
});
