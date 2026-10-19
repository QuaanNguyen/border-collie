from pathlib import Path
import json,re,hashlib
import argparse
parser=argparse.ArgumentParser()
parser.add_argument('source_directory',type=Path)
parser.add_argument('output',type=Path)
args=parser.parse_args()
base=args.source_directory
sha=lambda b:hashlib.sha256(b).hexdigest()
def strip(s,context=''):
 if isinstance(s,dict):return {k:strip(v,k) for k,v in s.items() if context in ['properties','definitions','$defs','patternProperties'] or k not in ['description','title','$schema','default','examples']}
 if isinstance(s,list):return [strip(x) for x in s]
 return s

def sample(s,defs,i,key='',depth=0):
 if isinstance(s,list):return [sample(x,defs,i,key,depth+1) for x in s]
 if depth>14:return None
 if '$ref' in s:return sample(defs[s['$ref'].split('/')[-1]],defs,i,key,depth+1)
 if 'const' in s:return s['const']
 if s.get('enum'):return next((x for x in s['enum'] if x is not None),None)
 for k in ['anyOf','oneOf']:
  if k in s:
   opts=[x for x in s[k] if x.get('type')!='null'];return sample(opts[0],defs,i,key,depth+1)
 if 'allOf' in s:
  parts=[sample(x,defs,i,key,depth+1) for x in s['allOf']]
  if all(isinstance(x,dict) for x in parts):return {k:v for x in parts for k,v in x.items()}
  return parts[0]
 typ=s.get('type','object')
 if isinstance(typ,list):typ=next((t for t in typ if t!='null'),'null')
 if typ=='object':return {k:sample(s.get('properties',{}).get(k,{}),defs,i,k,depth+1) for k in s.get('required',[])}
 if typ=='array':
  if isinstance(s.get('items'),list):return [sample(x,defs,i,key,depth+1) for x in s['items']]
  return [sample(s.get('items',{}),defs,i,key,depth+1) for _ in range(max(1,s.get('minItems',0)))]
 if typ in ['integer','number']:return max(1,s.get('minimum',s.get('exclusiveMinimum',0)+1))
 if typ=='boolean':return True
 if typ=='null':return None
 if s.get('pattern','').startswith('^file_'):return 'file_00000000-0000-0000-0000-00000000000'+str(i)
 if key=='tabID':return 'tab_00000000-0000-0000-0000-00000000000'+str(i)
 if key in ['fileID','baselineID']:return 'file_00000000-0000-0000-0000-00000000000'+str(i)
 if key in ['ref','from','to','sourceRef','targetRef']:return 'e'+str(i+1)
 if key in ['command','cmd']:return ['npm test','git diff --check','npm run check'][i]
 if 'url' in key.lower():return ['https://nodejs.org/api/fs.html','https://docs.python.org/3/library/pathlib.html','https://developer.mozilla.org/en-US/docs/Web/API/URL'][i]
 if any(x in key.lower() for x in ['path','directory']):return ['src/parser.js','test/parser.test.js','docs/parser.md'][i]
 if key in ['code','script']:return ['return await tools.read({path:"src/parser.js"})','return await tools.read({path:"test/parser.test.js"})','return await tools.read({path:"docs/parser.md"})'][i]
 if key=='pattern':return ['parse','timeout','request'][i]
 if key in ['old_string','oldString']:return 'old value'
 if key in ['new_string','newString','content','new_source']:return ['updated parser','updated tests','updated docs'][i]
 if key in ['patchText','patch']:return '*** Begin Patch\n*** Add File: docs/check-'+str(i)+'.md\n+Review complete\n*** End Patch'
 if key in ['prompt','query','message','description','subject','text']:return ['Inspect the parser before editing it.','Check the existing parser tests.','Review the parser documentation.'][i]
 if key=='agent':return 'explore'
 if key in ['name','id','skill','taskId','task_id','target','server','uri']:return ['parser-review','test-review','documentation-review'][i]
 if 'timeout' in key.lower():return 1000
 return ['parser','tests','documentation'][i]

tools=[]
def add(agent,name,schema,source,version,verified=True,hook=True,extra=None):
 schema=strip(schema) if schema is not None else None
 defs=(schema or {}).get('$defs',(schema or {}).get('definitions',{}))
 entry={'agent':agent,'name':name,'release':version,'checkedAt':'2026-10-19','sourceUrl':source,'inputSchema':schema,'schemaVerified':verified,'hookable':hook,'integrationVerified':False,'gap':'The shipped adapter has not verified this exact surface end to end.'}
 if schema is not None:entry['examples']=[sample(schema,defs,i) for i in range(3)]
 if extra:entry.update(extra)
 if agent=='codex' and name=='apply_patch':entry['examples']=['*** Begin Patch\n*** Add File: docs/check-'+str(i)+'.md\n+Review complete\n*** End Patch' for i in range(3)]
 if agent=='codex' and name=='exec':entry['examples']=['text(await tools.exec_command({cmd:'+json.dumps(c)+'}));' for c in ['npm test','git diff --check','npm run check']]
 tools.append(entry)

for row in json.loads((base/'opencode-schemas.json').read_text()):
 doc=row['schema'];schema={**doc['schema'],'$defs':doc['definitions']}
 add('opencode',row['name'],schema,'https://github.com/anomalyco/opencode/blob/v2.0.32/packages/core/src/tool/plugin/'+row['file'],'2.0.32',extra={'sourceSha256':sha((base/'sources/opencode/packages/core/src/tool/plugin'/row['file']).read_bytes())})
add('opencode','execute',{'type':'object','properties':{'code':{'type':'string'}},'required':['code']},'https://github.com/anomalyco/opencode/blob/v2.0.32/packages/codemode/src/codemode.ts','2.0.32',hook=None,extra={'gap':'Outer Code Mode is documented; individual nested-call interception is unverified.'})
for row in json.loads((base/'browser-schemas.json').read_text()):
 doc=row['schema'];schema={**doc['schema'],'$defs':doc['definitions']}
 add('opencode',row['name'],schema,'https://github.com/anomalyco/opencode/blob/v2.0.32/packages/plugin-browser/src/rpc.ts','2.0.32',hook=False,extra={'sourceSha256':sha((base/'browser-rpc.ts').read_bytes()),'gap':'Browser operations issue no individual permission prompt; offline cases do not prove interception.'})

sdk=json.loads((base/'claude-schemas.json').read_text());defs=sdk['definitions'];src=(base/'claude-sdk-tools.d.ts').read_text();version=json.loads((base/'claude-sdk-version.json').read_text())['version'];doc=(base/'claude-tools.md').read_text()
public=set(re.findall(r'^\| `([A-Za-z]+)` \|',doc,re.M));public.discard('TaskOutput')
mapnames={'Edit':'FileEditInput','Read':'FileReadInput','Write':'FileWriteInput','ListMcpResourcesTool':'ListMcpResourcesInput','ReadMcpResourceTool':'ReadMcpResourceInput'}
def subset(name):
 found={};todo=[name]
 while todo:
  current=todo.pop()
  if current in found:continue
  found[current]=defs[current]
  todo+=re.findall(r'#/definitions/([^"/]+)',json.dumps(defs[current]))
 return {'$ref':'#/definitions/'+name,'definitions':found}
for name in sorted(public):
 typ=mapnames.get(name,name+'Input');schema=subset(typ) if typ in defs else None
 add('claude-code',name,schema,'https://code.claude.com/docs/en/agent-sdk/typescript#tool-input-types','SDK '+version,verified=schema is not None,extra={'schemaPackage':'@anthropic-ai/claude-agent-sdk@'+version,'sourceSha256':sha((base/'claude-sdk-tools.d.ts').read_bytes()),'gap':'Schema comes from the official SDK; the Claude adapter and client-specific availability remain unqualified.' if schema else 'Public tool name is documented, but its complete input schema is not exported by this SDK. Capture the live tool catalog.'})

obj=lambda p,required=None:{'type':'object','properties':{k:({'type':v} if isinstance(v,str) else v) for k,v in p.items()},'required':list(p) if required is None else required}
known={
'exec_command':obj({'cmd':'string','workdir':'string'},['cmd']),
'write_stdin':obj({'session_id':'number','chars':'string'},['session_id']),
'apply_patch':{'type':'string'},'exec':{'type':'string'},
'update_plan':obj({'plan':{'type':'array','items':obj({'step':'string','status':{'enum':['pending','in_progress','completed']}})} }),
'request_user_input':obj({'questions':{'type':'array','items':obj({'header':'string','id':'string','question':'string','options':{'type':'array','minItems':2,'items':obj({'label':'string','description':'string'})}})}}),
'view_image':obj({'path':'string'}),'tool_search':obj({'query':'string'}),
'list_mcp_resources':obj({'server':'string'},[]),'list_mcp_resource_templates':obj({'server':'string'},[]),'read_mcp_resource':obj({'server':'string','uri':'string'}),
'spawn_agent':obj({'task_name':'string','message':'string'}),'send_message':obj({'target':'string','message':'string'}),'followup_task':obj({'target':'string','message':'string'}),'interrupt_agent':obj({'target':'string'}),'list_agents':obj({'path_prefix':'string'},[]),'wait_agent':obj({'timeout_ms':'number'},[]),
'get_context_remaining':obj({}),'new_context':obj({}),
'request_permissions':obj({'reason':'string','permissions':{'type':'object'}},['permissions']),
'list_available_plugins_to_install':obj({}),'request_plugin_install':obj({'plugin_id':'string','suggest_reason':'string'}),
'clock.curr_time':obj({}),'clock.sleep':obj({'duration_ms':'number'}),
'request_user_input_async':obj({'questions':{'type':'array','items':obj({'title':'string'})}}),
}
sourcebase=base/'sources/codex/codex-rs/core/src/tools'
for name,schema in known.items():
 files={'exec_command':'handlers/shell_spec.rs','write_stdin':'handlers/shell_spec.rs','request_permissions':'handlers/shell_spec.rs','exec':'code_mode/execute_spec.rs','clock.curr_time':'handlers/current_time.rs','clock.sleep':'handlers/sleep.rs'}
 file=files.get(name,'handlers/multi_agents_spec.rs' if name in ['spawn_agent','send_message','followup_task','interrupt_agent','list_agents','wait_agent'] else 'handlers/'+name.replace('update_plan','plan')+'_spec.rs')
 if not (sourcebase/file).exists():file='spec_plan.rs'
 add('codex',name,schema,'https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/tools/'+file,'0.163.0',verified=False,hook=None,extra={'sourceSha256':sha((sourcebase/file).read_bytes()),'schemaProjection':True,'gap':'Name/source verified; complete feature-specific schema and hook interception require a captured native tool catalog.'})
for name in ['web_search','web.run','image_gen.imagegen']:
 add('codex',name,None,'https://learn.chatgpt.com/docs/hooks','0.163.0',verified=False,hook=False,extra={'gap':'Hosted or extension-provided surface; native PreToolUse coverage is not established. Capture the actual schema and document the interception path.'})
for agent,names in [('opencode',['<server>_<tool>']),('claude-code',['mcp__<server>__<tool>','mcp__computer-use__*','mcp__claude-in-chrome__*']),('codex',['mcp__<server>__<tool>','browser/computer-use feature catalog'])]:
 for name in names:add(agent,name,None,'https://modelcontextprotocol.io/specification/2025-11-25/server/tools','dynamic',verified=False,hook=None,extra={'kind':'dynamic-catalog','gap':'Capture tools/list from every connected server or enabled extension. A wildcard is an explicit gap, not coverage.'})
output={'schemaVersion':1,'checkedAt':'2026-10-19','requestFormatVersion':'3','status':'source-inventory-with-explicit-gaps','notes':['Public names and schema sources are pinned. Semantic path and session identifiers must also be validated by each host.','Codex projections and undocumented Claude inputs require live catalog capture before training export.','Dynamic MCP and desktop catalogs cannot be enumerated from a fixed built-in list.','No runtime coverage or human review is implied by authored examples.'],'tools':tools}
p=args.output;p.write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps({'tools':len(tools),'withExamples':sum(bool(t.get('examples')) for t in tools),'verifiedSchemas':sum(t['schemaVerified'] for t in tools),'byAgent':{a:sum(t['agent']==a for t in tools) for a in ['opencode','claude-code','codex']}}))
