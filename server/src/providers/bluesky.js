// Bluesky — AT Protocol with an app password. No developer app needed.
import { readFileSync } from "node:fs";
import { api } from "./http.js";

export async function login(auth) {
  const s = await api(`${auth.service || "https://bsky.social"}/xrpc/com.atproto.server.createSession`, { method: "POST", json: { identifier: auth.identifier, password: auth.app_password } });
  return { ...auth, did: s.did, accessJwt: s.accessJwt, handle: s.handle };
}

function facets(text) {
  const out = [];
  const enc = new TextEncoder();
  for (const m of text.matchAll(/https?:\/\/[^\s)]+/g)) {
    const byteStart = enc.encode(text.slice(0, m.index)).length;
    out.push({ index: { byteStart, byteEnd: byteStart + enc.encode(m[0]).length }, features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }] });
  }
  for (const m of text.matchAll(/#(\w+)/g)) {
    const byteStart = enc.encode(text.slice(0, m.index)).length;
    out.push({ index: { byteStart, byteEnd: byteStart + enc.encode(m[0]).length }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[1] }] });
  }
  return out;
}

export async function publish({ auth: a, text, media, altText }) {
  const auth = await login(a);
  const base = auth.service || "https://bsky.social";
  const h = { authorization: `Bearer ${auth.accessJwt}` };
  const images = [];
  for (const m of media.slice(0, 4)) {
    const up = await api(`${base}/xrpc/com.atproto.repo.uploadBlob`, { method: "POST", headers: { ...h, "content-type": "image/png" }, body: readFileSync(m) });
    images.push({ alt: altText || "", image: up.blob });
  }
  const record = { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString(), facets: facets(text), ...(images.length && { embed: { $type: "app.bsky.embed.images", images } }) };
  const r = await api(`${base}/xrpc/com.atproto.repo.createRecord`, { method: "POST", headers: h, json: { repo: auth.did, collection: "app.bsky.feed.post", record } });
  const rkey = r.uri.split("/").pop();
  return { id: r.uri, url: `https://bsky.app/profile/${auth.handle}/post/${rkey}` };
}

export async function metrics(a, published) {
  const auth = await login(a);
  const r = await api(`${auth.service || "https://bsky.social"}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(published.id)}`, { headers: { authorization: `Bearer ${auth.accessJwt}` } });
  const p = r.posts[0] || {};
  return { likes: p.likeCount ?? 0, reposts: p.repostCount ?? 0, replies: p.replyCount ?? 0, quotes: p.quoteCount ?? 0 };
}
