import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'cadence-mcp-test-'));
process.env.CADENCE_DIR=join(dir,'app');
process.env.CADENCE_OGA_MCP_ENTRY=join(dir,'fake-mcp.mjs');
process.env.CATGPT_IMAGE_MODEL='chatgpt';
writeFileSync(process.env.CADENCE_OGA_MCP_ENTRY,`
import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
createInterface({input:process.stdin}).on('line',line=>{
 const msg=JSON.parse(line);if(msg.id===undefined)return;
 let result={};
 if(msg.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}};
 if(msg.method==='tools/call'){
  const folder=process.env.OGA_MCP_OUTPUT_DIR;
  writeFileSync(join(folder,'pid'),String(process.pid));
  const valid=process.env.OGA_IMAGE_PROVIDERS==='catgpt-gateway'&&process.env.CATGPT_IMAGE_MODEL==='chatgpt'&&msg.params.name==='generate_image';
  let path=join(folder,'test.png');writeFileSync(path,Buffer.from([137,80,78,71,13,10,26,10]));
  const prompt=msg.params.arguments.prompt;
  if(prompt==='outside')path=import.meta.filename;
  result={isError:!valid,content:[{type:'text',text:valid?'Path: '+path+'\\nProvider: '+(prompt==='fallback'?'huggingface':'catgpt-gateway'):'Invalid MCP parameters'}]};
 }
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result})+'\\n');
});
`);
const {generateWithOGA}=await import('../src/oga-images.js');
test.after(()=>rmSync(dir,{recursive:true,force:true}));
test('image generation invokes MCP with CatGPT pinned and closes the process',async()=>{
 const path=await generateWithOGA('Coffee still life',{brandSlug:'coffee',aspect:'portrait'});
 assert.ok(existsSync(path));assert.match(path,/coffee[\\/]oga[\\/]test\.png$/);
 const pid=Number(readFileSync(join(dir,'app/assets/coffee/oga/pid'),'utf8'));
 assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
test('MCP fallback providers and out-of-brand files are rejected',async()=>{
 await assert.rejects(generateWithOGA('fallback',{brandSlug:'coffee'}),/requested CatGPT/);
 await assert.rejects(generateWithOGA('outside',{brandSlug:'coffee'}),/outside this brand/);
});
