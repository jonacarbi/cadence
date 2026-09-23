import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'cadence-plan-'));process.env.CADENCE_DIR=join(dir,'app');
const {db,insert,all,one,run,setSetting}=await import('../src/db.js');
const {importDesignSystem,activateDesignSystem}=await import('../src/design-systems.js');
const {createCampaign,planCampaign,localSchedule,rollMonthlyCampaigns}=await import('../src/campaigns.js');
const source=join(dir,'source');mkdirSync(source);writeFileSync(join(source,'DESIGN.md'),'# Client identity\nUse dusty plum and 8% margins.');
const brand=insert('brands',{slug:'test',name:'Test',url:'https://example.com',dir});
const system=importDesignSystem(brand,{source_path:source});activateDesignSystem(brand,system.id);
test.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
test('month generation pins design version and produces unapproved drafts atomically',async()=> {
 const {campaign}=createCampaign({brand_id:brand,month:'2026-10',count:2,platforms:['mastodon'],time_zone:'America/Paramaribo'});
 let prompt='';const generate=async p=> {prompt=p;return {posts:[1,15].map(day=>({day,topic:`Topic ${day}`,copy:{mastodon:'A factual caption'},image_prompt:'Dusty plum composition',alt_text:'Simple illustration'}))};};
 await planCampaign(campaign.id,()=>{},{generate});assert.match(prompt,/dusty plum/);
 const posts=all('SELECT * FROM posts WHERE campaign_id=?',campaign.id);assert.equal(posts.length,2);assert.ok(posts.every(p=>p.status==='draft'&&!p.approved_by&&p.design_system_id===system.id));
 assert.equal(posts[0].scheduled_at,'2026-10-01T13:00:00.000Z');
 await assert.rejects(planCampaign(campaign.id,()=>{},{generate}),/already has drafts/);
});
test('invalid generated month leaves no partial drafts',async()=> {
 const {campaign}=createCampaign({brand_id:brand,month:'2026-11',count:2,platforms:['mastodon']});
 await assert.rejects(planCampaign(campaign.id,()=>{},{generate:async()=>({posts:[]})}),/incomplete/);
 assert.equal(all('SELECT id FROM posts WHERE campaign_id=?',campaign.id).length,0);
});
test('timezone conversion follows daylight saving and rejects nonexistent local hour',()=> {
 assert.equal(localSchedule('2026-01',10,10,'America/New_York'),'2026-01-10T15:00:00.000Z');
 assert.equal(localSchedule('2026-07',10,10,'America/New_York'),'2026-07-10T14:00:00.000Z');
 assert.throws(()=>localSchedule('2026-03',8,2,'America/New_York'),/does not exist/);
});

test('recurring planning repeats last month\'s settings once the owner enables it',()=> {
 const b2=insert('brands',{slug:'roll',name:'Roll',url:'https://rolling.example',dir});
 const s2=importDesignSystem(b2,{source_path:source});activateDesignSystem(b2,s2.id);
 const {campaign}=createCampaign({brand_id:b2,month:'2026-11',count:2,platforms:['mastodon'],hour:9,time_zone:'UTC',brief:'Keep it steady'},{queue:false});
 const january=new Date('2027-01-05T12:00:00Z');
 const mine=list=>list.filter(c=>c.brand_id===b2);
 assert.deepEqual(mine(rollMonthlyCampaigns({now:january})),[],'off by default');
 setSetting('auto_plan','on');
 assert.deepEqual(mine(rollMonthlyCampaigns({now:january})),[],'a campaign that never finished planning is not repeated');
 run("UPDATE campaigns SET status='visuals' WHERE id=?",campaign.id);
 const [next]=mine(rollMonthlyCampaigns({now:january}));
 assert.equal(next.month,'2027-01');assert.equal(next.brief,'Keep it steady');
 assert.deepEqual(JSON.parse(one('SELECT plan_json FROM campaigns WHERE id=?',next.id).plan_json).platforms,['mastodon']);
 assert.deepEqual(mine(rollMonthlyCampaigns({now:january})),[],'the same month is never planned twice');
 setSetting('auto_plan','off');
});
test('a full month is planned in batches and a mid-run failure resumes from the batches already saved',async()=> {
 const {campaign}=createCampaign({brand_id:brand,month:'2026-12',platforms:['mastodon']},{queue:false});
 assert.equal(JSON.parse(one('SELECT * FROM campaigns WHERE id=?',campaign.id).plan_json).count,31);
 let day=0,batches=[],fail=false;
 const generate=async p=> {
  const count=Number(p.match(/^Plan (\d+) distinct/)[1]);batches.push(count);
  if(fail&&batches.length===3)throw new Error('planner offline');
  return {posts:Array.from({length:count},()=>({day:++day,topic:`Topic ${day}`,copy:{mastodon:'A factual caption'},image_prompt:'Dusty plum composition',alt_text:'Simple illustration'}))};
 };
 fail=true;
 await assert.rejects(planCampaign(campaign.id,()=>{},{generate,queueVisuals:false}),/planner offline/);
 // The two batches that did return are saved, so the retry asks only for what is missing.
 assert.deepEqual(batches,[7,7,7]);
 assert.equal(JSON.parse(one('SELECT * FROM campaigns WHERE id=?',campaign.id).plan_json).items.length,14);
 assert.equal(all('SELECT id FROM posts WHERE campaign_id=?',campaign.id).length,0);
 fail=false;batches=[];
 await planCampaign(campaign.id,()=>{},{generate,queueVisuals:false});
 assert.deepEqual(batches,[7,7,3]);
 const posts=all('SELECT * FROM posts WHERE campaign_id=?',campaign.id);
 assert.equal(posts.length,31);
 assert.equal(new Set(posts.map(p=>p.scheduled_at)).size,31);
});
test('a plan with no stated hour uses the hour this brand performs best in',()=> {
 const at=(hour,day)=>`2026-03-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:00:00.000Z`;
 const scored=(hour,likes,n)=>{for(let i=0;i<n;i++){const id=insert('posts',{brand_id:brand,status:'published',copy_json:'{}',assets_json:'{}',platforms_json:'["mastodon"]',scheduled_at:at(hour,i+1)});
  run("INSERT INTO analytics (post_id, platform, metrics_json) VALUES (?,'mastodon',?)",id,JSON.stringify({favourites:likes,impressions:9999}));}};
 const plan=c=>JSON.parse(one('SELECT plan_json FROM campaigns WHERE id=?',c.id).plan_json).hour;
 assert.equal(plan(createCampaign({brand_id:brand,month:'2027-01',count:1,platforms:['mastodon'],time_zone:'UTC'},{queue:false}).campaign),10); // No history: the plain default.
 scored(19,50,4);scored(6,1,4);
 assert.equal(plan(createCampaign({brand_id:brand,month:'2027-02',count:1,platforms:['mastodon'],time_zone:'UTC'},{queue:false}).campaign),19);
 assert.equal(plan(createCampaign({brand_id:brand,month:'2027-03',count:1,platforms:['mastodon'],time_zone:'UTC',hour:7},{queue:false}).campaign),7); // An explicit hour still wins.
});
