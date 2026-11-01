import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const BASE = 'https://api.darnly.dev';

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

/** Opens the Mac sign-in page and approves it (dev sign-in), returning the darnly:// redirect. */
async function approve(challenge: string, email: string, withCookie = true): Promise<Response> {
  const page = await SELF.fetch(`${BASE}/app/signin?challenge=${challenge}`);
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain('Sign in the Darnly Mac app?');
  const tx = /name="tx" value="([^"]+)"/.exec(html)![1]!;
  const cookie = page.headers.get('set-cookie')!.split(';')[0]!;
  return SELF.fetch(`${BASE}/authorize`, {
    method: 'POST',
    headers: { ...(withCookie ? { cookie } : {}), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ tx, devEmail: email }),
    redirect: 'manual',
  });
}

describe('Mac app sign-in', () => {
  it('signs in with a one-time code and PKCE, and the token can upload', async () => {
    const { verifier, challenge } = await pkce();
    const back = await approve(challenge, 'mac@example.com');
    expect(back.status).toBe(302);
    const loc = back.headers.get('location')!;
    expect(loc.startsWith('darnly://signed-in?code=')).toBe(true);
    const code = new URL(loc).searchParams.get('code')!;

    const ex = await SELF.fetch(`${BASE}/v1/auth/app/exchange`, { method: 'POST', body: JSON.stringify({ code, verifier }) });
    expect(ex.status).toBe(200);
    const { token, email } = (await ex.json()) as { token: string; email: string };
    expect(email).toBe('mac@example.com');
    const me = await SELF.fetch(`${BASE}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(await me.json()).toEqual({ email: 'mac@example.com' });

    // The code works once.
    const again = await SELF.fetch(`${BASE}/v1/auth/app/exchange`, { method: 'POST', body: JSON.stringify({ code, verifier }) });
    expect(again.status).toBe(400);
  });

  it('refuses a stolen code without the verifier, and burns it', async () => {
    const { verifier, challenge } = await pkce();
    const code = new URL((await approve(challenge, 'victim@example.com')).headers.get('location')!).searchParams.get('code')!;
    const other = (await pkce()).verifier;
    const bad = await SELF.fetch(`${BASE}/v1/auth/app/exchange`, { method: 'POST', body: JSON.stringify({ code, verifier: other }) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'bad_verifier' });
    const late = await SELF.fetch(`${BASE}/v1/auth/app/exchange`, { method: 'POST', body: JSON.stringify({ code, verifier }) });
    expect(late.status).toBe(400);
  });

  it('needs the cookie of the browser that saw the page', async () => {
    const { challenge } = await pkce();
    const res = await approve(challenge, 'victim@example.com', false);
    expect(res.status).toBe(400);
  });

  it('sends cancel back to the app', async () => {
    const { challenge } = await pkce();
    const page = await SELF.fetch(`${BASE}/app/signin?challenge=${challenge}`);
    const tx = /name="tx" value="([^"]+)"/.exec(await page.text())![1]!;
    const cookie = page.headers.get('set-cookie')!.split(';')[0]!;
    const res = await SELF.fetch(`${BASE}/authorize`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ tx, deny: '1' }),
      redirect: 'manual',
    });
    expect(res.headers.get('location')).toBe('darnly://signed-in?error=access_denied');
  });

  it('rejects a bad challenge', async () => {
    const res = await SELF.fetch(`${BASE}/app/signin?challenge=short`);
    expect(res.status).toBe(400);
  });
});

describe('Mac bugs in the inbox', () => {
  it('names the Mac app as the site', async () => {
    const { siteOf } = await import('../src/bugs');
    expect(siteOf('macos://Maccy')).toBe('Maccy (Mac app)');
    expect(siteOf('macos://Google%20Chrome')).toBe('Google Chrome (Mac app)');
    expect(siteOf('https://example.com/a')).toBe('example.com');
  });
});
