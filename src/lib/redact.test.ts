import { describe, expect, it } from 'vitest';
import { HIDDEN, redactText, redactUrl } from './redact';

// Fake secrets: none of these may survive redaction.
const SECRETS = [
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  'sk-proj-abcdefghijklmnop1234567890',
  ['sk', 'live', '51HqLyjWDarjtT1zdp7dcXYZ'].join('_'), // split so GitHub's secret scanner doesn't flag a fake key
  'ghp_16C7e42F292c6912E7710c838347Ae178B4a',
  'AKIAIOSFODNN7EXAMPLE',
  'AIzaSyA-1234567890abcdefghijklmnopqrstu',
  'xoxb-123456789012-abcdefghij',
  'hunter2-password-value',
];

describe('redactText', () => {
  it('hides every fake secret in console-style messages', () => {
    for (const s of SECRETS.slice(0, 7)) {
      const out = redactText(`Request failed with key ${s} at Checkout.tsx:42`);
      expect(out, s).not.toContain(s);
      expect(out).toContain(HIDDEN);
      expect(out).toContain('Checkout.tsx:42');
    }
  });

  it('hides values of secret-named fields', () => {
    const out = redactText('{"password": "hunter2-password-value", "user": "maruthi"} token=abc12345 page=2');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('abc12345');
    expect(out).toContain('"user": "maruthi"');
    expect(out).toContain('page=2');
  });

  it('hides bearer tokens', () => {
    expect(redactText('Authorization: Bearer abc.def.ghijklmnopqrstu')).not.toContain('abc.def');
  });

  it('leaves normal errors alone', () => {
    const msg = "TypeError: Cannot read properties of undefined (reading 'id') at Checkout (Checkout.tsx:42:13)";
    expect(redactText(msg)).toBe(msg);
  });
});

describe('redactUrl', () => {
  it('hides secret query values but keeps the rest', () => {
    const out = redactUrl('http://localhost:3000/api/cart?token=abc12345&page=2&api_key=zzz999zzz');
    expect(out).toContain('page=2');
    expect(out).not.toContain('abc12345');
    expect(out).not.toContain('zzz999');
    expect(out).toContain(`token=${HIDDEN}`);
  });

  it('drops passwords in URLs and token fragments', () => {
    expect(redactUrl('https://user:pw123@example.com/x')).not.toContain('pw123');
    expect(redactUrl('https://app.com/cb#access_token=abcdef1234567890xyz&x=1')).not.toContain('abcdef1234567890xyz');
  });
});
