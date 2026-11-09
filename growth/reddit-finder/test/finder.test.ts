import { SELF, env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHn, parseRedditAtom, plainText, searchesForThisRun } from '../src/sources';
import { worthJudging, REDDIT_QUERIES } from '../src/queries';
import { runOnce } from '../src/run';
import type { Env } from '../src/env';

const BASE = 'https://finder.example';
const now = Math.floor(Date.now() / 1000);
const iso = (s: number) => new Date(s * 1000).toISOString();

const atom = (entries: { id: string; title: string; body: string; sub: string; author: string; at: number }[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>search results</title>${entries
    .map(
      (e) =>
        `<entry><author><name>/u/${e.author}</name><uri>https://www.reddit.com/user/${e.author}</uri></author><category term="${e.sub}" label="r/${e.sub}"/><content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;${e.body}&lt;/p&gt;&lt;/div&gt;</content><id>${e.id}</id><link href="https://www.reddit.com/r/${e.sub}/comments/${e.id.slice(3)}/x/" /><updated>${iso(e.at)}</updated><published>${iso(e.at)}</published><title>${e.title}</title></entry>`,
    )
    .join('')}</feed>`;

const claudeAnswer = (v: object) =>
  new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: JSON.stringify(v) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
    { headers: { 'content-type': 'application/json' } },
  );

async function login(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/login`, { method: 'POST', body: new URLSearchParams({ key: 'test-key' }), redirect: 'manual' });
  expect(res.status).toBe(303);
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

afterEach(() => vi.restoreAllMocks());

describe('parsing', () => {
  it('reads Reddit Atom entries', () => {
    const posts = parseRedditAtom(atom([{ id: 't3_abc', title: 'Cursor keeps changing every button', body: 'I only wanted &amp;amp; one', sub: 'cursor', author: 'sam', at: now }]), 'q');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: 'reddit:t3_abc', community: 'cursor', author: 'sam', title: 'Cursor keeps changing every button', body: 'I only wanted & one' });
  });

  it('reads Hacker News hits', () => {
    const [p] = parseHn({ hits: [{ objectID: '42', comment_text: '<p>Claude Code broke my CSS</p>', story_title: 'Ask HN', author: 'pg', created_at_i: now }] }, 'q');
    expect(p).toMatchObject({ id: 'hn:42', title: 'Comment on: Ask HN', body: 'Claude Code broke my CSS', community: 'Hacker News' });
  });

  it('strips html', () => expect(plainText('a<br>b &lt;3')).toBe('a\nb <3'));

  it('only judges posts about an AI tool and something visual', () => {
    expect(worthJudging('Claude Code moved my navbar padding')).toBe(true);
    expect(worthJudging('Cursor pricing changed again')).toBe(false);
    expect(worthJudging('My CSS grid is broken')).toBe(false);
  });

  it('takes turns through the Reddit searches, 5 an hour', () => {
    const all = Array.from({ length: 20 }, (_, i) => `q${i}`);
    const hour = 3_600_000;
    expect(searchesForThisRun(all, 5, 0)).toEqual(['q0', 'q1', 'q2', 'q3', 'q4']);
    expect(searchesForThisRun(all, 5, hour)).toEqual(['q5', 'q6', 'q7', 'q8', 'q9']);
    expect(searchesForThisRun(all, 5, 4 * hour)).toEqual(['q0', 'q1', 'q2', 'q3', 'q4']);
    expect(searchesForThisRun(all, 50, 0)).toHaveLength(20);
  });

  it('has about 20 Reddit searches', () => expect(REDDIT_QUERIES.length).toBeGreaterThanOrEqual(15));
});

describe('inbox', () => {
  it('asks for the key and refuses a wrong one', async () => {
    expect(await (await SELF.fetch(`${BASE}/`)).text()).toContain('Enter the inbox key');
    const bad = await SELF.fetch(`${BASE}/login`, { method: 'POST', body: new URLSearchParams({ key: 'nope' }), redirect: 'manual' });
    expect(await bad.text()).toContain("didn't match");
  });

  it('refuses form posts from other sites', async () => {
    const cookie = await login();
    const res = await SELF.fetch(`${BASE}/run`, { method: 'POST', headers: { cookie, origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });

  it('finds, judges, shows and files posts end to end', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://www.reddit.com/search.rss')) {
        return new Response(
          atom([
            { id: 't3_fit', title: 'How do I show Claude Code which button is broken?', body: 'It keeps changing the wrong element', sub: 'ClaudeAI', author: 'alex', at: now - 600 },
            { id: 't3_off', title: 'Cursor raised prices', body: 'ugh', sub: 'cursor', author: 'bo', at: now - 600 },
            { id: 't3_mine', title: 'Claude Code css question', body: 'layout', sub: 'ClaudeAI', author: 'Maruthi', at: now - 600 },
            { id: 't3_old', title: 'Claude Code css question', body: 'layout', sub: 'ClaudeAI', author: 'old', at: now - 30 * 86400 },
          ]),
        );
      }
      if (url.startsWith('https://hn.algolia.com/')) return Response.json({ hits: [] });
      if (url.startsWith('https://api.anthropic.com/')) {
        return claudeAnswer({ fit: 9, why: 'They cannot point the agent at one button.', mention: true, draft: 'Name the exact element and file. I built a free tool for this, Darnly (darnly.dev).' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    await runOnce(env as unknown as Env);

    const rows = await env.DB.prepare('SELECT id, status, fit FROM posts ORDER BY id').all<{ id: string; status: string; fit: number | null }>();
    expect(rows.results).toEqual([
      { id: 'reddit:t3_fit', status: 'judged', fit: 9 },
      { id: 'reddit:t3_off', status: 'skipped', fit: null },
    ]);
    // Exactly one Claude call: the off-topic post was filtered by the word check, Maruthi's own and old posts dropped.
    expect(fetchSpy.mock.calls.filter(([i]) => String(i instanceof Request ? i.url : i).includes('anthropic')).length).toBe(1);

    const cookie = await login();
    const html = await (await SELF.fetch(`${BASE}/`, { headers: { cookie } })).text();
    expect(html).toContain('How do I show Claude Code which button is broken?');
    expect(html).toContain('Fit 9/10');
    expect(html).toContain('Reddit: <b>working</b>');
    expect(html).toContain('1/30 posts checked today');

    const done = await SELF.fetch(`${BASE}/post/${encodeURIComponent('reddit:t3_fit')}/replied`, { method: 'POST', headers: { cookie }, body: new URLSearchParams({ tab: 'reply' }), redirect: 'manual' });
    expect(done.headers.get('location')).toBe('/?tab=reply');
    const doneTab = await (await SELF.fetch(`${BASE}/?tab=done`, { headers: { cookie } })).text();
    expect(doneTab).toContain('Done (1)');
    expect(doneTab).toContain('replied');
  });

  it('says when Reddit is blocking us', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('reddit.com')) return new Response('blocked', { status: 403 });
      return Response.json({ hits: [] });
    });
    await runOnce(env as unknown as Env);
    const cookie = await login();
    const html = await (await SELF.fetch(`${BASE}/`, { headers: { cookie } })).text();
    expect(html).toContain('Reddit: <b>failing</b> (Reddit answered 403 (blocked or rate limited))');
    expect(html).toContain('Hacker News: <b>working</b>');
  });

  it('shows why Claude failed and runs Search now while the browser waits', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://www.reddit.com/search.rss')) {
        return new Response(atom([{ id: 't3_err', title: 'Cursor broke my navbar layout', body: 'help', sub: 'cursor', author: 'cy', at: now - 60 }]));
      }
      if (url.startsWith('https://hn.algolia.com/')) return Response.json({ hits: [] });
      if (url.startsWith('https://api.anthropic.com/')) {
        return Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }, { status: 400 });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const cookie = await login();
    const res = await SELF.fetch(`${BASE}/run`, { method: 'POST', headers: { cookie }, redirect: 'manual' });
    expect(res.status).toBe(303);
    const note = decodeURIComponent(new URL(res.headers.get('location') ?? '', BASE).searchParams.get('note') ?? '');
    expect(note).toContain('Found 1 new posts. 1 mention an AI coding tool and something visual. Claude checked 0.');
    expect(note).toContain('Claude failed: Your credit balance is too low');
    expect(note).not.toContain('invalid_request_error');
    const html = await (await SELF.fetch(`${BASE}/`, { headers: { cookie } })).text();
    expect(html).toContain('Claude: <b>failing</b>');
    expect(html).toContain('credit balance is too low');
  });
});
