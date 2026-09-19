// Capability declarations are separate from executable adapters. Unsupported lanes fail closed.
export const PLATFORMS = Object.freeze({
  instagram: { name: 'Instagram', maxChars: 2200, requiresMedia: true },
  facebook: { name: 'Facebook', maxChars: 63206 },
  linkedin: { name: 'LinkedIn', maxChars: 3000 },
  x: { name: 'X', maxChars: 280 },
  threads: { name: 'Threads', maxChars: 500 },
  bluesky: { name: 'Bluesky', maxChars: 300 },
  mastodon: { name: 'Mastodon', maxChars: 500 },
  telegram: { name: 'Telegram', maxChars: 4096 },
  discord: { name: 'Discord', maxChars: 2000 },
  pinterest: { name: 'Pinterest', maxChars: 500, requiresMedia: true },
  tiktok: { name: 'TikTok', maxChars: 2200, requiresMedia: true },
  youtube: { name: 'YouTube', maxChars: 5000, requiresMedia: true },
  mock: { name: 'Mock (dry run)', maxChars: 2000 },
});
const adapters = new Map();
export function registerProvider(platform, adapter) {
  if (!PLATFORMS[platform] || typeof adapter.publish !== 'function') throw new Error('Invalid provider');
  adapters.set(platform, adapter);
}
export function providerFor(platform) {
  const adapter = adapters.get(platform);
  if (!adapter) throw new Error(`Publishing adapter for ${platform} is not configured`);
  return adapter;
}
export function capabilities() {
  return Object.entries(PLATFORMS).map(([id, spec]) => ({ id, ...spec, available: adapters.has(id) }));
}
