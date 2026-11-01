// llms.txt generator: crawls a site with the sitemap crawler (up to 50 pages), reads each page's
// title and one-line description, and checks robots.txt for the main AI crawlers.
// The llms.txt file itself is put together in the browser, so people can edit the name and summary.
// Like the sitemap crawler, it never fetches anything itself: everything goes through `fetchPage`.

import { crawl, type Fetcher } from './sitemap';

export const LLMS_MAX_PAGES = 50;

export type LlmsPage = { url: string; title: string; description: string };
export type BotState = 'allowed' | 'blocked' | 'partly';
export type Bot = { name: string; owner: string; what: string; state: BotState; rule: 'own' | 'all' | 'none'; closed: string[] };

// The crawlers people ask about, with who runs them and what they feed.
export const AI_BOTS: { name: string; owner: string; what: string }[] = [
  { name: 'GPTBot', owner: 'OpenAI', what: 'ChatGPT and OpenAI’s models' },
  { name: 'ClaudeBot', owner: 'Anthropic', what: 'Claude' },
  { name: 'PerplexityBot', owner: 'Perplexity', what: 'Perplexity answers' },
  { name: 'Google-Extended', owner: 'Google', what: 'Gemini (not Google Search)' },
  { name: 'CCBot', owner: 'Common Crawl', what: 'the open dataset many AI models learn from' },
];

export async function llmsSite(firstHtml: string, firstUrl: string, firstHeaders: Headers, firstStatus: number, fetchPage: Fetcher) {
  const info = new Map<string, { title: string; description: string }>();
  const result = await crawl(firstHtml, firstUrl, firstHeaders, firstStatus, fetchPage, {
    maxPages: LLMS_MAX_PAGES,
    onPage: (url, html) => {
      const key = pathKey(url);
      if (!info.has(key)) info.set(key, pageText(html));
    },
  });

  const home = siteText(firstHtml);
  const pages: LlmsPage[] = result.pages.map((p) => {
    const i = info.get(pathKey(p.url)) ?? { title: '', description: '' };
    return { url: p.url, title: i.title || titleFromPath(p.url), description: i.description };
  });

  // Is there an llms.txt already? Many hosts answer a missing file with the home page, so it has to look like one.
  const existingRes = await fetchPage(`${result.origin}/llms.txt`, 'text/plain,text/markdown,*/*;q=0.1');
  const existing = existingRes && existingRes.status === 200 && !/html/i.test(existingRes.type) && /^\s*#\s/.test(existingRes.text) ? existingRes.text.slice(0, 20_000) : null;

  return {
    origin: result.origin,
    siteOrigin: result.siteOrigin,
    name: home.name,
    summary: home.summary,
    pages,
    bots: aiBots(result.robots.text),
    robots: { found: result.robots.found, text: result.robots.text },
    existing,
    framework: result.framework,
    stopped: result.stopped,
    notCrawled: result.notCrawled,
    maxPages: LLMS_MAX_PAGES,
  };
}

// ---- Reading pages ----

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeChar(parseInt(n, 16)));
const safeChar = (n: number) => (n > 31 && n < 0x10ffff ? String.fromCodePoint(n) : ' ');
const clean = (s: string) => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function metaContent(html: string, names: string[]): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const n = (attr(tag, 'name') ?? attr(tag, 'property') ?? '').toLowerCase();
    if (!names.includes(n)) continue;
    const c = attr(tag, 'content');
    if (c && c.trim()) return clean(c);
  }
  return '';
}
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}
const tagText = (html: string, tag: string) => {
  const m = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i'));
  return m ? clean(m[1]) : '';
};

// Shorten to about one line, at a word or sentence end.
export function oneLine(s: string, max = 160): string {
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = cut.lastIndexOf('. ');
  if (stop > max * 0.5) return cut.slice(0, stop + 1);
  return cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max).replace(/[,;:\s–—-]+$/, '') + '…';
}

// The part of a title that names this page, without " | Site name" around it.
const SEP = /\s+[|·•—–-]\s+|\s+::\s+/;
function pageTitle(html: string): string {
  const t = metaContent(html, ['og:title', 'twitter:title']) || tagText(html, 'title') || tagText(html, 'h1');
  const parts = t.split(SEP).filter(Boolean);
  return oneLine(parts[0] ?? t, 90);
}

// The first real paragraph of the page's main text.
function firstParagraph(html: string): string {
  let body = html.replace(/<!--[\s\S]*?-->|<(script|style|template|noscript|svg|nav|header|footer|form|aside)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const main = body.match(/<main\b[\s\S]*?<\/main\s*>/i) ?? body.match(/<article\b[\s\S]*?<\/article\s*>/i);
  if (main) body = main[0];
  for (const m of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)) {
    const t = clean(m[1]);
    if (t.length >= 40 && !/cookie|javascript/i.test(t.slice(0, 60))) return t;
  }
  return '';
}

export function pageText(html: string): { title: string; description: string } {
  const description = metaContent(html, ['description', 'og:description', 'twitter:description']) || firstParagraph(html);
  return { title: pageTitle(html), description: description ? oneLine(description) : '' };
}

// The site's name and summary for the top of the file, from the home page.
export function siteText(html: string): { name: string; summary: string } {
  let name = metaContent(html, ['og:site_name', 'application-name', 'apple-mobile-web-app-title']);
  if (!name) {
    const t = tagText(html, 'title') || metaContent(html, ['og:title']) || tagText(html, 'h1');
    name = t.split(SEP)[0] ?? t;
  }
  const summary = metaContent(html, ['description', 'og:description', 'twitter:description']) || firstParagraph(html);
  return { name: oneLine(name, 80), summary: summary ? oneLine(summary, 300) : '' };
}

function titleFromPath(u: string): string {
  const seg = new URL(u).pathname.split('/').filter(Boolean).pop();
  if (!seg) return 'Home';
  const words = decodeURIComponent(seg).replace(/\.\w+$/, '').replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const pathKey = (u: string) => {
  const x = new URL(u);
  return (x.pathname.replace(/\/$/, '') || '/') + x.search;
};

// ---- robots.txt and AI crawlers ----

type Group = { agents: string[]; rules: { allow: boolean; path: string }[] };

export function robotsGroups(txt: string): Group[] {
  const groups: Group[] = [];
  let cur: Group | null = null;
  let inRules = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || inRules) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
        inRules = false;
      }
      cur.agents.push(val.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && cur) {
      inRules = true;
      if (val) cur.rules.push({ allow: key === 'allow', path: val });
      else if (key === 'disallow') cur.rules.push({ allow: true, path: '' }); // "Disallow:" (empty) allows everything
    }
  }
  return groups;
}

// How robots.txt treats one crawler: its own group if there is one, otherwise the "*" group.
// Blocking a few folders (like /admin) still counts as allowed; `closed` lists them.
export function botState(groups: Group[], name: string): { state: BotState; rule: Bot['rule']; closed: string[] } {
  const lower = name.toLowerCase();
  const own = groups.filter((g) => g.agents.includes(lower));
  const all = groups.filter((g) => g.agents.includes('*'));
  const use = own.length ? own : all;
  if (!use.length) return { state: 'allowed', rule: 'none', closed: [] };
  const rules = use.flatMap((g) => g.rules);
  const rule = own.length ? 'own' : 'all';
  if (!pathAllowed(rules, '/')) {
    // "Disallow: /" with a few "Allow:" lines still lets some pages through.
    return { state: rules.some((r) => r.allow && r.path.length > 1) ? 'partly' : 'blocked', rule, closed: [] };
  }
  const closed = [...new Set(rules.filter((r) => !r.allow && r.path).map((r) => r.path))].slice(0, 4);
  return { state: 'allowed', rule, closed };
}

export function aiBots(robotsText: string | null): Bot[] {
  const groups = robotsText ? robotsGroups(robotsText) : [];
  return AI_BOTS.map((b) => ({ ...b, ...botState(groups, b.name) }));
}

function pathAllowed(rules: { allow: boolean; path: string }[], path: string): boolean {
  let best: { allow: boolean; path: string } | null = null;
  for (const r of rules) {
    if (!r.path || !matches(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
}
