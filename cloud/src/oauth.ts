// Sign-in for coding agents (MCP connectors). The agent sends the user here; they see which app is asking,
// approve, sign in with Google, and the agent gets a token for their Darnly inbox only.
import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { Env } from './env';
import { createSession, upsertUser } from './auth';
import { HttpError, base64url, newToken } from './util';

type OAuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

const TX_TTL = 600; // seconds
const COOKIE = '__Host-darnly_tx';

/** The Mac app's sign-in: it sends a PKCE challenge, and gets back a one-time code on darnly://signed-in. */
export const APP_CALLBACK = 'darnly://signed-in';
const APP_CODE_TTL = 60; // seconds (the shortest KV allows)

type Transaction =
  // A coding agent connecting over MCP (older entries have no kind).
  | { kind?: 'agent'; authRequest: AuthRequest; browser: string }
  // The Darnly Mac app signing in to the cloud inbox.
  | { kind: 'app'; challenge: string; browser: string };
// browser must match the cookie: the approval has to come from the browser that saw the page.

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function page(title: string, body: string, status = 200, headers: HeadersInit = {}): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Darnly</title>
<style>
:root{--ink:#14202b;--quiet:#5b6b78;--sky:#0593C6;--pink:#D83995;--bg:#FCFFFF;--line:#d8e6ee}
@media (prefers-color-scheme:dark){:root{--ink:#e9f3f8;--quiet:#9db1bf;--bg:#0c151c;--line:#24343f}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;display:grid;min-height:100vh;place-items:center;padding:16px}
main{max-width:420px;width:100%;border:1px solid var(--line);border-radius:16px;padding:28px}
h1{font-size:22px;margin:0 0 12px}p{margin:0 0 12px;color:var(--quiet)}strong{color:var(--ink)}
button{width:100%;padding:12px;border:0;border-radius:10px;background:var(--sky);color:#fff;font:600 16px system-ui;cursor:pointer;margin-top:8px}
button.secondary{background:transparent;color:var(--quiet);border:1px solid var(--line)}
input{width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--ink);margin-top:8px}
.where{border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--ink)}
.brand{font-weight:700;color:var(--pink);letter-spacing:.02em;margin-bottom:16px}
</style></head><body><main><div class="brand">darnly</div>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'",
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      ...headers,
    },
  });
}

function cookieValue(req: Request): string | null {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)`).exec(req.headers.get('cookie') ?? '');
  return m ? m[1]! : null;
}

async function loadTx(env: OAuthEnv, req: Request, id: string | null): Promise<Transaction | null> {
  if (!id || !/^[A-Za-z0-9_-]{20,100}$/.test(id)) return null;
  const tx = await env.OAUTH_KV.get<Transaction>(`tx:${id}`, 'json');
  if (!tx || tx.browser !== cookieValue(req)) return null;
  return tx;
}

/** GET /authorize: show which app is asking. */
async function showConsent(req: Request, env: OAuthEnv): Promise<Response> {
  let authRequest: AuthRequest;
  try {
    authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(req);
  } catch (e) {
    return page('Sign-in link is broken', `<h1>This sign-in link doesn't work</h1><p>${escapeHtml((e as Error).message)}</p>`, 400);
  }
  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  if (!client) return page('Unknown app', '<h1>Unknown app</h1><p>The app asking to connect isn\'t registered. Try adding the connector again.</p>', 400);
  const txId = newToken();
  const browser = newToken();
  await env.OAUTH_KV.put(`tx:${txId}`, JSON.stringify({ authRequest, browser } satisfies Transaction), { expirationTtl: TX_TTL });
  const name = escapeHtml(client.clientName || 'An app');
  let host = '';
  try {
    host = new URL(authRequest.redirectUri).host;
  } catch {}
  const dev = env.ALLOW_DEV_LOGIN === 'true' ? '<input name="devEmail" type="email" placeholder="Dev only: sign in as this email">' : '';
  return page(
    'Connect your agent',
    `<h1>Connect ${name} to Darnly?</h1>
<p><strong>${name}</strong> wants to read the bugs in your Darnly inbox (screenshots, notes and page details) and mark them fixed.</p>
${host ? `<p class="where">Access goes to <strong>${escapeHtml(host)}</strong>. The app picks its own name, so check this address: it should belong to your coding agent.</p>` : ''}
<p>Only continue if you just added Darnly as a connector in your coding agent yourself. If someone sent you this link, cancel.</p>
<form method="post" action="/authorize">
<input type="hidden" name="tx" value="${txId}">${dev}
<button type="submit">Continue with Google</button>
</form>
<form method="post" action="/authorize"><input type="hidden" name="tx" value="${txId}"><input type="hidden" name="deny" value="1"><button class="secondary" type="submit">Cancel</button></form>`,
    200,
    { 'set-cookie': `${COOKIE}=${browser}; Path=/; Max-Age=${TX_TTL}; HttpOnly; Secure; SameSite=Lax` },
  );
}

/** POST /authorize: approved (go to Google) or cancelled (back to the app with an error). */
async function approve(req: Request, env: OAuthEnv): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const txId = form?.get('tx');
  const tx = await loadTx(env, req, typeof txId === 'string' ? txId : null);
  if (!tx) return page('Expired', '<h1>This page expired</h1><p>Go back to your agent and connect Darnly again.</p>', 400);
  if (form?.get('deny')) {
    await env.OAUTH_KV.delete(`tx:${txId}`);
    if (tx.kind === 'app') return redirect(`${APP_CALLBACK}?error=access_denied`);
    const back = new URL(tx.authRequest.redirectUri);
    back.searchParams.set('error', 'access_denied');
    if (tx.authRequest.state) back.searchParams.set('state', tx.authRequest.state);
    return Response.redirect(back.toString(), 302);
  }
  const devEmail = form?.get('devEmail');
  if (env.ALLOW_DEV_LOGIN === 'true' && typeof devEmail === 'string' && devEmail.includes('@')) {
    return finish(env, txId as string, tx, { sub: `dev:${devEmail}`, email: devEmail });
  }
  if (!env.GOOGLE_WEB_CLIENT_ID || !env.GOOGLE_WEB_CLIENT_SECRET) return page('Not ready', '<h1>Sign-in isn\'t set up yet</h1><p>Darnly cloud is missing its Google settings.</p>', 503);
  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.searchParams.set('client_id', env.GOOGLE_WEB_CLIENT_ID);
  google.searchParams.set('redirect_uri', new URL('/oauth/google/callback', req.url).toString());
  google.searchParams.set('response_type', 'code');
  google.searchParams.set('scope', 'openid email');
  google.searchParams.set('state', txId as string);
  google.searchParams.set('prompt', 'select_account');
  return Response.redirect(google.toString(), 302);
}

/** GET /oauth/google/callback: Google sends the user back here. */
async function googleCallback(req: Request, env: OAuthEnv): Promise<Response> {
  const url = new URL(req.url);
  const txId = url.searchParams.get('state');
  const tx = await loadTx(env, req, txId);
  if (!tx) return page('Expired', '<h1>This sign-in expired</h1><p>Go back to your agent and connect Darnly again.</p>', 400);
  const code = url.searchParams.get('code');
  if (!code) return page('Cancelled', '<h1>Sign-in was cancelled</h1><p>You can close this tab.</p>', 400);
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_WEB_CLIENT_ID!,
      client_secret: env.GOOGLE_WEB_CLIENT_SECRET!,
      redirect_uri: new URL('/oauth/google/callback', req.url).toString(),
      grant_type: 'authorization_code',
    }),
  });
  const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenRes.ok || !token.access_token) return page('Sign-in failed', '<h1>Google sign-in failed</h1><p>Please try again.</p>', 502);
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${token.access_token}` } });
  const info = (await infoRes.json().catch(() => ({}))) as { sub?: string; email?: string; email_verified?: boolean };
  if (!info.sub || !info.email || info.email_verified !== true) return page('Sign-in failed', '<h1>Your Google email isn\'t verified</h1>', 403);
  return finish(env, txId!, tx, { sub: info.sub, email: info.email });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
}

async function finish(env: OAuthEnv, txId: string, tx: Transaction, who: { sub: string; email: string }): Promise<Response> {
  await env.OAUTH_KV.delete(`tx:${txId}`);
  const user = await upsertUser(env, who);
  if (tx.kind === 'app') {
    const code = newToken();
    await env.OAUTH_KV.put(`appcode:${code}`, JSON.stringify({ userId: user.id, email: user.email, challenge: tx.challenge }), { expirationTtl: APP_CODE_TTL });
    return redirect(`${APP_CALLBACK}?code=${code}`);
  }
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: tx.authRequest,
    userId: user.id,
    metadata: { email: user.email },
    scope: tx.authRequest.scope,
    props: { userId: user.id, email: user.email },
  });
  return redirect(redirectTo);
}

/** GET /app/signin?challenge=…: the page the Mac app opens in its sign-in sheet. */
async function showAppSignIn(req: Request, env: OAuthEnv): Promise<Response> {
  const challenge = new URL(req.url).searchParams.get('challenge') ?? '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return page('Sign-in link is broken', '<h1>This sign-in link doesn\'t work</h1><p>Open Darnly on your Mac and choose Sign in again.</p>', 400);
  const txId = newToken();
  const browser = newToken();
  await env.OAUTH_KV.put(`tx:${txId}`, JSON.stringify({ kind: 'app', challenge, browser } satisfies Transaction), { expirationTtl: TX_TTL });
  const dev = env.ALLOW_DEV_LOGIN === 'true' ? '<input name="devEmail" type="email" placeholder="Dev only: sign in as this email">' : '';
  return page(
    'Sign in the Mac app',
    `<h1>Sign in the Darnly Mac app?</h1>
<p>Bugs you capture on your Mac will go to your private Darnly inbox, where the coding agents you connected can pick them up.</p>
<p>Only continue if you just chose <strong>Sign in</strong> in Darnly on your Mac.</p>
<form method="post" action="/authorize">
<input type="hidden" name="tx" value="${txId}">${dev}
<button type="submit">Continue with Google</button>
</form>
<form method="post" action="/authorize"><input type="hidden" name="tx" value="${txId}"><input type="hidden" name="deny" value="1"><button class="secondary" type="submit">Cancel</button></form>`,
    200,
    {
      'set-cookie': `${COOKIE}=${browser}; Path=/; Max-Age=${TX_TTL}; HttpOnly; Secure; SameSite=Lax`,
      // The form's redirect goes to Google, or straight back to the app (cancel, or dev sign-in).
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://accounts.google.com darnly:; frame-ancestors 'none'",
    },
  );
}

/** POST /v1/auth/app/exchange {code, verifier}: the Mac app trades its one-time code for a session token. */
export async function exchangeAppCode(env: Env, body: { code?: unknown; verifier?: unknown }): Promise<{ token: string; email: string }> {
  const { code, verifier } = body;
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(code)) throw new HttpError(400, 'bad_code');
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) throw new HttpError(400, 'bad_verifier');
  const key = `appcode:${code}`;
  const saved = await env.OAUTH_KV.get<{ userId: string; email: string; challenge: string }>(key, 'json');
  if (!saved) throw new HttpError(400, 'bad_code');
  await env.OAUTH_KV.delete(key); // one use, even when the verifier is wrong
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  if (base64url(new Uint8Array(digest)) !== saved.challenge) throw new HttpError(400, 'bad_verifier');
  return { token: await createSession(env, saved.userId), email: saved.email };
}

/** Routes for the agent sign-in pages, or null when the path isn't one of them. */
export function oauthRoute(req: Request, env: Env): Promise<Response> | null {
  const { pathname } = new URL(req.url);
  const e = env as OAuthEnv;
  if (pathname === '/authorize' && req.method === 'GET') return showConsent(req, e);
  if (pathname === '/app/signin' && req.method === 'GET') return showAppSignIn(req, e);
  if (pathname === '/authorize' && req.method === 'POST') return approve(req, e);
  if (pathname === '/oauth/google/callback' && req.method === 'GET') return googleCallback(req, e);
  return null;
}
