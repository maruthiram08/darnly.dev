// /ingest/* passes PostHog's browser library traffic to PostHog (src/components/PostHog.astro).
// Same-origin, so the site's CSP stays connect-src 'self' and ad blockers don't drop it.
// /ingest/static/* and /ingest/array/* are PostHog's script files; everything else is events.
import { POSTHOG_KEY, POSTHOG_REGION } from '../src/data/analytics';

export async function posthogProxy(req: Request, url: URL): Promise<Response> {
  if (!POSTHOG_KEY) return new Response('Not found', { status: 404 });
  if (!['GET', 'POST', 'OPTIONS', 'HEAD'].includes(req.method)) return new Response('Method not allowed', { status: 405 });
  const path = url.pathname.slice('/ingest'.length) || '/';
  const assets = path.startsWith('/static/') || path.startsWith('/array/');
  const host = `${POSTHOG_REGION}${assets ? '-assets' : ''}.i.posthog.com`;
  const headers = new Headers(req.headers);
  headers.delete('cookie');
  headers.delete('host');
  // PostHog needs the visitor's address for country and the cookieless daily hash.
  const ip = req.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body;
  return fetch(`https://${host}${path}${url.search}`, { method: req.method, headers, body, redirect: 'manual' });
}
