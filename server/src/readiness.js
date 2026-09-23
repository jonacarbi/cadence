import { existsSync } from 'node:fs';
import { browserExecutable } from './browser.js';
import { all } from './db.js';
import { META } from './providers/registry.js';
import { PLATFORMS } from './providers/index.js';
import { CLAUDE_BIN, NINE_ROUTER_MODEL, TEXT_PROVIDER, OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, IMAGE_PROVIDER, OGA_MCP_ENTRY, CATGPT_MODEL, CATGPT_URL, CATGPT_TOKEN } from './config.js';

// A configured gateway can still be out of image quota for hours, which otherwise shows up only as
// requests that burn four retries each and fail. The gateway records a limit once it has hit a real
// 429, so a negative is worth surfacing; a positive only means no limit has been recorded yet, since
// a plan refusal arrives as ordinary reply text the gateway never counts. Don't promise more.
async function catgptQuota(fetchImpl) {
  try {
    const res = await fetchImpl(`${CATGPT_URL.replace(/\/$/,'')}/status`, { headers: CATGPT_TOKEN ? { authorization: `Bearer ${CATGPT_TOKEN}` } : {}, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { reachable: false };
    const s = await res.json();
    return { reachable: true, can: s.can_generate_image !== false, hours: Math.round((s.retry_after_seconds || 0) / 3600) };
  } catch { return { reachable: false }; }
}

function imageCheck(quota) {
  if (IMAGE_PROVIDER === 'openai') return { ready: Boolean(OPENAI_API_KEY), message: OPENAI_API_KEY ? 'OpenAI API key configured.' : 'Set OPENAI_API_KEY in Cadence\u2019s .env file.' };
  const via = IMAGE_PROVIDER === 'oga-mcp' ? `Open Generative AI MCP \u2192 CatGPT (${CATGPT_MODEL})` : 'The configured image gateway';
  if (IMAGE_PROVIDER === 'oga-mcp' && !existsSync(OGA_MCP_ENTRY)) return { ready: false, message: `${via}: the MCP entry point is missing.` };
  if (!quota.reachable) return { ready: false, message: `${via} is not answering. Start it and sign it in.` };
  if (!quota.can) return { ready: false, message: `${via} is out of image quota${quota.hours ? ` for about ${quota.hours}h` : ''}. Sign in to an account with image credits, or set OPENAI_API_KEY to use the API directly.` };
  return { ready: true, message: `${via}. Reachable with no rate limit recorded; a plan's own image allowance is only visible when a post is generated.` };
}

export async function readiness({ fetchImpl = fetch } = {}) {
  const accounts=all('SELECT platform,paused FROM accounts');
  const hosted=Object.keys(META).filter(p=>META[p].needsPublicUrl).map(p=>PLATFORMS[p].name);
  const quota=IMAGE_PROVIDER==='openai'?null:await catgptQuota(fetchImpl);
  const hasText=TEXT_PROVIDER==='9router'?Boolean(NINE_ROUTER_MODEL):existsSync(CLAUDE_BIN)||Boolean(NINE_ROUTER_MODEL);
  return {checks:[
    {id:'text',title:'Text generation',ready:hasText,message:TEXT_PROVIDER==='9router'?(NINE_ROUTER_MODEL?`9Router · ${NINE_ROUTER_MODEL}. The router must be running.`:'Set CADENCE_FALLBACK_MODEL in Cadence’s .env file.'):'Claude CLI with your signed-in account. Set CADENCE_FALLBACK_MODEL to use 9Router when Claude is unavailable.'},
    {id:'browser',title:'Visual rendering',ready:Boolean(browserExecutable()),message:browserExecutable()?'Chrome/Chromium available for background rendering.':'Install Google Chrome or run: npx playwright install chromium (from the server directory).'},
    {id:'images',title:'Image generation',...imageCheck(quota)},
    {id:'accounts',title:'Social accounts',ready:accounts.some(a=>a.platform!=='mock'&&!a.paused),message:accounts.some(a=>a.platform!=='mock'&&!a.paused)?'Real publishing accounts connected. Connections are scoped to each brand.':'Only dry-run accounts or no accounts connected. Add a real destination in Accounts.'},
    {id:'media',title:'Public media hosting',ready:Boolean(SUPABASE_URL&&SUPABASE_SERVICE_KEY)||!accounts.some(a=>!a.paused&&META[a.platform]?.needsPublicUrl),message:SUPABASE_URL&&SUPABASE_SERVICE_KEY?'Supabase media hosting configured.':`${hosted.join(', ')} images require SUPABASE_URL and SUPABASE_SERVICE_KEY.`},
  ],note:'Image quota is probed live; credentials and real publishing are verified when used.'};
}
