// Name ideas and buy links for the domain name finder. No DOM here, so it can be tested on its own.

export const MAIN_TLDS = ['com', 'dev', 'app', 'io', 'ai', 'co'];
export const MORE_TLDS = ['net', 'org', 'xyz', 'sh', 'so', 'me'];
export const ALL_TLDS = [...MAIN_TLDS, ...MORE_TLDS];

const MAX_LABEL = 30; // longer names are valid but nobody wants to type them

// "Tiny Invoice", "tinyInvoice", "tiny-invoice.com" → ["tiny", "invoice"]
export function words(input: string): string[] {
  let s = input.trim();
  // Drop a typed ending: "myapp.com" is the name "myapp".
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '');
  const dot = s.lastIndexOf('.');
  if (dot > 0 && ALL_TLDS.includes(s.slice(dot + 1).toLowerCase())) s = s.slice(0, dot);
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 4);
}

const VOWELS = /[aeiouy]/;

// "pixel" → "pix", "photo" → "phot": up to the first consonant after the first vowel.
function front(w: string): string {
  const i = w.search(VOWELS);
  if (i < 0) return w;
  let j = i + 1;
  while (j < w.length && VOWELS.test(w[j])) j++;
  return w.slice(0, Math.min(w.length, j + 1));
}

// Join two words, sharing letters where one ends how the other starts: "snap" + "app" → "snapp".
function overlap(a: string, b: string): string | null {
  for (let k = Math.min(a.length, b.length) - 1; k >= 2; k--) {
    if (a.endsWith(b.slice(0, k))) return a + b.slice(k);
  }
  return null;
}

// "-ly" and "-ify" read better without a trailing vowel: "snappy" → "snappify", "cube" → "cubely".
function stem(w: string): string {
  return w.length > 3 && /[aeiouy]$/.test(w) ? w.slice(0, -1) : w;
}

// Name ideas, most natural first. The first one is always the name as typed.
export function ideas(input: string): string[] {
  const ws = words(input);
  if (!ws.length) return [];
  const base = ws.join('');
  const out: string[] = [base];

  const blends: string[] = [];
  if (ws.length >= 2) {
    const [a, b] = [ws[0], ws[1]];
    const o = overlap(a, b);
    if (o) blends.push(o);
    if (front(a) !== a) blends.push(front(a) + b);
    blends.push(b + a);
    if (ws.length > 2) blends.push(ws.slice(1).join(''));
  } else if (/er$/.test(base) && base.length > 4) {
    blends.push(base.slice(0, -2) + 'r'); // tumbler → tumblr
  }
  // -ly and -ify only suit short single words: "snaply", "pixelify".
  const short = ws.length === 1 && base.length <= 8 ? [`${stem(base)}ly`, `${stem(base)}ify`] : [];

  const pre = (p: string) => (base.startsWith(p) ? '' : p + base);
  const suf = (x: string) => (base.endsWith(x) ? '' : base + x);
  const fix = [
    pre('get'), pre('try'), suf('app'), suf('hq'), pre('use'), suf('labs'),
    ...blends,
    pre('go'), suf('hub'), short[0], suf('kit'), pre('hey'), short[1],
    pre('join'), pre('the'), pre('my'), suf('studio'), suf('io'), suf('now'),
  ].filter((n): n is string => !!n);
  if (ws.length >= 2) fix.push(ws.join('-'));

  for (const n of fix) {
    if (n.length <= MAX_LABEL && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

export type Store = { id: string; name: string; url: (domain: string) => string };

// Plain links, no affiliate tags.
export const STORES: Store[] = [
  { id: 'cloudflare', name: 'Cloudflare', url: (d) => `https://domains.cloudflare.com/?domain=${encodeURIComponent(d)}` },
  { id: 'namecheap', name: 'Namecheap', url: (d) => `https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(d)}` },
  { id: 'porkbun', name: 'Porkbun', url: (d) => `https://porkbun.com/checkout/search?q=${encodeURIComponent(d)}` },
];

// Splits a list into chunks for the API, which takes 12 names a request.
export function chunks<T>(list: T[], size = 12): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// "2014-06-02" → "Jun 2014"
export function monthYear(day?: string): string {
  if (!day) return '';
  const [y, m] = day.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[m - 1] ? `${names[m - 1]} ${y}` : String(y);
}
