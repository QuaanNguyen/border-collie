'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { plan, validateCase, validateParallelRows } = require('./author-checker-data');
const { digest, requestFor, validatePartitions } = require('./checker-data');

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function lineage(directory) {
  const ancestors = [];
  const seen = new Set();
  while (directory) {
    directory = path.resolve(directory);
    if (seen.has(directory) || ancestors.length >= 16) throw new Error('Invalid repair ancestry');
    seen.add(directory);
    const state = read(path.join(directory, 'state.json'));
    const planned = read(path.join(directory, 'plan.json'));
    if (state.planSha256 !== digest(planned)) throw new Error('Ancestor plan integrity failed');
    ancestors.push({ directory, state, planned, stateSha256: digest(fs.readFileSync(path.join(directory, 'state.json'), 'utf8')) });
    if (!state.repair?.receiptSha256) break;
    const receipt = read(path.join(directory, 'repair.json'));
    if (digest(receipt) !== state.repair.receiptSha256 || receipt.parent !== state.repair.parent) throw new Error('Repair ancestry receipt changed');
    for (const [name, hash] of Object.entries(receipt.sourceFiles)) {
      if (!['inventory.json', 'plan.json', 'state.json'].includes(name) || digest(fs.readFileSync(path.join(receipt.parent, name), 'utf8')) !== hash) throw new Error('Repair ancestor changed');
    }
    if (Object.keys(receipt.sourceFiles).length !== 3) throw new Error('Incomplete repair ancestry receipt');
    directory = receipt.parent;
  }
  return ancestors;
}

function repair(parent, destination) {
  parent = path.resolve(parent);
  destination = path.resolve(destination);
  if (fs.existsSync(destination)) throw new Error('Preserve existing studies; choose a new directory');
  if (fs.existsSync(parent + '.dev-lock')) throw new Error('Stop the parent study before preparing a successor');
  const inventory = read(path.join(parent, 'inventory.json'));
  const parentPlan = read(path.join(parent, 'plan.json'));
  const parentState = read(path.join(parent, 'state.json'));
  const ancestors = lineage(parent);
  if (parentState.planSha256 !== digest(parentPlan) || parentPlan.inventorySha256 !== digest(inventory)) throw new Error('Parent plan or inventory integrity failed');
  const sourceFiles = Object.fromEntries(['inventory.json', 'plan.json', 'state.json'].map((name) => [name, digest(fs.readFileSync(path.join(parent, name), 'utf8'))]));
  const options = { ...parentPlan.config, riskTopics: inventory.requiredRiskTopics ?? [], maxCalls: 500, maxTokens: 3000000, maxElapsedMs: 21600000 };
  const staging = destination + '.pending-' + crypto.randomUUID();
  try {
    plan(inventory, options, staging);
    const planned = read(path.join(staging, 'plan.json'));
    const tasks = new Map(planned.tasks.map((task) => [task.taskId, task]));
    const accepted = [];
    const imported = [];
    const rejected = [];
    const parentTasks = new Map(parentPlan.tasks.map((task) => [task.taskId, task]));
    const recorded = new Set();
    for (const call of ancestors.flatMap((ancestor) => ancestor.state.calls)) {
      if (call.response?.choices?.[0]?.finish_reason !== 'stop' || call.response.model !== parentPlan.config.authorModel && !call.response.model?.startsWith(parentPlan.config.authorModel + '-')) continue;
      let decoded;
      try { decoded = JSON.parse(call.response.choices[0].message.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); }
      catch { continue; }
      if (!Array.isArray(decoded?.cases)) continue;
      for (const value of decoded.cases) if (value && typeof value === 'object' && !Array.isArray(value) && call.taskIds.includes(value.taskId)) recorded.add(digest({ taskId: value.taskId, userMessage: value.userMessage, preference: typeof value.preference === 'string' ? { text: value.preference } : value.preference, tool: value.tool, args: value.args }));
    }
    const seen = new Set();
    const add = (value, source) => {
      if (seen.has(value.taskId)) return;
      const task = tasks.get(value.taskId);
      try {
        if (!task) throw new Error('Case does not belong to the successor plan');
        validateCase(value, task);
        const row = { id: task.taskId, family: task.family, agent: task.agent, split: task.split, ...(task.topic ? { topic: task.topic } : {}), ...(task.parallelGroup ? { parallelGroup: task.parallelGroup, parallelRole: task.parallelRole, batch: task.batch } : {}), userMessage: value.userMessage, preference: value.preference, tool: value.tool, args: value.args, origin: 'model-authored-revalidated', trainingEligible: false };
        row.inputHash = digest(requestFor(row));
        validatePartitions([...accepted, row]);
        accepted.push(row);
        seen.add(row.id);
        imported.push({ id: row.id, source, previousInputHash: source.inputHash || null, currentInputHash: row.inputHash });
      } catch (error) {
        rejected.push({ id: value.taskId, source, error: error.message });
      }
    };
    for (const row of parentState.accepted) {
      const value = { taskId: row.id, userMessage: row.userMessage, preference: row.preference, tool: row.tool, args: row.args };
      const task = parentTasks.get(row.id);
      if (!task || row.family !== task.family || row.agent !== task.agent || row.tool !== task.tool || row.split !== task.split) throw new Error('Saved parent case identity changed');
      if (!recorded.has(digest(value))) {
        rejected.push({ id: row.id, source: { kind: 'saved-case', inputHash: row.inputHash }, error: 'Saved case has no matching recorded author response in this study; inspect its ancestor provenance separately' });
        continue;
      }
      add(value, { kind: 'saved-case', inputHash: row.inputHash });
    }
    for (const call of [...parentState.calls].reverse()) {
      if (call.status !== 'rejected' || call.response?.choices?.[0]?.finish_reason !== 'stop') continue;
      if (call.response.model !== planned.config.authorModel && !call.response.model?.startsWith(planned.config.authorModel + '-')) continue;
      let decoded;
      try { decoded = JSON.parse(call.response.choices[0].message.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); }
      catch { continue; }
      if (!Array.isArray(decoded?.cases) || decoded.cases.some((value) => !value || typeof value !== 'object' || Array.isArray(value)) || decoded.cases.length !== call.taskIds.length || new Set(decoded.cases.map((value) => value.taskId)).size !== call.taskIds.length || decoded.cases.some((value) => !call.taskIds.includes(value.taskId))) continue;
      for (const value of decoded.cases) add({ ...value, preference: typeof value.preference === 'string' ? { text: value.preference } : value.preference }, { kind: 'rejected-response', sequence: call.sequence });
    }
    for (const group of new Set(accepted.map((row) => row.parallelGroup).filter(Boolean))) {
      const members = accepted.filter((row) => row.parallelGroup === group);
      try { validateParallelRows(members); }
      catch (error) {
        for (const row of members) {
          accepted.splice(accepted.findIndex((entry) => entry.id === row.id), 1);
          imported.splice(imported.findIndex((entry) => entry.id === row.id), 1);
          rejected.push({ id: row.id, source: { kind: 'incomplete-parallel-group', group }, error: error.message });
        }
      }
    }
    const state = read(path.join(staging, 'state.json'));
    state.accepted = accepted;
    state.status = 'authoring-incomplete';
    const receipt = { createdAt: new Date().toISOString(), parent, destination, sourceFiles, ancestry: ancestors.map((ancestor) => ({ directory: ancestor.directory, stateSha256: ancestor.stateSha256, calls: ancestor.state.calls.length })), parentPlanSha256: digest(parentPlan), successorPlanSha256: digest(planned), priorCalls: parentState.calls.length, priorTokens: parentState.calls.reduce((sum, call) => sum + (call.chargedTokens ?? call.reservedTokens ?? 0), 0), priorElapsedMs: parentState.elapsedMs, newAllocation: { maxCalls: options.maxCalls, maxTokens: options.maxTokens, maxElapsedMs: options.maxElapsedMs }, budgetPolicy: 'A separately bounded repair allocation; historical consumption remains recorded and is not erased.', imported, rejected, importedCases: accepted.length, plannedCases: planned.tasks.length, exactInputReviewsReused: false, humanVerified: false, trainingEligible: false };
    state.repair = { parent, receiptSha256: digest(receipt) };
    fs.writeFileSync(path.join(staging, 'state.json'), JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    fs.writeFileSync(path.join(staging, 'repair.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o444 });
    for (const [name, hash] of Object.entries(sourceFiles)) if (digest(fs.readFileSync(path.join(parent, name), 'utf8')) !== hash) throw new Error('Parent changed during successor preparation');
    if (fs.existsSync(destination)) throw new Error('Successor destination appeared during preparation');
    fs.renameSync(staging, destination);
    return { destination, imported: accepted.length, rejected: rejected.length, missing: planned.tasks.length - accepted.length, planned: planned.tasks.length, previousCalls: parentState.calls.length, trainingEligible: false };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const [parent, destination] = process.argv.slice(2);
  try {
    if (!parent || !destination || process.argv.length !== 4) throw new Error('Usage: repair-checker-study.js <parent-study> <new-study>');
    console.log(JSON.stringify(repair(parent, destination)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { repair };
