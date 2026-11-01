// UTM link builder logic, kept free of the DOM so it is easy to check.

export type Preset = { id: string; label: string; source: string; medium: string };

export const PRESETS: Preset[] = [
  { id: 'x', label: 'X', source: 'x', medium: 'social' },
  { id: 'linkedin', label: 'LinkedIn', source: 'linkedin', medium: 'social' },
  { id: 'reddit', label: 'Reddit', source: 'reddit', medium: 'social' },
  { id: 'producthunt', label: 'Product Hunt', source: 'producthunt', medium: 'referral' },
  { id: 'hackernews', label: 'Hacker News', source: 'hackernews', medium: 'referral' },
  { id: 'newsletter', label: 'Newsletter', source: 'newsletter', medium: 'email' },
];

export const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
export type Key = (typeof KEYS)[number];
export type Tags = Partial<Record<Key, string>>;

// Lowercase, dashes for spaces: "Launch Week" and "launch week" then count as one campaign.
export function tidy(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-');
}

export type Parsed = { ok: true; url: URL } | { ok: false; reason: string };

// Accepts "mysite.com/pricing" as well as a full https:// address.
export function parseUrl(input: string): Parsed {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: 'empty' };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: 'That doesn’t look like a web address. Try something like mysite.com/pricing.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'Use a web address that starts with https://.' };
  }
  const host = url.hostname;
  if (!host.includes('.') && host !== 'localhost') {
    return { ok: false, reason: 'Add the ending of your domain, like .com or .dev.' };
  }
  return { ok: true, url };
}

export type Part = { kind: 'base' | 'sep' | 'tag' | 'hash'; text: string; key?: Key; value?: string };
export type Built = { href: string; parts: Part[]; replaced: string[] };

// Builds the tagged link and the pieces the preview colors in. Other query values and the #part are kept.
export function build(url: URL, tags: Tags): Built {
  const u = new URL(url.href);
  const replaced: string[] = [];
  for (const key of [...u.searchParams.keys()]) {
    if (/^utm_/i.test(key)) {
      if (!replaced.includes(key)) replaced.push(key);
      u.searchParams.delete(key);
    }
  }
  const hash = u.hash;
  u.hash = '';
  let base = u.href;
  if (base.endsWith('?')) base = base.slice(0, -1);

  const parts: Part[] = [{ kind: 'base', text: base }];
  let sep = base.includes('?') ? '&' : '?';
  for (const key of KEYS) {
    const value = tags[key];
    if (!value) continue;
    parts.push({ kind: 'sep', text: sep });
    parts.push({ kind: 'tag', key, value, text: `${key}=${encodeURIComponent(value)}` });
    sep = '&';
  }
  if (hash) parts.push({ kind: 'hash', text: hash });
  return { href: parts.map((p) => p.text).join(''), parts, replaced };
}
