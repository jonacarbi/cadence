# Connect your social accounts

Cadence posts through each platform's official API. For most platforms that means you create a small developer app, paste its credentials into Cadence once, then sign in to the account you want to post from. Some platforms review apps before they allow posting to anyone but you. Plan for that.

The **Accounts** screen (and step 4 of the setup guide) shows the exact redirect URI to paste, a numbered checklist and the scopes for each platform. When it differs from this page, trust the app, and check the platform's current docs, since portals change often.

Each developer app gives you a client ID and secret. Paste them into the card for that platform; Cadence stores them in your `.env` (`CADENCE_<PLATFORM>_CLIENT_ID` and `CADENCE_<PLATFORM>_CLIENT_SECRET`) and never shows them again.

## Quick map

| Platform | How you connect | Developer app | Review or cost to know about |
|---|---|---|---|
| Bluesky | Handle plus an app password | No | None |
| Mastodon | Instance URL plus access token | No | None |
| Telegram | Bot token plus chat id | No (a bot from BotFather) | None |
| Discord | Channel webhook URL | No | None |
| Facebook Pages | OAuth | Yes (Meta) | Meta app review for posting to pages you do not own |
| Instagram | OAuth (Business or Creator account linked to a Page) | Yes (Meta) | Meta app review; images need a public media URL |
| Threads | OAuth | Yes (Meta) | Meta app review; images need a public media URL |
| LinkedIn | OAuth | Yes | Requires the "Share on LinkedIn" product on your app |
| X | OAuth | Yes | Posting needs an API tier that includes it, which may be paid |
| Pinterest | OAuth | Yes | Trial access is limited until upgraded |
| TikTok | OAuth | Yes | Unaudited apps can only post at restricted privacy levels; the media domain must be verified |
| Reddit | OAuth | Yes | Registering an app; subreddit rules and rate limits apply |

YouTube is not supported: Cadence produces still images and the YouTube API requires video files.

## OAuth callback and certificate

Providers compare the redirect URI byte for byte, so paste exactly what the app shows for that platform.

| Platforms | Redirect URI | Certificate |
|---|---|---|
| X, LinkedIn, Pinterest, Reddit | `http://127.0.0.1:8796/oauth/callback` | none |
| Instagram, Facebook, Threads, TikTok | `https://localhost:8797/oauth/callback` | self-signed, created on first start |

The port is `PORT` (default 8796); the https port is `PORT + 1`. If a portal rejects the default, set `CADENCE_<PLATFORM>_CALLBACK=http` or `https` in `.env` (for example `CADENCE_PINTEREST_CALLBACK=https`) and restart. The redirect URI is shown after the change.

**The https certificate.** Cadence needs `openssl` to create it (macOS and most Linux have it; on Windows install Git for Windows or `winget install ShiningLight.OpenSSL.Light`). It is written to `tls/` inside your data folder the first time Cadence starts; `scripts/make-tls-cert.sh` recreates it. The first sign-in shows a browser warning: choose Advanced, then Proceed to localhost. That is enough, and trusting the certificate is optional:

- macOS: `security add-trusted-cert -r trustRoot -p ssl -k ~/Library/Keychains/login.keychain-db "<data folder>/tls/cert.pem"`
- Windows (PowerShell, no admin): `Import-Certificate -FilePath "$env:APPDATA\Cadence\tls\cert.pem" -CertStoreLocation Cert:\CurrentUser\Root`
- Linux: browsers keep their own store. Chrome, Chromium and Edge: `chrome://settings/certificates`, Authorities, Import `~/.local/share/cadence/tls/cert.pem`. Firefox: Settings, Privacy and Security, View Certificates, Authorities, Import.

The certificate lasts 825 days. When it expires, delete the `tls/` folder (or run `scripts/make-tls-cert.sh`) and restart. After you approve in the provider's tab, the callback page tells you to return to Cadence.

## Public media hosting

Instagram, Threads, Reddit and TikTok fetch images from a public URL. Configure a public media bucket under Settings, Image generation and hosting (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET` in `.env.example`). Pinterest uploads the image bytes directly.

## Per platform notes

**Meta (Facebook, Instagram, Threads).** Create an app at developers.facebook.com. In development mode only people with a role on the app can authorize it, which is enough to post to your own accounts. Posting for other people requires app review and business verification. Instagram publishing requires a Business or Creator account connected to a Facebook Page.

**X.** Create a project and app in the X developer portal and enable OAuth 2.0 with write access. Whether posting is available depends on your API tier at the time. Check current pricing before you rely on it.

**LinkedIn.** Create an app, associate it with a company Page, and request the Share on LinkedIn product. Approval can take a while.

**TikTok.** Register an app and add the Content Posting API. Until your app passes TikTok's audit, posts are limited to private or restricted visibility. Verify the domain that serves your media in the developer portal.

**Pinterest.** Create an app and request access. New apps start with trial access.

**Reddit.** Create a "web app" at reddit.com/prefs/apps and set the redirect URI. By default posts go to the connected account's own profile.

**Bluesky.** Create an app password in Bluesky under Settings, Privacy and security, App passwords. Never use your main password.

**Mastodon.** In your instance, Preferences, Development, create an application with write:statuses and write:media.

**Telegram.** Talk to BotFather, create a bot, add it to your channel as admin, and paste the token and the channel id.

**Discord.** Channel settings, Integrations, Webhooks, copy the URL.

## Check you are ready

After connecting, run `npm run doctor` or open the Setup screen, which reports which accounts and media hosting are ready. Mock accounts are dry runs and never publish.

Status: verified end to end only where noted in the changelog. Treat each live platform as unverified until you have published a test post from your own account.
