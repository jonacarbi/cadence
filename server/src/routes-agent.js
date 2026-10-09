// Owner routes for choosing the text agent and for linking social platforms. Registered from routes-extra.js.
import { WorkflowError } from './workflow.js';
import { PROVIDERS, providerInfo, binPath, agentConfig, runAgent, DEFAULT_PROVIDER, LOCK_UNSUPPORTED } from './agents.js';
import { writeEnvValue } from './credentials.js';
import { setupAll, setupRow, saveApp } from './platforms-setup.js';

const clean = (v, what, max = 300) => {
  if (typeof v !== 'string') throw new WorkflowError(`${what} must be text`);
  const t = v.trim();
  if (t.length > max || /[\r\n]/.test(t)) throw new WorkflowError(`${what} is invalid`);
  return t;
};

/** Never includes api keys: only whether one is set. */
function agentState() {
  const cfg = agentConfig(), fb = agentConfig('fallback');
  return {
    active: { provider: cfg.provider, model: cfg.model, context: cfg.context, base_url: cfg.base_url, api_key_set: Boolean(cfg.api_key) },
    fallback: fb ? { provider: fb.provider, model: fb.model } : null,
    providers: PROVIDERS.map(({ id, name, kind, models, docs_url, fields }) => {
      const path = kind === 'cli' ? binPath(id) : undefined;
      return { id, name, kind, detected: kind === 'cli' ? Boolean(path) : Boolean(cfg.base_url || process.env.CADENCE_OPENAI_BASE_URL), ...(path && { path }), models, docs_url, fields };
    }),
  };
}

function saveProvider(body) {
  const provider = clean(body.provider ?? DEFAULT_PROVIDER, 'provider', 40);
  if (!providerInfo(provider)) throw new WorkflowError(`Unknown provider. Use one of: ${PROVIDERS.map((p) => p.id).join(', ')}`);
  const context = body.context ?? 'full';
  if (!['full', 'locked'].includes(context)) throw new WorkflowError("context must be 'full' or 'locked'");
  // gemini and opencode have no flag that stops them loading the user's own config/memory, so 'locked' would be a false promise.
  if (context === 'locked' && LOCK_UNSUPPORTED.has(provider)) throw new WorkflowError(`${providerInfo(provider).name} cannot run locked; pick 'full' or use Claude Code, Codex or an OpenAI-compatible endpoint`);
  const model = body.model === undefined ? '' : clean(body.model, 'model', 200);
  let baseUrl;
  if (body.base_url !== undefined) {
    baseUrl = clean(body.base_url, 'base_url', 500);
    if (baseUrl) { try { const u = new URL(baseUrl); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw 0; } catch { throw new WorkflowError('base_url must be an http(s) address without credentials'); } }
  }
  if (provider === 'openai' && !(baseUrl ?? process.env.CADENCE_OPENAI_BASE_URL)) throw new WorkflowError('An OpenAI-compatible provider needs a base_url (for example https://api.openai.com/v1)');
  // Validate everything before writing anything, so a rejected request leaves the .env untouched.
  const fbProvider = body.fallback_provider === undefined ? undefined : clean(body.fallback_provider, 'fallback_provider', 40);
  if (fbProvider && !providerInfo(fbProvider)) throw new WorkflowError('Unknown fallback provider');
  const apiKey = body.api_key === undefined || body.api_key === '' ? undefined : clean(body.api_key, 'api_key', 4000); // empty = keep the saved key
  writeEnvValue('CADENCE_TEXT_PROVIDER', provider);
  writeEnvValue('CADENCE_MODEL', model);
  writeEnvValue('CADENCE_AGENT_CONTEXT', context);
  if (baseUrl !== undefined) writeEnvValue('CADENCE_OPENAI_BASE_URL', baseUrl);
  if (apiKey !== undefined) writeEnvValue('CADENCE_OPENAI_API_KEY', apiKey);
  if (fbProvider !== undefined) writeEnvValue('CADENCE_FALLBACK_PROVIDER', fbProvider);
  if (body.fallback_model !== undefined) writeEnvValue('CADENCE_FALLBACK_MODEL', clean(body.fallback_model, 'fallback_model', 200));
}

async function testAgent() {
  const cfg = agentConfig(), started = Date.now();
  try {
    const sample = await runAgent(cfg, 'Reply with exactly: OK', { timeout: 90_000 });
    return { ok: true, provider: cfg.provider, model: cfg.model, latency_ms: Date.now() - started, sample: sample.slice(0, 200) };
  } catch (e) {
    const msg = e.code === 'ENOENT' ? `${providerInfo(cfg.provider).name} is not installed or not on PATH.` : String(e.message).replace(/(sk-|Bearer\s+)[\w.-]{8,}/g, '$1***').slice(0, 500);
    return { ok: false, provider: cfg.provider, model: cfg.model, latency_ms: Date.now() - started, error: msg };
  }
}

/** Returns true when handled. */
export async function agentRoutes({ req, path, body, owner, send }) {
  let x;
  if (path === '/api/agent/providers' && req.method === 'GET') { owner(); send(200, agentState()); return true; }
  if (path === '/api/agent/provider' && req.method === 'PUT') { owner(); saveProvider(body); send(200, agentState()); return true; }
  if (path === '/api/agent/test' && req.method === 'POST') { owner(); send(200, await testAgent()); return true; }
  if (path === '/api/platforms/setup' && req.method === 'GET') { owner(); send(200, setupAll()); return true; }
  if ((x = path.match(/^\/api\/platforms\/([a-z]+)\/app$/)) && req.method === 'PUT') { owner(); send(200, saveApp(x[1], body)); return true; }
  return false;
}
