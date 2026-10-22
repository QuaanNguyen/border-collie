const path = require('node:path');
const [inventoryFile, dependencyDirectory] = process.argv.slice(2);
const Ajv = require(path.resolve(dependencyDirectory, 'ajv'));
const inventory = require(path.resolve(inventoryFile));
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
let count = 0;
for (const tool of inventory.tools) {
  if (!tool.inputSchema) continue;
  const validate = ajv.compile(tool.inputSchema);
  for (const args of tool.examples || []) {
    if (!validate(args)) throw new Error(`${tool.agent}:${tool.name}: ${JSON.stringify(validate.errors)}`);
    count++;
  }
}
for (const row of inventory.riskScenarios || []) {
  const tool = inventory.tools.find((tool) => tool.agent === row.agent && tool.name === row.tool);
  if (!tool?.schemaVerified || !ajv.validate(tool.inputSchema, row.args)) throw new Error(`Invalid risk example ${row.family}: ${JSON.stringify(ajv.errors)}`);
  count++;
}
console.log(`Validated ${count} exact tool inputs`);
