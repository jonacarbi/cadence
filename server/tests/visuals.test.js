import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.CADENCE_DIR = mkdtempSync(join(tmpdir(), 'cadence-visuals-'));
const { imageSubject } = await import('../src/visuals.js');

test('image subject never reaches the image model empty', () => {
  assert.equal(imageSubject({ image_prompt: '  A red fox  ', topic: 'x' }), 'A red fox');
  const derived = imageSubject({ image_prompt: '', topic: 'Weekly planning', copy: { mastodon: 'One clear priority.' } });
  assert.match(derived, /Weekly planning/);
  assert.match(derived, /One clear priority\./);
  assert.throws(() => imageSubject({ image_prompt: '', topic: ' ', copy: { mastodon: '' } }), /image prompt, topic or caption/);
});
