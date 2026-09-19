// Caption linter (pendpost-style): rules.json + hard platform limits. Returns [{rule, severity, message, platform}].
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_DIR } from "./config.js";
import { PLATFORMS } from "./providers/index.js";

const RULES_PATH = join(REPO_DIR, "server/rules.json");
export const loadRules = () => JSON.parse(readFileSync(RULES_PATH, "utf8"));

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const URL_RE = /https?:\/\/[^\s)]+/g;

export function lintCaption(text, platform, rules = loadRules()) {
  const issues = [];
  const push = (rule, message) => issues.push({ rule, severity: rules[rule]?.severity || "warn", message, platform });
  const limit = PLATFORMS[platform]?.maxChars;
  if (limit && [...text].length > limit) issues.push({ rule: "maxChars", severity: "block", message: `${[...text].length}/${limit} chars`, platform });
  const tags = (text.match(/#\w+/g) || []).length;
  if (tags > rules.maxHashtags.value) push("maxHashtags", `${tags} hashtags (max ${rules.maxHashtags.value})`);
  const caps = (text.match(/\b[A-Z]{4,}\b/g) || []).length;
  if (caps > rules.allCapsWordsMax.value) push("allCapsWordsMax", `${caps} all-caps words`);
  for (const p of rules.bannedPhrases.value) if (text.toLowerCase().includes(p.toLowerCase())) push("bannedPhrases", `contains "${p}"`);
  const emoji = (text.match(EMOJI_RE) || []).length;
  if (emoji > rules.maxEmoji.value) push("maxEmoji", `${emoji} emoji (max ${rules.maxEmoji.value})`);
  for (const r of rules.regex.value) if (new RegExp(r, "i").test(text)) push("regex", `matches /${r}/`);
  if (rules.requireCta.value && !/\b(learn|shop|book|join|read|get|try|discover|visit|sign up|dm|link)\b/i.test(text)) push("requireCta", "no call to action");
  return issues;
}

/** Async: also verify links resolve (HEAD). */
export async function lintPost(copy, rules = loadRules()) {
  const issues = [];
  for (const [platform, text] of Object.entries(copy)) {
    if (typeof text !== "string") continue;
    issues.push(...lintCaption(text, platform, rules));
    if (rules.linkCheck.value) {
      for (const url of text.match(URL_RE) || []) {
        try {
          const r = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8000) });
          if (r.status >= 400) issues.push({ rule: "linkCheck", severity: "warn", message: `${url} → ${r.status}`, platform });
        } catch { issues.push({ rule: "linkCheck", severity: "warn", message: `${url} unreachable`, platform }); }
      }
    }
  }
  return issues;
}

export const hasBlockers = (issues) => issues.some((i) => i.severity === "block");
