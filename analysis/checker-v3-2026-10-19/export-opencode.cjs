const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const base=process.argv[2];
if(!base)throw new Error('Pass the cached public source directory');
const src=base+'/sources/opencode/packages/core/src/tool/plugin';
const prefix=`import { Effect, Schema } from 'effect';
const optional=Schema.optionalKey;
const NonNegativeInt=Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const PositiveInt=Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const RelativePath=Schema.String, AbsolutePath=Schema.String;
const Session={ID:Schema.String}, SessionSchema=Session, Skill={ID:Schema.String};
const ReadToolFileSystem={PageInput:Schema.Struct({offset:optional(NonNegativeInt),limit:optional(NonNegativeInt)})};
const FileSystem={DEFAULT_SEARCH_LIMIT:100,GlobInput:Schema.Struct({pattern:Schema.String,hidden:optional(Schema.Boolean),limit:optional(PositiveInt)}),GrepInput:Schema.Struct({pattern:Schema.String,include:optional(Schema.String),literal:optional(Schema.Boolean),caseSensitive:optional(Schema.Boolean),limit:optional(PositiveInt)})};
`;
const q=fs.readFileSync(base+'/opencode-question.ts','utf8');
const question=q.slice(q.indexOf('const Option'),q.indexOf('export interface Prompt')).replace('export const Prompt','const Prompt')+'\nconst Question={Prompt};';
let text=prefix+question+'\nconst output=[];\n';
for(const filename of fs.readdirSync(src)){
 if(!filename.endsWith('.ts') || ['file-diff.ts','opencode.ts','mcp-resource.ts'].includes(filename))continue;
 const source=fs.readFileSync(path.join(src,filename),'utf8');
 const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true);
 const variables=[];
 for(const statement of ast.statements){
  if(ts.isVariableStatement(statement)) for(const d of statement.declarationList.declarations) if(d.initializer && ['Input','LocationInput','name','DEFAULT_TIMEOUT_MS','Timeout','MAX_TIMEOUT_SECONDS'].includes(d.name.getText(ast))) variables.push('const '+d.getText(ast)+';');
 }
 if(!variables.some(x=>x.startsWith('const Input')))continue;
 text+='\n{\n'+variables.join('\n')+'\noutput.push({name,schema:Schema.toJsonSchemaDocument(Input),file:'+JSON.stringify(filename)+'});\n}\n';
}
const source=fs.readFileSync(src+'/opencode.ts','utf8');
const ast=ts.createSourceFile('opencode.ts',source,ts.ScriptTarget.Latest,true);
const names=['RenameInput','MoveInput','WorktreeCreateInput','WorktreeRemoveInput','ModelsInput'];
for(const statement of ast.statements) if(ts.isVariableStatement(statement))for(const d of statement.declarationList.declarations) if(d.initializer && names.includes(d.name.getText(ast))) text+='\nconst '+d.getText(ast)+';\n';
for(const [name,schema] of Object.entries({'session_rename':'RenameInput','session_move':'MoveInput','worktree_create':'WorktreeCreateInput','worktree_list':'Schema.Struct({})','worktree_remove':'WorktreeRemoveInput','models':'ModelsInput'})) text+=`output.push({name:'opencode.${name}',schema:Schema.toJsonSchemaDocument(${schema}),file:'opencode.ts'});\n`;
text+=`output.push({name:'opencode.list_mcp_resources',schema:Schema.toJsonSchemaDocument(Schema.Struct({server:optional(Schema.String)})),file:'mcp-resource.ts'});\noutput.push({name:'opencode.read_mcp_resource',schema:Schema.toJsonSchemaDocument(Schema.Struct({server:Schema.String,uri:Schema.String})),file:'mcp-resource.ts'});\nconsole.log(JSON.stringify(output));`;
fs.writeFileSync(base+'/schema-tools/opencode.mjs',ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
