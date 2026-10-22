'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { digest, reviewPacket, validatePartitions, REVIEW_INSTRUCTION_HASH } = require('./checker-data');

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const readRows = (directory) => fs.readFileSync(path.join(directory, 'proposals.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

function localFile(directory, relative) {
  requireValue(typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative), 'Composition evidence path must be relative');
  const root = fs.realpathSync(directory);
  const file = fs.realpathSync(path.resolve(directory, relative));
  requireValue(file.startsWith(root + path.sep) && fs.statSync(file).isFile(), 'Composition evidence escapes its snapshot');
  return file;
}

function decisionsByModel(reviews) {
  requireValue(reviews.length === 2 && reviews[0].model !== reviews[1].model && reviews[0].modelFamily !== reviews[1].modelFamily, 'Composition requires two independent source reviewers');
  return new Map(reviews.map((review) => [review.model, new Map(review.decisions.map((decision) => [decision.id, decision]))]));
}

function selection(original, supplement, remediation, sourcePlan, sourceState, supplementPlan) {
  requireValue(digest(sourcePlan) === remediation.sourcePlanSha256 && sourceState.planSha256 === remediation.sourcePlanSha256, 'Composition source plan ancestry changed');
  requireValue(sourcePlan.inventorySha256 === supplementPlan.inventorySha256, 'Composition inventory changed');
  requireValue(original.manifest.planSha256 === remediation.sourcePlanSha256 && supplement.manifest.planSha256 === digest(supplementPlan), 'Composition frozen plan ancestry changed');
  const originalRows = new Map(original.rows.map((row) => [row.id, row]));
  const originalTasks = new Map(sourcePlan.tasks.map((task) => [task.taskId, task]));
  const tasks = new Map(supplementPlan.tasks.map((task) => [task.taskId, task]));
  const supplementalRows = new Map(supplement.rows.map((row) => [row.id, row]));
  requireValue(tasks.size === supplementPlan.tasks.length && originalTasks.size === sourcePlan.tasks.length, 'Composition plan contains duplicate task identities');
  for (const row of original.rows) {
    const task = originalTasks.get(row.id);
    requireValue(task && ['family', 'split', 'agent', 'tool', 'topic', 'parallelGroup', 'parallelRole', 'batch'].every((field) => row[field] === task[field]), 'Composition original proposal differs from its source task');
  }
  requireValue(Array.isArray(remediation.links) && remediation.links.length === tasks.size && new Set(remediation.links.map((link) => link.taskId)).size === tasks.size, 'Composition remediation links do not cover the supplement plan');
  requireValue(supplementalRows.size === tasks.size && supplement.rows.length === tasks.size, 'Composition is missing a planned replacement or coverage case');
  const models = decisionsByModel(original.reviews);
  const supplementModels = decisionsByModel(supplement.reviews);
  requireValue([...models.keys()].every((model) => supplementModels.has(model)) && original.reviews.every((review) => supplement.reviews.some((other) => other.model === review.model && other.modelFamily === review.modelFamily)), 'Composition reviewer identities changed');
  requireValue(Array.isArray(remediation.requiredReplacementIds), 'Composition remediation omits its required replacement identities');
  const requiredReplacements = new Map();
  for (const required of remediation.requiredReplacementIds) {
    const row = originalRows.get(required?.sourceTaskId);
    requireValue(row && !requiredReplacements.has(required.sourceTaskId) && required.sourceInputHash === reviewPacket([row])[0].inputHash, 'Composition required replacement identity is duplicated, missing or changed');
    requiredReplacements.set(required.sourceTaskId, required.sourceInputHash);
  }
  const agrees = (row) => {
    const pair = [...models.values()].map((decisions) => decisions.get(row.id));
    return pair.every((decision) => decision && decision.inputHash === reviewPacket([row])[0].inputHash && ['approve', 'deny', 'ask'].includes(decision.verdict)) && pair[0].verdict === pair[1].verdict;
  };
  const replaced = new Set();
  for (const link of remediation.links) {
    const task = tasks.get(link.taskId);
    const sourceTask = originalTasks.get(link.sourceTaskId);
    const old = originalRows.get(link.sourceTaskId);
    const row = supplementalRows.get(link.taskId);
    requireValue(task && sourceTask && row && link.taskId !== link.sourceTaskId, 'Composition replacement identity is missing or unchanged');
    requireValue(['replace-disputed-input', 'replace-invalid-tool-semantics', 'additional-coverage-case', 'fill-missing-task'].includes(link.purpose), 'Unknown composition remediation purpose');
    requireValue(link.family === sourceTask.family && link.split === sourceTask.split && task.family === link.family && task.split === link.split && task.agent === sourceTask.agent && task.tool === sourceTask.tool && ['family', 'split', 'agent', 'tool', 'topic', 'parallelGroup', 'parallelRole', 'batch'].every((field) => row[field] === task[field]), 'Composition replacement crosses its source family, split or tool');
    requireValue(old ? link.sourceInputHash === reviewPacket([old])[0].inputHash : link.sourceInputHash === null, 'Composition source input identity changed');
    requireValue((link.purpose === 'fill-missing-task') === !old, 'Composition missing-task ancestry is inconsistent');
    if (link.purpose.startsWith('replace-')) {
      requireValue(!replaced.has(old.id), 'Composition replaces the same original twice');
      requireValue(requiredReplacements.get(old.id) === link.sourceInputHash, 'Composition replacement was not declared in its required replacement identities');
      requireValue(link.purpose !== 'replace-disputed-input' || !agrees(old), 'Composition claims an agreed input was disputed');
      requireValue(reviewPacket([row])[0].inputHash !== link.sourceInputHash, 'Composition replacement repeats the disputed or invalid input');
      replaced.add(old.id);
    }
  }
  for (const id of requiredReplacements.keys()) requireValue(replaced.has(id), 'Composition lacks a replacement link for a required source input');
  for (const row of original.rows) requireValue(agrees(row) || replaced.has(row.id), 'Composition lacks a replacement for a disputed source input');
  const retained = original.rows.filter((row) => !replaced.has(row.id));
  requireValue(sourceState.accepted.length === original.rows.length && new Set(sourceState.accepted.map((row) => row.id)).size === original.rows.length && sourceState.accepted.every((row) => originalRows.has(row.id) && digest(row) === digest(originalRows.get(row.id))), 'Composition source state does not match its frozen proposals');
  const selected = [...retained.map((row) => ({ row, source: 'original' })), ...supplement.rows.map((row) => ({ row, source: 'supplement' }))];
  validatePartitions(selected.map((entry) => entry.row));
  return { selected, replaced: [...replaced], retained: retained.length };
}

function validateComposition(inventoryFile, directory, manifest, rows, reviews, verifySource) {
  const composition = manifest.composedFrom;
  requireValue(composition?.version === 1 && composition.sources?.length === 2 && new Set(composition.sources.map((source) => source.name)).size === 2, 'Invalid composition source envelope');
  const sources = {};
  for (const source of composition.sources) {
    requireValue(['original', 'supplement'].includes(source.name) && typeof source.directory === 'string' && !path.isAbsolute(source.directory), 'Invalid composition source identity');
    for (const name of ['manifest.json', 'review-packet.json', 'proposals.jsonl', ...source.reviews]) requireValue(Object.hasOwn(source.files, name), 'Composition omits required source evidence');
    for (const [name, hash] of Object.entries(source.files)) {
      const file = localFile(directory, path.join(source.directory, name));
      requireValue(digest(fs.readFileSync(file, 'utf8')) === hash, 'Composition source evidence changed');
    }
    const sourceDirectory = path.dirname(localFile(directory, path.join(source.directory, 'manifest.json')));
    const sourceManifest = read(path.join(sourceDirectory, 'manifest.json'));
    requireValue(!sourceManifest.composedFrom, 'Nested compositions require separate qualification');
    const sourceReviews = source.reviews.map((name) => read(localFile(directory, path.join(source.directory, name))));
    requireValue(!sourceReviews.some((review) => review.composedFrom), 'Nested composed reviews are unsupported');
    const report = verifySource(inventoryFile, sourceDirectory, source.reviews.map((name) => localFile(directory, path.join(source.directory, name))));
    requireValue(report.integrity === 'passed' && report.currentProductionBuilderMatches, 'Composition source does not pass current exact-input verification');
    requireValue(sourceReviews.length === 2 && sourceReviews.every((review) => review.decisions.length === report.cases), 'Composition source reviews are incomplete');
    sources[source.name] = { rows: readRows(sourceDirectory), reviews: sourceReviews, manifest: sourceManifest };
  }
  const ancestry = {};
  for (const name of ['remediation', 'sourcePlan', 'sourceState', 'supplementPlan']) {
    const reference = composition[name];
    const file = localFile(directory, reference.file);
    const text = fs.readFileSync(file, 'utf8');
    requireValue(digest(text) === reference.sha256, 'Composition ancestry evidence changed');
    ancestry[name] = JSON.parse(text);
  }
  requireValue(ancestry.remediation.sourceStateSha256 === composition.sourceState.sha256 && ancestry.remediation.sourceManifestSha256 === composition.sources.find((source) => source.name === 'original').files['manifest.json'], 'Composition remediation source receipts changed');
  const chosen = selection(sources.original, sources.supplement, ancestry.remediation, ancestry.sourcePlan, ancestry.sourceState, ancestry.supplementPlan);
  requireValue(digest(chosen.selected.map((entry) => entry.row)) === digest(rows), 'Composition contains substituted, missing or unexpected proposal inputs');
  for (const review of reviews) {
    requireValue(review.composedFrom?.length === 2 && !review.importedFrom && Array.isArray(review.responses) && review.responses.length === 0, 'Invalid composed review provenance');
    const expected = chosen.selected.map(({ row, source }) => {
      const sourceReview = sources[source].reviews.find((value) => value.model === review.model && value.modelFamily === review.modelFamily && value.instructionHash === REVIEW_INSTRUCTION_HASH);
      requireValue(sourceReview, 'Composed reviewer identity differs from its source');
      const decision = sourceReview.decisions.find((value) => value.id === row.id && value.inputHash === reviewPacket([row])[0].inputHash);
      requireValue(decision, 'Composed decision has no exact source decision');
      return decision;
    });
    requireValue(digest(review.decisions) === digest(expected), 'Composed decisions differ from their source evidence');
    for (const source of ['original', 'supplement']) {
      const mapping = review.composedFrom.filter((entry) => entry.source === source);
      const sourceReference = composition.sources.find((entry) => entry.name === source);
      const originalReview = sources[source].reviews.find((entry) => entry.model === review.model);
      const filename = sourceReference.reviews.find((name) => read(localFile(directory, path.join(sourceReference.directory, name))).model === originalReview.model);
      requireValue(mapping.length === 1 && mapping[0].reviewFile === path.join(sourceReference.directory, filename) && mapping[0].reviewSha256 === sourceReference.files[filename] && digest(mapping[0].caseIds) === digest(chosen.selected.filter((entry) => entry.source === source).map((entry) => entry.row.id)), 'Composed review mapping changed');
    }
  }
  return { sources: Object.keys(sources), retainedOriginalCases: chosen.retained, replacedOriginalCases: chosen.replaced.length, supplementalCases: sources.supplement.rows.length };
}

module.exports = { localFile, selection, validateComposition };
