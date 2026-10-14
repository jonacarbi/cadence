// What the owner must do on each platform's developer portal, and the exact redirect URI to paste there.
// Portal UIs change; the steps name the stable parts (product/permission names, field labels) and say when a rule is policy rather than a guarantee.
import { PORT, HTTPS_PORT } from './config.js';
import { PLATFORMS } from './providers/index.js';
import { META } from './providers/registry.js';
import { DEFAULT_CAPS, DEFAULT_GAP_MIN } from './safety.js';
import { tlsReady, opensslPath, trustHint } from './tls.js';
import { writeEnvValue } from './credentials.js';
import { WorkflowError } from './workflow.js';

/** Platforms whose portals only accept an https redirect. Everything else gets plain loopback http, which needs no certificate. */
const HTTPS_CALLBACK = new Set(['instagram', 'facebook', 'threads', 'tiktok']);
/** CADENCE_<PLATFORM>_CALLBACK=http|https overrides the default for a portal whose rules differ from what we assume. */
export const needsHttps = (platform) => { const o = process.env[`CADENCE_${platform.toUpperCase()}_CALLBACK`]; return o === 'https' ? true : o === 'http' ? false : HTTPS_CALLBACK.has(platform); };
/** The one redirect_uri used for BOTH the authorize request and the token exchange (providers compare them byte for byte). */
export const redirectFor = (platform) => needsHttps(platform) ? `https://localhost:${HTTPS_PORT}/oauth/callback` : `http://127.0.0.1:${PORT}/oauth/callback`;

const meta = 'https://developers.facebook.com/apps';
const NOTE_LOOPBACK = 'This platform accepts a plain loopback address, so no certificate is needed. If its portal refuses it, set CADENCE_<PLATFORM>_CALLBACK=https in .env and restart.';
const GUIDE = {
  x: { portal: 'https://developer.x.com/en/portal/dashboard', create: 'https://developer.x.com/en/portal/projects-and-apps', keys: 'Your app > Keys and tokens > OAuth 2.0 Client ID and Client Secret', scopes: 'tweet.read tweet.write users.read media.write offline.access', secretOptional: true, steps: [
    'Open the X developer portal and create a Project and an App (a pay-per-use or paid API plan is required to post).',
    'In the App, open "User authentication settings" and choose Set up.',
    'App permissions: Read and write. Type of App: "Web App, Automated App or Bot" (this gives you a Client Secret).',
    'Callback URI / Redirect URL: paste the redirect URI shown here exactly. Website URL: any page you own.',
    'Save, then open "Keys and tokens" and copy the OAuth 2.0 Client ID and Client Secret into Cadence.'] },
  linkedin: { portal: 'https://www.linkedin.com/developers/apps', create: 'https://www.linkedin.com/developers/apps/new', keys: 'Your app > Auth tab > Client ID and Primary Client Secret', scopes: 'openid profile w_member_social', steps: [
    'Open the LinkedIn developer portal and create an app. It must be linked to a LinkedIn Company Page you administer.',
    'On the Products tab, request "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect" (both are approved instantly).',
    'On the Auth tab, add the redirect URI shown here under "Authorized redirect URLs for your app".',
    'Copy the Client ID and Primary Client Secret into Cadence.',
    'LinkedIn tokens last 60 days and standard apps get no refresh token: Cadence will show "Reconnect" when one expires.'] },
  instagram: { portal: meta, create: 'https://developers.facebook.com/apps/creation/', keys: 'Your app > App settings > Basic > App ID and App Secret (click Show)', scopes: 'instagram_basic instagram_content_publish pages_show_list pages_read_engagement business_management', steps: [
    'The Instagram account must be a Professional (Business or Creator) account linked to a Facebook Page you manage.',
    'In Meta for Developers create an app (use case: Other, type: Business), then add the "Facebook Login" product.',
    'Facebook Login > Settings: under "Valid OAuth Redirect URIs" paste the redirect URI shown here, then save.',
    'App settings > Basic: copy the App ID (Client ID) and App Secret into Cadence. Facebook and Instagram can share one app.',
    'While the app is in Development mode only people with a role on the app can connect, which is exactly right for your own accounts. No app review is needed for that.'] },
  facebook: { portal: meta, create: 'https://developers.facebook.com/apps/creation/', keys: 'Your app > App settings > Basic > App ID and App Secret (click Show)', scopes: 'pages_show_list pages_manage_posts pages_read_engagement business_management', steps: [
    'You need a Facebook Page you manage. Posts go to the Page, not a personal profile.',
    'In Meta for Developers create an app (use case: Other, type: Business), then add the "Facebook Login" product.',
    'Facebook Login > Settings: under "Valid OAuth Redirect URIs" paste the redirect URI shown here, then save.',
    'App settings > Basic: copy the App ID (Client ID) and App Secret into Cadence. Facebook and Instagram can share one app.',
    'In Development mode only people with a role on the app can connect, which is right for your own Page.'] },
  threads: { portal: meta, create: 'https://developers.facebook.com/apps/creation/', keys: 'Your app > Use cases > Threads API > Settings > Threads App ID and Threads App Secret', scopes: 'threads_basic threads_content_publish threads_manage_insights', steps: [
    'In Meta for Developers create an app and add the "Threads" use case / product.',
    'Threads settings: paste the redirect URI shown here under "Redirect Callback URLs" (also fill the uninstall and delete callback URLs; any https URL you own works).',
    'App roles > Roles: add your Threads account as a "Threads Tester" and accept the invite inside Threads (Settings > Account > Website permissions).',
    'Copy the Threads App ID and Threads App Secret (shown on the Threads settings page, not the main app dashboard) into Cadence.'] },
  pinterest: { portal: 'https://developers.pinterest.com/apps/', create: 'https://developers.pinterest.com/apps/connect/', keys: 'Your app > Manage > App ID and App secret key (click Show key)', scopes: 'boards:read pins:read pins:write user_accounts:read', steps: [
    'Open the Pinterest developer portal and connect or create an app.',
    'Under the app, add the redirect URI shown here to "Redirect URIs".',
    'Copy the App ID and App secret key into Cadence.',
    'New apps start with Trial access: pins you create are visible only to you until Pinterest upgrades the app to Standard. Apply for Standard access in the portal if you want public pins.',
    'Pinterest decides which redirect hosts are accepted; if it refuses this one, add 127.0.0.1 and localhost variants it offers.'] },
  reddit: { portal: 'https://www.reddit.com/prefs/apps', create: 'https://www.reddit.com/prefs/apps', keys: 'Under your app name (Client ID) and the "secret" field', scopes: 'identity submit read', steps: [
    'While signed in to Reddit open the apps page and choose "create another app".',
    'Name it anything. Type: "web app". redirect uri: paste the redirect URI shown here exactly.',
    'Create the app. The Client ID is the short string directly under the app name; the Client Secret is labelled "secret".',
    'Copy both into Cadence. Posts go to your own profile (u/yourname), where you can always submit.',
    'Reddit is strict about self-promotion; keep to your profile and read each community\'s rules before pointing a post anywhere else.'] },
  tiktok: { portal: 'https://developers.tiktok.com/apps', create: 'https://developers.tiktok.com/apps/', keys: 'Your app > App details > Client key and Client secret', scopes: 'video.publish', steps: [
    'Open TikTok for Developers and create an app. Add the products "Login Kit" and "Content Posting API".',
    'In Login Kit, add the redirect URI shown here (TikTok requires https).',
    'Copy the Client key and Client secret into Cadence.',
    'Until TikTok audits your app, posts from it are forced to private ("only me"). Submit the app for audit in the portal to publish publicly.',
    'Photo posts need public image URLs, so Supabase media hosting must be configured.'] },
};

const MANUAL = {
  bluesky: { portal: 'https://bsky.app/settings/app-passwords', steps: ['In Bluesky open Settings > Privacy and security > App passwords.', 'Create an app password (never your main password) and paste it below with your handle.'], fields: [['handle', 'Handle', false, 'you.bsky.social', 'Your full handle, without the @.'], ['app_password', 'App password', true, 'xxxx-xxxx-xxxx-xxxx', 'Create it under Settings > App passwords.']] },
  mastodon: { portal: 'https://mastodon.social/settings/applications', create: 'https://mastodon.social/settings/applications/new', steps: ['On your Mastodon server open Preferences > Development > New application.', 'Name it Cadence and tick only read:accounts and write:statuses (and write:media for images).', 'Open the application and copy "Your access token" below, with your server address.'], fields: [['instance', 'Server', false, 'https://mastodon.social', 'The address of your Mastodon server.'], ['access_token', 'Access token', true, '', 'From Preferences > Development > your application.']] },
  telegram: { portal: 'https://t.me/BotFather', steps: ['Message @BotFather in Telegram, send /newbot and follow the prompts to get a bot token.', 'Add the bot as an admin of your channel or group.', 'Paste the token and the chat id (for a public channel use @channelname) below.'], fields: [['bot_token', 'Bot token', true, '123456:ABC…', 'From @BotFather.'], ['chat_id', 'Chat id', false, '@mychannel', 'A @channel name or numeric id.']] },
  discord: { portal: 'https://discord.com/developers/docs/resources/webhook', steps: ['In Discord open the channel settings > Integrations > Webhooks > New Webhook.', 'Copy the webhook URL and paste it below.'], fields: [['webhook_url', 'Webhook URL', true, 'https://discord.com/api/webhooks/…', 'Channel settings > Integrations > Webhooks.']] },
};

const envOf = (id, suffix) => process.env[`CADENCE_${id.toUpperCase()}_${suffix}`] || '';
const num = (list) => list.map((s, i) => `${i + 1}. ${s}`);

export function setupRow(id) {
  const m = META[id]; if (!m || id === 'mock') throw new WorkflowError('Unknown platform', 404);
  const limits = { daily_cap_default: DEFAULT_CAPS[id] ?? 5, min_gap_minutes_default: DEFAULT_GAP_MIN };
  const base = { id, name: PLATFORMS[id].name, auth: m.auth, needs_public_media: Boolean(m.needsPublicUrl), limits };
  if (m.auth === 'manual') {
    const g = MANUAL[id];
    return { ...base, ready: true, developer_portal_url: g.portal, create_app_url: g.create || g.portal, keys_where: '', redirect_uri: '', needs_https_callback: false, steps: num(g.steps), scopes: [], app_fields: [],
      account_fields: g.fields.map(([key, title, secret, placeholder, help]) => ({ key, title, secret, placeholder, help })) };
  }
  const g = GUIDE[id], https = needsHttps(id), idTitle = id === 'tiktok' ? 'Client key' : id === 'pinterest' || id === 'threads' || id === 'instagram' || id === 'facebook' ? 'App ID' : 'Client ID';
  const row = { ...base, ready: Boolean(envOf(id, 'CLIENT_ID') && (envOf(id, 'CLIENT_SECRET') || g.secretOptional)),
    developer_portal_url: g.portal, create_app_url: g.create || g.portal, keys_where: g.keys || '', redirect_uri: redirectFor(id), needs_https_callback: https, steps: num(g.steps), scopes: g.scopes.split(' '),
    app_fields: [{ key: 'client_id', title: idTitle, secret: false }, { key: 'client_secret', title: id === 'tiktok' ? 'Client secret' : id === 'reddit' || id === 'x' || id === 'linkedin' ? 'Client secret' : 'App secret', secret: true }], account_fields: [] };
  if (https) {
    row.tls = { ready: tlsReady(), openssl: Boolean(opensslPath()) };
    row.callback_note = tlsReady() ? `The first sign-in shows a browser warning for the self-signed certificate: choose Advanced > Proceed to localhost. To avoid it: ${trustHint()}`
      : opensslPath() ? 'The https callback certificate is created when Cadence starts. Restart Cadence once, then connect.'
        : 'This platform needs an https callback and openssl was not found to create a certificate. Install openssl (Windows: Git for Windows or "winget install ShiningLight.OpenSSL.Light"), then restart Cadence.';
  } else row.callback_note = NOTE_LOOPBACK;
  return row;
}

export const setupAll = () => Object.keys(META).filter((id) => id !== 'mock').map(setupRow);

/** PUT /api/platforms/:id/app. Saves the app's client id/secret to .env and applies them immediately. Secrets are never returned. */
export function saveApp(id, body) {
  if (META[id]?.auth !== 'oauth') throw new WorkflowError('This platform does not use an app registration', 404);
  for (const k of ['client_id', 'client_secret']) if (body[k] !== undefined && typeof body[k] !== 'string') throw new WorkflowError(`${k} must be text`);
  if (body.client_id !== undefined) writeEnvValue(`CADENCE_${id.toUpperCase()}_CLIENT_ID`, body.client_id);
  if (body.client_secret !== undefined) writeEnvValue(`CADENCE_${id.toUpperCase()}_CLIENT_SECRET`, body.client_secret);
  return setupRow(id);
}
