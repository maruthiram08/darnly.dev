import type { Env } from './env';
import { inboxPage, loginPage, TABS, type Tab } from './inbox';
import { runOnce } from './run';

const COOKIE = 'finder_key';

/** Constant-time string comparison, so the key can't be guessed one character at a time. */
async function same(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

function cookieKey(req: Request): string {
  const m = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m?.[1] ? decodeURIComponent(m[1]) : '';
}

const redirect = (to: string, extra: Record<string, string> = {}) => new Response(null, { status: 303, headers: { location: to, ...extra } });

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (!env.INBOX_KEY) return new Response('Set the inbox key first: npx wrangler secret put INBOX_KEY', { status: 503 });

  if (req.method === 'POST') {
    // Forms only come from this page. Refuse posts from other sites.
    const origin = req.headers.get('origin');
    if (origin && origin !== url.origin) return new Response('Forbidden', { status: 403 });
  }

  if (url.pathname === '/login' && req.method === 'POST') {
    const key = String((await req.formData()).get('key') ?? '');
    if (!(await same(key, env.INBOX_KEY))) return loginPage(true);
    return redirect('/', { 'set-cookie': `${COOKIE}=${encodeURIComponent(key)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${60 * 60 * 24 * 90}` });
  }

  if (!(await same(cookieKey(req), env.INBOX_KEY))) return loginPage();

  if (url.pathname === '/' && req.method === 'GET') {
    const t = url.searchParams.get('tab');
    const tab: Tab = t && t in TABS ? (t as Tab) : 'reply';
    return inboxPage(env, tab, url.searchParams.get('note') ?? undefined);
  }

  if (url.pathname === '/run' && req.method === 'POST') {
    // Run it while the browser waits (well under a minute), so nothing gets cut off.
    const r = await runOnce(env);
    const note = `Found ${r.found} new posts. ${r.passed} mention an AI coding tool and something visual. Claude checked ${r.judged}.${r.claudeError ? ` Claude failed: ${r.claudeError}` : ''}`;
    return redirect(`/?note=${encodeURIComponent(note)}`);
  }

  const action = url.pathname.match(/^\/post\/([^/]+)\/(replied|dismiss|undo)$/);
  if (action && req.method === 'POST') {
    const id = decodeURIComponent(action[1] ?? '');
    const status = action[2] === 'replied' ? 'replied' : action[2] === 'dismiss' ? 'dismissed' : 'judged';
    await env.DB.prepare('UPDATE posts SET status = ? WHERE id = ?').bind(status, id).run();
    const back = String((await req.formData()).get('tab') ?? '');
    return redirect(back in TABS ? `/?tab=${back}` : '/');
  }

  return new Response('Not found', { status: 404 });
}

export default {
  fetch: route,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runOnce(env).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
