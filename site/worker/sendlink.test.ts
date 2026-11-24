import { describe, expect, it } from 'vitest';
import { cleanEmail, emailHtml, emailText, sendLink, STORE, type SendLinkDeps } from './sendlink';

const post = (body: unknown, origin = 'https://darnly.dev') =>
  new Request('https://darnly.dev/api/send-link', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });

function deps(over: Partial<SendLinkDeps> = {}) {
  const sent: { to: string }[] = [];
  const memory = new Set<string>();
  const d: SendLinkDeps = {
    mailer: { send: async (m) => { sent.push(m); return {}; } },
    seen: async (h) => memory.has(h),
    remember: async (h) => { memory.add(h); },
    ...over,
  };
  return { d, sent, memory };
}

describe('send-link', () => {
  it('sends one email to a valid address and keeps only a hash', async () => {
    const { d, sent, memory } = deps();
    const res = await sendLink(post({ email: ' Me@Example.com ' }), d);
    expect(res.status).toBe(200);
    expect(sent.map((m) => m.to)).toEqual(['me@example.com']);
    expect([...memory][0]).toMatch(/^[0-9a-f]{64}$/);
    expect([...memory][0]).not.toContain('example');
  });

  it('does not send twice to the same address in a day, but still says sent', async () => {
    const { d, sent } = deps();
    await sendLink(post({ email: 'me@example.com' }), d);
    const res = await sendLink(post({ email: 'ME@example.com' }), d);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it('refuses other sites, bad addresses and GET', async () => {
    const { d, sent } = deps();
    expect((await sendLink(post({ email: 'me@example.com' }, 'https://evil.com'), d)).status).toBe(403);
    expect((await sendLink(new Request('https://darnly.dev/api/send-link'), d)).status).toBe(405);
    for (const bad of ['', 'me', 'me@x', 'a b@example.com', 'me@example.c', 'x'.repeat(250) + '@example.com', 42]) {
      expect((await sendLink(post({ email: bad }), d)).status).toBe(400);
    }
    expect(sent).toHaveLength(0);
  });

  it('quietly drops bots that fill the honeypot', async () => {
    const { d, sent } = deps();
    expect((await sendLink(post({ email: 'me@example.com', website: 'spam.com' }), d)).status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it('applies the visitor limit, then the site-wide limit', async () => {
    const { d, sent } = deps({ limit: { limit: async () => ({ success: false }) } });
    expect((await sendLink(post({ email: 'me@example.com' }), d)).status).toBe(429);
    const all = deps({ limit: { limit: async () => ({ success: true }) }, limitAll: { limit: async () => ({ success: false }) } });
    expect((await sendLink(post({ email: 'me@example.com' }), all.d)).status).toBe(429);
    expect(sent.length + all.sent.length).toBe(0);
  });

  it('says email is off when there is no mailer, and 502 when sending fails', async () => {
    expect((await sendLink(post({ email: 'me@example.com' }), deps({ mailer: undefined }).d)).status).toBe(503);
    const failing = deps({ mailer: { send: async () => { throw Object.assign(new Error('x'), { code: 'E_SENDER_DOMAIN_NOT_AVAILABLE' }); } } });
    expect((await sendLink(post({ email: 'me@example.com' }), failing.d)).status).toBe(502);
    expect(failing.memory.size).toBe(0);
  });

  it('accepts ordinary addresses', () => {
    expect(cleanEmail('first.last+tag@mail.co.uk')).toBe('first.last+tag@mail.co.uk');
  });

  it('email has the store link and the three steps in both parts', () => {
    for (const body of [emailHtml(), emailText()]) {
      expect(body).toContain(STORE);
      expect(body).toContain('Option+Shift+B');
      expect(body).toContain('/darnly');
      expect(body).toContain('We don’t keep it');
    }
  });
});
