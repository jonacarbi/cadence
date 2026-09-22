// Discord — channel webhook URL. Attach images as files.
import { readFileSync } from "node:fs";
import { api, mediaType } from "./http.js";

export async function publish({ auth, text, media }) {
  const form = { payload_json: JSON.stringify({ content: text }) };
  media.slice(0, 10).forEach((m, i) => { form[`files[${i}]`] = new Blob([readFileSync(m)], { type: mediaType(m) }); });
  const r = await api(`${auth.webhook_url}?wait=true`, { method: "POST", form });
  return { id: r.id, url: "" };
}
