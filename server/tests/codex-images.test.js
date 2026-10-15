import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'cadence-codex-img-'));
process.env.CADENCE_DIR = join(dir, 'app');
process.env.CADENCE_IMAGE_PROVIDER = 'codex';
process.env.CODEX_HOME = join(dir, 'codex');
mkdirSync(join(dir, 'codex/generated_images'), { recursive: true });
const bin = join(dir, 'codex-fake');
// Fake Codex: "outside" reports a file outside generated_images, anything else saves a PNG there.
writeFileSync(bin, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
 let out=path.join(process.env.CODEX_HOME,'generated_images','x.png');
 if(s.includes('outside'))out=path.join(${JSON.stringify(dir)},'stray.png');
 fs.writeFileSync(out,Buffer.from([137,80,78,71,13,10,26,10,0,0]));process.stdout.write('done\\nIMAGE: '+out+'\\n');});
`);
chmodSync(bin, 0o755);
process.env.CADENCE_CODEX_BIN = bin;
const { generateImage } = await import('../src/images.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));
test('codex provider saves the image Codex generated', async () => {
  const path = await generateImage('A mango on a table', { brandSlug: 'fruit', aspect: 'square' });
  assert.ok(existsSync(path)); assert.match(path, /fruit/);
});
test('codex images outside generated_images are rejected', async () => {
  await assert.rejects(generateImage('outside', { brandSlug: 'fruit' }), /did not just generate/);
});
