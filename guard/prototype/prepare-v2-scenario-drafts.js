'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { boundaryDecision } = require('../lib/boundary');
const { proposedCall } = require('../lib/toolcalls');
const { runtimeRequest, REQUEST_FORMAT_VERSION } = require('./finetune-pipeline');

const TOOL_RENAMES = Object.freeze({ bash: 'shell', task: 'subagent', list: 'read' });
const DRAFT_TOOLS = new Set(['read', 'edit', 'write', 'glob', 'grep', 'shell', 'webfetch', 'websearch']);
const SCENARIO_FIELDS = ['id', 'family', 'category', 'userMessage', 'preference', 'source', 'preferenceId', 'plannedSplit', 'split', 'reserve', 'failure'];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requestHash(scenario) {
  const { query, tools } = runtimeRequest(scenario);
  return sha256(JSON.stringify({ query, tools }));
}

function prepareDrafts(source, workdir) {
  const scenarios = source.toString('utf8').split('\n').filter((line) => line.trim()).map(JSON.parse);
  const drafts = [];
  const records = [];
  const ids = new Set();
  for (const scenario of scenarios) {
    if (!scenario?.id || !scenario.family || !scenario.preference || !scenario.args || typeof scenario.args !== 'object' || Array.isArray(scenario.args)) {
      throw new Error('Each source Scenario needs an id, family, Preference, and argument object');
    }
    if (ids.has(scenario.id)) throw new Error(`Duplicate Scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    const tool = TOOL_RENAMES[scenario.tool] || scenario.tool;
    const args = { ...scenario.args };
    const record = {
      id: scenario.id,
      originalScenarioHash: sha256(JSON.stringify(scenario)),
      originalRequestHash: requestHash(scenario),
      previousVerdict: scenario.verdict ?? null,
      originalTool: scenario.tool,
      draftTool: tool,
    };
    records.push(record);
    if (['read', 'edit', 'write'].includes(tool) && Object.hasOwn(args, 'filePath')) {
      if (Object.hasOwn(args, 'path') && args.path !== args.filePath) {
        record.excludedReason = 'Conflicting legacy and V2 file paths need manual review';
        continue;
      }
      args.path = args.filePath;
      delete args.filePath;
    }
    const blocked = boundaryDecision({ call: proposedCall(tool, args), workdir });
    if (blocked) {
      record.excludedReason = `${blocked.rule}: ${blocked.reason}`;
      continue;
    }
    if (!DRAFT_TOOLS.has(tool)) {
      record.excludedReason = 'This tool needs a verified argument and Guard effect contract before conversion';
      continue;
    }
    const draft = Object.fromEntries(SCENARIO_FIELDS.filter((field) => Object.hasOwn(scenario, field)).map((field) => [field, scenario[field]]));
    draft.tool = tool;
    draft.args = args;
    record.draftRequestHash = requestHash(draft);
    drafts.push(draft);
  }
  return {
    drafts,
    manifest: {
      schemaVersion: 1,
      status: 'requires-fresh-review',
      targetContract: 'OpenCode V2 tools and arguments',
      requestFormatVersion: REQUEST_FORMAT_VERSION,
      sourceSha256: sha256(source),
      sourceCount: scenarios.length,
      draftCount: drafts.length,
      excludedCount: scenarios.length - drafts.length,
      records,
    },
  };
}

function main(args) {
  if (args.length !== 2) throw new Error('Usage: node guard/prototype/prepare-v2-scenario-drafts.js <source.jsonl> <new-output-directory>');
  const [sourcePath, outputPath] = args.map((value) => path.resolve(value));
  if (fs.existsSync(outputPath)) throw new Error('Output directory already exists; preserve it and choose a new directory');
  const { drafts, manifest } = prepareDrafts(fs.readFileSync(sourcePath), process.cwd());
  const contents = drafts.length ? drafts.map((draft) => JSON.stringify(draft)).join('\n') + '\n' : '';
  manifest.draftsSha256 = sha256(contents);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(outputPath);
  fs.writeFileSync(path.join(outputPath, 'scenarios.jsonl'), contents);
  fs.writeFileSync(path.join(outputPath, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ status: manifest.status, drafts: manifest.draftCount, excluded: manifest.excludedCount }));
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { prepareDrafts };
