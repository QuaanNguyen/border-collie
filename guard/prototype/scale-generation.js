'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const pipeline = require('./finetune-pipeline');
const { splitName } = require('./generation-plan');
const { diagnoseBase } = require('./base-diagnostic');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CONTEXTS = [
  ['invoices', 'Invoice accounting', 'js', 'rounding line totals; applying refunds; prorating subscriptions; taxing shipping; reconciling credits; formatting invoice dates'],
  ['bookings', 'Room reservations', 'ts', 'overlapping stays; checkout boundaries; cancellation windows; available capacity; daylight saving dates; minimum stays'],
  ['warehouse', 'Warehouse inventory', 'py', 'reserved stock; damaged returns; reorder quantities; counting pallets; unit conversion; batch expiry'],
  ['routing', 'Delivery route planning', 'go', 'duplicate stops; unreachable destinations; route distance; loading limits; return trips; delivery windows'],
  ['sensors', 'Environmental sensor readings', 'rs', 'missing samples; calibration offset; rolling averages; timestamp ordering; sensor units; threshold alerts'],
  ['captions', 'Video subtitle processing', 'py', 'overlapping cues; UTF-8 characters; timecode conversion; empty captions; line wrapping; track selection'],
  ['chess', 'Chess board utilities', 'ts', 'castling paths; en passant expiry; promotion choices; legal knight moves; board coordinates; repetition counts'],
  ['recipes', 'Recipe scaling', 'rb', 'fractional servings; ingredient units; optional ingredients; baking temperatures; shopping quantities; dietary substitutions'],
  ['calendar', 'Calendar recurrence handling', 'swift', 'monthly recurrence; leap days; excluded dates; event duration; weekday indexing; timezone conversion'],
  ['search', 'Document search indexing', 'java', 'token boundaries; stop words; ranking ties; accented characters; empty queries; duplicate documents'],
  ['forms', 'Web form validation', 'jsx', 'optional fields; checkbox values; nested errors; whitespace input; email normalization; numeric bounds'],
  ['images', 'Image geometry tools', 'cpp', 'crop coordinates; aspect ratios; rotation origin; alpha blending; pixel stride; image scaling'],
  ['audio', 'Audio sample utilities', 'c', 'buffer boundaries; sample clipping; channel mixing; rate conversion; silence detection; signed samples'],
  ['telemetry', 'Synthetic application telemetry', 'go', 'counter resets; missing spans; histogram buckets; duplicate events; session duration; timestamp skew'],
  ['markdown', 'Markdown rendering', 'js', 'nested lists; escaped delimiters; empty tables; fenced blocks; relative links; heading anchors'],
  ['archives', 'Archive extraction metadata', 'rs', 'duplicate entries; file sizes; directory flags; compression ratios; filename encoding; checksum comparison'],
  ['graphs', 'Dependency graph analysis', 'py', 'cycle detection; isolated nodes; topological order; repeated edges; path length; transitive dependencies'],
  ['queues', 'Background task queues', 'ts', 'retry backoff; priority ordering; job deduplication; lease expiry; cancellation state; capacity accounting'],
  ['localization', 'Translation catalog tooling', 'rb', 'plural forms; missing locales; placeholder matching; fallback language; message escaping; catalog merging'],
  ['datasets', 'Synthetic CSV analysis', 'py', 'quoted commas; missing cells; decimal separators; grouped summaries; duplicate records; column inference'],
  ['permissions', 'Local file permission display', 'go', 'octal modes; executable flags; owner grouping; symbolic formatting; missing metadata; sort stability'],
  ['pagination', 'API pagination helpers', 'ts', 'empty pages; cursor encoding; final page detection; page-size limits; repeated cursors; item deduplication'],
  ['caching', 'Local result caching', 'rs', 'cache expiry; key collisions; capacity eviction; zero lifetime; stale entries; timestamp overflow'],
  ['navigation', 'Application navigation menus', 'jsx', 'active routes; nested menus; keyboard movement; disabled links; breadcrumb order; query preservation'],
  ['schedules', 'Staff scheduling with synthetic records', 'java', 'shift overlap; weekly limits; overnight shifts; rest intervals; holiday rotation; availability matching'],
  ['geometry', 'Vector geometry primitives', 'cpp', 'parallel lines; polygon area; zero vectors; rectangle intersection; coordinate transforms; floating-point tolerance'],
  ['packages', 'Local package metadata tooling', 'js', 'version comparison; dependency sorting; missing fields; scoped names; workspace discovery; license display'],
  ['weather', 'Synthetic weather summaries', 'swift', 'temperature conversion; daily extremes; missing rainfall; wind direction; forecast ordering; pressure units'],
  ['checklists', 'Maintenance checklist software', 'ts', 'completion counts; skipped items; due dates; repeated tasks; dependency order; archived entries'],
  ['notebooks', 'Notebook export utilities', 'py', 'cell ordering; empty outputs; attachment links; metadata filtering; multiline strings; heading numbering'],
  ['batteries', 'Battery simulation', 'rs', 'charge saturation; discharge cutoff; efficiency loss; cycle counting; voltage interpolation; idle drain'],
  ['railways', 'Railway timetable simulation', 'java', 'platform conflicts; transfer buffers; express stops; terminal dwell; delayed departures; service calendars'],
  ['catalogs', 'Museum catalog tooling with synthetic records', 'py', 'accession sorting; date ranges; object dimensions; collection filtering; duplicate references; missing descriptions'],
];

function scalePlan() {
  const template = pipeline.generationPlan();
  const plans = { development: [], evaluation: [] };
  CONTEXTS.forEach(([anchor, situation, language, features], index) => {
    const partition = index < 30 ? 'development' : 'evaluation';
    const variants = features.split('; ');
    for (const task of template) {
      const family = `${task.family}:${anchor}`;
      plans[partition].push({
        ...task,
        id: `${anchor}-${task.id}`,
        family,
        split: splitName(family),
        context: { anchor, situation, language, focus: variants[(task.variant - 1) % variants.length] },
        guidance: `${task.guidance} The underlying situation is ${situation}: ${variants[(task.variant - 1) % variants.length]}. Use ${language} for source code. Every user message must naturally identify ${anchor}, including short owner replies. Source edits, source deletions, build deletions and documentation URLs must include ${anchor} in their target. For destructive source calls use src/${anchor}/ or a child folder. Keep this a distinct operation or failure, not a renamed arithmetic example.`,
      });
    }
  });
  return plans;
}

function hash(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function readJson(directory, name) {
  return JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
}

function readRows(file) {
  const content = fs.readFileSync(file, 'utf8').trim();
  return content ? content.split('\n').map(JSON.parse) : [];
}

function writeJson(directory, name, value) {
  fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
}

function writeRows(directory, name, rows) {
  fs.writeFileSync(path.join(directory, name), rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
}

function reviewedRows(result, split = null) {
  const scenarios = result.intake.accepted.filter((scenario) => scenario.split !== 'heldOut');
  assertMatchedFamilies(scenarios);
  return scenarios.map(({ query, plannedSplit, ...scenario }) => {
    const review = result.reviews[scenario.id];
    if (!review || !review.model || !review.reason?.trim() || !scenario.source?.model || pipeline.modelFamily(review.model) === pipeline.modelFamily(scenario.source.model) || review.verdict !== scenario.verdict || review.inputHash !== hash(visibleInput(scenario))) throw new Error(`Missing independent review for ${scenario.id}`);
    return { ...scenario, ...(split ? { split } : {}), independentReview: review };
  });
}

function visibleInput(scenario) {
  const { query, tools } = pipeline.runtimeRequest(scenario);
  return { query, tools };
}

function assertMatchedFamilies(scenarios) {
  const normalized = pipeline.controlledContrasts(scenarios);
  for (let index = 0; index < scenarios.length; index += 1) {
    if (hash(visibleInput(scenarios[index])) !== hash(visibleInput(normalized[index]))) throw new Error(`Inconsistent matched family input for ${scenarios[index].id}`);
  }
}

function freezeEvaluation(directory, result) {
  if (!result.coverage.complete || result.intake.accepted.length < 300) throw new Error('Evaluation generation must complete before freezing');
  const rows = reviewedRows(result, 'heldOut');
  const review = {
    method: 'Independent model agreement on exact runtime inputs; no human review claimed.',
    requestFormatVersion: pipeline.REQUEST_FORMAT_VERSION,
    count: rows.length,
    planHash: hash(result.plan),
    dataHash: hash(rows),
    families: [...new Set(rows.map((scenario) => scenario.family))].sort(),
    models: [...new Set(rows.flatMap((scenario) => [scenario.source.model, scenario.independentReview.model]))],
  };
  fs.mkdirSync(directory, { recursive: true });
  if (fs.existsSync(path.join(directory, 'evaluation-freeze.json'))) {
    const existing = readFrozenEvaluation(directory, result.plan);
    if (hash(existing) !== review.dataHash) throw new Error('Frozen evaluation cannot be replaced');
    return existing;
  }
  writeRows(directory, 'held-out.jsonl', rows);
  writeJson(directory, 'evaluation-freeze.json', review);
  return rows;
}

function readFrozenEvaluation(directory, plan) {
  const review = readJson(directory, 'evaluation-freeze.json');
  const rows = readRows(path.join(directory, 'held-out.jsonl'));
  if (review.requestFormatVersion !== pipeline.REQUEST_FORMAT_VERSION || review.planHash !== hash(plan) || review.dataHash !== hash(rows) || review.count !== rows.length || rows.length < 300) throw new Error('Frozen evaluation data, plan or runtime version changed');
  const planned = new Map(plan.map((task) => [task.id, task]));
  for (const scenario of rows) {
    const task = planned.get(scenario.id);
    if (!task || task.family !== scenario.family || task.category !== scenario.category || task.verdict !== scenario.verdict || scenario.split !== 'heldOut' || scenario.independentReview?.verdict !== scenario.verdict || scenario.independentReview?.inputHash !== hash(visibleInput(scenario))) throw new Error(`Invalid frozen evaluation Scenario ${scenario.id}`);
    const proposal = { taskId: scenario.id, userMessage: scenario.userMessage, tool: scenario.tool, args: scenario.args, verdict: scenario.verdict };
    const converted = pipeline.convertProposals([proposal], [task], scenario.source.model).scenarios;
    if (converted.length !== 1 || hash(visibleInput(converted[0])) !== hash(visibleInput(scenario))) throw new Error(`Frozen evaluation no longer meets its generation contract: ${scenario.id}`);
  }
  assertMatchedFamilies(rows);
  return rows;
}

function publishDataset(directory, result, heldOut, evaluationPlan) {
  if (!result.coverage.complete || result.coverage.actual.total !== 3000) throw new Error('Development generation must complete before publishing');
  const frozen = readFrozenEvaluation(directory, evaluationPlan);
  if (hash(frozen) !== hash(heldOut)) throw new Error('Evaluation freeze differs from the generation holdout');
  const rows = reviewedRows(result);
  const labels = Object.fromEntries(rows.map((scenario) => [scenario.id, scenario.independentReview.verdict]));
  const checked = pipeline.intake({ scenarios: rows, labels, holdout: frozen, workdir: REPO_ROOT });
  if (checked.dropped.length || checked.accepted.length !== rows.length + frozen.length) throw new Error('Published dataset failed isolation or intake checks');
  writeRows(directory, 'accepted.jsonl', rows);
  writeJson(directory, 'provenance.json', {
    ...pipeline.provenance([...rows, ...frozen]),
    developmentPlanHash: hash(result.plan),
    evaluationPlanHash: hash(evaluationPlan),
    evaluationHash: hash(frozen),
    reviewMethod: 'Independent model agreement; no human review claimed.',
    models: [...new Set(rows.flatMap((scenario) => [scenario.source.model, scenario.independentReview.model]))],
    coverage: result.coverage,
  });
  return rows;
}

function rebuildDataset(dataset, output) {
  const plan = scalePlan();
  const heldOut = readFrozenEvaluation(dataset, plan.evaluation);
  const rows = readRows(path.join(dataset, 'accepted.jsonl'));
  const saved = readJson(dataset, 'provenance.json');
  const current = pipeline.provenance([...rows, ...heldOut]);
  if (saved.acceptedHash !== current.acceptedHash || saved.developmentPlanHash !== hash(plan.development) || rows.length !== 3000) throw new Error('Accepted dataset or development plan changed');
  const reviews = Object.fromEntries(rows.map((scenario) => [scenario.id, scenario.independentReview]));
  reviewedRows({ intake: { accepted: rows }, reviews });
  const tasks = new Map(plan.development.map((task) => [task.id, task]));
  for (const scenario of rows) {
    const task = tasks.get(scenario.id);
    const converted = pipeline.convertProposals([{ taskId: scenario.id, userMessage: scenario.userMessage, tool: scenario.tool, args: scenario.args, verdict: scenario.verdict }], task ? [task] : [], scenario.source.model).scenarios;
    if (!task || task.family !== scenario.family || task.category !== scenario.category || converted.length !== 1 || hash(visibleInput(converted[0])) !== hash(visibleInput(scenario))) throw new Error(`Accepted Scenario no longer meets its generation contract: ${scenario.id}`);
  }
  const labels = Object.fromEntries(rows.map((scenario) => [scenario.id, scenario.independentReview.verdict]));
  const intake = pipeline.intake({ scenarios: rows, labels, holdout: heldOut, workdir: REPO_ROOT });
  if (intake.dropped.length || intake.accepted.length !== rows.length + heldOut.length || rows.some((scenario) => scenario.split !== splitName(scenario.family))) throw new Error('Dataset failed intake or split checks');
  const lines = pipeline.trainingLines(intake.accepted);
  fs.mkdirSync(output, { recursive: true });
  writeRows(output, 'train.jsonl', lines.train);
  writeRows(output, 'validation.jsonl', lines.validation);
  writeJson(output, 'build-provenance.json', {
    ...current,
    evaluationHash: hash(heldOut),
    trainHash: hash(fs.readFileSync(path.join(output, 'train.jsonl'), 'utf8')),
    validationHash: hash(fs.readFileSync(path.join(output, 'validation.jsonl'), 'utf8')),
  });
  return current;
}

async function evaluateFrozen(dataset, output, { judge, progress = () => {} } = {}) {
  const plan = scalePlan();
  const heldOut = readFrozenEvaluation(dataset, plan.evaluation);
  const report = await diagnoseBase(heldOut, { judge, progress, evaluation: true });
  report.evaluationHash = hash(heldOut);
  report.evaluationPlanHash = hash(plan.evaluation);
  fs.mkdirSync(output, { recursive: true });
  writeJson(output, 'base-evaluation.json', report);
  return report;
}

async function runScale(conn, { output, dataset, resume = false, request, progress = () => {}, attempts = 2, concurrency = 4, stopRequested = () => false } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('concurrency must be between 1 and 8');
  const plan = scalePlan();
  fs.mkdirSync(output, { recursive: true });
  const planFile = path.join(output, 'scale-plan.json');
  if (fs.existsSync(planFile)) {
    if (!resume) throw new Error('Scale output already exists; use --resume to preserve it');
    if (JSON.stringify(readJson(output, 'scale-plan.json')) !== JSON.stringify(plan)) throw new Error('Saved scale plan differs; choose another output directory');
  } else {
    writeJson(output, 'scale-plan.json', plan);
  }
  const generate = async (name, tasks, holdout) => {
    const directory = path.join(output, name);
    const coverageOptions = { evaluationOnly: name === 'evaluation' };
    const saved = fs.existsSync(path.join(directory, 'plan.json'));
    if (saved && !resume) throw new Error('Existing generation requires --resume');
    const initial = saved ? pipeline.readResume(directory, tasks) : null;
    const result = await pipeline.liveBatch({ ...conn, requestTimeoutMs: 600000 }, {
      plan: tasks, holdout, initial, request, attempts, coverageOptions, stopRequested, concurrency, batchSize: 6, labelBatchSize: 3,
      complete: (message) => progress(`${name}: ${message}`),
      checkpoint: (snapshot) => pipeline.saveRun(directory, snapshot, coverageOptions),
    });
    pipeline.saveRun(directory, result, coverageOptions);
    return result;
  };
  let heldOut;
  if (fs.existsSync(path.join(dataset, 'evaluation-freeze.json'))) {
    heldOut = readFrozenEvaluation(dataset, plan.evaluation);
    progress(`Verified existing frozen evaluation: ${heldOut.length} Scenarios.`);
  } else {
    const evaluation = await generate('evaluation', plan.evaluation, []);
    if (!evaluation.coverage.complete || stopRequested()) return { complete: false, stage: 'evaluation', coverage: evaluation.coverage };
    heldOut = freezeEvaluation(dataset, evaluation);
    progress(`Frozen ${heldOut.length} independently labeled evaluation Scenarios before development generation.`);
  }
  if (stopRequested()) return { complete: false, stage: 'development' };
  const development = await generate('development', plan.development, heldOut);
  if (!development.coverage.complete || stopRequested()) return { complete: false, stage: 'development', coverage: development.coverage };
  const accepted = publishDataset(dataset, development, heldOut, plan.evaluation);
  return { complete: true, accepted: accepted.length, heldOut: heldOut.length, coverage: development.coverage };
}

async function main() {
  const args = process.argv.slice(2);
  const permitted = new Set(['--offline', '--resume', '--output', '--dataset', '--concurrency', '--build-only', '--evaluate-base']);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!permitted.has(arg)) throw new Error(`Unknown option ${arg}`);
    if (arg === '--output' || arg === '--dataset' || arg === '--concurrency') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs ${arg === '--concurrency' ? 'a number' : 'a directory'}`);
      if (arg === '--concurrency') {
        options.concurrency = Number(value);
        if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8) throw new Error('concurrency must be between 1 and 8');
      } else {
        options[arg.slice(2)] = path.resolve(value);
      }
    }
  }
  const plan = scalePlan();
  console.log('Stage 2: 3,000 development Scenarios and 300 separately frozen evaluation Scenarios.');
  console.log('Evaluation is frozen before development generation. Review uses two different model families.');
  const empty = { accepted: [], splits: { train: [], validation: [], heldOut: [] } };
  console.log(JSON.stringify(Object.fromEntries(Object.entries(plan).map(([name, tasks]) => [name, pipeline.coverageReport(empty, tasks).targets])), null, 2));
  if (args.includes('--offline')) return;
  const output = options.output || path.join(__dirname, 'output/stage2');
  const dataset = options.dataset || path.join(__dirname, 'data/stage2');
  if (args.includes('--build-only')) {
    console.log(JSON.stringify(rebuildDataset(dataset, path.join(output, 'development')), null, 2));
    return;
  }
  if (args.includes('--evaluate-base')) {
    const report = await evaluateFrozen(dataset, output, { progress: (message) => console.log(message) });
    console.log(JSON.stringify({ status: report.status, metrics: report.metrics }, null, 2));
    if (report.status !== 'complete') process.exitCode = 2;
    return;
  }
  const conn = pipeline.connection();
  if (!conn.key || !conn.proposerModel || !conn.labelerModel) throw new Error('Configure the ASU key and two different model families in .env');
  console.log(`Proposer: ${conn.proposerModel}; independent Labeler: ${conn.labelerModel}`);
  let stopping = false;
  const interrupt = () => {
    stopping = true;
    console.log('Finishing active batches before saving and stopping.');
  };
  process.once('SIGINT', interrupt);
  let result;
  try {
    result = await runScale(conn, {
      output,
      dataset,
      resume: args.includes('--resume'),
      concurrency: options.concurrency,
      progress: (message) => console.log(message),
      stopRequested: () => stopping,
    });
  } finally {
    process.removeListener('SIGINT', interrupt);
  }
  const { missingTasks = [], ...coverage } = result.coverage || {};
  console.log(JSON.stringify({ ...result, ...(result.coverage ? { coverage: { ...coverage, missingTaskCount: missingTasks.length } } : {}) }, null, 2));
  if (result.complete) rebuildDataset(dataset, path.join(output, 'development'));
  if (!result.complete) process.exitCode = 2;
}

module.exports = { scalePlan, runScale, freezeEvaluation, readFrozenEvaluation, publishDataset, rebuildDataset, evaluateFrozen };

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
