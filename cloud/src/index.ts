import { OAuthProvider, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { Env } from './env';
import { mcpFetch } from './mcp';
import { exchangeAppCode, oauthRoute } from './oauth';
import { deleteAllSessions, deleteExpiredSessions, requireUser, signIn, signOut } from './auth';
import { cleanup, deleteAccount, deleteAllBugs, getBug, getPicture, listBugs, markFixed, parseUpload, saveBug } from './bugs';
import { HttpError, json, readJson } from './util';
import { isPaused, rateLimit } from './limits';
import { checkSpend } from './spend';

/** The Chrome Web Store id of the Darnly extension (tester builds get the same id from the store key). */
const EXTENSION_ORIGIN = 'chrome-extension://gognoljafcabnmbbpfoeeamcflpbgidj';

/**
 * The extension is the only browser caller. Requests carry a bearer token, never cookies.
 * Only the Darnly extension is allowed; local development (random unpacked ids) allows any extension.
 */
function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = origin === EXTENSION_ORIGIN || (env.ALLOW_DEV_LOGIN === 'true' && origin.startsWith('chrome-extension://'));
  if (!allowed) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

/** Disconnects every coding agent this user connected (their MCP tokens stop working). */
async function revokeAgents(env: Env, userId: string): Promise<void> {
  const helpers = (env as Env & { OAUTH_PROVIDER?: OAuthHelpers }).OAUTH_PROVIDER;
  if (!helpers) return;
  const { items } = await helpers.listUserGrants(userId);
  await Promise.all(items.map((g) => helpers.revokeGrant(g.id, userId)));
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  if (path === '/' || path === '/v1/health') return json({ ok: true, service: 'darnly-cloud' });

  if (path === '/v1/auth/google' && method === 'POST') {
    const { token, user } = await signIn(env, await readJson(req));
    return json({ token, email: user.email });
  }
  if (path === '/v1/auth/app/exchange' && method === 'POST') return json(await exchangeAppCode(env, await readJson(req)));
  if (path === '/v1/auth/logout' && method === 'POST') {
    await signOut(env, req);
    return json({ ok: true });
  }

  const user = await requireUser(env, req);

  if (path === '/v1/me' && method === 'GET') return json({ email: user.email });
  // "Sign out everywhere": every extension session and every connected agent, for a lost laptop or a leaked token.
  if (path === '/v1/auth/logout-all' && method === 'POST') {
    await revokeAgents(env, user.id);
    await deleteAllSessions(env, user.id);
    return json({ ok: true });
  }
  if (path === '/v1/me' && method === 'DELETE') {
    // Disconnect every agent first, then delete the bugs and the account.
    await revokeAgents(env, user.id);
    await deleteAccount(env, user.id);
    return json({ ok: true });
  }
  if (path === '/v1/bugs' && method === 'POST') {
    if (await isPaused(env)) throw new HttpError(503, 'uploads_paused');
    return json(await saveBug(env, user.id, await parseUpload(req)), 201);
  }
  if (path === '/v1/bugs' && method === 'GET') {
    const status = url.searchParams.get('status');
    const pick = status === 'waiting' || status === 'fixed' ? status : 'all';
    return json({ bugs: await listBugs(env, user.id, pick, Number(url.searchParams.get('limit') ?? 100)) });
  }
  if (path === '/v1/bugs' && method === 'DELETE') return json({ deleted: await deleteAllBugs(env, user.id) });

  const m = /^\/v1\/bugs\/(b_[a-z0-9]{16})(\/picture|\/fixed)?$/.exec(path);
  if (m) {
    const [, id, sub] = m as unknown as [string, string, string | undefined];
    if (!sub && method === 'GET') return json(await getBug(env, user.id, id));
    if (sub === '/picture' && method === 'GET') {
      return new Response(await getPicture(env, user.id, id), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=300' } });
    }
    if (sub === '/fixed' && method === 'POST') {
      const body = await readJson<{ note?: unknown }>(req);
      return json(await markFixed(env, user.id, id, body.note));
    }
  }
  throw new HttpError(404, 'not_found');
}

/** Everything except /mcp: the extension's API and the agent sign-in pages. */
const appHandler = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const signInPage = oauthRoute(req, env);
    if (signInPage) {
      return signInPage.catch((err) => {
        if (!(err instanceof HttpError)) throw err;
        const text = err.code === 'signups_paused' ? 'Darnly is not taking new sign-ups right now. Please try again tomorrow.' : `Darnly: ${err.code}`;
        return new Response(text, { status: err.status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      });
    }
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res: Response;
    try {
      res = await route(req, env);
    } catch (err) {
      if (err instanceof HttpError) res = json({ error: err.code }, err.status);
      else {
        console.error(err);
        res = json({ error: 'server_error' }, 500);
      }
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    res.headers.set('x-content-type-options', 'nosniff');
    return res;
  },
};

/** /mcp, reached only with a valid agent token. The OAuth library puts the signed-in user in ctx.props. */
const mcpHandler = {
  async fetch(req: Request, env: Env, ctx: ExecutionContext & { props?: { userId?: string } }): Promise<Response> {
    const userId = ctx.props?.userId;
    if (!userId) return new Response('signed out', { status: 401 });
    const res = await mcpFetch(req, env, userId);
    res.headers.set('x-content-type-options', 'nosniff');
    return res;
  },
};

// Built on first use, because the public address comes from the environment (localhost in tests).
let provider: OAuthProvider<Env> | null = null;
let providerFor = '';
function oauthProvider(env: Env): OAuthProvider<Env> {
  const base = (env.PUBLIC_URL || 'https://api.darnly.dev').replace(/\/+$/, '');
  if (provider && providerFor === base) return provider;
  providerFor = base;
  provider = new OAuthProvider<Env>({
    resourceMetadata: { resource: `${base}/mcp`, authorization_servers: [base], resource_name: 'Darnly bug inbox' },
    apiRoute: '/mcp',
    apiHandler: mcpHandler as never,
    defaultHandler: appHandler as never,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/token',
    clientRegistrationEndpoint: '/register',
    scopesSupported: ['bugs'],
    accessTokenTTL: 3600,
  });
  return provider;
}

/** Uploads, sign-ins and agent registration get a tighter per-IP limit than everything else. */
function isWrite(req: Request, path: string): boolean {
  if (req.method !== 'POST') return false;
  return path === '/v1/bugs' || path === '/v1/auth/google' || path === '/v1/auth/app/exchange' || path === '/register' || path === '/token' || path === '/authorize';
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
    if (req.method !== 'OPTIONS' && path !== '/v1/health') {
      const limited = (isWrite(req, path) && (await rateLimit(env, req, 'write'))) || (await rateLimit(env, req, 'any'));
      if (limited) return limited;
    }
    return oauthProvider(env).fetch(req, env, ctx);
  },

  /** Every hour: the spend meter. Once a day (03:17 UTC): cleanup. */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkSpend(env).then((r) => console.log(`spend: ${JSON.stringify(r)}`)));
    if (new Date(event.scheduledTime).getUTCHours() === 3) {
      ctx.waitUntil(cleanup(env).then((n) => console.log(`cleanup: deleted ${n} fixed bugs`)));
      ctx.waitUntil(deleteExpiredSessions(env).then((n) => console.log(`cleanup: deleted ${n} expired sessions`)));
    }
  },
} satisfies ExportedHandler<Env>;
