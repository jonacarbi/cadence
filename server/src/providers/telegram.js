// Telegram — bot token + channel/chat id. Photos with caption, albums for carousels.
import { readFileSync } from "node:fs";
import { api } from "./http.js";

export async function publish({ auth, text, media }) {
  const base = `https://api.telegram.org/bot${auth.bot_token}`;
  if (!media.length) { const r = await api(`${base}/sendMessage`, { method: "POST", json: { chat_id: auth.chat_id, text } }); return { id: String(r.result.message_id), url: "" }; }
  if (media.length === 1) {
    const r = await api(`${base}/sendPhoto`, { method: "POST", form: { chat_id: auth.chat_id, caption: text, photo: new Blob([readFileSync(media[0])], { type: "image/png" }) } });
    return { id: String(r.result.message_id), url: "" };
  }
  const form = { chat_id: auth.chat_id, media: JSON.stringify(media.map((_, i) => ({ type: "photo", media: `attach://p${i}`, ...(i === 0 && { caption: text }) }))) };
  media.forEach((m, i) => { form[`p${i}`] = new Blob([readFileSync(m)], { type: "image/png" }); });
  const r = await api(`${base}/sendMediaGroup`, { method: "POST", form });
  return { id: String(r.result[0].message_id), url: "" };
}
