import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { OGA_MCP_ENTRY, CATGPT_URL, CATGPT_TOKEN, CATGPT_MODEL, ASSETS_DIR } from './config.js';

export async function generateWithOGA(prompt, { aspect='square', brandSlug='misc' }={}) {
  if(!existsSync(OGA_MCP_ENTRY))throw new Error('Open Generative AI MCP not found. Set CADENCE_OGA_MCP_ENTRY to its src/index.js.');
  const directory=join(ASSETS_DIR,brandSlug,'oga');mkdirSync(directory,{recursive:true,mode:0o700});
  const [width,height]=aspect==='portrait'?[819,1024]:aspect==='landscape'?[1024,538]:[1024,1024];
  const transport=new StdioClientTransport({command:process.execPath,args:[OGA_MCP_ENTRY],cwd:dirname(OGA_MCP_ENTRY),stderr:'pipe',env:{
    ...getDefaultEnvironment(),
    OGA_MCP_OUTPUT_DIR:directory,
    OGA_IMAGE_PROVIDERS:'catgpt-gateway',
    OGA_CATGPT_TIMEOUT_MS:'480000',
    OGA_CATGPT_HEALTH_ROUTE:'1',
    CATGPT_GATEWAY_URL:CATGPT_URL,
    CATGPT_GATEWAY_TOKEN:CATGPT_TOKEN,
    CATGPT_IMAGE_MODEL:CATGPT_MODEL,
  }});
  // Drain diagnostics without exposing another process's environment or provider credentials.
  transport.stderr?.on('data',()=>{});
  const client=new Client({name:'cadence',version:'0.2.0'});
  try {
    await client.connect(transport,{timeout:15000});
    const result=await client.callTool({name:'generate_image',arguments:{prompt,width,height}},undefined,{timeout:510000,maxTotalTimeout:510000});
    const response=result.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n')||'';
    if(result.isError)throw new Error(`Open Generative AI MCP: ${response.slice(0,500)}`);
    if(!/^Provider: catgpt-gateway\s*$/m.test(response))throw new Error('MCP did not use the requested CatGPT provider; output rejected.');
    const path=response.match(/^Path: (.+)$/m)?.[1]?.trim();
    if(!path||!existsSync(path))throw new Error('MCP returned no saved image');
    const actual=realpathSync(path), rel=relative(realpathSync(directory),actual);
    if(rel.startsWith('..')||isAbsolute(rel)||!statSync(actual).isFile())throw new Error('MCP image is outside this brand’s output folder');
    if(statSync(actual).size>30*1024*1024)throw new Error('MCP image exceeds 30 MB');
    const bytes=readFileSync(actual);
    if(!((bytes[0]===0x89&&bytes[1]===0x50)||(bytes[0]===0xff&&bytes[1]===0xd8)))throw new Error('MCP did not return a PNG or JPEG image');
    return actual;
  } finally {
    await client.close().catch(()=>{});
    await transport.close().catch(()=>{});
  }
}
