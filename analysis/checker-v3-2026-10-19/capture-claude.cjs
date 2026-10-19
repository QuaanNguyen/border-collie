const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const [binary, directory] = process.argv.slice(2);
if (!binary || !directory) throw new Error('Usage: capture-claude.cjs <native-binary> <new-evidence-directory>');
const root = path.resolve(directory);
if (fs.existsSync(root)) throw new Error('Choose a new evidence directory');
fs.mkdirSync(root, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'checker-claude-catalog-'));
fs.mkdirSync(path.join(work, 'config'));
fs.writeFileSync(path.join(work, 'settings.json'), '{}');
let captured = false;
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const b of req) raw += b;
  if (req.url.includes('count_tokens')) { res.writeHead(200, {'content-type':'application/json'});res.end('{"input_tokens":100}');return; }
  if (!req.url.startsWith('/v1/messages')) {res.writeHead(404);res.end('{}');return;}
  const body = JSON.parse(raw);
  fs.writeFileSync(root+'/claude-live-tools.json', JSON.stringify(body.tools,null,2)+'\n');
  captured = true;
  const msg = {id:'msg_fixture',type:'message',role:'assistant',model:'claude-sonnet-4-6',content:[{type:'text',text:'Catalog captured.'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:100,output_tokens:4}};
  if (!body.stream) {res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(msg));return;}
  res.writeHead(200,{'content-type':'text/event-stream'});
  const send=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify({type:event,...data})}\n\n`);
  send('message_start',{message:{...msg,content:[],stop_reason:null}});
  send('content_block_start',{index:0,content_block:{type:'text',text:''}});
  send('content_block_delta',{index:0,delta:{type:'text_delta',text:'Catalog captured.'}});
  send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:4}});send('message_stop',{});res.end();
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const env={PATH:process.env.PATH,TMPDIR:os.tmpdir(),CLAUDE_CONFIG_DIR:path.join(work,'config'),ANTHROPIC_API_KEY:'fictional-local-test-key',ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',DO_NOT_TRACK:'1'};
 const child=spawn(path.resolve(binary),['-p','Report that the catalog is ready. Do not call any tools.','--model','claude-sonnet-4-6','--tools','default','--max-turns','1','--output-format','json','--settings',path.join(work,'settings.json'),'--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands','--system-prompt','This is an isolated catalog test.'],{cwd:work,env,stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=b);child.stdout.resume();
 const timer=setTimeout(()=>child.kill('SIGKILL'),45000);
 const code=await new Promise(r=>child.on('close',r));clearTimeout(timer);
 server.closeAllConnections();await new Promise(r=>server.close(r));
 console.log(JSON.stringify({code,captured,stderr:stderr.slice(-1000)}));if(!captured)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exit(1)});
