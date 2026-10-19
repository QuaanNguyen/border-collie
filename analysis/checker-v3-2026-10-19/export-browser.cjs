const fs = require('node:fs');
const ts = require('typescript');
const base=process.argv[2];
if(!base)throw new Error('Pass the cached public source directory');
let source = fs.readFileSync(base+'/browser-rpc.ts', 'utf8');
source = source.slice(source.indexOf('export const MAX_FILE_BYTES'), source.indexOf('export const Action'));
source = "import { Schema } from 'effect';\nconst optional = Schema.optionalKey;\n" + source + "\nconsole.log(JSON.stringify(Operations.map(row => ({ name: 'browser.' + row.name, schema: Schema.toJsonSchemaDocument(row.input) }))));";
fs.writeFileSync(base+'/schema-tools/browser.mjs', ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
