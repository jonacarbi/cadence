import { all, one, insert, update, run } from './db.js';
import { transaction } from './workflow.js';
const handlers=new Map();
export function registerJob(type,handler) {handlers.set(type,handler);}
export function enqueue(type,refId) {
 if(!handlers.has(type)) throw new Error(`Unknown job type: ${type}`);
 return transaction(()=> {
  const existing=one("SELECT * FROM jobs WHERE type=? AND ref_id=? AND status IN ('queued','running')",type,refId);
  if(existing) return existing;
  const id=insert('jobs',{type,ref_id:refId});return one('SELECT * FROM jobs WHERE id=?',id);
 });
}
export function recoverJobs() {run("UPDATE jobs SET status='interrupted', message='The app stopped during this job. Resume explicitly to avoid repeating paid generations.' WHERE status='running'");}
export function resumeJob(id) {
 const job=one('SELECT * FROM jobs WHERE id=?',id);
 if(!job || !['failed','interrupted'].includes(job.status)) throw new Error('Only failed or interrupted jobs can resume');
 update('jobs',id,{status:'queued',message:'Resuming'});
 return one('SELECT * FROM jobs WHERE id=?',id);
}
export async function workOne() {
 const job=transaction(()=> {
  const job=one("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1"); if(!job)return null;
  update('jobs',job.id,{status:'running',message:'Starting'});return job;
 });
 if(!job)return false;
 const report=(progress,message)=>update('jobs',job.id,{progress,message});
 try {
  const handler=handlers.get(job.type);if(!handler)throw new Error(`No handler for ${job.type}`);
  await handler(job.ref_id,report);report(1,'Complete');update('jobs',job.id,{status:'complete'});
 } catch(error) {update('jobs',job.id,{status:'failed',message:String(error.message).slice(0,1000)});}
 return true;
}
export function startWorker() {
 recoverJobs(); let busy=false;
 const timer=setInterval(async()=>{if(busy)return;busy=true;try{await workOne();}catch(error){console.error('Job worker:',error.message);}finally{busy=false;}},1000);timer.unref();
 return ()=>clearInterval(timer);
}
