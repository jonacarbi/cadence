import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_DIR } from './config.js';
function tokenFile(name) {
 const path = join(APP_DIR, `${name}.token`);
 try { writeFileSync(path, randomBytes(32).toString('hex'), { mode:0o600, flag:'wx' }); } catch(e) { if(e.code !== 'EEXIST') throw e; }
 return readFileSync(path,'utf8').trim();
}
export const ownerToken = tokenFile('owner');
export const agentToken = tokenFile('agent');
function equal(a,b) { const x=Buffer.from(a), y=Buffer.from(b); return x.length === y.length && timingSafeEqual(x,y); }
export function authenticate(header='') {
 const token=header.startsWith('Bearer ') ? header.slice(7) : '';
 if(equal(token,ownerToken)) return 'owner';
 if(equal(token,agentToken)) return 'agent';
 return null;
}
