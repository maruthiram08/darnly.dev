import { describe, expect, it } from 'vitest';
import { sendRequest, type RequestDeps } from './request';

const deps = (over: Partial<RequestDeps>): RequestDeps => ({
  checkTarget: (raw) => new URL(raw),
  isOwnHost: () => false,
  ownPage: async () => new Response('own'),
  ...over,
});
const post = () =>
  new Request('https://darnly.dev/api/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'GET', url: 'https://example.com/' }) });

describe('API tester limits', () => {
  it('refuses once the site-wide budget is used up, before sending anything', async () => {
    let keys: string[] = [];
    const res = await sendRequest(post(), deps({
      limit: { limit: async () => ({ success: true }) },
      limitAll: { limit: async ({ key }) => (keys.push(key), { success: false }) },
    }));
    expect(res.status).toBe(429);
    expect(keys).toEqual(['all']);
    expect(((await res.json()) as { error: string }).error).toMatch(/busy/);
  });

  it('checks the visitor limit first', async () => {
    let allChecked = false;
    const res = await sendRequest(post(), deps({
      limit: { limit: async () => ({ success: false }) },
      limitAll: { limit: async () => ((allChecked = true), { success: true }) },
    }));
    expect(res.status).toBe(429);
    expect(allChecked).toBe(false);
  });
});
