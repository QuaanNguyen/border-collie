const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const [binary, directory, modelCatalog] = process.argv.slice(2);
if (!binary || !directory || !modelCatalog) throw new Error('Usage: capture-codex.cjs <native-binary> <new-evidence-directory> <official-models.json>');
const root = path.resolve(directory);
if (fs.existsSync(root)) throw new Error('Choose a new evidence directory');
fs.mkdirSync(root, { recursive: true });
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'checker-codex-catalog-'));
let captured = false;
const server = http.createServer(async (req,res) => {
 let raw='';for await(const b of req)raw+=b;
 if(!req.url.includes('responses')){res.writeHead(200,{'content-type':'application/json'});res.end(fs.readFileSync(path.resolve(modelCatalog)));return;}
 const body=JSON.parse(raw);const find=(o)=>{if(!o||typeof o!=='object')return null;if(Array.isArray(o.tools))return o.tools;for(const v of Object.values(o)){const r=find(v);if(r)return r;}return null;};body.tools=find(body);fs.writeFileSync(root+'/codex-live-tools-featured.json',JSON.stringify(body.tools,null,2)+'\n');captured=true;
 res.writeHead(200,{'content-type':'text/event-stream'});
 const response={id:'resp_fixture',object:'response',created_at:0,status:'completed',output:[{id:'msg_fixture',type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:'Catalog captured.',annotations:[]}]}],usage:{input_tokens:100,output_tokens:4,total_tokens:104}};
 for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.done',output_index:0,item:response.output[0]},{type:'response.completed',response}])res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);res.end();
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const args=['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','-C',cwd,'-s','read-only','-c','model_provider="catalog"','-c',`model_providers.catalog={name="catalog",base_url="http://127.0.0.1:${server.address().port}/v1",wire_api="responses",requires_openai_auth=false}`,'-c','features.apps=false','-c','features.browser_use=false','-c','features.computer_use=false','-c','features.code_mode=true','-c','features.context_management=true','-c','features.multi_agent_v2=true','-c','web_search="disabled"','-c','mcp_servers={}','-m','gpt-6.1-sol','Print catalog ready. Do not call any tool.'];
 const child=spawn(path.resolve(binary),args,{cwd,env:{PATH:process.env.PATH,TMPDIR:os.tmpdir(),DO_NOT_TRACK:'1'},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=b);child.stdout.resume();const timer=setTimeout(()=>child.kill('SIGKILL'),45000);const code=await new Promise(r=>child.on('close',r));clearTimeout(timer);server.closeAllConnections();await new Promise(r=>server.close(r));console.log(JSON.stringify({code,captured,stderr:stderr.slice(-2000)}));if(!captured)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exit(1)});
