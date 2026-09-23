import test from 'node:test';
import assert from 'node:assert/strict';
import { login } from '../src/providers/bluesky.js';
import { publish as instagram } from '../src/providers/instagram.js';
import { publish as linkedin } from '../src/providers/linkedin.js';
import { publish as tiktok } from '../src/providers/tiktok.js';

test('Bluesky accepts the handle field collected by the native account form',async t=>{
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(JSON.parse(options.body).identifier,'studio.example');
  return Response.json({did:'did:plc:test',accessJwt:'test-session',handle:'studio.example'});
 });
 const result=await login({handle:'studio.example',app_password:'test-only'});
 assert.equal(result.did,'did:plc:test');
});
test('a failed Instagram permalink lookup preserves the confirmed publication receipt',async t=>{
 t.mock.method(globalThis,'fetch',async url=>{
  if(String(url).includes('status_code'))return Response.json({status_code:'FINISHED'});
  if(String(url).includes('fields=permalink'))return Response.json({error:'expired read permission'},{status:403});
  if(String(url).endsWith('/media_publish'))return Response.json({id:'published-id'});
  return Response.json({id:'container-id'});
 });
 const result=await instagram({auth:{access_token:'test'},account:{external_id:'test'},text:'A post',mediaUrls:['https://example.com/image.jpg']});
 assert.equal(result.id,'published-id');
});
test('LinkedIn uses a supported version and propagates explicit API rejections',async t=>{
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(options.headers['LinkedIn-Version'],process.env.CADENCE_LINKEDIN_VERSION||'202609');
  return new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:test'}});
 });
 const input={auth:{access_token:'test'},account:{external_id:'urn:li:person:test'},text:'A post',media:[]};
 assert.equal((await linkedin(input)).id,'urn:li:share:test');
 globalThis.fetch=async()=>new Response(null,{status:429});
 await assert.rejects(linkedin(input),error=>error.status===429);
});
test('TikTok posts photos at an allowed privacy level and keeps the receipt when the status poll breaks',async t=>{
 const calls=[];
 const mock=status=>t.mock.method(globalThis,'fetch',async(url,options)=>{
  const path=String(url);calls.push(path);
  if(path.endsWith('/creator_info/query/'))return Response.json({data:{creator_username:'studio',privacy_level_options:['SELF_ONLY']}});
  if(path.endsWith('/content/init/')){
   const b=JSON.parse(options.body);
   assert.equal(b.media_type,'PHOTO');
   assert.equal(b.source_info.source,'PULL_FROM_URL');
   assert.equal(b.post_info.privacy_level,'SELF_ONLY'); // An unaudited client may not post publicly.
   return Response.json({data:{publish_id:'pub-1'}});
  }
  return status();
 });
 const input={auth:{access_token:'test'},account:{},text:'A caption',mediaUrls:['https://example.com/a.jpg']};
 mock(()=>Response.json({data:{status:'PUBLISH_COMPLETE',publicaly_available_post_id:['7333']}}));
 assert.equal((await tiktok(input)).id,'7333');
 mock(()=>Response.json({error:'gone'},{status:403}));
 assert.equal((await tiktok(input)).id,'pub-1'); // Init already accepted the post; a dead poll must not lose that.
 mock(()=>Response.json({data:{status:'FAILED',fail_reason:'photo_pull_failed'}}));
 await assert.rejects(tiktok(input),e=>e.definitelyNotSent===true);
});
