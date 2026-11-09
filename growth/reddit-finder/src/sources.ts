import type { Env } from './env';

export interface FoundPost {
  id: string;
  source: 'reddit' | 'hn';
  url: string;
  title: string;
  body: string;
  community: string;
  author: string;
  postedAt: number; // unix seconds
  query: string;
}

/** Reddit asks every client for a descriptive User-Agent. */
export const USER_AGENT = 'web:darnly-thread-finder:0.1 (personal read-only search for darnly.dev)';

const WEEK = 7 * 24 * 3600;

/** Strips HTML tags and decodes the handful of entities Reddit and HN use. */
export function plainText(html: string): string {
  return decodeEntities(
    decodeEntities(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/** Parses Reddit's Atom search feed (https://www.reddit.com/search.rss). */
export function parseRedditAtom(xml: string, query: string): FoundPost[] {
  const out: FoundPost[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1] ?? '';
    const pick = (re: RegExp) => e.match(re)?.[1] ?? '';
    const id = pick(/<id>([^<]+)<\/id>/);
    if (!id.startsWith('t3_')) continue; // posts only
    const link = pick(/<link href="([^"]+)"/);
    const updated = pick(/<(?:published|updated)>([^<]+)</);
    out.push({
      id: `reddit:${id}`,
      source: 'reddit',
      url: decodeEntities(link),
      title: plainText(pick(/<title>([\s\S]*?)<\/title>/)),
      body: plainText(pick(/<content type="html">([\s\S]*?)<\/content>/)).slice(0, 4000),
      community: pick(/<category term="([^"]+)"/),
      author: pick(/<name>\/u\/([^<]+)<\/name>/),
      postedAt: Math.floor(Date.parse(updated) / 1000) || Math.floor(Date.now() / 1000),
      query,
    });
  }
  return out;
}

interface RedditListing {
  data?: { children?: { kind: string; data: { name: string; title: string; selftext?: string; subreddit: string; author: string; permalink: string; created_utc: number } }[] };
}

export function parseRedditJson(body: RedditListing, query: string): FoundPost[] {
  return (body.data?.children ?? [])
    .filter((c) => c.kind === 't3')
    .map(({ data: d }) => ({
      id: `reddit:${d.name}`,
      source: 'reddit' as const,
      url: `https://www.reddit.com${d.permalink}`,
      title: d.title,
      body: (d.selftext ?? '').slice(0, 4000),
      community: d.subreddit,
      author: d.author,
      postedAt: Math.floor(d.created_utc),
      query,
    }));
}

async function redditToken(env: Env): Promise<string | null> {
  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) return null;
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Reddit sign-in failed (${res.status})`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('Reddit sign-in returned no token');
  return body.access_token;
}

/** Runs every Reddit search. Uses the Reddit API when an app is set up, else the public feed. */
export async function searchReddit(env: Env, queries: string[]): Promise<FoundPost[]> {
  const token = await redditToken(env);
  const posts: FoundPost[] = [];
  let failures = 0;
  let lastError = '';
  for (const q of queries) {
    const params = new URLSearchParams({ q, sort: 'new', t: 'week', limit: '25', type: 'link' });
    const res = token
      ? await fetch(`https://oauth.reddit.com/search?${params}&raw_json=1`, { headers: { authorization: `Bearer ${token}`, 'user-agent': USER_AGENT } })
      : await fetch(`https://www.reddit.com/search.rss?${params}`, { headers: { 'user-agent': USER_AGENT, accept: 'application/atom+xml' } });
    if (!res.ok) {
      failures++;
      lastError = `Reddit answered ${res.status}${res.status === 403 || res.status === 429 ? ' (blocked or rate limited)' : ''}`;
      if (res.status === 403 || res.status === 429) break; // blocked or over the limit: the other searches will be too
      continue;
    }
    posts.push(...(token ? parseRedditJson((await res.json()) as RedditListing, q) : parseRedditAtom(await res.text(), q)));
  }
  if (failures > 0 && posts.length === 0) throw new Error(lastError);
  const weekAgo = Date.now() / 1000 - WEEK;
  return posts.filter((p) => p.postedAt >= weekAgo);
}

interface HnHit {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  author: string;
  created_at_i: number;
  story_id?: number | null;
}

export function parseHn(body: { hits?: HnHit[] }, query: string): FoundPost[] {
  return (body.hits ?? []).map((h) => ({
    id: `hn:${h.objectID}`,
    source: 'hn' as const,
    url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    title: h.title ?? (h.story_title ? `Comment on: ${h.story_title}` : 'Hacker News comment'),
    body: plainText(h.story_text ?? h.comment_text ?? '').slice(0, 4000),
    community: 'Hacker News',
    author: h.author,
    postedAt: h.created_at_i,
    query,
  }));
}

/** Hacker News search through Algolia's free public API (no key needed). */
export async function searchHn(queries: string[]): Promise<FoundPost[]> {
  const since = Math.floor(Date.now() / 1000) - WEEK;
  const posts: FoundPost[] = [];
  for (const q of queries) {
    const params = new URLSearchParams({ query: q, tags: '(story,comment)', numericFilters: `created_at_i>${since}`, hitsPerPage: '20' });
    const res = await fetch(`https://hn.algolia.com/api/v1/search_by_date?${params}`, { headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Hacker News search answered ${res.status}`);
    posts.push(...parseHn((await res.json()) as { hits?: HnHit[] }, q));
  }
  return posts;
}

/**
 * Reddit allows only a few searches a minute without an API app, so each run takes
 * the next few searches in turn. With 20 searches and 5 a run, each one runs every 4 hours.
 */
export function searchesForThisRun(all: string[], perRun: number, at = Date.now()): string[] {
  if (perRun >= all.length) return all;
  const groups = Math.ceil(all.length / perRun);
  const g = Math.floor(at / 3_600_000) % groups;
  return all.slice(g * perRun, g * perRun + perRun);
}
