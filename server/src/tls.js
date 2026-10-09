// Self-signed localhost certificate for the OAuth callback. Meta, Threads and TikTok refuse an http redirect, so the same
// handler is also served on https://localhost:<PORT+1>. Needs `openssl` (macOS/Linux ship it; Windows: Git for Windows or winget).
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:https';
import { X509Certificate } from 'node:crypto';
import { TLS_DIR, HTTPS_PORT, findBin } from './config.js';

const WIN = process.platform === 'win32';
const CERT = join(TLS_DIR, 'cert.pem'), KEY = join(TLS_DIR, 'key.pem');
const CONF = `[req]
distinguished_name=dn
x509_extensions=v3
prompt=no
[dn]
CN=localhost
[v3]
subjectAltName=DNS:localhost,IP:127.0.0.1
extendedKeyUsage=serverAuth
basicConstraints=critical,CA:FALSE
`;

export const opensslPath = () => findBin('openssl') || (WIN ? ['C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe'].find(existsSync) : undefined);
// Expired (825-day) certs count as missing so they are regenerated instead of breaking https sign-in.
export const tlsReady = () => { try { return existsSync(KEY) && new X509Certificate(readFileSync(CERT)).validToDate > new Date(Date.now() + 86_400_000); } catch { return false; } };

/** One line per OS on how to stop the browser warning. Optional: clicking through once also works for an OAuth redirect. */
export function trustHint(platform = process.platform) {
  if (platform === 'darwin') return `macOS: security add-trusted-cert -r trustRoot -p ssl -k ~/Library/Keychains/login.keychain-db "${CERT}"`;
  if (platform === 'win32') return `Windows (PowerShell, as you): Import-Certificate -FilePath "${CERT}" -CertStoreLocation Cert:\\CurrentUser\\Root`;
  return `Linux: browsers keep their own store. In Chrome/Chromium/Edge open chrome://settings/certificates > Authorities > Import "${CERT}". Firefox: Settings > Privacy & Security > View Certificates > Authorities > Import. Or just click through the warning once.`;
}

/** Create the certificate if it is missing. Never throws: returns {ok, created?, error?}. */
export function ensureCert({ force = false } = {}) {
  if (tlsReady() && !force) return { ok: true, created: false };
  const bin = opensslPath();
  if (!bin) return { ok: false, error: 'openssl was not found, so the https:// sign-in callback cannot start. Install it (macOS and most Linux have it; Windows: install Git for Windows or run "winget install ShiningLight.OpenSSL.Light"), then restart Cadence or run scripts/make-tls-cert.sh.' };
  const conf = join(TLS_DIR, 'openssl.cnf');
  try {
    mkdirSync(TLS_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(conf, CONF);
    writeFileSync(KEY, '', { mode: 0o600 }); chmodSync(KEY, 0o600); // exists as 0600 before openssl writes the key into it
    execFileSync(bin, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-config', conf, '-keyout', KEY, '-out', CERT], { stdio: 'pipe', timeout: 30_000 });
    try { chmodSync(KEY, 0o600); } catch { /* Windows: ACLs, not modes */ }
    return { ok: true, created: true };
  } catch (e) { return { ok: false, error: `Could not create the localhost certificate: ${String(e.stderr || e.message).slice(0, 300)}` }; }
  finally { try { rmSync(conf, { force: true }); } catch { /* best effort */ } }
}

/** HTTPS twin of the API server (same request handler). Returns {server?, note?}; a failure only disables https sign-in. */
export async function startTls(apiServer) {
  const made = ensureCert();
  if (!made.ok) return { note: made.error };
  try {
    const server = createServer({ key: readFileSync(KEY), cert: readFileSync(CERT) }, apiServer.listeners('request')[0]);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(HTTPS_PORT, '127.0.0.1', resolve); });
    return { server, note: made.created ? `Created a self-signed certificate for https://localhost:${HTTPS_PORT}. ${trustHint()}` : undefined };
  } catch (e) { return { note: `https sign-in callback not started on port ${HTTPS_PORT}: ${e.message}` }; }
}
