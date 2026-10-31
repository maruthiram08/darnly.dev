import { describe, expect, it } from 'vitest';
import { mergeLogs, redactLog } from './logs';

describe('mergeLogs', () => {
  it('drops old entries and duplicates seen by both page and browser', () => {
    const now = 1_000_000;
    const page = [
      { t: now - 1000, kind: 'request' as const, method: 'POST', url: 'http://x/api', status: 500 },
      { t: now - 120_000, kind: 'error' as const, message: 'old' },
    ];
    const browser = [
      { t: now - 900, kind: 'request' as const, method: 'POST', url: 'http://x/api', status: 500 },
      { t: now - 500, kind: 'request' as const, method: 'GET', url: 'http://x/logo.png', status: 404, resourceType: 'image' },
    ];
    const out = mergeLogs(page, browser, now);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ url: 'http://x/logo.png', source: 'browser' });
  });
});

describe('redactLog', () => {
  it('hides tokens in messages, urls and snippets', () => {
    const e = redactLog({
      t: 0,
      kind: 'request',
      url: 'http://localhost/api?token=abc12345',
      snippet: '{"session": "s3cr3tvalue"}',
      message: 'bad key sk-proj-abcdefghijklmnop1234567890',
    });
    expect(JSON.stringify(e)).not.toMatch(/abc12345|s3cr3tvalue|sk-proj-abcdef/);
  });
});
