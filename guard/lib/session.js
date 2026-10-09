'use strict';
const { scan } = require('./injection');
const { detectClaims, verify } = require('./verify');
const { captureRepositoryState } = require('./repository');
const { proposedCall, truncate } = require('./toolcalls');
const { toolFailed } = require('./toolerror');
const { boundaryDecision } = require('./boundary');
const { withDefaults } = require('./preference');

const GENERIC_CLAIM = /\b(done|complete[d]?|finished|all set|that'?s it)\b/i;
const TARGET_KEYS = ['command', 'cmd', 'url', 'query', 'filePath', 'file_path', 'path', 'pattern', 'source', 'destination', 'subagent_type'];

function repositoryPatterns(doneCriteria) {
  const patterns = [];
  for (const criterion of doneCriteria) {
    for (const check of criterion.checks || []) {
      if (check.type !== 'repository_state') continue;
      if (check.allow_ignored === false) patterns.push('**');
      patterns.push(...(check.allowed_paths || []), ...(check.forbidden_paths || []));
    }
  }
  return [...new Set(patterns)];
}

function targetOf(call) {
  const declared = TARGET_KEYS.map((key) => call.args?.[key]).find((value) => typeof value === 'string' && value.trim());
  return declared || call.writePaths[0] || call.readPaths[0] || call.urls[0] || call.tool;
}

function refusalMessage(call, { rule, decidedBy, reason, alternative }) {
  return [
    'Guard refused this action.',
    'Requested action: ' + call.tool,
    'Target: ' + targetOf(call),
    'Governing rule: ' + rule,
    'Decided by: ' + decidedBy,
    'Reason: ' + reason,
    'Permitted alternative: ' + alternative,
    'Retry: do not retry this target; choose a different action or ask the owner.',
  ].join('\n');
}

function askMessage(call, preference) {
  return [
    'Guard is holding this action for the owner.',
    'Requested action: ' + call.tool,
    'Target: ' + targetOf(call),
    'Reason: the folder Preference asks the owner first: ' + preference.ask,
    "Next step: ask the owner whether to proceed, then wait for the owner's reply.",
    "Retry: only after the owner answers; the owner's reply is judged with the next attempt.",
  ].join('\n');
}

function judgeRefusal(judgment) {
  if (judgment.unavailable) {
    return { rule: 'judge_unavailable', reason: judgment.reason || 'the Judge is not installed', alternative: 'Ask the owner to run bdc install.' };
  }
  if (judgment.verdict === null) {
    return { rule: 'judge_no_verdict', reason: judgment.reason || 'the Judge returned no Verdict', alternative: "Choose a different action that serves the user's request." };
  }
  return {
    rule: 'judge',
    reason: 'the Judge found this action outside the folder Preference',
    alternative: "Choose a different action that serves the user's request within the folder Preference.",
  };
}

function createSession(opts = {}) {
  const workdir = opts.workdir || process.cwd();
  const judge = typeof opts.judge === 'function' ? opts.judge : null;
  let preference = withDefaults(opts.preference || {});
  const settled = new Set();
  const repository = captureRepositoryState(workdir, { ignoredPatterns: repositoryPatterns(preference.done_criteria) });
  let askedAboutDone = false;
  const seenResults = new Set();
  const remediationAttempts = new Map();
  let terminal = false;
  let actionSeq = 0;

  function handle(event) {
    if (!event || !event.kind) return { events: [] };
    if (event.kind === 'session.start') return start();
    if (event.kind === 'session.end') {
      return { events: [{ type: 'run', status: 'end', petState: 'calm', summary: 'session ended' }] };
    }
    if (event.kind === 'busy' || event.kind === 'thinking') {
      return { events: [{ type: 'thinking', status: 'ok', petState: 'thinking', summary: 'waiting on the model' }] };
    }
    if (event.kind === 'idle') {
      return { events: [{ type: 'thinking', status: 'idle', petState: 'calm', summary: 'agent idle' }] };
    }
    if (event.kind === 'tool.after') return toolAfter(event);
    if (event.kind === 'assistant') return assistant(event);
    return { events: [] };
  }

  function summary() {
    return {
      workdir,
      purpose: preference.purpose,
      allow: preference.allow,
      disallow: preference.disallow,
      ask: preference.ask,
      done_criteria: preference.done_criteria.map((d) => ({ id: d.id, describe: d.describe || d.id })),
    };
  }

  function start() {
    return {
      events: [
        {
          type: 'run', status: 'start', petState: 'calm', summary: 'session started',
          detail: { workdir },
        },
        {
          type: 'protocol', status: 'ok', petState: 'calm',
          summary: truncate(preference.purpose, 60),
          detail: summary(),
        },
      ],
    };
  }

  function refuse(call, actionId, events, refusal) {
    events.push({
      type: 'excursion', status: 'block', petState: 'refused',
      tool: call.tool, summary: truncate(call.summary, 70),
      reason: refusal.reason, rule: refusal.rule,
      detail: { kind: call.kind, actionId },
    });
    return { decision: 'disallow', message: refusalMessage(call, refusal), events };
  }

  async function propose(event) {
    const call = proposedCall(event.tool || 'tool', event.args || {});
    if (call.tool === 'question') return { decision: 'allow', events: [] };

    if (terminal) {
      return {
        decision: 'disallow',
        message: 'Guard stopped this session after unverified completion claims. Wait for a corrected task or Preference.',
        events: [{
          type: 'excursion', status: 'block', petState: 'refused',
          tool: call.tool, summary: 'completion evaluation stopped the session',
          reason: 'human action is required before further tool use',
          rule: 'completion_terminal',
        }],
      };
    }

    const actionId = `a${++actionSeq}`;
    const events = [
      { type: 'thinking', status: 'ok', petState: 'watching', summary: 'it wants to do something', detail: { actionId } },
      { type: 'thinking', status: 'ok', petState: 'checking', summary: 'checking one action', detail: { actionId } },
    ];

    const boundary = boundaryDecision({ call, workdir });
    if (boundary) return refuse(call, actionId, events, { ...boundary, decidedBy: 'folder boundary' });

    let judgment;
    if (!judge) {
      judgment = { verdict: null, unavailable: true, reason: 'no Judge is configured for this session' };
    } else {
      try {
        judgment = await judge({ userMessage: event.userMessage || '', preference, call });
      } catch (error) {
        judgment = { verdict: null, reason: `the Judge failed: ${error.message}` };
      }
    }
    const verdict = judgment?.verdict ?? null;

    if (verdict === 'allow') {
      events.push({
        type: 'action', status: 'allow', petState: 'allowed',
        tool: call.tool, summary: truncate(call.summary, 70),
        detail: { actionId },
      });
      return { decision: 'allow', events };
    }
    if (verdict === 'ask') {
      events.push({
        type: 'ask', status: 'ask', petState: 'asking',
        tool: call.tool, summary: truncate(`${call.summary} needs the owner`, 60),
        reason: preference.ask || 'the Judge asked for the owner',
        rule: 'judge',
        detail: { actionId },
      });
      return { decision: 'ask', message: askMessage(call, preference), events };
    }
    return refuse(call, actionId, events, { ...judgeRefusal(judgment || {}), decidedBy: 'Judge' });
  }

  function toolAfter(event) {
    const events = [];
    const tool = event.tool || 'tool';
    const content = event.status === 'error'
      ? (event.error && event.error.message) || String(event.result || '')
      : (typeof event.result === 'string' ? event.result : JSON.stringify(event.result || ''));
    const key = event.id || content.slice(0, 200);
    if (seenResults.has(key)) return { events };
    seenResults.add(key);

    const failureLine = event.status === 'error' ? (content || 'tool failed') : toolFailed(content);
    if (failureLine) {
      events.push({
        type: 'toolerror', status: 'error', petState: 'error',
        tool, summary: `${tool} failed`, reason: truncate(failureLine, 120),
      });
    }

    const found = scan(content);
    if (found.level) {
      events.push({
        type: 'suspicious', status: 'warn', petState: 'suspicious',
        tool, summary: 'something in that file is talking to the agent',
        reason: found.labels.join(', '),
        detail: { severity: found.level, score: found.score, labels: found.labels, excerpt: found.excerpt },
      });
    }

    return { events };
  }

  function assistant(event) {
    const text = event.text || '';
    const doneCriteria = preference.done_criteria;

    if (!doneCriteria.length) {
      if (event.completed === true && GENERIC_CLAIM.test(text) && !askedAboutDone) {
        askedAboutDone = true;
        return {
          events: [{
            type: 'ask', status: 'ask', petState: 'asking',
            summary: 'it says it is done, and this folder declared no way to check',
            reason: 'no done_criteria in the Preference  -  a human has to look',
            detail: { said: truncate(text, 160) },
          }],
        };
      }
      return { events: [] };
    }

    const pending = doneCriteria.filter((criterion) => !settled.has(criterion.id));
    if (!pending.length || event.error || event.completed !== true || terminal) return { events: [] };
    const claimed = detectClaims(text, pending);
    if (!claimed.length) return { events: [] };

    const results = claimed.map((criterion) => ({
      criterion,
      result: verify(criterion, workdir, { repository, claims: event.claims }),
    }));
    const failed = results.filter(({ result }) => !result.pass);
    const events = [{
      type: 'claim', status: 'open', petState: 'proving',
      summary: 'checking whether the task is complete',
      detail: { criteria: pending.map((criterion) => criterion.id) },
    }];

    if (!failed.length) {
      for (const criterion of claimed) settled.add(criterion.id);
      events.push({
        type: 'verdict', status: 'pass', petState: 'celebrating',
        summary: settled.size === doneCriteria.length
          ? 'all completion checks passed'
          : 'claimed completion checks passed',
        detail: { criteria: results.map(({ result }) => result) },
      });
      return { events };
    }

    const reason = failed.map(({ result }) => result.summary).join('; ');
    const reachedLimit = failed.some(({ criterion }) => {
      const attempts = (remediationAttempts.get(criterion.id) || 0) + 1;
      remediationAttempts.set(criterion.id, attempts);
      return attempts > 2;
    });
    if (reachedLimit) terminal = true;
    events.push({
      type: 'verdict', status: 'fail', petState: 'rejecting',
      summary: terminal ? `evaluation stopped  -  ${truncate(reason, 60)}` : `not finished  -  ${truncate(reason, 60)}`,
      reason,
      detail: { criteria: results.map(({ result }) => result), terminal },
    });

    const lines = failed.flatMap(({ criterion, result }) => [
      `  - claim: ${criterion.describe || criterion.id}`,
      ...result.checks.filter((c) => !c.pass).map((c) => `    evidence check failed: ${c.evidence}`),
    ]);

    const inject = terminal
      ? [
        'Evaluation stopped. Tell the user:',
        ...lines,
        'Wait for a corrected task or Preference. Do not call tools.',
      ].join('\n')
      : [
        'Guard did not accept this as done:',
        ...lines,
        'Address the failed evidence, then report completion again.',
      ].join('\n');

    return { inject, events };
  }

  function replacePreference(nextPreference) {
    preference = withDefaults(nextPreference || {});
    settled.clear();
    remediationAttempts.clear();
    terminal = false;
    askedAboutDone = false;
  }

  return {
    handle,
    propose,
    replacePreference,
    get preference() { return preference; },
  };
}

module.exports = { createSession };
