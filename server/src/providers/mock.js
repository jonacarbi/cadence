// Mock platform — full workflow with zero credentials. Writes to the events log only.
export async function publish({ text, media }) {
  const id = `mock_${Date.now()}`;
  return { id, url: `mock://post/${id}`, meta: { chars: text.length, media: media.length } };
}
export async function metrics() { return { impressions: Math.floor(Math.random() * 500), likes: Math.floor(Math.random() * 40) }; }
