import { existsSync } from 'node:fs';
import { browserExecutable } from './browser.js';
import { all } from './db.js';
import { META } from './providers/registry.js';
import { PLATFORMS } from './providers/index.js';
import { agentConfig, binPath, providerInfo } from './agents.js';
import { OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, IMAGE_PROVIDER, OGA_MCP_ENTRY, CATGPT_MODEL, CATGPT_URL, CATGPT_TOKEN } from './config.js';

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
  if (IMAGE_PROVIDER === 'none') return { ready: true, message: 'No AI photos: posts use the branded layout only. Set OPENAI_API_KEY (or CADENCE_IMAGE_PROVIDER=openai) to add generated images.' };
  if (IMAGE_PROVIDER === 'codex') { const bin = binPath('codex'); return { ready: Boolean(bin), message: bin ? `Codex CLI (${bin}) image generation on your ChatGPT sign-in.` : 'Codex CLI was not found on PATH. Install it and run codex login.' }; }
  if (IMAGE_PROVIDER === 'openai') return { ready: Boolean(OPENAI_API_KEY), message: OPENAI_API_KEY ? 'OpenAI-compatible image API key configured.' : 'Set OPENAI_API_KEY in Cadence\u2019s .env file.' };
  const via = IMAGE_PROVIDER === 'oga-mcp' ? `Open Generative AI MCP \u2192 CatGPT (${CATGPT_MODEL})` : `CatGPT gateway (${CATGPT_MODEL})`;
  if (IMAGE_PROVIDER === 'oga-mcp' && !(OGA_MCP_ENTRY && existsSync(OGA_MCP_ENTRY))) return { ready: false, message: 'Open Generative AI MCP: set CADENCE_OGA_MCP_ENTRY to its src/index.js.' };
  if (!quota.reachable) return { ready: false, message: `${via} is not answering. Start it and sign it in.` };
  if (!quota.can) return { ready: false, message: `${via} is out of image quota${quota.hours ? ` for about ${quota.hours}h` : ''}. Sign in to an account with image credits, or set OPENAI_API_KEY to use the API directly.` };
  return { ready: true, message: `${via}. Reachable with no rate limit recorded; a plan's own image allowance is only visible when a post is generated.` };
}

/** One check per configured provider: CLIs need the binary on PATH, API providers need a base URL + model. */
export function textCheck(env=process.env){
  let cfg; try{cfg=agentConfig('primary',env);}catch(e){return{ready:false,message:e.message};}
  const info=providerInfo(cfg.provider), fb=agentConfig('fallback',env), tail=fb?` Fallback: ${fb.provider}${fb.model?` \u00b7 ${fb.model}`:''}.`:'';
  if(info.kind==='cli'){const bin=binPath(cfg.provider);
    return bin?{ready:true,message:`${info.name} (${bin})${cfg.model?` \u00b7 ${cfg.model}`:''}, context ${cfg.context}. Uses your signed-in CLI.${tail}`}
      :{ready:false,message:`${info.name} was not found on PATH. Install it and sign in (${info.docs_url}), or pick another provider in Settings.`};}
  const ok=Boolean(cfg.base_url&&cfg.model);
  return{ready:ok,message:ok?`${info.name} \u00b7 ${cfg.model} at ${cfg.base_url}.${tail}`:'Set a base URL and model for the OpenAI-compatible provider in Settings.'};
}

export async function readiness({ fetchImpl = fetch } = {}) {
  const accounts=all('SELECT platform,paused FROM accounts');
  const hosted=Object.keys(META).filter(p=>META[p].needsPublicUrl).map(p=>PLATFORMS[p].name);
  const quota=['openai','none','codex'].includes(IMAGE_PROVIDER)?null:await catgptQuota(fetchImpl);
  const text=textCheck();
  return {checks:[
    {id:'text',title:'Text generation',...text},
    {id:'browser',title:'Visual rendering',ready:Boolean(browserExecutable()),message:browserExecutable()?`Chromium-based browser found (${browserExecutable()}).`:'Install Google Chrome, Chromium or Microsoft Edge, or run: npx playwright install chromium (from the server directory), or set CADENCE_CHROMIUM_EXECUTABLE.'},
    {id:'images',title:'Image generation',...imageCheck(quota)},
    {id:'accounts',title:'Social accounts',ready:accounts.some(a=>a.platform!=='mock'&&!a.paused),message:accounts.some(a=>a.platform!=='mock'&&!a.paused)?'Real publishing accounts connected. Connections are scoped to each brand.':'Only dry-run accounts or no accounts connected. Add a real destination in Accounts.'},
    {id:'media',title:'Public media hosting',ready:Boolean(SUPABASE_URL&&SUPABASE_SERVICE_KEY)||!accounts.some(a=>!a.paused&&META[a.platform]?.needsPublicUrl),message:SUPABASE_URL&&SUPABASE_SERVICE_KEY?'Supabase media hosting configured.':`${hosted.join(', ')} images require SUPABASE_URL and SUPABASE_SERVICE_KEY.`},
  ],note:'Image quota is probed live; credentials and real publishing are verified when used.'};
}
