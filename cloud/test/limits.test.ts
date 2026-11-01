import { SELF, env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '../src/bugs';
import { CAPS, PAUSE_KEY, billingMonth, today } from '../src/limits';
import { PRICES, checkSpend, estimateUsd, type Usage } from '../src/spend';

const BASE = 'https://api.darnly.dev';
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const e = env as never as { DB: D1Database; OAUTH_KV: KVNamespace };

async function signIn(email: string): Promise<{ token: string; userId: string }> {
  const res = await SELF.fetch(`${BASE}/v1/auth/google`, { method: 'POST', body: JSON.stringify({ devEmail: email }) });
  const { token } = (await res.json()) as { token: string };
  const row = await e.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  return { token, userId: row!.id };
}

function upload(token: string) {
  const form = new FormData();
  form.set('meta', JSON.stringify({ title: 'Bug', pageUrl: 'https://example.com/' }));
  form.set('report', '# Bug');
  form.set('picture', new File([PNG], 'picture.png', { type: 'image/png' }));
  return SELF.fetch(`${BASE}/v1/bugs`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
}

async function setUsage(scope: string, uploads: number, bytes = 0, signups = 0) {
  await e.DB.prepare('INSERT OR REPLACE INTO usage (scope, day, uploads, bytes, signups) VALUES (?, ?, ?, ?, ?)').bind(scope, today(), uploads, bytes, signups).run();
}

afterEach(async () => {
  await e.DB.prepare("DELETE FROM usage WHERE scope = '*'").run();
  await e.OAUTH_KV.delete(PAUSE_KEY);
});

describe('usage limits', () => {
  it('stops a user at the daily cap, and deleting bugs does not reset it', async () => {
    const { token, userId } = await signIn('daily@example.com');
    expect((await upload(token)).status).toBe(201);
    await setUsage(userId, CAPS.userUploadsPerDay);
    const refused = await upload(token);
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: string }).error).toBe('daily_limit');
    await SELF.fetch(`${BASE}/v1/bugs`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    expect((await upload(token)).status).toBe(429);
  });

  it('stops everyone at the daily ceiling, without counting it against the user', async () => {
    const { token } = await signIn('busy@example.com');
    await setUsage('*', CAPS.allUploadsPerDay);
    const res = await upload(token);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('cloud_busy');
  });

  it('stops a user whose stored bugs reach 1 GB', async () => {
    const { token, userId } = await signIn('storage@example.com');
    expect((await upload(token)).status).toBe(201);
    await e.DB.prepare('UPDATE bugs SET bytes = ? WHERE user_id = ?').bind(CAPS.userStoredBytes, userId).run();
    const res = await upload(token);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe('storage_full');
  });

  it('records the size of each bug', async () => {
    const { token, userId } = await signIn('size@example.com');
    await upload(token);
    const row = await e.DB.prepare('SELECT bytes FROM bugs WHERE user_id = ?').bind(userId).first<{ bytes: number }>();
    expect(row!.bytes).toBe('# Bug'.length + PNG.byteLength);
  });

  it('refuses new accounts over the daily sign-up ceiling, but lets existing users in', async () => {
    await signIn('existing@example.com');
    await setUsage('*', 0, 0, CAPS.allSignupsPerDay);
    const res = await SELF.fetch(`${BASE}/v1/auth/google`, { method: 'POST', body: JSON.stringify({ devEmail: 'brand-new@example.com' }) });
    expect(res.status).toBe(503);
    const again = await SELF.fetch(`${BASE}/v1/auth/google`, { method: 'POST', body: JSON.stringify({ devEmail: 'existing@example.com' }) });
    expect(again.status).toBe(200);
  });

  it('pauses uploads and sign-ups while the spend meter says so, only for this month', async () => {
    const { token } = await signIn('paused@example.com');
    await e.OAUTH_KV.put(PAUSE_KEY, billingMonth(Date.now()));
    const res = await upload(token);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('uploads_paused');
    // Reading and fixing still work.
    expect((await SELF.fetch(`${BASE}/v1/bugs`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    await e.OAUTH_KV.put(PAUSE_KEY, '2020-01');
    expect((await upload(token)).status).toBe(201);
  });

  it('cleans up more than 1,000 old fixed bugs in one run', async () => {
    const { userId } = await signIn('lots@example.com');
    const old = Date.now() - 40 * 86_400_000;
    const stmts = Array.from({ length: 1050 }, (_, i) =>
      e.DB.prepare("INSERT INTO bugs (id, user_id, title, page_url, site, status, has_logs, files_prefix, created_at, fixed_at) VALUES (?, ?, 'x', 'u', 's', 'fixed', 0, ?, ?, ?)")
        .bind(`b_old${String(i).padStart(12, '0')}`, userId, `u/${userId}/old${i}/`, old, old),
    );
    for (let i = 0; i < stmts.length; i += 100) await e.DB.batch(stmts.slice(i, i + 100));
    expect(await cleanup(env as never)).toBeGreaterThanOrEqual(1050);
    const left = await e.DB.prepare('SELECT COUNT(*) AS n FROM bugs WHERE user_id = ?').bind(userId).first<{ n: number }>();
    expect(left!.n).toBe(0);
  });

  it('treats a bad list limit as the default', async () => {
    const { token } = await signIn('nan@example.com');
    expect((await SELF.fetch(`${BASE}/v1/bugs?limit=abc`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
  });
});

describe('spend meter', () => {
  const zero: Usage = { requests: 0, cpuMs: 0, r2ClassA: 0, r2ClassB: 0, r2StorageGB: 0, d1RowsRead: 0, d1RowsWritten: 0, kvReads: 0, kvWrites: 0, kvDeletes: 0, kvLists: 0 };

  it('prices usage above what the plan includes', () => {
    expect(estimateUsd(zero)).toBe(0);
    expect(estimateUsd({ ...zero, requests: PRICES.requests.included })).toBe(0);
    expect(estimateUsd({ ...zero, r2ClassA: 11_000_000 })).toBe(45); // 10M over at $4.50
    expect(estimateUsd({ ...zero, r2StorageGB: 610 })).toBe(9); // 600 GB over at $0.015
    expect(estimateUsd({ ...zero, d1RowsWritten: 150_000_000 })).toBe(100);
  });

  function fakeCloudflare(classA: number) {
    const calls: { url: string; method: string }[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.endsWith('/graphql')) {
        const { query } = JSON.parse(String(init?.body)) as { query: string };
        const key = /accounts\(filter: \{ accountTag: \$acct \}\) \{ (\w+):/.exec(query)![1]!;
        if (key === 'kv') return Response.json({ errors: [{ message: 'unknown field' }] });
        const parts: Record<string, unknown> = {
          workers: [{ sum: { requests: 1000, cpuTimeUs: 5000 } }],
          r2ops: [{ sum: { requests: classA }, dimensions: { actionType: 'PutObject' } }, { sum: { requests: 99_000_000 }, dimensions: { actionType: 'DeleteObject' } }],
          r2store: [],
          d1: [],
        };
        return Response.json({ data: { viewer: { accounts: [{ [key]: parts[key] }] } } });
      }
      if (url.includes('/workers/domains?')) return Response.json({ result: [{ id: 'dom1', hostname: 'api.darnly.dev', service: 'darnly-cloud' }, { id: 'dom2', hostname: 'darnly.dev', service: 'darnly-dev' }] });
      return Response.json({ success: true });
    };
    return { calls, fetcher };
  }

  const configured = () => ({ ...(env as object), CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'a', SPEND_PAUSE_USD: '50', SPEND_STOP_USD: '85', WORKER_NAME: 'darnly-cloud' }) as never;

  it('does nothing without a token', async () => {
    expect((await checkSpend(env as never)).action).toBe('not_configured');
  });

  it('leaves things alone under the pause line', async () => {
    const { fetcher } = fakeCloudflare(2_000_000); // $4.50
    const r = await checkSpend(configured(), Date.now(), fetcher);
    expect(r).toMatchObject({ usd: 4.5, action: 'none' });
    expect(r.missing).toEqual(['kv (200: unknown field)']);
    expect(await e.OAUTH_KV.get(PAUSE_KEY)).toBeNull();
  });

  it('pauses uploads at the pause line', async () => {
    const { fetcher, calls } = fakeCloudflare(13_000_000); // $54
    const r = await checkSpend(configured(), Date.now(), fetcher);
    expect(r.action).toBe('paused');
    expect(await e.OAUTH_KV.get(PAUSE_KEY)).toBe(billingMonth(Date.now()));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('takes only this Worker offline at the stop line', async () => {
    const { fetcher, calls } = fakeCloudflare(21_000_000); // $90
    const r = await checkSpend(configured(), Date.now(), fetcher);
    expect(r.action).toBe('offline');
    const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
    expect(deletes).toEqual(['https://api.cloudflare.com/client/v4/accounts/a/workers/domains/dom1']);
  });

  it('reports an analytics failure without acting', async () => {
    const r = await checkSpend(configured(), Date.now(), async () => Response.json({ errors: [{ message: 'no access' }] }, { status: 403 }));
    expect(r.action).toBe('error');
    expect(await e.OAUTH_KV.get(PAUSE_KEY)).toBeNull();
  });
});

describe('per-IP rate limit', () => {
  it('slows down one address that signs in too often', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const res = await SELF.fetch(`${BASE}/v1/auth/google`, { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ devEmail: 'ratelimited@example.com' }) });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // Another address is unaffected.
    const other = await SELF.fetch(`${BASE}/v1/auth/google`, { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.10' }, body: JSON.stringify({ devEmail: 'ratelimited@example.com' }) });
    expect(other.status).toBe(200);
  });
});
