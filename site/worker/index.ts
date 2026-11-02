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
// GET /api/design?url=https://example.com
//   Same guards. Reads the page and its stylesheets once and returns its colors, fonts, type
//   scale, spacing, radius, shadows, buttons and cards, for the DESIGN.md generator at
//   /tools/design-md-generator/.
//
// GET /api/stack?url=https://example.com
//   Same guards. Reads the page, its response headers and a few of its own files and returns
//   what it was built with, for the tech stack finder at /tools/tech-stack-finder/.
//
// GET /api/speed?url=https://example.com
//   Same address rules. Asks Google PageSpeed Insights to test the page on a phone and a laptop
//   and returns the scores, the loading filmstrip, Core Web Vitals and the top fixes, for the
//   page speed checker at /tools/page-speed-checker/. PSI takes 10 to 40 seconds, so this has
//   its own rate limit (PSI_LIMIT), a 60 second timeout and a one hour cache. PSI_KEY is an
//   optional Google API key secret; without it Google's shared free quota is used.
//
// GET /api/sitemap?url=https://example.com
//   Same guards, plus its own limit of 2 crawls a minute per visitor. Follows links on the same
//   host (up to 100 pages, 4 at a time) and returns the pages for sitemap.xml and robots.txt,
//   for the sitemap generator at /tools/sitemap-generator/.
//
// GET /api/links?url=https://example.com
//   Same guards, plus its own limit of 1 check a minute per visitor. Crawls the site with the
//   sitemap crawler (up to 50 pages), then checks every link and image on them (at most 150
//   extra checks, 4 at a time; HEAD then GET for other sites), for the broken link checker at
//   /tools/broken-link-checker/.
//
// GET /api/secrets?url=https://example.com
//   Same guards, but never cached. Reads the page and up to 20 of its own JavaScript files and
//   reports secret API keys anyone can copy, for the API key leak checker at
//   /tools/api-key-leak-checker/. Only masked previews (sk-ab…9f2) are ever sent back.
//
// GET /api/jwks?url=https://example.com/.well-known/jwks.json
//   Same address rules and rate limit. Reads a public key set (or an OpenID configuration that
//   points to one) and returns only its public keys, for signature checks in the JWT decoder at
//   /tools/jwt-decoder/. The token itself never comes here.
//
// GET /api/llms?url=https://example.com
//   Same guards, plus its own limit of 2 a minute per visitor. Uses the sitemap crawler (up to
//   50 pages) to read each page's title and description, checks robots.txt for AI crawlers and
//   whether an llms.txt exists, for the llms.txt generator at /tools/llms-txt-generator/.
// GET /api/headers?url=https://example.com
//   Same guards, but never cached, so a re-check after a fix is fresh. Grades the page's
//   security headers (HSTS, CSP, framing, nosniff, referrer, permissions, cookie flags, server
//   version) from A to F, for the security headers checker at /tools/security-headers-checker/.
//   Cookie values are never sent back, only their names and flags.
// GET /api/csp?url=https://example.com
//   Same guards. Reads the page, up to 6 stylesheets and up to 12 of its own JavaScript files, and
//   returns every place it loads things from, grouped by CSP directive, plus its inline scripts
//   (with hashes), for the CSP generator at /tools/csp-generator/.
// GET /api/pwa?url=https://example.com
//   Same guards. Reads the page, its web app manifest, its icons and up to 20 of its own
//   JavaScript files (to find a service worker being registered) and grades each install
//   requirement, for the PWA checker at /tools/pwa-checker/.
// GET /api/domains?names=myapp.com,myapp.dev
//   Up to 12 names. For each: free, taken (with dates), maybe (no DNS, registry didn't answer) or
//   unknown. Asks each registry's RDAP server (from the IANA list, cached a day) and Cloudflare DNS.
//   Own rate limit (DOMAIN_LIMIT). Used by the domain name finder at /tools/domain-name-finder/.
// GET /api/a11y?url=https://example.com
//   Same guards, but never cached, so a re-check after a fix is fresh. Reads the page's HTML and
//   runs the automated accessibility checks, for the accessibility checker at
//   /tools/accessibility-checker/.
// POST /api/request  { method, url, headers, body }
//   Sends one API request for the API tester at /tools/api-tester/ and returns its status, time,
//   size, headers and body. Public addresses only (checked on every redirect), its own limit of
//   20 a minute, a 10 second timeout, a 1 MB response limit, no Cookie header, never cached.
//   See request.ts.
// GET /api/ssl?domain=example.com
//   Same rate limit. Reads the domain's certificates from the public Certificate Transparency logs
//   (crt.sh, with Cert Spotter as a fallback, cached for an hour), looks up its DNS through
//   Cloudflare's DNS-over-HTTPS, and opens https://, http:// and the www (or bare) name to confirm
//   what visitors get, for the SSL checker at /tools/ssl-checker/. Results are cached 10 minutes.
// GET /api/whoami
//   Sends back the visitor's own IP address and country (from Cloudflare's request data), for the
//   browser info tool at /tools/browser-info/. Fetches nothing, logs nothing, and is never cached.
// GET /api/npm?name=zod
//   Same rate limit and one hour cache. Reads one package from the npm registry (and its
//   download counts) and grades it, for the npm package checker at /tools/npm-package-checker/.
//   Only fixed npm addresses are fetched; the name is checked against npm's naming rules first.

import { findFonts } from './fonts';
import { findColors } from './colors';
import { checkLaunch, type Probe } from './launch';
import { findDesign } from './design';
import { findStack } from './stack';
import { summarize, field, psiError, type Psi } from './speed';
import { crawl, type Fetched } from './sitemap';
import { llmsSite } from './llms';
import { findLeaks } from './secrets';
import { checkHeaders } from './headers';
import { checkLinks, type ProbeResult } from './links';
import { buildCsp } from './csp';
import { checkPwa } from './pwa';
import { cleanName, parseBootstrap, readDns, readRecord, verdict, type DnsAnswer, type RdapAnswer, type Result } from './domains';
import { checkA11y } from './a11y';
import { sendRequest } from './request';
import { analyze, otherName, parseCrtSh, parseCertSpotter, type CtCert, type Dns, type SslProbe } from './ssl';
import { checkPackage, cleanName, type GetJson } from './npm';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  FETCH_LIMIT?: RateLimit;
  CRAWL_LIMIT?: RateLimit; // the sitemap crawl reads up to 100 pages, so it has a tighter limit
  LLMS_LIMIT?: RateLimit; // the llms.txt generator crawls up to 50 pages, with its own limit
  LINK_LIMIT?: RateLimit; // the broken link checker reads up to 50 pages and checks 150 links
  DOMAIN_LIMIT?: RateLimit; // domain lookups, one request checks up to 12 names
  API_LIMIT?: RateLimit; // the API tester sends requests of any method, so it has its own limit
  PSI_LIMIT?: RateLimit;
  PSI_KEY?: string; // optional Google API key for PageSpeed Insights (a Worker secret)
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
    if (url.pathname === '/api/design') return designApi(req, url, env, ctx);
    if (url.pathname === '/api/stack') return stackApi(req, url, env, ctx);
    if (url.pathname === '/api/speed') return speedApi(req, url, env, ctx);
    if (url.pathname === '/api/sitemap') return sitemapApi(req, url, env, ctx);
    if (url.pathname === '/api/links') return linksApi(req, url, env, ctx);
    if (url.pathname === '/api/secrets') return secretsApi(req, url, env, ctx);
    if (url.pathname === '/api/jwks') return jwksApi(req, url, env, ctx);
    if (url.pathname === '/api/llms') return llmsApi(req, url, env, ctx);
    if (url.pathname === '/api/headers') return headersApi(req, url, env, ctx);
    if (url.pathname === '/api/csp') return cspApi(req, url, env, ctx);
    if (url.pathname === '/api/pwa') return pwaApi(req, url, env, ctx);
    if (url.pathname === '/api/domains') return domainsApi(req, url, env, ctx);
    if (url.pathname === '/api/a11y') return a11yApi(req, url, env, ctx);
    if (url.pathname === '/api/request') {
      return sendRequest(req, {
        checkTarget: (raw) => checkTarget(raw, env.ALLOW_LOCAL === '1'),
        isOwnHost: (t) => isOwnHost(t, url),
        ownPage: (t) => ownPage(t, env),
        limit: env.API_LIMIT,
      });
    }
    if (url.pathname === '/api/ssl') return sslApi(req, url, env, ctx);
    if (url.pathname === '/api/whoami') return whoami(req);
    if (url.pathname === '/api/npm') return npmApi(req, url, env, ctx);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(req);
  },
};

type RateLimit = { limit(o: { key: string }): Promise<{ success: boolean }> };
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

// /api/secrets: secret keys in a page's own JavaScript. Not cached, so a re-check after a fix is fresh.
function secretsApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  return pageTool(
    'secrets',
    req,
    url,
    env,
    ctx,
    async (p) => ({
      url: p.target.href,
      finalUrl: p.finalUrl,
      status: p.status,
      ...(await findLeaks(p.html, p.finalUrl, (u) => fetchText(u, url, env, 'application/javascript,*/*;q=0.1', 2_000_000))),
    }),
    { cache: false, maxBytes: 2_000_000 },
  );
}

// /api/csp: everything a page loads, grouped by Content-Security-Policy directive.
function cspApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  return pageTool('csp', req, url, env, ctx, async (p) => ({
    url: p.target.href,
    finalUrl: p.finalUrl,
    status: p.status,
    ...(await buildCsp(p.html, p.finalUrl, p.headers, (u) => fetchText(u, url, env, 'text/css,application/javascript,*/*;q=0.1', 1_500_000))),
  }));
// /api/a11y: automated accessibility checks on one page's HTML. Not cached, so a re-check after a fix is fresh.
function a11yApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  return pageTool(
    'a11y',
    req,
    url,
    env,
    ctx,
    async (p) => ({ url: p.target.href, finalUrl: p.finalUrl, status: p.status, ...checkA11y(p.html, p.finalUrl) }),
    { cache: false },
  );
// /api/whoami: the visitor's own IP address and country, read from the request. Nothing is stored.
function whoami(req: Request): Response {
  if (req.method !== 'GET') return json({ error: 'Use GET' }, 405);
  const cf = (req as Request & { cf?: { country?: string } }).cf;
  const country = (cf?.country ?? req.headers.get('cf-ipcountry') ?? '').toUpperCase().slice(0, 2);
  const ip = (req.headers.get('cf-connecting-ip') ?? '').slice(0, 64);
  return json({ ip, country });
}

// /api/jwks: the public keys a JWT can be checked against. Only key fields are passed back.
async function jwksApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Use GET' }, 405);
  const target = checkTarget(url.searchParams.get('url') ?? '', env.ALLOW_LOCAL === '1');
  if (typeof target === 'string') return json({ error: target }, 400);

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(`https://darnly.dev/api/jwks?url=${encodeURIComponent(target.href)}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  if (env.FETCH_LIMIT) {
    const { success } = await env.FETCH_LIMIT.limit({ key: req.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!success) return json({ error: 'Too many checks in a minute. Wait a moment and try again.' }, 429);
  }

  const read = async (raw: string): Promise<Record<string, unknown> | null> => {
    const text = await fetchText(raw, url, env, 'application/json,*/*;q=0.1', 200_000);
    if (!text) return null;
    try {
      const data = JSON.parse(text);
      return data && typeof data === 'object' ? data : null;
    } catch {
      return null;
    }
  };

  let data = await read(target.href);
  // An OpenID configuration names its key set in jwks_uri.
  if (data && !Array.isArray(data.keys) && typeof data.jwks_uri === 'string') data = await read(data.jwks_uri);
  if (!data) return json({ error: 'We couldn’t read a key set at that address. Check it opens in your browser and shows JSON with "keys".' }, 422);

  const list = Array.isArray(data.keys) ? data.keys : typeof data.kty === 'string' ? [data] : [];
  const PUBLIC = ['kty', 'kid', 'alg', 'use', 'crv', 'n', 'e', 'x', 'y'];
  const keys = list
    .filter((k): k is Record<string, unknown> => !!k && typeof k === 'object')
    .slice(0, 50)
    .map((k) => Object.fromEntries(PUBLIC.filter((f) => typeof k[f] === 'string').map((f) => [f, k[f]])));
  if (!keys.length) return json({ error: 'That address answered, but it has no public keys in it.' }, 422);

  const body = json({ keys }, 200, CACHE_SECONDS);
  ctx.waitUntil(cache.put(cacheKey, body.clone()));
  return body;
}

// /api/headers: a page's security headers, graded. Not cached, so a re-check after a fix is fresh.
function headersApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  return pageTool(
    'headers',
    req,
    url,
    env,
    ctx,
    async (p) => ({ url: p.target.href, finalUrl: p.finalUrl, status: p.status, ...checkHeaders(p.headers, p.finalUrl, p.html) }),
    { cache: false },
  );
// /api/domains: is each name registered? Each name is cached on its own, so ideas shared
// between searches are only looked up once.
const MAX_NAMES = 12;
async function domainsApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Use GET' }, 405);
  const raw = (url.searchParams.get('names') ?? '').split(',').filter((n) => n.trim());
  if (!raw.length) return json({ error: 'Type a name to check, like myapp.com.' }, 400);
  if (raw.length > MAX_NAMES) return json({ error: `Check up to ${MAX_NAMES} names at a time.` }, 400);
  const names = raw.map(cleanName);
  if (names.some((n) => !n)) return json({ error: 'Names can use letters, numbers and dashes, and end in .com, .dev, .app, .io, .ai, .co, .net, .org, .xyz, .sh, .so or .me.' }, 400);

  const limit = env.DOMAIN_LIMIT ?? env.FETCH_LIMIT;
  if (limit) {
    const { success } = await limit.limit({ key: req.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!success) return json({ error: 'That’s a lot of lookups in a minute. Wait a moment and try again.' }, 429);
  }

  const cache = (caches as unknown as { default: Cache }).default;
  const servers = await rdapServers(url, env, ctx, cache);
  const results = await Promise.all(
    [...new Set(names as string[])].map(async (name): Promise<Result> => {
      const key = new Request(`https://darnly.dev/api/domains/one?name=${encodeURIComponent(name)}`);
      const hit = await cache.match(key);
      if (hit) return (await hit.json()) as Result;
      const [rdap, dns] = await Promise.all([rdapLookup(name, servers, url, env), dnsLookup(name, url, env)]);
      const result = verdict(name, rdap, dns);
      // Taken names rarely change; free ones can be bought any minute, and errors should retry soon.
      const ttl = result.state === 'taken' ? 6 * 3600 : result.state === 'free' ? 600 : 60;
      ctx.waitUntil(cache.put(key, json(result, 200, ttl)));
      return result;
    }),
  );
  return json({ results });
}

// The IANA list of RDAP servers per ending, kept for a day in memory and in the cache.
const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
let bootstrap: { at: number; map: Record<string, string> } | null = null;
async function rdapServers(self: URL, env: Env, ctx: Ctx, cache: Cache): Promise<Record<string, string>> {
  const DAY = 86_400;
  if (bootstrap && Date.now() - bootstrap.at < DAY * 1000) return bootstrap.map;
  const key = new Request('https://darnly.dev/api/domains/rdap-bootstrap');
  const hit = await cache.match(key);
  let text = hit ? await hit.text() : null;
  if (!text) {
    text = await fetchText(BOOTSTRAP_URL, self, env, 'application/json', 1_000_000);
    if (text && Object.keys(parseBootstrap(text)).length) {
      ctx.waitUntil(cache.put(key, new Response(text, { headers: { 'cache-control': `public, max-age=${DAY}` } })));
    }
  }
  const map = text ? parseBootstrap(text) : {};
  // Without the list, try again on the next request rather than in a day.
  if (Object.keys(map).length) bootstrap = { at: Date.now(), map };
  return map;
}

// Endings missing from the IANA list (some country endings) go through rdap.org, which knows more servers.
async function rdapLookup(name: string, servers: Record<string, string>, self: URL, env: Env): Promise<RdapAnswer> {
  const tld = name.slice(name.lastIndexOf('.') + 1);
  const base = servers[tld] ?? 'https://rdap.org/';
  try {
    const res = await get(new URL(`${base}domain/${name}`), self, env, 'application/rdap+json, application/json', 6_000);
    if (res.status === 404) return { kind: 'none' };
    if (!res.ok) return { kind: 'error' };
    let record: unknown = null;
    try {
      record = JSON.parse(await readLimited(res, 300_000));
    } catch {
      /* found, but the details didn't parse */
    }
    return { kind: 'found', ...readRecord(record) };
  } catch {
    return { kind: 'error' };
  }
}

async function dnsLookup(name: string, self: URL, env: Env): Promise<DnsAnswer> {
  try {
    const res = await get(new URL(`https://cloudflare-dns.com/dns-query?name=${name}&type=NS`), self, env, 'application/dns-json', 4_000);
    if (!res.ok) return 'error';
    return readDns(JSON.parse(await readLimited(res, 50_000)));
  } catch {
    return 'error';
  }
}

// /api/ssl: a domain's certificate, from the public logs plus a live https request.
async function sslApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Use GET' }, 405);
  const raw = (url.searchParams.get('domain') ?? url.searchParams.get('url') ?? '').trim();
  if (!raw) return json({ error: 'Type a domain, like yoursite.com.' }, 400);
  const target = checkTarget(raw, env.ALLOW_LOCAL === '1');
  if (typeof target === 'string') return json({ error: target }, 400);
  const host = target.hostname.toLowerCase().replace(/\.$/, '');
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return json({ error: 'Paste a domain name rather than an IP address.' }, 400);
  if (host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) return json({ error: 'That doesn’t look like a domain name.' }, 400);

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(`https://darnly.dev/api/ssl?domain=${encodeURIComponent(host)}`);
// /api/npm: one npm package, graded. Missing packages are cached for 10 minutes, found ones for an hour.
async function npmApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Use GET' }, 405);
  const name = cleanName(url.searchParams.get('name') ?? '');
  if (!name) return json({ error: 'That isn’t a valid npm package name. Names look like zod or @tanstack/react-query.' }, 400);

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(`https://darnly.dev/api/npm?name=${encodeURIComponent(name)}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  if (env.FETCH_LIMIT) {
    const { success } = await env.FETCH_LIMIT.limit({ key: req.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!success) return json({ error: 'Too many checks in a minute. Wait a moment and try again.' }, 429);
  }

  const www = otherName(host);
  const labels = host.split('.');
  // A subdomain like app.example.com is often covered by a *.example.com certificate.
  const wildcard = !host.startsWith('www.') && labels.length > 2 ? `*.${labels.slice(1).join('.')}` : null;
  const ownHost = isOwnHost(new URL(`https://${host}/`), url);

  const [ct, https, http, wwwProbe, dns, wwwDns] = await Promise.all([
    certsFor([host, www, ...(wildcard ? [wildcard] : [])], url, env, ctx),
    sslProbe(`https://${host}/`, url, env),
    ownHost ? Promise.resolve(null) : sslProbe(`http://${host}/`, url, env),
    sslProbe(`https://${www}/`, url, env),
    ownHost ? Promise.resolve({ a: ['own'], cname: [] }) : lookup(host, url, env),
    isOwnHost(new URL(`https://${www}/`), url) ? Promise.resolve({ a: ['own'], cname: [] }) : lookup(www, url, env),
  ]);

  const data = analyze({ host, now: new Date(), certs: ct.certs, source: ct.source, https, http, www: wwwProbe, dns, wwwDns });
  const body = json(data, 200, 600);
  const getJson: GetJson = async (raw, max = 500_000) => {
    const res = await get(new URL(raw), url, env, 'application/json', 6_000);
    if (res.status === 404) {
      res.body?.cancel().catch(() => {});
      return { status: 404, data: null };
    }
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      throw new Error(`npm answered ${res.status}`);
    }
    return { status: res.status, data: JSON.parse(await readLimited(res, max)) };
  };

  let report;
  try {
    report = await checkPackage(name, getJson);
  } catch {
    return json({ error: 'We couldn’t reach npm just now. Try again in a minute.' }, 502);
  }
  const body = json(report, 200, report.found ? CACHE_SECONDS : 600);
  ctx.waitUntil(cache.put(cacheKey, body.clone()));
  return body;
}

// Certificates for these names from crt.sh, falling back to Cert Spotter. Each answer is cached an hour.
async function certsFor(names: string[], self: URL, env: Env, ctx: Ctx): Promise<{ certs: CtCert[]; source: 'crt.sh' | 'certspotter' | null }> {
  const cache = (caches as unknown as { default: Cache }).default;
  const read = async (api: string, accept: string, timeout: number, max: number): Promise<string | null> => {
    const key = new Request(api);
    const hit = await cache.match(key);
    if (hit) return hit.text();
    try {
      const res = await get(new URL(api), self, env, accept, timeout);
      if (!res.ok) {
        res.body?.cancel().catch(() => {});
        return null;
      }
      const text = await readLimited(res, max);
      ctx.waitUntil(cache.put(key, new Response(text, { headers: { 'cache-control': `public, max-age=${CACHE_SECONDS}` } })));
      return text;
    } catch {
      return null;
    }
  };

  const crt = await Promise.all(
    names.map((n) => read(`https://crt.sh/?q=${encodeURIComponent(n)}&output=json&deduplicate=Y`, 'application/json', 15_000, 3_000_000)),
  );
  if (crt.some((t) => t !== null)) return { certs: crt.flatMap((t) => (t ? parseCrtSh(t) : [])), source: 'crt.sh' };

  const spot = await Promise.all(
    names
      .filter((n) => !n.startsWith('*.'))
      .map((n) => read(`https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(n)}&expand=dns_names&expand=issuer`, 'application/json', 10_000, 1_000_000)),
  );
  if (spot.some((t) => t !== null)) return { certs: spot.flatMap((t) => (t ? parseCertSpotter(t) : [])), source: 'certspotter' };
  return { certs: [], source: null };
}

// Opens one address and reports whether a secure connection worked. Only the status is read.
async function sslProbe(raw: string, self: URL, env: Env): Promise<SslProbe | null> {
  const t = checkTarget(raw, env.ALLOW_LOCAL === '1');
  if (typeof t === 'string') return null;
  try {
    const res = await get(t, self, env, 'text/html,*/*;q=0.5', 7_000);
    res.body?.cancel().catch(() => {});
    const finalUrl = res.url || t.href;
    // 525 and 526 are Cloudflare's "the site's own certificate is broken" answers.
    const tlsFail = res.status === 525 || res.status === 526;
    return { ok: !tlsFail, status: res.status, finalUrl, ...(tlsFail ? { error: 'tls' as const } : {}) };
  } catch (err) {
    const e = err as Error;
    const error = e?.name === 'TimeoutError' ? 'timeout' : /ssl|tls|certificate|handshake|x509/i.test(e?.message ?? '') ? 'tls' : 'connect';
    return { ok: false, status: 0, finalUrl: t.href, error };
  }
}

// A and AAAA answers (and the CNAME chain) through Cloudflare's DNS-over-HTTPS. null if the lookup failed.
async function lookup(name: string, self: URL, env: Env): Promise<Dns | null> {
  const ask = async (type: string) => {
    const text = await fetchText(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, self, env, 'application/dns-json', 50_000);
    if (!text) return null;
    try {
      return (JSON.parse(text).Answer ?? []) as { type: number; data: string }[];
    } catch {
      return null;
    }
  };
  const [a, aaaa] = await Promise.all([ask('A'), ask('AAAA')]);
  if (!a && !aaaa) return null;
  const all = [...(a ?? []), ...(aaaa ?? [])];
  return {
    a: [...new Set(all.filter((r) => r.type === 1 || r.type === 28).map((r) => r.data))],
    cname: [...new Set(all.filter((r) => r.type === 5).map((r) => r.data.replace(/\.$/, '')))],
  };
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

// /api/pwa: can this site be installed to a phone's home screen? Cached for 10 minutes, so a
// re-check after a fix is fresh soon.
function pwaApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  const loadsImage = async (raw: string): Promise<boolean> => {
    const t = checkTarget(raw, env.ALLOW_LOCAL === '1');
    if (typeof t === 'string') return false;
    try {
      const res = await get(t, url, env, 'image/*,*/*;q=0.1', 5_000);
      res.body?.cancel().catch(() => {});
      return res.ok && !/html/i.test(res.headers.get('content-type') ?? '') && typeof checkTarget(res.url || t.href, env.ALLOW_LOCAL === '1') !== 'string';
    } catch {
      return false;
    }
  };
  return pageTool('pwa', req, url, env, ctx, async (p) => ({
    url: p.target.href,
    finalUrl: p.finalUrl,
    status: p.status,
    ...(await checkPwa(p.html, p.finalUrl, (u, accept, max) => fetchText(u, url, env, accept, max), loadsImage)),
  }), { cacheSeconds: 600 });
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

// /api/speed: Google PageSpeed Insights on a phone and a laptop, boiled down for the page.
// It doesn't read the page itself, so it skips pageTool() but keeps its address check,
// cache and rate limit, and calls Google through get().
const PSI = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
async function speedApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Use GET' }, 405);
  const target = checkTarget(url.searchParams.get('url') ?? '', env.ALLOW_LOCAL === '1');
  if (typeof target === 'string') return json({ error: target }, 400);

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(`https://darnly.dev/api/speed?url=${encodeURIComponent(target.href)}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const limiter = env.PSI_LIMIT ?? env.FETCH_LIMIT;
  if (limiter) {
    const who = req.headers.get('cf-connecting-ip') ?? 'unknown';
    const { success } = await limiter.limit({ key: who });
    if (!success) return json({ error: 'Speed tests are slow for Google to run, so there’s a limit of 2 a minute. Wait a minute and try again.' }, 429);
  }

  const run = async (strategy: 'mobile' | 'desktop') => {
    const q = new URL(PSI);
    q.searchParams.set('url', target.href);
    q.searchParams.set('strategy', strategy);
    q.searchParams.set('category', 'performance');
    q.searchParams.set('locale', 'en');
    if (env.PSI_KEY) q.searchParams.set('key', env.PSI_KEY);
    try {
      const res = await get(q, url, env, 'application/json', 60_000);
      const text = await readLimited(res, 8_000_000);
      if (!res.ok) return { error: psiError(res.status, text) };
      const psi = JSON.parse(text) as Psi;
      const report = summarize(psi);
      if (!report) return { error: psiError(500, text) };
      return { report, field: field(psi), finalUrl: psi.lighthouseResult?.finalDisplayedUrl ?? psi.lighthouseResult?.finalUrl ?? target.href };
    } catch (e) {
      return { error: (e as Error)?.name === 'TimeoutError' ? 'That page took too long to load for Google to test it.' : psiError(0, '') };
    }
  };
  const [mobile, desktop] = await Promise.all([run('mobile'), run('desktop')]);
  if ('error' in mobile && 'error' in desktop) return json({ error: mobile.error }, 502);

  const body = json(
    {
      url: target.href,
      finalUrl: ('finalUrl' in mobile ? mobile.finalUrl : 'finalUrl' in desktop ? desktop.finalUrl : target.href),
      mobile: 'report' in mobile ? mobile.report : { error: mobile.error },
      desktop: 'report' in desktop ? desktop.report : { error: desktop.error },
      field: 'field' in mobile ? mobile.field : null,
      testedAt: new Date().toISOString(),
    },
    200,
    'error' in mobile || 'error' in desktop ? 0 : CACHE_SECONDS,
  );
  if (!('error' in mobile) && !('error' in desktop)) ctx.waitUntil(cache.put(cacheKey, body.clone()));
  return body;
}

// /api/sitemap: crawl one site and list the pages for sitemap.xml. Every page goes through get().
function sitemapApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  const fetchPage = crawlFetcher(url, env);
  return pageTool('sitemap', req, url, env, ctx, async (p) => ({
    url: p.target.href,
    finalUrl: p.finalUrl,
    status: p.status,
    ...(await crawl(p.html, p.finalUrl, p.headers, p.status, fetchPage)),
  }), { limit: env.CRAWL_LIMIT, limitError: 'You can make 2 sitemaps a minute. Wait a moment and try again.', cacheSeconds: 600 });
}

// /api/llms: crawl one site (up to 50 pages) for the llms.txt generator, and check robots.txt for AI crawlers.
function llmsApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  const fetchPage = crawlFetcher(url, env);
  return pageTool('llms', req, url, env, ctx, async (p) => ({
    url: p.target.href,
    finalUrl: p.finalUrl,
    status: p.status,
    ...(await llmsSite(p.html, p.finalUrl, p.headers, p.status, fetchPage)),
  }), { limit: env.LLMS_LIMIT, limitError: 'You can make 2 llms.txt files a minute. Wait a moment and try again.', cacheSeconds: 600 });
}

// The page reader the crawlers use: the same address rules as every tool, a 5 second timeout per page.
function crawlFetcher(url: URL, env: Env) {
  return async (raw: string, accept: string): Promise<Fetched | null> => {
    const t = checkTarget(raw, env.ALLOW_LOCAL === '1');
    if (typeof t === 'string') return null;
    try {
      const res = await get(t, url, env, accept, 5_000);
      const final = res.url || t.href;
      if (typeof checkTarget(final, env.ALLOW_LOCAL === '1') === 'string') return null;
      const type = res.headers.get('content-type') ?? '';
      const readable = /html|text\/plain|markdown/i.test(type) || !type;
      const text = readable && res.status < 400 ? await readLimited(res, 500_000) : '';
      if (!text) res.body?.cancel().catch(() => {});
      return { status: res.status, url: final, type, lastModified: res.headers.get('last-modified'), robotsHeader: res.headers.get('x-robots-tag'), text };
    } catch {
      return null;
    }
  };
}

// /api/links: crawl one site and check every link and image on it. Every request goes through get().
function linksApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  const local = env.ALLOW_LOCAL === '1';
  const fetchPage = async (raw: string, accept: string): Promise<Fetched | null> => {
    const t = checkTarget(raw, local);
    if (typeof t === 'string') return null;
    try {
      const res = await get(t, url, env, accept, 5_000);
      const final = res.url || t.href;
      if (typeof checkTarget(final, local) === 'string') return null;
      const type = res.headers.get('content-type') ?? '';
      const readable = /html|text\/plain/i.test(type) || !type;
      const text = readable && res.status < 400 ? await readLimited(res, 500_000) : '';
      if (!text) res.body?.cancel().catch(() => {});
      return { status: res.status, url: final, type, lastModified: null, robotsHeader: res.headers.get('x-robots-tag'), text };
    } catch {
      return null;
    }
  };
  // One link check: only the status and where it ends up; the body is never read.
  const probe = async (raw: string, method: 'HEAD' | 'GET', accept: string): Promise<ProbeResult> => {
    const t = checkTarget(raw, local);
    // Addresses we won't fetch (localhost, private networks) can't work for visitors either.
    if (typeof t === 'string') return { status: 0, url: raw };
    try {
      const res = await get(t, url, env, accept, 6_000, method);
      res.body?.cancel().catch(() => {});
      const final = res.url || t.href;
      if (typeof checkTarget(final, local) === 'string') return { status: 0, url: final };
      return { status: res.status, url: final };
    } catch (e) {
      // Cloudflare caps how many requests one visit can make; that's our limit, not a broken link.
      if (/subrequest/i.test(String(e))) return { status: 0, url: raw, limited: true };
      return { status: 0, url: raw };
    }
  };
  return pageTool('links', req, url, env, ctx, async (p) => ({
    url: p.target.href,
    finalUrl: p.finalUrl,
    status: p.status,
    ...(await checkLinks(p.html, p.finalUrl, p.headers, p.status, fetchPage, probe)),
  }), { limit: env.LINK_LIMIT, limitError: 'You can check one site a minute. Wait a moment and try again.', cacheSeconds: 120 });
}

// /api/design: a page's design system (colors, fonts, type scale, spacing, shape, components).
function designApi(req: Request, url: URL, env: Env, ctx: Ctx): Promise<Response> {
  return pageTool('design', req, url, env, ctx, async (p) => ({
    url: p.target.href,
    finalUrl: p.finalUrl,
    status: p.status,
    ...(await findDesign(p.html, p.finalUrl, (u) => fetchText(u, url, env, 'text/css,*/*;q=0.1'))),
  }));
}

// Shared by every tool that reads a page: address check, cache, rate limit, fetch, HTML check.
// Options: cache (false = never cached), maxBytes, cacheSeconds, and an extra rate limit.
type ToolOptions = { cache?: boolean; maxBytes?: number; cacheSeconds?: number; limit?: RateLimit; limitError?: string };
async function pageTool(
  name: string,
  req: Request,
  url: URL,
  env: Env,
  ctx: Ctx,
  run: (p: Page) => Promise<unknown>,
  opts: ToolOptions = {},
): Promise<Response> {
  const useCache = opts.cache !== false;
  if (req.method !== 'GET') return json({ error: 'Use GET' }, 405);

  const target = checkTarget(url.searchParams.get('url') ?? '', env.ALLOW_LOCAL === '1');
  if (typeof target === 'string') return json({ error: target }, 400);

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(`https://darnly.dev/api/${name}?url=${encodeURIComponent(target.href)}`);
  const hit = useCache ? await cache.match(cacheKey) : undefined;
  if (hit) return hit;

  if (env.FETCH_LIMIT) {
    const who = req.headers.get('cf-connecting-ip') ?? 'unknown';
    const { success } = await env.FETCH_LIMIT.limit({ key: who });
    if (!success) return json({ error: 'Too many checks in a minute. Wait a moment and try again.' }, 429);
  }
  if (opts.limit) {
    const who = req.headers.get('cf-connecting-ip') ?? 'unknown';
    const { success } = await opts.limit.limit({ key: who });
    if (!success) return json({ error: opts.limitError ?? 'Too many checks in a minute. Wait a moment and try again.' }, 429);
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

  const html = await readLimited(res, opts.maxBytes ?? MAX_BYTES);
  const data = await run({ target, finalUrl, status: res.status, html, headers: res.headers });
  if (!useCache) return json(data);
  const body = json(data, 200, opts.cacheSeconds ?? CACHE_SECONDS);
  ctx.waitUntil(cache.put(cacheKey, body.clone()));
  return body;
}

// Cloudflare won't let this Worker fetch its own domain (it answers "error code: 1042"),
// so pages on darnly.dev are read straight from the site's own files.
function get(target: URL, self: URL, env: Env, accept: string, timeout = TIMEOUT_MS, method: 'GET' | 'HEAD' = 'GET'): Promise<Response> {
  if (isOwnHost(target, self)) return ownPage(target, env);
  return fetch(target.href, { method, headers: { 'user-agent': UA, accept }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
}

// A stylesheet or other text file linked from the page, with the same address rules and smaller limits.
async function fetchText(raw: string, self: URL, env: Env, accept: string, max = 500_000): Promise<string | null> {
  const t = checkTarget(raw, env.ALLOW_LOCAL === '1');
  if (typeof t === 'string') return null;
  try {
    const res = await get(t, self, env, accept, 5_000);
    if (!res.ok || typeof checkTarget(res.url || t.href, env.ALLOW_LOCAL === '1') === 'string') return null;
    return await readLimited(res, max);
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
