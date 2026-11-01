import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { cleanup } from '../src/bugs';

const BASE = 'https://api.darnly.dev';
// A tiny valid PNG (1x1).
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));

async function signIn(email: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/v1/auth/google`, { method: 'POST', body: JSON.stringify({ devEmail: email }) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

function upload(token: string, opts: { picture?: Uint8Array; report?: string; title?: string; clientId?: string } = {}) {
  const form = new FormData();
  form.set('meta', JSON.stringify({ title: opts.title ?? 'Pay now does nothing', pageUrl: 'https://counterdraft.com/checkout?x=1', clientId: opts.clientId }));
  form.set('report', new File([opts.report ?? '# Bug on /checkout: PayButton\n\n**Expected:** Pay now opens the form'], 'report.md', { type: 'text/markdown' }));
  form.set('picture', new File([opts.picture ?? PNG], 'picture.png', { type: 'image/png' }));
  form.set('logs', '{"entries":[]}');
  return SELF.fetch(`${BASE}/v1/bugs`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
}

const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe('cloud inbox API', () => {
  it('refuses requests without a session', async () => {
    expect((await SELF.fetch(`${BASE}/v1/bugs`)).status).toBe(401);
    expect((await SELF.fetch(`${BASE}/v1/bugs`, auth('not-a-real-token-but-long-enough'))).status).toBe(401);
  });

  it('refuses a Google token login when the token is not ours', async () => {
    const res = await SELF.fetch(`${BASE}/v1/auth/google`, { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  it('uploads, lists, reads, serves the picture and marks fixed', async () => {
    const token = await signIn('maruthi@example.com');
    const res = await upload(token);
    expect(res.status).toBe(201);
    const bug = (await res.json()) as { id: string; status: string; site: string };
    expect(bug.id).toMatch(/^b_[a-z0-9]{16}$/);
    expect(bug.status).toBe('waiting');
    expect(bug.site).toBe('counterdraft.com');

    const list = (await (await SELF.fetch(`${BASE}/v1/bugs?status=waiting`, auth(token))).json()) as { bugs: { id: string }[] };
    expect(list.bugs.map((b) => b.id)).toEqual([bug.id]);

    const full = (await (await SELF.fetch(`${BASE}/v1/bugs/${bug.id}`, auth(token))).json()) as { report: string; logs: string };
    expect(full.report).toContain('**Expected:** Pay now opens the form');
    expect(full.logs).toBe('{"entries":[]}');

    const pic = await SELF.fetch(`${BASE}/v1/bugs/${bug.id}/picture`, auth(token));
    expect(pic.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await pic.arrayBuffer())).toEqual(PNG);

    const fixed = await SELF.fetch(`${BASE}/v1/bugs/${bug.id}/fixed`, {
      method: 'POST',
      ...auth(token),
      body: JSON.stringify({ note: 'made Pay now clickable in PayButton.tsx' }),
    });
    expect(((await fixed.json()) as { status: string; fixedNote: string }).fixedNote).toBe('made Pay now clickable in PayButton.tsx');
    const fixedList = (await (await SELF.fetch(`${BASE}/v1/bugs?status=fixed`, auth(token))).json()) as { bugs: { id: string }[] };
    expect(fixedList.bugs).toHaveLength(1);
    const waiting = (await (await SELF.fetch(`${BASE}/v1/bugs?status=waiting`, auth(token))).json()) as { bugs: unknown[] };
    expect(waiting.bugs).toHaveLength(0);
  });

  it('never shows one person another person’s bug', async () => {
    const alice = await signIn('alice@example.com');
    const bob = await signIn('bob@example.com');
    const bug = (await (await upload(alice)).json()) as { id: string };
    expect((await SELF.fetch(`${BASE}/v1/bugs/${bug.id}`, auth(bob))).status).toBe(404);
    expect((await SELF.fetch(`${BASE}/v1/bugs/${bug.id}/picture`, auth(bob))).status).toBe(404);
    expect((await SELF.fetch(`${BASE}/v1/bugs/${bug.id}/fixed`, { method: 'POST', ...auth(bob), body: '{}' })).status).toBe(404);
    const list = (await (await SELF.fetch(`${BASE}/v1/bugs`, auth(bob))).json()) as { bugs: unknown[] };
    expect(list.bugs).toHaveLength(0);
    // Bob deleting "all" his bugs leaves Alice's alone.
    await SELF.fetch(`${BASE}/v1/bugs`, { method: 'DELETE', ...auth(bob) });
    expect((await SELF.fetch(`${BASE}/v1/bugs/${bug.id}`, auth(alice))).status).toBe(200);
  });

  it('saves a capture once, however many times Save is pressed', async () => {
    const token = await signIn('clicks-save-a-lot@example.com');
    const clientId = 'c0ffee00-1111-4222-8333-444455556666';
    const first = (await (await upload(token, { clientId })).json()) as { id: string };
    // A second press after the first finished, then three at once while nothing has finished.
    const again = (await (await upload(token, { clientId })).json()) as { id: string };
    const burst = await Promise.all([1, 2, 3].map(() => upload(token, { clientId: 'burst-' + clientId })));
    const burstIds = new Set(await Promise.all(burst.map(async (r) => ((await r.json()) as { id: string }).id)));
    expect(again.id).toBe(first.id);
    expect(burstIds.size).toBe(1);
    const list = (await (await SELF.fetch(`${BASE}/v1/bugs`, auth(token))).json()) as { bugs: { id: string }[] };
    expect(list.bugs).toHaveLength(2);
    // Without an id (older extension builds) every upload is still its own bug.
    await upload(token);
    await upload(token);
    const after = (await (await SELF.fetch(`${BASE}/v1/bugs`, auth(token))).json()) as { bugs: { id: string }[] };
    expect(after.bugs).toHaveLength(4);
  });

  it('accepts a bug without a picture', async () => {
    const token = await signIn('nopic@example.com');
    const form = new FormData();
    form.set('meta', JSON.stringify({ title: 'No screenshot', pageUrl: 'https://example.com/' }));
    form.set('report', '# Bug');
    const res = await SELF.fetch(`${BASE}/v1/bugs`, { method: 'POST', ...auth(token), body: form });
    expect(res.status).toBe(201);
    const bug = (await res.json()) as { id: string };
    expect((await SELF.fetch(`${BASE}/v1/bugs/${bug.id}/picture`, auth(token))).status).toBe(404);
  });

  it('refuses pictures that are not PNG or are too big', async () => {
    const token = await signIn('limits@example.com');
    expect((await upload(token, { picture: new TextEncoder().encode('<svg>not a png</svg>') })).status).toBe(415);
    const big = new Uint8Array(5 * 1024 * 1024 + 10);
    big.set(PNG.slice(0, 8));
    expect((await upload(token, { picture: big })).status).toBe(413);
    const form = new FormData();
    form.set('meta', JSON.stringify({ title: 'x', pageUrl: 'https://a.example/' }));
    form.set('report', '# x');
    form.set('reference', new File([new TextEncoder().encode('not a png')], 'r.png', { type: 'image/png' }));
    expect((await SELF.fetch(`${BASE}/v1/bugs`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form })).status).toBe(415);
  });

  it('deletes all bugs and files, and deleting the account signs out', async () => {
    const token = await signIn('delete@example.com');
    const bug = (await (await upload(token)).json()) as { id: string };
    const del = (await (await SELF.fetch(`${BASE}/v1/bugs`, { method: 'DELETE', ...auth(token) })).json()) as { deleted: number };
    expect(del.deleted).toBe(1);
    const left = await env.FILES.list({ prefix: 'u/' });
    expect(left.objects.filter((o) => o.key.includes(bug.id))).toHaveLength(0);
    await SELF.fetch(`${BASE}/v1/me`, { method: 'DELETE', ...auth(token) });
    expect((await SELF.fetch(`${BASE}/v1/me`, auth(token))).status).toBe(401);
  });

  it('cleans up fixed bugs after 30 days, and keeps waiting ones', async () => {
    const token = await signIn('cleanup@example.com');
    const a = (await (await upload(token, { title: 'old fixed' })).json()) as { id: string };
    const b = (await (await upload(token, { title: 'still waiting' })).json()) as { id: string };
    await SELF.fetch(`${BASE}/v1/bugs/${a.id}/fixed`, { method: 'POST', ...auth(token), body: '{}' });
    expect(await cleanup(env as never, Date.now() + 29 * 86_400_000)).toBe(0);
    expect(await cleanup(env as never, Date.now() + 31 * 86_400_000)).toBeGreaterThanOrEqual(1); // storage is shared across tests in this file
    expect((await SELF.fetch(`${BASE}/v1/bugs/${a.id}`, auth(token))).status).toBe(404);
    expect((await SELF.fetch(`${BASE}/v1/bugs/${b.id}`, auth(token))).status).toBe(200);
  });

  it('answers CORS only for the extension', async () => {
    const ok = await SELF.fetch(`${BASE}/v1/bugs`, { method: 'OPTIONS', headers: { origin: 'chrome-extension://abc' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('chrome-extension://abc');
    const web = await SELF.fetch(`${BASE}/v1/bugs`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(web.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('keeps a worker export with fetch and scheduled', () => {
    expect(typeof worker.fetch).toBe('function');
    expect(typeof worker.scheduled).toBe('function');
  });
});
