// Sitemap generator: starting from one page, follows links on the same host (at most 100 pages,
// 4 at a time) and returns the pages that belong in sitemap.xml, plus the ones that don't
// (errors, redirects, noindex, another canonical, blocked by robots.txt).
// It never fetches anything itself: every request goes through the `fetchPage` passed in by
// the Worker, which applies the address rules and limits.

export type Fetched = {
  status: number;
  url: string; // final address after redirects
  type: string;
  lastModified: string | null;
  robotsHeader: string | null;
  text: string;
};
export type Fetcher = (url: string, accept: string) => Promise<Fetched | null>;

type Kind = 'error' | 'redirect' | 'noindex' | 'canonical' | 'robots';
export type Problem = { url: string; kind: Kind; status?: number; to?: string; from?: string };
export type SitemapPage = { url: string; lastmod: string | null };

export const MAX_PAGES = 100;
const PARALLEL = 4;
const TIME_BUDGET_MS = 25_000;

const SKIP_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|pdf|zip|gz|tgz|rar|7z|dmg|exe|msi|apk|ipa|mp4|webm|mov|mp3|wav|ogg|m4a|css|js|mjs|map|json|xml|txt|rss|atom|woff2?|ttf|otf|eot|csv|xlsx?|docx?|pptx?|wasm)$/i;

export async function crawl(firstHtml: string, firstUrl: string, firstHeaders: Headers, firstStatus: number, fetchPage: Fetcher) {
  const start = new URL(firstUrl);
  const origin = start.origin;
  const started = Date.now();

  // robots.txt: we skip what it blocks, and build the new one from it.
  const robotsRes = await fetchPage(`${origin}/robots.txt`, 'text/plain,*/*;q=0.1');
  const robotsText = robotsRes && robotsRes.status === 200 && !/html/i.test(robotsRes.type) && !/^\s*</.test(robotsRes.text) ? robotsRes.text : null;
  const rules = robotsText ? parseRobots(robotsText) : [];
  const sitemapLines = robotsText ? [...robotsText.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]) : [];

  const pages: SitemapPage[] = [];
  const problems: Problem[] = [];
  const seen = new Set<string>(); // every address we queued or fetched
  const done = new Set<string>(); // final addresses already handled
  const queue: { url: string; from?: string }[] = [];
  let skippedQuery = 0;
  let stopped = null as 'limit' | 'time' | null;
  let fetched = 0;
  const canonicalOrigins = new Map<string, number>();

  const enqueue = (raw: string, from?: string) => {
    const u = normalize(raw, start.hostname);
    if (!u) return;
    if (u.search) {
      if (!seen.has(u.href)) skippedQuery++;
      seen.add(u.href);
      return;
    }
    if (seen.has(u.href)) return;
    seen.add(u.href);
    if (!allowed(rules, u.pathname)) {
      problems.push({ url: u.href, kind: 'robots', from });
      return;
    }
    queue.push({ url: u.href, from });
  };

  // The first page was already read by the Worker.
  seen.add(new URL(firstUrl).href);
  handle({ url: firstUrl, requested: firstUrl, status: firstStatus, html: firstHtml, lastModified: firstHeaders.get('last-modified'), robotsHeader: firstHeaders.get('x-robots-tag') });

  function handle(r: { url: string; requested: string; status: number; html: string; lastModified: string | null; robotsHeader: string | null; from?: string }) {
    const final = new URL(r.url);
    final.hash = '';
    if (done.has(final.href)) return;
    done.add(final.href);
    seen.add(final.href);

    if (r.status >= 400) {
      problems.push({ url: final.href, kind: 'error', status: r.status, from: r.from });
      return;
    }
    const head = readHead(r.html, final.href);
    for (const href of links(r.html, head.base ?? final.href)) enqueue(href, pathOf(final.href));

    if (!allowed(rules, final.pathname)) {
      problems.push({ url: final.href, kind: 'robots', from: r.from });
      return;
    }

    if (/\b(noindex|none)\b/i.test(head.robots ?? '') || /\b(noindex|none)\b/i.test(r.robotsHeader ?? '')) {
      problems.push({ url: final.href, kind: 'noindex', from: r.from });
      return;
    }
    if (head.canonical && sameExceptHost(head.canonical, final.href)) {
      // A preview or second domain whose pages point to the real site: list the real addresses.
      const c = new URL(head.canonical);
      canonicalOrigins.set(c.origin, (canonicalOrigins.get(c.origin) ?? 0) + 1);
      pages.push({ url: c.href, lastmod: head.modified ?? headerDate(r.lastModified) });
      return;
    }
    if (head.canonical && stripSlash(head.canonical) !== stripSlash(final.href)) {
      problems.push({ url: final.href, kind: 'canonical', to: head.canonical, from: r.from });
      enqueue(head.canonical, pathOf(final.href));
      return;
    }
    pages.push({ url: final.href, lastmod: head.modified ?? headerDate(r.lastModified) });
  }

  async function worker() {
    while (queue.length) {
      if (fetched + 1 >= MAX_PAGES) {
        stopped = 'limit';
        return;
      }
      if (Date.now() - started > TIME_BUDGET_MS) {
        stopped = 'time';
        return;
      }
      const next = queue.shift()!;
      fetched++;
      const res = await fetchPage(next.url, 'text/html,application/xhtml+xml');
      if (!res) {
        problems.push({ url: next.url, kind: 'error', status: 0, from: next.from });
        continue;
      }
      const final = new URL(res.url);
      final.hash = '';
      if (final.hostname !== start.hostname) {
        problems.push({ url: next.url, kind: 'redirect', to: final.href, from: next.from });
        continue;
      }
      if (final.href !== next.url) {
        problems.push({ url: next.url, kind: 'redirect', to: final.href, from: next.from });
        if (done.has(final.href) || final.search) continue;
      }
      if (res.status < 400 && !/html/i.test(res.type)) continue; // a file, not a page
      handle({ url: final.href, requested: next.url, status: res.status, html: res.text, lastModified: res.lastModified, robotsHeader: res.robotsHeader, from: next.from });
    }
  }

  // Keep 4 workers busy; a worker that finds the queue empty waits for the others to add more.
  const running = new Set<Promise<void>>();
  while (!stopped) {
    while (running.size < PARALLEL && queue.length && !stopped) {
      const p: Promise<void> = worker().finally(() => running.delete(p));
      running.add(p);
    }
    if (!running.size) break;
    await Promise.race(running);
  }
  await Promise.all(running);

  pages.sort((a, b) => depth(a.url) - depth(b.url) || a.url.localeCompare(b.url));
  const left = queue.length;
  // If most pages point to another domain (say a preview deploy pointing to the real site),
  // that's the address the files are for, so every page is listed there.
  const [top, votes] = [...canonicalOrigins].sort((a, b) => b[1] - a[1])[0] ?? [origin, 0];
  const siteOrigin = votes * 2 >= pages.length ? top : origin;
  const listed = pages.map((p) => (siteOrigin !== origin && p.url.startsWith(`${origin}/`) ? { ...p, url: siteOrigin + p.url.slice(origin.length) } : p));
  const unique = listed.filter((p, i) => listed.findIndex((q) => q.url === p.url) === i);
  return {
    origin,
    siteOrigin,
    pages: unique,
    problems: dedupeProblems(problems),
    robots: { found: robotsText !== null, text: robotsText, sitemaps: sitemapLines, blocksAll: rules.some((r) => !r.allow && r.path === '/') && !allowed(rules, '/') },
    framework: detectFramework(firstHtml),
    stopped: stopped ?? (left ? 'limit' : null),
    notCrawled: left,
    skippedQuery,
  };
}

// Same host only, no fragments, no files.
function normalize(raw: string, host: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.hostname !== host) return null;
  if (SKIP_EXT.test(u.pathname) || u.pathname.startsWith('/cdn-cgi/')) return null;
  u.hash = '';
  return u;
}

function links(html: string, base: string): string[] {
  const out: string[] = [];
  // Links inside scripts, styles and comments aren't links a search engine follows.
  const body = html.replace(/<!--[\s\S]*?-->|<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '');
  for (const m of body.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi)) {
    const href = decode((m[1] ?? m[2] ?? m[3] ?? '').trim());
    if (!href || /^(mailto|tel|javascript|data|sms):/i.test(href) || href.startsWith('#')) continue;
    if (/\brel\s*=\s*["']?[^"'>]*\bnofollow\b/i.test(m[0])) continue;
    try {
      out.push(new URL(href, base).href);
    } catch {
      /* not an address */
    }
  }
  return out;
}

function readHead(html: string, pageUrl: string) {
  const tags = html.match(/<(meta|link|base)\b[^>]*>/gi) ?? [];
  const attr = (tag: string, name: string) => {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return m ? decode(m[1] ?? m[2] ?? m[3] ?? '') : null;
  };
  let robots: string | null = null;
  let canonical: string | null = null;
  let modified: string | null = null;
  let base: string | null = null;
  for (const t of tags) {
    if (/^<base/i.test(t) && !base) {
      const h = attr(t, 'href');
      if (h) try { base = new URL(h, pageUrl).href; } catch { /* ignore */ }
    } else if (/^<link/i.test(t) && !canonical && /\brel\s*=\s*["']?canonical\b/i.test(t)) {
      const h = attr(t, 'href');
      if (h) try { canonical = new URL(h, base ?? pageUrl).href.replace(/#.*$/, ''); } catch { /* ignore */ }
    } else if (/^<meta/i.test(t)) {
      const name = (attr(t, 'name') ?? attr(t, 'property') ?? '').toLowerCase();
      const content = attr(t, 'content');
      if (!content) continue;
      if (name === 'robots' || name === 'googlebot') robots = `${robots ?? ''} ${content}`;
      if (!modified && /^(article:modified_time|og:updated_time|last-modified|dcterms\.modified)$/.test(name)) modified = isoDate(content);
    }
  }
  return { robots, canonical, modified, base };
}

function headerDate(v: string | null): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  // Servers that build each page on request say "modified just now", which isn't useful.
  if (Number.isNaN(t) || Math.abs(Date.now() - t) < 3_600_000) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function isoDate(v: string): string | null {
  const t = Date.parse(v);
  if (Number.isNaN(t) || t > Date.now() + 86_400_000) return null;
  return new Date(t).toISOString().slice(0, 10);
}

// robots.txt rules for "User-agent: *" (longest match wins, Allow wins a tie).
type Rule = { allow: boolean; path: string };
function parseRobots(txt: string): Rule[] {
  const rules: Rule[] = [];
  let agents: string[] = [];
  let inRules = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (inRules) agents = [];
      inRules = false;
      agents.push(val.toLowerCase());
    } else if (key === 'allow' || key === 'disallow') {
      inRules = true;
      if (agents.includes('*') && val) rules.push({ allow: key === 'allow', path: val });
    }
  }
  return rules;
}

function allowed(rules: Rule[], path: string): boolean {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!matches(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
}

function detectFramework(html: string): string {
  const gen = (html.match(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)/i)?.[1] ?? '').toLowerCase();
  if (/__NEXT_DATA__|\/_next\//.test(html)) return 'next';
  if (gen.startsWith('astro') || /\bastro-island\b|\/_astro\//.test(html)) return 'astro';
  if (/\/_nuxt\/|__NUXT__/.test(html)) return 'nuxt';
  if (/__sveltekit|\/_app\/immutable\//.test(html)) return 'sveltekit';
  if (gen.includes('wordpress') || /\/wp-content\//.test(html)) return 'wordpress';
  if (/<script[^>]+type=["']module["'][^>]+src=["'][^"']*\/assets\/index-[\w-]+\.js/i.test(html)) return 'vite';
  return 'other';
}

function dedupeProblems(list: Problem[]): Problem[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const k = `${p.kind} ${p.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const depth = (u: string) => new URL(u).pathname.split('/').filter(Boolean).length;
const stripSlash = (u: string) => u.replace(/\/$/, '');
const sameExceptHost = (a: string, b: string) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host !== y.host && stripSlash(x.pathname + x.search) === stripSlash(y.pathname + y.search);
  } catch {
    return false;
  }
};
const pathOf = (u: string) => {
  const x = new URL(u);
  return x.pathname + x.search;
};
const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
