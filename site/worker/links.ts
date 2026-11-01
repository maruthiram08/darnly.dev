// Broken link checker: crawls a site with the sitemap generator's crawler (up to 50 pages), collects
// every link and image on those pages, then checks each address once:
//   - pages the crawl already opened use the answer it got;
//   - other addresses on the same site get a GET;
//   - addresses on other sites get a HEAD, then a GET if the HEAD fails;
// at most 150 checks beyond the crawl, 4 at a time.
// It never fetches anything itself: the Worker passes in `fetchPage` (the crawl) and `probe`
// (one check), which apply the address rules and limits.

import { crawl, type Fetcher } from './sitemap';

export const MAX_PAGES = 50;
export const MAX_CHECKS = 150;
const PARALLEL = 4;
const CRAWL_BUDGET_MS = 20_000;
const CHECK_BUDGET_MS = 22_000;
const MAX_PLACES = 8;

// One check. `limited` means the Worker ran out of requests, so the address wasn't really checked.
export type ProbeResult = { status: number; url: string; limited?: boolean };
export type Prober = (url: string, method: 'HEAD' | 'GET', accept: string) => Promise<ProbeResult>;

export type Kind = 'broken' | 'redirect' | 'blocked';
type Place = { page: string; text: string };
export type Found = {
  url: string;
  type: 'link' | 'image';
  internal: boolean;
  kind: Kind;
  status: number;
  to?: string;
  places: Place[];
  total: number; // how many times it appears across the pages
};

type Target = { url: string; type: 'link' | 'image'; internal: boolean; places: Place[]; total: number; pages: Set<string> };

export async function checkLinks(firstHtml: string, firstUrl: string, firstHeaders: Headers, firstStatus: number, fetchPage: Fetcher, probe: Prober) {
  const host = new URL(firstUrl).hostname;
  const targets = new Map<string, Target>();
  const crawled = new Map<string, { status: number; final: string }>();
  const pages: string[] = [];

  const add = (raw: string, base: string, page: string, type: 'link' | 'image', text: string) => {
    const u = toUrl(raw, base);
    if (!u) return;
    const key = u.href;
    let t = targets.get(key);
    if (!t) {
      t = { url: key, type, internal: u.hostname === host, places: [], total: 0, pages: new Set() };
      targets.set(key, t);
    }
    if (type === 'link') t.type = 'link'; // a page that's also used as an image source is a link
    t.total++;
    t.pages.add(page);
    if (t.places.length < MAX_PLACES && !t.places.some((p) => p.page === page && p.text === text)) t.places.push({ page, text });
  };

  const result = await crawl(firstHtml, firstUrl, firstHeaders, firstStatus, fetchPage, {
    maxPages: MAX_PAGES,
    timeBudgetMs: CRAWL_BUDGET_MS,
    onFetch: (requested, status, final) => crawled.set(strip(requested), { status, final: strip(final) }),
    onPage: (url, html, base) => {
      const page = pathOf(url);
      pages.push(page);
      for (const l of extract(html)) add(l.href, base, page, l.type, l.text);
    },
  });

  const found: Found[] = [];
  const toCheck: Target[] = [];
  let ok = 0;
  for (const t of targets.values()) {
    const known = crawled.get(t.url);
    if (known) {
      const f = classify(t, known.status, known.final);
      if (f) found.push(f);
      else ok++;
    } else {
      toCheck.push(t);
    }
  }

  // Same-site addresses first (they're the user's to fix), then the most-used external ones.
  toCheck.sort((a, b) => Number(b.internal) - Number(a.internal) || b.total - a.total);
  const queue = toCheck.slice(0, MAX_CHECKS);
  let notChecked = toCheck.length - queue.length;
  let checked = 0;
  let limited = false;
  const started = Date.now();

  async function worker() {
    while (queue.length) {
      if (limited || Date.now() - started > CHECK_BUDGET_MS) {
        notChecked += queue.length;
        queue.length = 0;
        return;
      }
      const t = queue.shift()!;
      const accept = t.type === 'image' ? 'image/*,*/*;q=0.8' : 'text/html,*/*;q=0.8';
      let r = await probe(t.url, t.internal ? 'GET' : 'HEAD', accept);
      // Plenty of servers answer HEAD wrongly (404, 405, 403 or nothing), so ask again with GET.
      if (!r.limited && !t.internal && (r.status === 0 || r.status >= 400)) r = await probe(t.url, 'GET', accept);
      if (r.limited) {
        limited = true;
        notChecked++;
        continue;
      }
      checked++;
      const f = classify(t, r.status, strip(r.url || t.url));
      if (f) found.push(f);
      else ok++;
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  const rank: Record<Kind, number> = { broken: 0, redirect: 1, blocked: 2 };
  found.sort((a, b) => rank[a.kind] - rank[b.kind] || Number(b.internal) - Number(a.internal) || b.total - a.total || a.url.localeCompare(b.url));

  const brokenPages = new Set<string>();
  for (const f of found) if (f.kind === 'broken') for (const p of targets.get(f.url)?.pages ?? []) brokenPages.add(p);

  return {
    pagesCrawled: pages.length,
    pages: pages.slice(0, MAX_PAGES),
    linksFound: targets.size,
    ok,
    found,
    brokenPages: brokenPages.size,
    notChecked,
    stopped: result.stopped,
    morePages: result.notCrawled,
  };
}

// Broken, redirected or blocked; null when it's fine.
function classify(t: Target, status: number, final: string): Found | null {
  const base = { url: t.url, type: t.type, internal: t.internal, places: t.places, total: t.total, status };
  // 401/403/429 and LinkedIn's 999 usually mean "no robots", not "missing", so we say we couldn't check.
  if (!t.internal && (status === 401 || status === 403 || status === 429 || status === 999)) return { ...base, kind: 'blocked' };
  if (status === 0 || status >= 400) return { ...base, kind: 'broken' };
  if (final && final !== t.url) return { ...base, kind: 'redirect', to: final };
  return null;
}

const SKIP = /^(mailto|tel|javascript|data|sms|blob|about|file|ftp):/i;

function toUrl(raw: string, base: string): URL | null {
  const href = decode(raw.trim());
  if (!href || href.startsWith('#') || SKIP.test(href) || /[{}]|\$\{/.test(href)) return null;
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u;
  } catch {
    return null;
  }
}

// Every <a href> (with its text) and <img src> outside scripts, styles and comments.
export function extract(html: string): { href: string; type: 'link' | 'image'; text: string }[] {
  const out: { href: string; type: 'link' | 'image'; text: string }[] = [];
  const body = html.replace(/<!--[\s\S]*?-->|<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '');
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)(?=<\/a\s*>|<a\b)/gi)) {
    const href = attr(m[1], 'href');
    if (href === null) continue;
    let text = clean(m[2].replace(/<[^>]*>/g, ' '));
    if (!text) text = clean(attr(m[1], 'aria-label') ?? attr(m[1], 'title') ?? attr(m[2], 'alt') ?? '');
    if (!text && /<(img|svg)\b/i.test(m[2])) text = '(an image or icon)';
    out.push({ href, type: 'link', text: text.slice(0, 120) });
  }
  for (const m of body.matchAll(/<img\b([^>]*)>/gi)) {
    const src = attr(m[1], 'src');
    if (!src || src.startsWith('data:')) continue;
    out.push({ href: src, type: 'image', text: clean(attr(m[1], 'alt') ?? '').slice(0, 120) || '(image with no alt text)' });
  }
  return out;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

const clean = (s: string) => decode(s).replace(/\s+/g, ' ').trim();
const strip = (u: string) => u.replace(/#.*$/, '');
const pathOf = (u: string) => {
  const x = new URL(u);
  return x.pathname + x.search;
};
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
