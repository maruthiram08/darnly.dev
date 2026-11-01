import type { Env } from './env';
import { requireUser, signIn, signOut } from './auth';
import { cleanup, deleteAccount, deleteAllBugs, getBug, getPicture, listBugs, markFixed, parseUpload, saveBug } from './bugs';
import { HttpError, json, readJson } from './util';

/** The extension is the only browser caller. Requests carry a bearer token, never cookies. */
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  if (!origin.startsWith('chrome-extension://')) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
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
  if (path === '/v1/auth/logout' && method === 'POST') {
    await signOut(env, req);
    return json({ ok: true });
  }

  const user = await requireUser(env, req);

  if (path === '/v1/me' && method === 'GET') return json({ email: user.email });
  if (path === '/v1/me' && method === 'DELETE') {
    await deleteAccount(env, user.id);
    return json({ ok: true });
  }
  if (path === '/v1/bugs' && method === 'POST') return json(await saveBug(env, user.id, await parseUpload(req)), 201);
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req);
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
    return res;
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(cleanup(env).then((n) => console.log(`cleanup: deleted ${n} fixed bugs`)));
  },
} satisfies ExportedHandler<Env>;
