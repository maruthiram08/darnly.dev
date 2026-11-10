import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { getBug, listBugs } from '../src/bugs';
import { AI_CAPS, writeTitle } from '../src/titles';

const BASE = 'https://api.darnly.dev';
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));

async function newBug(email: string, title = 'wrong'): Promise<{ token: string; id: string; userId: string }> {
  const signIn = await SELF.fetch(`${BASE}/v1/auth/google`, { method: 'POST', body: JSON.stringify({ devEmail: email }) });
  const { token } = (await signIn.json()) as { token: string };
  const form = new FormData();
  form.set('meta', JSON.stringify({ title, pageUrl: 'https://shop.example/cart' }));
  form.set('report', new File([`# Bug on /cart\n\n**Expected:** ${title}\n\n## How to fix\nagent steps`], 'report.md'));
  form.set('picture', new File([PNG], 'picture.png', { type: 'image/png' }));
  const res = await SELF.fetch(`${BASE}/v1/bugs`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  const { id } = (await res.json()) as { id: string };
  const row = await env.DB.prepare('SELECT user_id FROM bugs WHERE id = ?').bind(id).first<{ user_id: string }>();
  return { token, id, userId: row!.user_id };
}

/** A fake Messages API that answers with this JSON (or this stop reason), and remembers the request. */
function fakeClaude(answer: object, stopReason = 'end_turn') {
  const calls: { body: any; headers: Headers }[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return new Response(
      JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: stopReason, stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const withKey = (extra: Partial<Env> = {}) => ({ ...(env as unknown as Env), ANTHROPIC_API_KEY: 'test-key', AI_TITLES: 'on', ...extra });

describe('AI bug titles', () => {
  it('is off by default (no switch, or a key but no switch), so uploads keep the note as the title', async () => {
    const { id, userId } = await newBug('nokey@example.com');
    const { fetchImpl, calls } = fakeClaude({ title: 'x', summary: 'y' });
    expect(await writeTitle(env as unknown as Env, userId, id, { report: 'r' }, fetchImpl)).toBe(false);
    expect(await writeTitle({ ...(env as unknown as Env), ANTHROPIC_API_KEY: 'k' }, userId, id, { report: 'r' }, fetchImpl)).toBe(false);
    expect(calls).toHaveLength(0);
    const bug = await getBug(env as unknown as Env, userId, id);
    expect(bug.title).toBe('wrong');
    expect(bug.aiSummary).toBeNull();
  });

  it('writes the title and summary, keeps the note, and shows both to agents', async () => {
    const { id, userId } = await newBug('titled@example.com');
    const { fetchImpl, calls } = fakeClaude({ title: 'Cart subtotal wrong:\nshows $12.00 for $36.00', summary: 'Subtotal shows $12.00 while 3 mugs cost $36.00.' });
    const e = withKey({ ANTHROPIC_WORKSPACE_ID: 'wrkspc_test' });
    expect(await writeTitle(e, userId, id, { report: '# Bug\n\n**Expected:** wrong\n\n## How to fix\nagent steps', picture: PNG.buffer as ArrayBuffer }, fetchImpl)).toBe(true);

    const req = calls[0]!;
    expect(req.body.model).toBe('claude-sonnet-5-5');
    expect(req.body.output_config.effort).toBe('low');
    expect(req.headers.get('anthropic-workspace-id')).toBe('wrkspc_test');
    expect(req.body.messages[0].content[0].type).toBe('image');
    expect(req.body.messages[0].content[1].text).not.toContain('agent steps');

    const [listed] = await listBugs(e, userId);
    expect(listed!.title).toBe('Cart subtotal wrong: shows $12.00 for $36.00');
    expect(listed!.noteTitle).toBe('wrong');
    expect(listed!.aiSummary).toBe('Subtotal shows $12.00 while 3 mugs cost $36.00.');
    const bug = await getBug(e, userId, id);
    expect(bug.report).toContain('**Expected:** wrong');
  });

  it('keeps the note title when Claude refuses or AI titles are switched off', async () => {
    const { id, userId } = await newBug('refused@example.com');
    const refused = fakeClaude({ title: 'nope', summary: '' }, 'refusal');
    expect(await writeTitle(withKey(), userId, id, { report: 'r' }, refused.fetchImpl)).toBe(false);
    const off = fakeClaude({ title: 'x', summary: 'y' });
    expect(await writeTitle(withKey({ AI_TITLES: 'off' }), userId, id, { report: 'r' }, off.fetchImpl)).toBe(false);
    expect(off.calls).toHaveLength(0);
    expect((await getBug(env as unknown as Env, userId, id)).title).toBe('wrong');
  });

  it('stops at the daily ceiling per user', async () => {
    const { id, userId } = await newBug('busy@example.com');
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare('INSERT INTO usage (scope, day, ai_titles) VALUES (?, ?, ?) ON CONFLICT (scope, day) DO UPDATE SET ai_titles = excluded.ai_titles')
      .bind(userId, day, AI_CAPS.userPerDay)
      .run();
    const { fetchImpl, calls } = fakeClaude({ title: 'x', summary: 'y' });
    expect(await writeTitle(withKey(), userId, id, { report: 'r' }, fetchImpl)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('never throws when the API fails', async () => {
    const { id, userId } = await newBug('broken@example.com');
    const failing = (async () => new Response('{"type":"error","error":{"type":"authentication_error","message":"bad"}}', { status: 401 })) as typeof fetch;
    expect(await writeTitle(withKey(), userId, id, { report: 'r' }, failing)).toBe(false);
  });
});
