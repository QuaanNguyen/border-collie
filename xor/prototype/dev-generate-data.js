'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { plan } = require('./author-checker-data');
const { digest, reviewPacket, reviewedRows, REVIEW_INSTRUCTION_HASH } = require('./checker-data');

const reviewers = [{ model: 'gemma4-31b-it', family: 'gemma', label: 'Gemma' }, { model: 'glm-5-3-flash', family: 'glm', label: 'GLM' }];
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
};
const checkpoint = (state) => digest([state.accepted, state.calls, state.errors, state.blockedTaskIds]);
const bar = (count, total) => '[' + '#'.repeat(total ? Math.floor(10 * count / total) : 0).padEnd(10, '.') + ']';

function progress(directory, phase) {
  const planned = read(path.join(directory, 'plan.json'));
  const state = read(path.join(directory, 'state.json'));
  const acceptedIds = new Set(state.accepted.map((row) => row.id));
  const rows = planned.tasks.map((task) => state.accepted.find((row) => row.id === task.taskId)).filter(Boolean);
  const snapshot = path.join(directory, 'dev-reviews', digest(rows));
  const packets = reviewPacket(rows);
  const inputHash = digest(packets);
  if (fs.existsSync(snapshot)) {
    const manifest = read(path.join(snapshot, 'manifest.json'));
    const packet = read(path.join(snapshot, 'review-packet.json'));
    const contents = fs.readFileSync(path.join(snapshot, 'proposals.jsonl'), 'utf8');
    const expected = rows.map(JSON.stringify).join('\n') + '\n';
    if (contents !== expected || manifest.proposalsSha256 !== digest(contents) || manifest.requestsSha256 !== inputHash || manifest.planSha256 !== state.planSha256 || packet.instructionHash !== REVIEW_INSTRUCTION_HASH || digest(packet.instructions) !== REVIEW_INSTRUCTION_HASH || digest(packet.requests) !== inputHash) throw new Error(`Invalid frozen snapshot in ${snapshot}`);
  }
  const reviews = reviewers.map(({ model, family }) => {
    const file = path.join(snapshot, `review-${model}.json`);
    if (!fs.existsSync(file)) return { model, modelFamily: family, instructionHash: REVIEW_INSTRUCTION_HASH, decisions: [] };
    const value = read(file);
    if (value.model !== model || value.modelFamily !== family || value.instructionHash !== REVIEW_INSTRUCTION_HASH || value.inputHash !== inputHash || !Array.isArray(value.decisions) || new Set(value.decisions.map((row) => row.id)).size !== value.decisions.length || value.decisions.some((row) => !packets.some((packet) => packet.id === row.id && packet.inputHash === row.inputHash) || !['approve', 'deny', 'ask', 'abstain'].includes(row.verdict))) throw new Error(`Invalid or stale ${model} review in ${snapshot}`);
    return value;
  });
  const complete = rows.length > 0 && reviews.every((review) => review.decisions.length === rows.length);
  const agreed = complete ? reviewedRows(rows, reviews) : null;
  const attempts = new Map();
  for (const call of state.calls) for (const id of call.taskIds) attempts.set(id, (attempts.get(id) || 0) + 1);
  return {
    phase, planned: planned.tasks.length, generated: rows.length, reviews: reviews.map((review) => review.decisions.length),
    accepted: agreed?.accepted.length ?? null, excluded: agreed?.quarantine.length ?? null,
    verdicts: Object.fromEntries(['approve', 'deny', 'ask'].map((verdict) => [verdict, agreed?.accepted.filter((row) => row.verdict === verdict).length ?? 0])),
    blocked: state.blockedTaskIds?.length || 0,
    exhausted: planned.tasks.filter((task) => !acceptedIds.has(task.taskId) && (attempts.get(task.taskId) || 0) >= planned.config.maxAttemptsPerTask).length,
    failed: state.calls.filter((call) => ['failed', 'rejected'].includes(call.status)).length,
    uncertain: state.calls.filter((call) => call.status === 'reserved').length, calls: state.calls.length, maxCalls: planned.config.maxCalls,
    snapshot, state, config: planned.config,
  };
}

function display(value) {
  return [
    `${value.phase} | Generated ${bar(value.generated, value.planned)} ${value.generated}/${value.planned}`,
    ...reviewers.map(({ label }, index) => `${label.padEnd(7)} ${bar(value.reviews[index], value.generated)} ${value.reviews[index]}/${value.generated}`),
    `Accepted ${value.accepted ?? 'pending'} | Excluded ${value.excluded ?? 'pending'} | approve ${value.verdicts.approve} deny ${value.verdicts.deny} ask ${value.verdicts.ask}`,
    `Calls ${value.calls}/${value.maxCalls} | failed ${value.failed} exhausted ${value.exhausted} blocked ${value.blocked} uncertain ${value.uncertain}`,
  ];
}

function authorStop(value, directory) {
  if (value.generated === value.planned) return 'generation complete';
  if (fs.existsSync(path.join(directory, 'STOP-AUTHORING'))) return 'STOP-AUTHORING exists';
  if (fs.existsSync(directory + '.dev-stop')) return 'interrupted; checkpoints preserved';
  if (value.calls >= value.config.maxCalls) return 'author call limit reached';
  if (value.state.elapsedMs >= value.config.maxElapsedMs) return 'author elapsed limit reached';
  const charged = value.state.calls.reduce((sum, call) => sum + (call.chargedTokens ?? call.reservedTokens), 0);
  if (charged + value.config.maxInputTokens + value.config.maxOutputTokens > value.config.maxTokens) return 'author token limit reached';
  return null;
}

async function main(args) {
  if (args.includes('--help')) {
    if (args.length !== 1) throw new Error('Use --help by itself');
    console.log('Usage: npm run dev:generate-data -- [study-directory] [--status]\nGemma generates cases; Gemma and GLM review them. --status reads once without API calls.');
    return;
  }
  if (args.filter((arg) => arg === '--status').length > 1 || args.some((arg) => arg.startsWith('-') && arg !== '--status') || args.filter((arg) => arg !== '--status').length > 1) throw new Error('Usage: npm run dev:generate-data -- [study-directory] [--status]');
  const explicit = args.find((arg) => arg !== '--status');
  const activeFile = path.join(__dirname, 'output/checker-active-study.json');
  const active = !explicit && fs.existsSync(activeFile) ? read(activeFile) : null;
  if (active && (typeof active.directory !== 'string' || typeof active.planSha256 !== 'string')) throw new Error('Invalid active study receipt');
  const selected = path.resolve(explicit || (active ? path.resolve(__dirname, '../..', active.directory) : path.join(__dirname, 'output/checker-authoring')));
  if (active && digest(read(path.join(selected, 'plan.json'))) !== active.planSha256) throw new Error('Active study plan changed; inspect its repair receipt before resuming');
  if (args.includes('--status')) {
    console.log(`Study ${selected}`);
    console.log(display(progress(selected, 'Status')).join('\n'));
    return;
  }
  fs.mkdirSync(path.dirname(selected), { recursive: true });
  const directory = fs.existsSync(selected) ? fs.realpathSync(selected) : path.join(fs.realpathSync(path.dirname(selected)), path.basename(selected));
  const lock = directory + '.dev-lock';
  const owner = { pid: process.pid, hostname: os.hostname(), token: crypto.randomUUID() };
  try {
    fs.writeFileSync(lock, JSON.stringify(owner) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = fs.readFileSync(lock, 'utf8').match(/"pid"\s*:\s*(\d+)/)?.[1] || 'unknown';
    throw new Error(`Another runner owns ${lock}, PID ${pid}. Check its owner before manually removing an abandoned lock.`);
  }
  let child;
  let interrupted = false;
  let phase = 'Starting';
  let previous = '';
  let renderedRows = 0;
  let timer;
  const interrupt = () => {
    if (child) child.kill(interrupted ? 'SIGKILL' : 'SIGTERM');
    interrupted = true;
  };
  const render = () => {
    const lines = display(progress(directory, phase)).flatMap((line) => {
      if (!process.stdout.isTTY) return [line];
      const width = Math.max(1, (process.stdout.columns || 80) - 1);
      const wrapped = [];
      while (line.length > width) {
        const end = line.lastIndexOf(' ', width) > 0 ? line.lastIndexOf(' ', width) : width;
        wrapped.push(line.slice(0, end));
        line = line.slice(end).trimStart();
      }
      return [...wrapped, line];
    });
    while (process.stdout.isTTY && lines.length < renderedRows) lines.push('');
    const text = lines.join(process.stdout.isTTY ? '\n' : ' | ');
    if (text === previous) return;
    if (process.stdout.isTTY && renderedRows) process.stdout.write(`\x1b[${renderedRows}A`);
    process.stdout.write((process.stdout.isTTY ? lines.map((line) => '\x1b[2K' + line).join('\n') : text) + '\n');
    previous = text;
    renderedRows = lines.length;
  };
  const run = async (script, childArgs) => {
    if (interrupted) return null;
    const log = fs.openSync(path.join(directory, 'dev-generation.log'), 'a', 0o600);
    try {
      return await new Promise((resolve, reject) => {
        child = spawn(process.execPath, [path.join(__dirname, script), ...childArgs], { stdio: ['ignore', log, log] });
        child.once('error', reject);
        child.once('close', (code, signal) => { child = null; resolve(signal ? 1 : code); });
      });
    } finally {
      fs.closeSync(log);
    }
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    if (!fs.existsSync(directory)) plan(read(path.resolve(__dirname, '../../docs/checker-tool-inventory.json')), read(path.join(__dirname, 'config/checker-authoring-full.json')), directory);
    if (progress(directory, phase).config.authorModel !== reviewers[0].model) throw new Error('This command requires a Gemma author plan; preserve other studies and choose a new directory.');
    console.log(`Study ${directory}\nGemma generates; Gemma and GLM review. Ctrl-C stops this runner.\nDiagnostics ${path.join(directory, 'dev-generation.log')}`);
    const sessionFile = path.join(directory, 'dev-runner.json');
    const session = fs.existsSync(sessionFile) ? read(sessionFile) : { snapshots: {} };
    const save = () => write(sessionFile, session);
    timer = setInterval(() => {
      if (fs.existsSync(directory + '.dev-stop')) interrupt();
      try { render(); } catch (error) { console.error(error.message); interrupt(); }
    }, 100);
    phase = 'Generating';
    render();
    let stop;
    for (;;) {
      if (fs.existsSync(directory + '.dev-stop')) interrupt();
      const before = progress(directory, phase);
      stop = authorStop(before, directory);
      if (stop || interrupted) break;
      const code = await run('author-checker-data.js', ['author', directory, '1']);
      render();
      if (interrupted || fs.existsSync(directory + '.dev-stop')) {
        interrupt();
        break;
      }
      if (code !== 0) { stop = 'author process failed; inspect diagnostics'; break; }
      const after = progress(directory, phase);
      if (checkpoint(before.state) === checkpoint(after.state)) { stop = 'no eligible author tasks or no checkpoint progress'; break; }
      if (after.failed > before.failed) await delay(Math.min(5000, 1000 * after.state.consecutiveErrors));
    }
    let value = progress(directory, phase);
    if (!interrupted && value.generated) {
      phase = 'Freezing';
      render();
      if (!fs.existsSync(value.snapshot)) {
        const staging = value.snapshot + '.pending-' + crypto.randomUUID();
        try {
          const code = await run('author-checker-data.js', ['freeze', directory, staging]);
          if (!interrupted) {
            if (code !== 0) throw new Error('Snapshot creation failed; inspect diagnostics');
            fs.renameSync(staging, value.snapshot);
          }
        } finally {
          fs.rmSync(staging, { recursive: true, force: true });
        }
      }
      session.snapshots[path.basename(value.snapshot)] ??= {};
      const launches = session.snapshots[path.basename(value.snapshot)];
      for (const [index, reviewer] of reviewers.entries()) {
        let attempts = 0;
        for (;;) {
          value = progress(directory, phase);
          if (interrupted || value.reviews[index] === value.generated || attempts >= 2 || fs.existsSync(path.join(value.snapshot, 'STOP-REVIEWS'))) break;
          attempts += 1;
          launches[reviewer.model] = (launches[reviewer.model] || 0) + 1;
          save();
          phase = `Reviewing ${reviewer.label}`;
          render();
          await run('review-checker-data.js', [value.snapshot, reviewer.model, reviewer.family]);
          render();
          if (!interrupted && progress(directory, phase).reviews[index] < value.generated) await delay(1000);
        }
      }
    }
    phase = interrupted ? 'Interrupted' : 'Stopped';
    render();
    value = progress(directory, phase);
    session.stopReason = interrupted ? 'interrupted; checkpoints preserved' : stop;
    session.activeSnapshot = fs.existsSync(value.snapshot) ? value.snapshot : null;
    session.updatedAt = new Date().toISOString();
    save();
    console.log(`Reason ${session.stopReason}\nReview snapshot ${session.activeSnapshot || 'none'}`);
    process.exitCode = interrupted ? 130 : value.generated === value.planned && value.accepted !== null ? 0 : 1;
  } finally {
    clearInterval(timer);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    try { if (fs.existsSync(directory + '.dev-stop')) fs.unlinkSync(directory + '.dev-stop'); } catch {}
    if (read(lock).token === owner.token) fs.unlinkSync(lock);
  }
}

if (require.main === module) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
