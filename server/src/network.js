import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
const blocked = new BlockList();
const blocked6 = new BlockList();
for (const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(ip,prefix,'ipv4');
for (const [ip,prefix] of [['::',96],['::ffff:0:0',96],['64:ff9b::',96],['64:ff9b:1::',48],['100::',64],['2001::',32],['2001:db8::',32],['2002::',16],['fc00::',7],['fe80::',10],['ff00::',8]]) blocked6.addSubnet(ip,prefix,'ipv6');
export function isPublicAddress(address) {
 const family=isIP(address); if(!family) return false;
 // Permit only global-unicast IPv6; IPv4 exceptions are enumerated above.
 if(family===6 && !/^[23][0-9a-f]{3}:/i.test(address)) return false;
 return !(family===4 ? blocked : blocked6).check(address,family===4?'ipv4':'ipv6');
}
export async function publicURL(input, resolve=lookup) {
 const url=new URL(input);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password) throw new Error('Only public HTTP(S) URLs without credentials are supported');
 if(url.port && !['80','443'].includes(url.port)) throw new Error('Only standard web ports are supported');
 const host=url.hostname.replace(/^\[|\]$/g,'');
 const records=isIP(host)?[{address:host,family:isIP(host)}]:await resolve(host,{all:true,verbatim:true});
 if(!records.length||records.some(r=>!isPublicAddress(r.address))) throw new Error('Private, local, and reserved network addresses are blocked');
 return {url,record:records[0]};
}
/** Validate every redirect and pin the socket to the validated DNS answer (prevents rebinding). */
export async function fetchPublic(input,{method='GET',headers={},body,limit=10*1024*1024,timeout=15000,redirects=4}={}) {
 const {url,record}=await publicURL(input);
 const result=await new Promise((resolve,reject)=> {
  const transport=url.protocol==='https:'?httpsRequest:httpRequest;
  const req=transport(url,{method,agent:false,headers:{'accept-encoding':'identity','user-agent':'Cadence/0.1',...headers},lookup:(_host,options,callback)=> {
   if(options.all) callback(null,[record]); else callback(null,record.address,record.family);
  }},res=> {
   const chunks=[];let size=0;
   res.on('data',chunk=> {size+=chunk.length;if(size>limit) {res.destroy(new Error('Response exceeds size limit'));return;}chunks.push(chunk);});
   res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks),url:url.href}));
  });
  const timer=setTimeout(()=>req.destroy(new Error('Request timed out')),timeout);timer.unref();
  req.on('close',()=>clearTimeout(timer)); req.on('error',reject); if(body) req.write(body);req.end();
 });
 if([301,302,303,307,308].includes(result.status)&&result.headers.location) {
  if(!redirects) throw new Error('Too many redirects');
  if(method!=='GET'&&method!=='HEAD') throw new Error('Redirect refused for authenticated write');
  const next=new URL(result.headers.location,url);
  const safeHeaders={...headers}; if(next.origin!==url.origin) { for(const key of Object.keys(safeHeaders)) if(['authorization','cookie'].includes(key.toLowerCase())) delete safeHeaders[key]; }
  return fetchPublic(next,{method,headers:safeHeaders,limit,timeout,redirects:redirects-1});
 }
 return result;
}

// Browser traffic uses the same pinned, public-only transport, including subresources and redirects.
export async function routePublic(route) {
 try {
  if(route.request().method()!=='GET')return await route.abort();
  const response=await fetchPublic(route.request().url());
  const headers=Object.fromEntries(Object.entries(response.headers).filter(([k,v])=>typeof v==='string'&&!['content-encoding','content-length','transfer-encoding','set-cookie','connection'].includes(k)));
  await route.fulfill({status:response.status,headers,body:response.body});
 }catch {await route.abort().catch(()=>{});}
}
