import { existsSync } from 'node:fs';
import { browserExecutable } from './browser.js';
import { all } from './db.js';
import { CLAUDE_BIN, NINE_ROUTER_MODEL, TEXT_PROVIDER, OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, IMAGE_PROVIDER, OGA_MCP_ENTRY, CATGPT_MODEL } from './config.js';

export function readiness() {
  const accounts=all('SELECT platform,paused FROM accounts');
  const hasText=TEXT_PROVIDER==='9router'?Boolean(NINE_ROUTER_MODEL):existsSync(CLAUDE_BIN)||Boolean(NINE_ROUTER_MODEL);
  return {checks:[
    {id:'text',title:'Text generation',ready:hasText,message:TEXT_PROVIDER==='9router'?(NINE_ROUTER_MODEL?`9Router · ${NINE_ROUTER_MODEL}. The router must be running.`:'Set CADENCE_FALLBACK_MODEL in Cadence’s .env file.'):'Claude CLI with your signed-in account. Set CADENCE_FALLBACK_MODEL to use 9Router when Claude is unavailable.'},
    {id:'browser',title:'Visual rendering',ready:Boolean(browserExecutable()),message:browserExecutable()?'Chrome/Chromium available for background rendering.':'Install Google Chrome or run: npx playwright install chromium (from the server directory).'},
    {id:'images',title:'Image generation',ready:IMAGE_PROVIDER==='oga-mcp'?existsSync(OGA_MCP_ENTRY):IMAGE_PROVIDER==='openai'?Boolean(OPENAI_API_KEY):true,message:IMAGE_PROVIDER==='oga-mcp'?`Open Generative AI MCP → CatGPT (${CATGPT_MODEL}). Keep the gateway running and signed in.`:IMAGE_PROVIDER==='openai'?'OpenAI API key configured.':'Using the configured image gateway. Keep it running and signed in.'},
    {id:'accounts',title:'Social accounts',ready:accounts.some(a=>a.platform!=='mock'&&!a.paused),message:accounts.some(a=>a.platform!=='mock'&&!a.paused)?'Real publishing accounts connected. Connections are scoped to each brand.':'Only dry-run accounts or no accounts connected. Add a real destination in Accounts.'},
    {id:'media',title:'Public media hosting',ready:Boolean(SUPABASE_URL&&SUPABASE_SERVICE_KEY)||!accounts.some(a=>!a.paused&&['instagram','threads','pinterest'].includes(a.platform)),message:SUPABASE_URL&&SUPABASE_SERVICE_KEY?'Supabase media hosting configured.':'Instagram, Threads and Pinterest images require SUPABASE_URL and SUPABASE_SERVICE_KEY.'},
  ],note:'Configuration checks only. Provider quotas, credentials and live publishing are verified when used.'};
}
