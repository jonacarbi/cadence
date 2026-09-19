import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'cadence-design-'));process.env.CADENCE_DIR=join(dir,'app');
const {db,insert}=await import('../src/db.js');
const {discoverDesignSystems,importDesignSystem,activateDesignSystem,designContext}=await import('../src/design-systems.js');
const library=join(dir,'library');mkdirSync(join(library,'acme'),{recursive:true});
writeFileSync(join(library,'acme','brand.json'),JSON.stringify({name:'Acme',colors:[{name:'Sea',role:'accent',hex:'#008080'}]}));
writeFileSync(join(library,'acme','DESIGN.md'),'# Acme design\nUse generous margins. Never use another client logo.');
mkdirSync(join(library,'fragment'));writeFileSync(join(library,'fragment','widget.js'),'console.log("not a system")');
const b=insert('brands',{slug:'acme',name:'Acme',url:'https://example.com',dir});
const other=insert('brands',{slug:'other',name:'Other',url:'https://example.org',dir});
test.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
test('discovers complete systems and excludes loose exports',()=>{
 const entries=discoverDesignSystems(library);assert.equal(entries.length,1);assert.equal(entries[0].name,'Acme');
});
test('imports immutable snapshots, reuses same version and pins context to client',()=>{
 const first=importDesignSystem(b,{source_id:'acme'},library);activateDesignSystem(b,first.id);
 assert.equal(importDesignSystem(b,{source_id:'acme'},library).id,first.id);
 assert.throws(()=>activateDesignSystem(other,first.id),/does not belong/);
 assert.throws(()=>designContext(other,first.id),/Assign/);
 writeFileSync(join(library,'acme','DESIGN.md'),'# Acme revised\nUse wide margins.');
 const second=importDesignSystem(b,{source_id:'acme'},library);assert.notEqual(second.id,first.id);
 assert.equal(designContext(b).id,first.id);assert.match(designContext(b).documents[0].text,/generous/);
 activateDesignSystem(b,second.id);assert.equal(designContext(b).id,second.id);
});
test('rejects traversal and does not copy symbolic links or hidden secrets',()=>{
 assert.throws(()=>importDesignSystem(b,{source_id:'../acme'},library),/Invalid/);
 writeFileSync(join(library,'acme','.env'),'not-a-real-secret');symlinkSync(join(library,'acme','.env'),join(library,'acme','leak.md'));
 const version=importDesignSystem(b,{source_id:'acme'},library);assert.ok(version.manifest.every(f=>!f.path.includes('leak')&&!f.path.includes('.env')));
});
