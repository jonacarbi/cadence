// MCP stdio server: every tool is a thin call into the running REST API, so agents and the mac app share one
// code path and one permission model. Default role is "agent" (drafts only). CADENCE_MCP_ROLE=owner unlocks approval.
import { createInterface } from 'node:readline';
import { BASE_URL } from './config.js';
import { ownerToken, agentToken } from './auth.js';

const token = process.env.CADENCE_MCP_ROLE === 'owner' ? ownerToken : agentToken;
const S = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (description) => ({ type: 'string', description });
const TOOLS = [
  ['cadence_capabilities', 'Platforms and their limits', S({}), () => api('GET', '/api/capabilities')],
  ['cadence_create_brand', 'Create a brand from its website URL; extracts the design system in the background', S({ url: str('Website URL'), name: str('Optional name') }, ['url']), (a) => api('POST', '/api/brands', a)],
  ['cadence_list_brands', 'List brands', S({}), () => api('GET', '/api/brands')],
  ['cadence_get_brand', 'Brand detail including tokens and voice', S({ id: str('Brand id or slug') }, ['id']), (a) => api('GET', `/api/brands/${a.id}`)],
  ['cadence_plan_month', 'Plan a month of posts for a brand (drafts + visuals, then review)', S({ brand_id: str('Brand id'), month: str('YYYY-MM'), platforms: { type: 'array', items: { type: 'string' } }, brief: str('Content brief'), count: { type: 'integer' }, time_zone: str('IANA timezone'), hour: { type: 'integer' } }, ['brand_id','month','platforms']), (a) => api('POST', '/api/campaigns', a)],
  ['cadence_content_agent', 'Create a brand, a post for every connected platform, or a month of content (owner role)', S({brand_id:str('Optional existing brand'),prompt:str('Brief'),website:str('Source website'),mode:str('auto|brand|single|month'),month:str('YYYY-MM'),time_zone:str('IANA timezone') }), a=>api('POST','/api/agent/requests',a)],
  ['cadence_agent_requests', 'Content agent progress and generated posts', S({}), ()=>api('GET','/api/agent/requests')],
  ['cadence_get_campaign', 'Campaign with its posts', S({ id: str('Campaign id') }, ['id']), (a) => api('GET', `/api/campaigns/${a.id}`)],
  ['cadence_list_posts', 'Posts for a brand', S({ brand_id: str('Brand id') }, ['brand_id']), (a) => api('GET', `/api/posts?brand_id=${a.brand_id}`)],
  ['cadence_create_post', 'Draft a post', S({ brand_id: str(''), platforms: { type: 'array', items: { type: 'string' } }, copy: { type: 'object' }, scheduled_at: str('ISO with timezone'), topic: str(''), image_prompt: str(''), alt_text: str(''), format: str('single|carousel|text'), assets: { type: 'object' } }, ['brand_id', 'platforms', 'copy', 'scheduled_at']), (a) => api('POST', '/api/posts', a)],
  ['cadence_edit_post', 'Edit a draft (invalidates approval)', S({ id: str(''), version: { type: 'integer' }, copy: { type: 'object' }, scheduled_at: str(''), topic: str(''), alt_text: str(''), image_prompt: str(''), assets: { type: 'object' } }, ['id', 'version']), ({ id, ...a }) => api('PATCH', `/api/posts/${id}`, a)],
  ['cadence_comment', 'Leave feedback on a post', S({ id: str(''), body: str('') }, ['id', 'body']), ({ id, body }) => api('POST', `/api/posts/${id}/comments`, { body })],
  ['cadence_approve_post', 'Approve and schedule (owner role only)', S({ id: str(''), version: { type: 'integer' }, account_ids: { type: 'array', items: { type: 'string' } } }, ['id', 'version']), ({ id, ...a }) => api('POST', `/api/posts/${id}/approve-and-schedule`, a)],
  ['cadence_reject_post', 'Reject a draft (owner role only)', S({ id: str(''), version: { type: 'integer' } }, ['id', 'version']), ({ id, ...a }) => api('POST', `/api/posts/${id}/reject`, a)],
  ['cadence_regenerate_post', 'Re-draft copy and visual from feedback (owner role only)', S({ id: str(''), feedback: str(''), fresh_image: { type: 'boolean' } }, ['id']), ({ id, ...a }) => api('POST', `/api/posts/${id}/regenerate`, a)],
  ['cadence_publish_now', 'Publish an approved post immediately (owner role only)', S({ id: str('') }, ['id']), ({ id }) => api('POST', `/api/posts/${id}/publish-now`, {})],
  ['cadence_list_accounts', 'Connected accounts', S({}), () => api('GET', '/api/accounts')],
  ['cadence_pause_account', 'Pause or resume an account (kill switch)', S({ id: str(''), paused: { type: 'boolean' } }, ['id', 'paused']), ({ id, paused }) => api('POST', `/api/accounts/${id}/pause`, { paused })],
  ['cadence_get_settings', 'Autonomy level and integrations', S({}), () => api('GET', '/api/settings')],
  ['cadence_set_autonomy', 'review_all | auto_trusted | hands_off (owner role only)', S({ level: str('') }, ['level']), ({ level }) => api('PUT', '/api/settings', { autonomy: level })],
  ['cadence_analytics', 'Per-post metrics for a brand', S({ brand_id: str('') }, ['brand_id']), (a) => api('GET', `/api/analytics?brand_id=${a.brand_id}`)],
  ['cadence_events', 'Recent activity log', S({}), () => api('GET', '/api/events')],
];

async function api(method, path, body) {
  const res = await fetch(BASE_URL + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}
const reply = (id, result, error) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) }) + '\n');

createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params = {} } = msg;
  if (method === 'initialize') return reply(id, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'cadence', version: '1.0.0' } });
  if (method === 'tools/list') return reply(id, { tools: TOOLS.map(([name, description, inputSchema]) => ({ name, description, inputSchema })) });
  if (method === 'tools/call') {
    const t = TOOLS.find(([n]) => n === params.name);
    if (!t) return reply(id, null, { code: -32601, message: `Unknown tool ${params.name}` });
    try { reply(id, { content: [{ type: 'text', text: JSON.stringify(await t[3](params.arguments || {}), null, 2) }] }); }
    catch (e) { reply(id, { content: [{ type: 'text', text: e.message }], isError: true }); }
    return;
  }
  if (id !== undefined) reply(id, {});
});
