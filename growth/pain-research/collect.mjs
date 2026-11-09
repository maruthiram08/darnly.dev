// Collects public Hacker News and Reddit posts/comments about UI and visual bugs
// in AI coding tools. Writes data/posts.jsonl. No API key needed.
// Usage: node collect.mjs
import fs from 'node:fs';

const UA = 'darnly-pain-research/0.1 (one-off public research)';
const SINCE = Math.floor(new Date('2025-06-01').getTime() / 1000);
const MAX_BODY = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOOL = /\b(claude code|claude|cursor|codex|lovable|bolt(\.new)?|v0|replit|windsurf|copilot|vibe ?cod\w*|ai (agent|coding|coder|assistant)|coding agent|gemini cli|firebase studio)\b/i;
const VISUAL = /\b(ui|ux|css|tailwind|layout|styl(e|es|ing)|design|button|screenshot|frontend|front-end|visual(ly)?|pixel|align\w*|spacing|padding|margin|responsive|mobile view|dark mode|font|color|colour|overlap\w*|looks? (wrong|off|broken|bad|ugly)|component|element|modal|navbar|header|footer|dropdown|z-index|shadcn|figma|page)\b/i;

function plain(html = '') {
  return html
    .replace(/<p>/g, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&#x2F;/g, '/')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
    .trim();
}

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (res.ok) return res.json();
    if (res.status === 429) { console.log('  rate limited, waiting 60s'); await sleep(60_000); continue; }
    throw new Error(`${res.status} for ${url}`);
  }
  throw new Error(`gave up on ${url}`);
}

const items = new Map();
function add(p) {
  if (!p.body && !p.title) return;
  const text = `${p.title}\n${p.body}`;
  if (!TOOL.test(text) || !VISUAL.test(text)) return;
  p.body = (p.body || '').slice(0, MAX_BODY);
  if (!items.has(p.id)) items.set(p.id, p);
}

// ---------- Hacker News (Algolia) ----------
const HN_QUERIES = [
  'claude code ui', 'claude code css', 'claude code frontend', 'claude code screenshot', 'claude code design',
  'cursor ui', 'cursor css', 'cursor frontend', 'cursor screenshot', 'codex frontend', 'codex ui',
  'vibe coding ui', 'vibe coding design', 'vibe coded app bugs', 'lovable', 'bolt.new', 'v0 ui', 'replit agent',
  'windsurf ui', 'ai generated ui', 'ai agent frontend bugs', 'llm css', 'llm frontend', 'ai coding visual bugs',
  'agent screenshot browser', 'ai tailwind',
];

async function hn() {
  for (const q of HN_QUERIES) {
    for (const tags of ['story', 'comment']) {
      for (let page = 0; page < 3; page++) {
        const params = new URLSearchParams({ query: q, tags, numericFilters: `created_at_i>${SINCE}`, hitsPerPage: '100', page: String(page) });
        let body;
        try { body = await getJson(`https://hn.algolia.com/api/v1/search?${params}`); }
        catch (e) { console.log('  HN error:', e.message); break; }
        for (const h of body.hits ?? []) {
          add({
            id: `hn:${h.objectID}`,
            source: 'hn',
            community: 'Hacker News',
            kind: tags,
            url: `https://news.ycombinator.com/item?id=${h.objectID}`,
            thread_url: h.story_id ? `https://news.ycombinator.com/item?id=${h.story_id}` : `https://news.ycombinator.com/item?id=${h.objectID}`,
            title: h.title ?? (h.story_title ? `Comment on: ${h.story_title}` : ''),
            body: plain(h.story_text ?? h.comment_text ?? ''),
            created: h.created_at_i,
            score: h.points ?? null,
            comments: h.num_comments ?? null,
          });
        }
        if (page + 1 >= (body.nbPages ?? 0)) break;
        await sleep(300);
      }
    }
    console.log(`HN "${q}": ${items.size} kept so far`);
  }
}

// ---------- Reddit (public Atom feeds, gentle; JSON is blocked for cloud IPs) ----------
const SUBS = ['vibecoding', 'ClaudeAI', 'ClaudeCode', 'cursor', 'ChatGPTCoding', 'lovable', 'boltnewbuilders', 'replit',
  'windsurf', 'VibeCodeDevs', 'SideProject', 'nocode', 'OpenAI', 'webdev', 'codex', 'vibecodingcommunity'];
const RQ = [
  { q: 'UI OR CSS OR layout OR styling OR design', sort: 'relevance', t: 'year' },
  { q: 'screenshot OR button OR frontend OR "looks wrong" OR visual OR "wrong element"', sort: 'relevance', t: 'year' },
];
const REDDIT_DELAY = 7000;
const THREADS_PER_QUERY = 3;

async function getText(url) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/atom+xml' } });
    if (res.ok) return res.text();
    if (res.status === 429) { console.log('  rate limited, waiting 60s'); await sleep(60_000); continue; }
    throw new Error(`${res.status} for ${url}`);
  }
  throw new Error(`gave up on ${url}`);
}

function entries(xml) {
  return xml.split('<entry>').slice(1).map((e) => {
    const g = (re) => (e.match(re) ?? [])[1] ?? '';
    const html = g(/<content type="html">([\s\S]*?)<\/content>/).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    return {
      id: g(/<id>([^<]+)<\/id>/),
      link: g(/<link href="([^"]+)"/),
      title: plain(g(/<title>([\s\S]*?)<\/title>/)),
      body: plain(html.replace(/<!-- SC_O(N|FF) -->/g, '')).replace(/submitted by\s+\/u\/\S+[\s\S]*$/, '').trim(),
      updated: Date.parse(g(/<(?:published|updated)>([^<]+)<\/(?:published|updated)>/)) / 1000,
      sub: g(/<category term="([^"]+)"/),
    };
  });
}

async function reddit() {
  const threads = new Map();
  for (const sub of SUBS) {
    for (const r of RQ) {
      const params = new URLSearchParams({ q: r.q, restrict_sr: '1', sort: r.sort, t: r.t, limit: '100' });
      try {
        const xml = await getText(`https://www.reddit.com/r/${sub}/search.rss?${params}`);
        let n = 0;
        for (const e of entries(xml)) {
          if (!e.id.startsWith('t3_')) continue;
          const p = { id: `rd:${e.id}`, source: 'reddit', community: `r/${e.sub || sub}`, kind: 'post', url: e.link, thread_url: e.link, title: e.title, body: e.body, created: e.updated, score: null, comments: null };
          const before = items.size;
          add(p);
          if (items.size > before && n < THREADS_PER_QUERY) { threads.set(p.id, p); n++; }
        }
      } catch (e) { console.log(`  Reddit error on r/${sub}:`, e.message); }
      await sleep(REDDIT_DELAY);
    }
    console.log(`Reddit r/${sub}: ${items.size} kept so far`);
  }
  for (const t of threads.values()) {
    try {
      const xml = await getText(`${t.url.replace(/\/$/, '')}/.rss?limit=100`);
      for (const e of entries(xml)) {
        if (!e.id.startsWith('t1_')) continue;
        add({ id: `rd:${e.id}`, source: 'reddit', community: t.community, kind: 'comment', url: e.link, thread_url: t.url, title: `Comment on: ${t.title}`, body: e.body, created: e.updated, score: null, comments: null });
      }
    } catch (e) { console.log('  Reddit comments error:', e.message); }
    await sleep(REDDIT_DELAY);
  }
  console.log(`Reddit comments from ${threads.size} threads: ${items.size} kept so far`);
}

fs.mkdirSync('data', { recursive: true });
const stage = process.argv[2] ?? 'all';
const save = (file) => fs.writeFileSync(file, [...items.values()].filter((p) => (p.body || '').length + (p.title || '').length > 40).map((p) => JSON.stringify(p)).join('\n') + '\n');
if (stage === 'hn' || stage === 'all') { await hn(); save('data/hn.jsonl'); items.clear(); }
if (stage === 'reddit' || stage === 'all') {
  const timer = setInterval(() => save('data/reddit.jsonl'), 30_000);
  await reddit(); clearInterval(timer); save('data/reddit.jsonl');
}
const all = ['data/hn.jsonl', 'data/reddit.jsonl'].filter((f) => fs.existsSync(f)).flatMap((f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean));
fs.writeFileSync('data/posts.jsonl', all.join('\n') + '\n');
console.log(`Saved ${all.length} posts to data/posts.jsonl`);
