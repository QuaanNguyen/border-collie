const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const [runner,weights,out]=process.argv.slice(2);
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('This probe requires an Apple Silicon Mac');
if(!runner||!weights||!out||fs.existsSync(out))throw new Error('Provide a runner, existing weights and a new output file');
const {judgeRequest,verdictFrom}=require(root+'/xor/lib/judge');
const {proposedCall}=require(root+'/xor/lib/toolcalls');
const {DEFAULT_PREFERENCE}=require(root+'/xor/lib/preference');
const toolsFile=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'checker-direct-probe-')),'tools.json');
const request=judgeRequest({userMessage:'Read the parser before fixing it.',preference:DEFAULT_PREFERENCE,call:proposedCall('read',{path:'src/parser.js'})});
fs.writeFileSync(toolsFile,JSON.stringify(request.tools));
const variants=[['default',[]],['instruction',['--system','Return exactly one tool call. Do not write reasoning. Close the thinking section immediately without any text.']],['forced',['--forced']],['forced-instruction',['--forced','--system','Return exactly one tool call. Do not write reasoning. Close the thinking section immediately without any text.']]];
const results=[];
for(const [name,extra]of variants){
 for(let i=0;i<3;i++){
  const started=performance.now();const r=spawnSync(runner,['--model',weights,'--tools',toolsFile,'--prompt',request.query,'--max','128','--threads','4','--fail-input-overflow',...extra],{encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,NEEDLE_TELEMETRY:'0',DO_NOT_TRACK:'1'}});
  let response;try{response=JSON.parse(r.stdout)}catch{}
  const row={name,attempt:i,elapsedMs:performance.now()-started,status:r.status,error:r.error?.code||null,response,stderr:r.stderr,hasReasoning:typeof response?.reasoning==='string'&&response.reasoning.trim().length>0,verdict:response?verdictFrom(response):null};results.push(row);
  fs.writeFileSync(out,JSON.stringify({platform:process.platform+'-'+process.arch,modelSha256:crypto.createHash('sha256').update(fs.readFileSync(weights)).digest('hex'),runnerSha256:crypto.createHash('sha256').update(fs.readFileSync(runner)).digest('hex'),promotionAllowed:false,results},null,2)+'\n');
  console.log(JSON.stringify({name,attempt:i,hasReasoning:row.hasReasoning,verdict:row.verdict,elapsedMs:row.elapsedMs,status:r.status}));
 }
}
