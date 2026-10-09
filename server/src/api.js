import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { all, one, insert, update, hydrate, logEvent } from './db.js';
import { authenticate } from './auth.js';
import { HOST, PORT, BRANDS_DIR } from './config.js';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createPost, editPost, approvePost, rejectPost, schedulePost, listPosts, WorkflowError } from './workflow.js';
import { capabilities, PLATFORMS } from './providers/index.js';
import { discoverDesignSystems, listDesignSystems, importDesignSystem, activateDesignSystem } from './design-systems.js';
import { createCampaign, listCampaigns } from './campaigns.js';
import { resumeJob } from './jobs.js';
import { extraRoutes, oauthCallback } from './routes-extra.js';
import { createAgentRequest, listRequests, requestById, continueRequest, scheduleRequest } from './content-agent.js';
import { readiness } from './readiness.js';
import { hostAndOriginOk, cookieActor, authRoutes, serveStatic } from './web.js';

async function readBody(req) {
 let size=0; const chunks=[];
 for await(const chunk of req) { size+=chunk.length; if(size>1024*1024) throw new WorkflowError('Request exceeds 1 MB',413); chunks.push(chunk); }
 try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw new WorkflowError('Invalid JSON'); }
}
function requiredText(value,name,max=1000) { if(typeof value !== 'string' || !value.trim() || value.length>max) throw new WorkflowError(`${name} is required (maximum ${max} characters)`); return value.trim(); }
export function createApiServer() {
 return createServer(async(req,res)=> {
  res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Referrer-Policy','no-referrer');
  const send=(status,body)=> { res.writeHead(status); res.end(JSON.stringify(body)); };
  try {
   // Loopback Host on our own port (DNS rebinding) and no foreign Origin. The browser UI's own origin is allowed;
   // it still needs the session cookie plus the CSRF header (web.js). Bearer clients never send an Origin.
   if(!hostAndOriginOk(req)) throw new WorkflowError('Invalid host or origin',403);
   const url=new URL(req.url,`http://${HOST}`), path=url.pathname;
   if(authRoutes(req,res,url)) return;
   if(!/^\/(api|oauth|health|auth)(\/|$)/.test(path) && serveStatic(req,res,path)) return;
   if(path==='/health' && req.method==='GET') return send(200,{status:'ok',app:'Cadence',version:'0.3.0'});
   if(path==='/oauth/callback' && req.method==='GET') return oauthCallback(url,res);
   const actor=authenticate(req.headers.authorization)||cookieActor(req); if(!actor) throw new WorkflowError('Authentication required',401);
   const owner=()=> { if(actor!=='owner') throw new WorkflowError('Owner access required',403); };
   const body=['POST','PATCH','PUT'].includes(req.method) ? await readBody(req) : {};
   if(!body || typeof body!=='object' || Array.isArray(body))throw new WorkflowError('Request body must be a JSON object');
   if(path==='/api/readiness'&&req.method==='GET'){owner();return send(200,await readiness());}
   if(path==='/api/agent/requests' && req.method==='POST') {owner();return send(202,createAgentRequest(body));}
   if(path==='/api/agent/requests' && req.method==='GET') return send(200,listRequests());
   const agentMatch=path.match(/^\/api\/agent\/requests\/([^/]+)(?:\/(continue|schedule))?$/);
   if(agentMatch) {
    if(req.method==='GET'&&!agentMatch[2])return send(200,requestById(agentMatch[1]));
    if(req.method==='POST') {owner();if(agentMatch[2]==='continue')return send(202,continueRequest(agentMatch[1]));if(agentMatch[2]==='schedule')return send(200,scheduleRequest(agentMatch[1],body.versions,actor));}
   }
   if(await extraRoutes({req,res,url,path,body,actor,owner,send})) return;
   if(path==='/api/capabilities' && req.method==='GET') return send(200,capabilities());
   if(path==='/api/campaigns' && req.method==='POST') return send(202,createCampaign(body));
   if(path==='/api/campaigns' && req.method==='GET') return send(200,listCampaigns(requiredText(url.searchParams.get('brand_id'),'brand_id')));
   const resumeMatch=path.match(/^\/api\/jobs\/([^/]+)\/resume$/);
   if(resumeMatch&&req.method==='POST') { owner(); return send(200,resumeJob(resumeMatch[1])); }
   if(path==='/api/design-library' && req.method==='GET') { owner(); return send(200,discoverDesignSystems()); }
   const designMatch=path.match(/^\/api\/brands\/([^/]+)\/design-systems(?:\/([^/]+)\/(activate|refresh))?$/);
   if(designMatch) {
    const [,brandId,systemId,action]=designMatch;
    if(req.method==='GET'&&!systemId) return send(200,listDesignSystems(brandId));
    if(req.method==='POST') {
     owner();
     if(!systemId) return send(201,importDesignSystem(brandId,body));
     if(action==='activate') return send(200,activateDesignSystem(brandId,systemId));
     if(action==='refresh') {
      const source=one('SELECT * FROM design_systems WHERE id=? AND brand_id=?',systemId,brandId);
      if(!source) throw new WorkflowError('Design system not found',404);
      return send(200,importDesignSystem(brandId,{source_path:source.source_path,source_project_url:source.source_project_url}));
     }
    }
   }
   if(path==='/api/brands' && req.method==='GET') return send(200,all('SELECT * FROM brands ORDER BY name').map(hydrate));
   if(path==='/api/brands' && req.method==='POST') {
    const name=requiredText(body.name,'Brand name',150); let site;
    try { site=new URL(body.url); } catch { throw new WorkflowError('A valid website URL is required'); }
    if(!['https:','http:'].includes(site.protocol)||site.username||site.password) throw new WorkflowError('Use an HTTP or HTTPS website without credentials');
    const existing=one('SELECT * FROM brands WHERE url = ?',site.origin); if(existing) return send(200,hydrate(existing));
    const slug=`${name.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,50)}-${randomUUID().slice(0,8)}`;
    const dir=join(BRANDS_DIR,slug); mkdirSync(dir,{recursive:true,mode:0o700});
    const id=insert('brands',{name,slug,url:site.origin,dir}); return send(201,hydrate(one('SELECT * FROM brands WHERE id = ?',id)));
   }
   if(path==='/api/accounts' && req.method==='GET') return send(200,all('SELECT * FROM accounts ORDER BY label').map(hydrate));
   // No raw account POST: accounts only come from OAuth or /api/accounts/manual, which resolve the canonical remote id.
   const accountMatch=path.match(/^\/api\/accounts\/([^/]+)\/pause$/);
   if(accountMatch && req.method==='POST') { owner(); if(typeof body.paused!=='boolean') throw new WorkflowError('paused must be true or false'); if(!one('SELECT id FROM accounts WHERE id=?',accountMatch[1])) throw new WorkflowError('Account not found',404); return send(200,hydrate(update('accounts',accountMatch[1],{paused:body.paused?1:0,failures:0}))); }
   if(path==='/api/posts' && req.method==='GET') return send(200,listPosts(requiredText(url.searchParams.get('brand_id'),'brand_id')));
   if(path==='/api/posts' && req.method==='POST') return send(201,createPost(body,actor));
   const match=path.match(/^\/api\/posts\/([^/]+)(?:\/(approve|reject|schedule))?$/);
   if(match) {
    const [,id,action]=match;
    if(!action && req.method==='PATCH') return send(200,editPost(id,body,body.version));
    if(req.method==='POST' && action==='approve') { owner(); return send(200,approvePost(id,body.version,actor)); }
    if(req.method==='POST' && action==='reject') { owner(); return send(200,rejectPost(id,body.version,actor)); }
    if(req.method==='POST' && action==='schedule') return send(200,schedulePost(id,body.version,body.account_ids));
   }
   if(path==='/api/deliveries' && req.method==='GET') return send(200,all('SELECT * FROM deliveries ORDER BY rowid DESC LIMIT 500'));
   if(path==='/api/jobs' && req.method==='GET') return send(200,all('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100'));
   if(path==='/api/events' && req.method==='GET') return send(200,all('SELECT * FROM events ORDER BY id DESC LIMIT 200').map(hydrate));
   throw new WorkflowError('Endpoint not found',404);
  } catch(error) { const status=error instanceof WorkflowError?error.status:500; if(status===500) console.error('API request failed:',error.message); send(status,{error:status===500?'Internal error; see local server logs':error.message}); }
 });
}
export async function listen(server,port=PORT) { await new Promise((resolve,reject)=> {server.once('error',reject);server.listen(port,HOST,resolve);}); return server.address(); }
