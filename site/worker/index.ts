// darnly.dev Worker. Static pages are served from site/dist; this only handles /api/*.
//
// GET /api/og?url=https://example.com
//   Fetches a public page and returns its share tags (Open Graph, Twitter, title, description)
//   for the Open Graph checker at /tools/open-graph-checker/.
//   Guarded by: public http(s) addresses only, a per-visitor rate limit, an 8 second timeout,
//   a 1 MB read limit, and a one hour cache.
//
// GET /api/fonts?url=https://example.com
//   Same guards. Reads the page and its stylesheets and returns the fonts it loads and where
//   they are used, for the font finder at /tools/font-finder/.
//
// GET /api/colors?url=https://example.com
//   Same guards. Reads the page and its stylesheets and returns its color palette, for the
//   website color finder at /tools/website-color-finder/.
//
// GET /api/launch?url=https://example.com
//   Same guards. Reads the page plus robots.txt, the sitemap, the favicon and a made-up address,
//   and grades each launch basic, for the launch checker at /tools/launch-checker/.
//
// GET /api/stack?url=https://example.com
//   Same guards. Reads the page, its response headers and a few of its own files and returns
//   what it was built with, for the tech stack finder at /tools/tech-stack-finder/.

import { findFonts } from './fonts';
import { findColors } from './colors';
import { checkLaunch, type Probe } from './launch';
import { findStack } from './stack';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  FETCH_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  ALLOW_LOCAL?: string; // only set in local dev (.dev.vars) to test against localhost
}

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 8_000;
const CACHE_SECONDS = 3600;
const UA = 'Mozilla/5.0 (compatible; DarnlyPreview/1.0; +https://darnly.dev/tools/)';

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/og') return og(req, url, env, ctx);
    if (url.pathname === '/api/fonts') return fontsApi(req, url, env, ctx);
    if (url.pathname === '/api/colors') return colorsApi(req, url, env, ctx);
    if (url.pathname === '/api/launch') return launchApi(req, url, env, ctx);
    if (url.pathname === '/api/stack') return stackApi(req, url, env, ctx);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(req);
  },
};

type Ctx = { waitUntil(p: Promise<unknown>): void };
type Page = { target: URL; finalUrl: string; status: number; html: string; headers: Headers };

// /api/og: the share tags of one page.
function og(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  return pageTool('og', req, url, env, ctx, async (p) => ({ url: p.target.href, finalUrl: p.finalUrl, status: p.status, ...(await extract(p.html, p.finalUrl)) }));
}

// /api/fonts: the fonts a page loads and where it uses them.
function fontsApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  return pageTool('fonts', req, url, env, ctx, async (p) => ({
    url: p.target.href,
    finalUrl: p.finalUrl,
    status: p.status,
    ...(await findFonts(p.html, p.finalUrl, (u) => fetchText(u, url, env, 'text/css,*/*;q=0.1'))),
  }));
}

// /api/stack: what a page was built with, hosted on and tracked by.
function stackApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  return pageTool('stack', req, url, env, ctx, async (p) => ({
    url: p.target.href,
    finalUrl: p.finalUrl,
    status: p.status,
    ...(await findStack(p.html, p.finalUrl, p.headers, (u) => fetchText(u, url, env, '*/*'))),
  }));
}

// /api/launch: is this site ready to launch? Extra files are read with the same address rules.
function launchApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  const probe = async (raw: string, accept: string): Promise<Probe | null> => {
    const t = checkTarget(raw, env.ALLOW_LOCAL === '1');
    if (typeof t === 'string') return null;
    try {
      const res = await get(t, url, env, accept, 5_000);
      const final = res.url || t.href;
      if (typeof checkTarget(final, env.ALLOW_LOCAL === '1') === 'string') return null;
      return { status: res.status, url: final, type: res.headers.get('content-type') ?? '', text: await readLimited(res, 300_000) };
    } catch {
      return null;
    }
  };
  return pageTool('launch', req, url, env, ctx, async (p) => ({
    url: p.target.href,
    finalUrl: p.finalUrl,
    status: p.status,
    // Our own pages are read from the site files, which never see the http→https redirect.
    ...(await checkLaunch(p.html, p.finalUrl, probe, { probeHttp: !isOwnHost(new URL(p.finalUrl), url) })),
  }));
}

// /api/colors: a page's color palette from its CSS.
function colorsApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  return pageTool('colors', req, url, env, ctx, async (p) => ({
    url: p.target.href,
    finalUrl: p.finalUrl,
    status: p.status,
    ...(await findColors(p.html, p.finalUrl, (u) => fetchText(u, url, env, 'text/css,*/*;q=0.1'))),
  }));
}

// Shared by every tool that reads a page: address check, cache, rate limit, fetch, HTML check.
async function pageTool(name: string, req: Request, url: URL, env: Env, ctx: Ctx, run: (p: Page) => Promise<unknown>): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Use GET' }, 405);

  const target = checkTarget(url.searchParams.get('url') ?? '', env.ALLOW_LOCAL === '1');
  if (typeof target === 'string') return json({ error: target }, 400);

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(`https://darnly.dev/api/${name}?url=${encodeURIComponent(target.href)}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  if (env.FETCH_LIMIT) {
    const who = req.headers.get('cf-connecting-ip') ?? 'unknown';
    const { success } = await env.FETCH_LIMIT.limit({ key: who });
    if (!success) return json({ error: 'Too many checks in a minute. Wait a moment and try again.' }, 429);
  }

  let res: Response;
  try {
    res = await get(target, url, env, 'text/html,application/xhtml+xml');
  } catch {
    return json({ error: 'We couldn’t reach that page. Check the address, and that the site is public.' }, 502);
  }

  const finalUrl = res.url || target.href;
  const finalCheck = checkTarget(finalUrl, env.ALLOW_LOCAL === '1');
  if (typeof finalCheck === 'string') return json({ error: 'That page redirects somewhere we can’t check.' }, 400);

  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('html') && res.status >= 400) {
    return json({ error: `That site answered with error ${res.status}. It may be down, or it may block automated checks.` }, 422);
  }
  if (!type.includes('html')) {
    return json({ error: `That address returns ${type.split(';')[0] || 'something'} rather than a web page.` }, 422);
  }

  const html = await readLimited(res, MAX_BYTES);
  const body = json(await run({ target, finalUrl, status: res.status, html, headers: res.headers }), 200, CACHE_SECONDS);
  ctx.waitUntil(cache.put(cacheKey, body.clone()));
  return body;
}

// Cloudflare won't let this Worker fetch its own domain (it answers "error code: 1042"),
// so pages on darnly.dev are read straight from the site's own files.
function get(target: URL, self: URL, env: Env, accept: string, timeout = TIMEOUT_MS): Promise<Response> {
  if (isOwnHost(target, self)) return ownPage(target, env);
  return fetch(target.href, { headers: { 'user-agent': UA, accept }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
}

// A stylesheet or other text file linked from the page, with the same address rules and smaller limits.
async function fetchText(raw: string, self: URL, env: Env, accept: string): Promise<string | null> {
  const t = checkTarget(raw, env.ALLOW_LOCAL === '1');
  if (typeof t === 'string') return null;
  try {
    const res = await get(t, self, env, accept, 5_000);
    if (!res.ok || typeof checkTarget(res.url || t.href, env.ALLOW_LOCAL === '1') === 'string') return null;
    return await readLimited(res, 500_000);
  } catch {
    return null;
  }
}

const OWN_HOSTS = ['darnly.dev', 'www.darnly.dev'];
function isOwnHost(target: URL, self: URL): boolean {
  const h = target.hostname.toLowerCase();
  return OWN_HOSTS.includes(h) || target.host === self.host;
}

// Reads one of our own pages from the site files, following its redirects (like /tools → /tools/).
async function ownPage(target: URL, env: Env): Promise<Response> {
  let u = target;
  for (let i = 0; i < 4; i++) {
    const res = await env.ASSETS.fetch(new Request(u.href, { headers: { accept: 'text/html' }, redirect: 'manual' }));
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) {
      // Responses from the assets binding have no url; give the page's real address back.
      return new Response(res.body, { status: res.status, headers: res.headers, url: u.href } as ResponseInit);
    }
    u = new URL(loc, u);
  }
  throw new Error('Too many redirects');
}

// Only public web addresses: no localhost, private networks, raw IPv6 or odd ports.
export function checkTarget(raw: string, allowLocal = false): URL | string {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return 'That doesn’t look like a web address.';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Only http and https addresses work.';
  if (u.username || u.password) return 'Addresses with a username or password don’t work here.';
  if (allowLocal) return u;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(h)) {
    return 'That’s an address on your own computer, so other apps can’t see it either. Deploy your site, then paste its public address.';
  }
  if (h.startsWith('[')) return 'Paste a site address rather than an IP address.';
  if (u.port && u.port !== '80' && u.port !== '443') return 'Only standard web ports work here.';
  const ip = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    const priv =
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
    if (priv) return 'That’s a private network address. Paste the public address of your site instead.';
  }
  return u;
}

async function readLimited(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, out.length - at);
    out.set(part, at);
    at += part.length;
    if (at >= out.length) break;
  }
  return new TextDecoder().decode(out);
}

type Tags = {
  title: string | null;
  description: string | null;
  canonical: string | null;
  icon: string | null;
  themeColor: string | null;
  og: Record<string, string>;
  twitter: Record<string, string>;
};

async function extract(html: string, base: string): Promise<Tags> {
  const t: Tags = { title: null, description: null, canonical: null, icon: null, themeColor: null, og: {}, twitter: {} };
  let titleText = '';
  const abs = (v: string) => {
    try {
      return new URL(v, base).href;
    } catch {
      return v;
    }
  };

  const rewriter = new HTMLRewriter()
    .on('title', {
      text(chunk) {
        if (t.title === null) titleText += chunk.text;
        if (chunk.lastInTextNode && t.title === null) t.title = decode(titleText.trim());
      },
    })
    .on('meta', {
      element(el) {
        const key = (el.getAttribute('property') ?? el.getAttribute('name') ?? '').toLowerCase().trim();
        const content = el.getAttribute('content');
        if (!key || content === null) return;
        const value = decode(content.trim());
        if (key.startsWith('og:') && !(key in t.og)) t.og[key] = /^og:(image|image:url|image:secure_url|url)$/.test(key) ? abs(value) : value;
        else if (key.startsWith('twitter:') && !(key in t.twitter)) t.twitter[key] = key === 'twitter:image' ? abs(value) : value;
        else if (key === 'description' && t.description === null) t.description = value;
        else if (key === 'theme-color' && t.themeColor === null) t.themeColor = value;
      },
    })
    .on('link', {
      element(el) {
        const rel = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
        const href = el.getAttribute('href');
        if (!href) return;
        if (rel.includes('canonical') && t.canonical === null) t.canonical = abs(href);
        if (rel.includes('icon') && t.icon === null) t.icon = abs(href);
      },
    });

  await rewriter.transform(new Response(html, { headers: { 'content-type': 'text/html' } })).text();
  return t;
}

// HTMLRewriter hands back attribute values with entities still encoded.
function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function json(data: unknown, status = 200, maxAge = 0): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
