// Explicit, isolated live-provider smoke test. Generates one image; never sends to real social accounts.
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.env.CADENCE_LIVE_SMOKE !== '1') throw new Error('Set CADENCE_LIVE_SMOKE=1 to run a live text/image generation test.');
const root=fileURLToPath(new URL('..',import.meta.url));
const home=process.env.HOME||process.env.USERPROFILE||'';
const appDir=process.env.CADENCE_DIR||(process.platform==='darwin'?join(home,'Library/Application Support/Cadence'):process.platform==='win32'?join(process.env.APPDATA||join(home,'AppData/Roaming'),'Cadence'):join(process.env.XDG_DATA_HOME||join(home,'.local/share'),'cadence'));
const resume=process.env.CADENCE_SMOKE_RESUME;
if(resume&&!resume.startsWith(join(tmpdir(),'cadence-release-smoke-')))throw new Error('Resume only an isolated smoke-test directory');
process.env.CADENCE_DIR=resume||mkdtempSync(join(tmpdir(),'cadence-release-smoke-'));
// The real .env holds sealed values: open them with the real folder's key, after switching so nothing writes there.
const {parseEnvValue,openEnvValue,reloadEnvSettings}=await import('../server/src/config.js');
const env=join(appDir,'.env');
if(existsSync(env))for(const line of readFileSync(env,'utf8').split(/\r?\n/)) {
 const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
 if(m&&!(m[1] in process.env))process.env[m[1]]=openEnvValue(parseEnvValue(m[2]),appDir);
}
reloadEnvSettings(); // config captured image/media settings at import, before these credentials were loaded
if(!['openai','catgpt','oga-mcp'].includes(process.env.CADENCE_IMAGE_PROVIDER||(process.env.OPENAI_API_KEY?'openai':'none')))throw new Error('No image provider configured: the live smoke test needs one to check a generated image');
console.log('Isolated workspace:',process.env.CADENCE_DIR);
const {createAgentRequest,runAgent,requestById,scheduleRequest}=await import('../server/src/content-agent.js');
const {db,insert,encrypt,run,one}=await import('../server/src/db.js');
const {tick}=await import('../server/src/scheduler.js');
const {publish}=await import('../server/src/providers/mock.js');
const request=resume?requestById(one('SELECT id FROM agent_requests ORDER BY rowid DESC LIMIT 1').id):createAgentRequest({prompt:'Create one single-image post for Northline Coffee, a fictional independent coffee roaster. Warm, plainspoken English. Topic: making a mindful morning coffee ritual. Do not claim specific products, prices or promotions. Use cream, dark brown and terracotta. Visual: ceramic coffee cup with soft morning window light.',mode:'single'});
const report=(n,message)=>console.log(`${Math.round(n*100)}% ${message}`);
try {
 if(!request.brand_id)await runAgent(request.id,report);
 const setup=requestById(request.id);
 for(const platform of ['mock','mastodon'])if(!one('SELECT id FROM accounts WHERE brand_id=? AND platform=?',setup.brand_id,platform))insert('accounts',{brand_id:setup.brand_id,platform,label:'Isolated smoke test',auth_enc:encrypt({})});
 await runAgent(request.id,report);
 const result=requestById(request.id);
 if(result.status!=='review'||result.posts.length!==1||!result.posts[0].image_path)throw new Error('Expected a finished visual post for review');
 const generated=readdirSync(join(process.env.CADENCE_DIR,'assets'),{recursive:true}).filter(f=>/\.(png|jpe?g|webp)$/i.test(f)&&!/(^|[\\/])renders[\\/]/.test(f)); // renders/ holds layouts, not generated photos
 if(!generated.length)throw new Error('The image provider produced no image: the post fell back to the text-only layout');
 const output=join(root,'build/release-check');mkdirSync(output,{recursive:true});
 copyFileSync(result.posts[0].image_path,join(output,'sample-post.jpg'));
 const scheduled=scheduleRequest(request.id,Object.fromEntries(result.posts.map(p=>[p.id,p.version])),'owner');
 const due=new Date(Date.now()-1000).toISOString(); // the scheduler claims by delivery time, so move both
 for(const p of scheduled.posts){run('UPDATE posts SET scheduled_at=? WHERE id=?',due,p.id);run('UPDATE deliveries SET next_attempt_at=? WHERE post_id=?',due,p.id);}
 await tick({getProvider:()=>({publish:async({post,account})=>publish({text:post.copy[account.platform],media:[]})})});
 const final=requestById(request.id);
 if(final.posts.some(p=>p.status!=='published'))throw new Error('Dry-run publishing did not complete');
 writeFileSync(join(output,'smoke-result.json'),JSON.stringify({checked_at:new Date().toISOString(),text_provider:process.env.CADENCE_TEXT_PROVIDER,model:process.env.CADENCE_FALLBACK_MODEL,image_provider:process.env.CADENCE_IMAGE_PROVIDER||(process.env.OPENAI_API_KEY?'openai':'none'),image_model:process.env.CATGPT_IMAGE_MODEL||'chatgpt',posts:final.posts.map(p=>({topic:p.topic,copy:p.copy,status:p.status,platforms:p.platforms})),real_social_publishing:false},null,2));
 console.log('PASS: live brand + copy + image + rendering + dry-run delivery. Artifacts: build/release-check');
} catch(error) {console.error('SMOKE FAILED:',error.message);process.exitCode=1;} finally {db.close();}
