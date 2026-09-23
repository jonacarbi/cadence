// The owner's own images. Everything else in Cadence is generated; this is the one lane for
// artwork that already exists (a product shot, a photo, a logo lockup). Uploads arrive as a local
// path rather than bytes because the app and the server share a machine — the file picker hands
// over a path, and a 1 MB JSON body could never carry an image anyway.
import { copyFileSync, existsSync, mkdirSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { extname, join, basename } from 'node:path';
import { all, one, insert, run, update, uuid } from './db.js';
import { WorkflowError, postById, transaction } from './workflow.js';
import { getBrand } from './brands.js';

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_BYTES = 25 * 1024 * 1024;

export function importMedia(brandId, input) {
  const brand = getBrand(brandId);
  if (!brand) throw new WorkflowError('Brand not found', 404);
  if (typeof input.path !== 'string' || !input.path.trim()) throw new WorkflowError('A file path is required');
  let source;
  try { source = realpathSync(input.path); } catch { throw new WorkflowError('That file does not exist', 404); }
  if (!statSync(source).isFile()) throw new WorkflowError('That path is not a file');
  const ext = extname(source).toLowerCase();
  if (!ALLOWED.has(ext)) throw new WorkflowError(`Images only: ${[...ALLOWED].join(', ')}`);
  const bytes = statSync(source).size;
  if (bytes > MAX_BYTES) throw new WorkflowError(`That image is ${Math.round(bytes / 1048576)} MB; the limit is 25 MB`);
  // Copy rather than reference: the library must keep working after the original is moved or deleted.
  const dir = join(brand.dir, 'uploads');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${uuid()}${ext}`);
  copyFileSync(source, path);
  const id = insert('media', { brand_id: brandId, path, filename: basename(source).slice(0, 200), bytes, alt_text: String(input.alt_text || '').slice(0, 500), tags: String(input.tags || '').slice(0, 200) });
  return one('SELECT * FROM media WHERE id = ?', id);
}

export const listMedia = (brandId) => all('SELECT * FROM media WHERE brand_id = ? ORDER BY created_at DESC', brandId);

export function deleteMedia(id) {
  const item = one('SELECT * FROM media WHERE id = ?', id);
  if (!item) throw new WorkflowError('Media not found', 404);
  // A published post's receipt points at this file; removing it would rewrite history.
  const used = one('SELECT id FROM posts WHERE image_path = ?', item.path);
  if (used) throw new WorkflowError('This image is attached to a post. Detach it there first.', 409);
  run('DELETE FROM media WHERE id = ?', id);
  if (existsSync(item.path)) unlinkSync(item.path);
  return { ok: true };
}

/** Use a library image as a post's media, or clear it. Same effect as an edit: approval is cleared. */
export function setPostMedia(postId, mediaId, version) {
  return transaction(() => {
    const post = postById(postId);
    if (!Number.isInteger(version) || post.version !== version) throw new WorkflowError('This post changed. Reload before continuing.', 409);
    if (['publishing', 'published', 'uncertain'].includes(post.status)) throw new WorkflowError('This post cannot be edited in its current state', 409);
    const item = mediaId === null ? null : one('SELECT * FROM media WHERE id = ? AND brand_id = ?', mediaId, post.brand_id);
    if (mediaId !== null && !item) throw new WorkflowError('Media not found for this brand', 404);
    // Drop generated frames: otherwise a carousel would publish the old renders and ignore this one.
    const assets = { ...post.assets, raw: null, frames: [], square: null };
    update('posts', postId, { image_path: item?.path ?? null, assets_json: JSON.stringify(assets), alt_text: item?.alt_text || post.alt_text || '', status: 'draft', approved_by: null, version: post.version + 1, error: null });
    return postById(postId);
  });
}
