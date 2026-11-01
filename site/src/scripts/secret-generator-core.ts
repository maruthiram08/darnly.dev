// Secret generator core: every value comes from crypto.getRandomValues, in the visitor's browser.
// Nothing here is sent anywhere, stored or logged.

export type Kind = 'auth' | 'jwt' | 'webhook' | 'apikey' | 'uuid' | 'password';
export type Encoding = 'base64' | 'base64url' | 'hex';

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // getRandomValues takes at most 65536 bytes per call; we never ask for more than a few hundred.
  crypto.getRandomValues(out);
  return out;
}

/** A random whole number from 0 to max - 1, with no bias (rejection sampling). */
export function randomIndex(max: number): number {
  if (max <= 0 || max > 2 ** 32) throw new Error('bad range');
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

export function encode(bytes: Uint8Array, enc: Encoding): string {
  if (enc === 'hex') return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return enc === 'base64' ? b64 : b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(length: number, alphabet: string): string {
  let s = '';
  for (let i = 0; i < length; i++) s += alphabet[randomIndex(alphabet.length)];
  return s;
}

export const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// ---- UUIDs ----

function formatUuid(b: Uint8Array): string {
  const h = encode(b, 'hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function uuidV4(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return formatUuid(b);
}

/** UUID v7 (RFC 9562): 48-bit Unix time in ms, then random bits. Sorts by creation time. */
export function uuidV7(now = Date.now()): string {
  const b = randomBytes(16);
  let t = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  return formatUuid(b);
}

// ---- Passwords ----

export interface PasswordOpts {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  /** Leave out characters that look alike: 0 O o 1 l I | */
  noLookalikes: boolean;
}

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  // No quotes, backslash, $, # or spaces: they break .env files and shell commands.
  symbols: '!%&*+-=?@^_~',
};
const LOOKALIKES = /[0Oo1lI|]/g;

export function passwordSets(o: PasswordOpts): string[] {
  const picked = (['lower', 'upper', 'digits', 'symbols'] as const).filter((k) => o[k]).map((k) => SETS[k]);
  const sets = (picked.length ? picked : [SETS.lower]).map((s) => (o.noLookalikes ? s.replace(LOOKALIKES, '') : s));
  return sets.filter((s) => s.length > 0);
}

export function password(o: PasswordOpts): string {
  const sets = passwordSets(o);
  const all = sets.join('');
  const len = Math.max(o.length, sets.length);
  // One from each chosen set, the rest from all of them, then shuffle (Fisher–Yates).
  const chars = sets.map((s) => s[randomIndex(s.length)]);
  while (chars.length < len) chars.push(all[randomIndex(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function passwordBits(o: PasswordOpts): number {
  const size = passwordSets(o).join('').length;
  return Math.max(o.length, 1) * Math.log2(size);
}

export interface Strength {
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
  crack: string;
}

/** Plain-words strength from bits of randomness. Guessing speed: 100 billion tries a second (a GPU rig, offline). */
export function strength(bits: number): Strength {
  const seconds = 2 ** (bits - 1) / 1e11;
  const crack = timeWords(seconds);
  if (bits < 50) return { level: 0, label: 'Weak', crack };
  if (bits < 64) return { level: 1, label: 'Fair', crack };
  if (bits < 80) return { level: 2, label: 'Good', crack };
  if (bits < 112) return { level: 3, label: 'Strong', crack };
  return { level: 4, label: 'Very strong', crack };
}

export function timeWords(s: number): string {
  if (s < 1) return 'less than a second';
  const units: [number, string][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [365, 'day'],
    [1000, 'year'],
    [1000, 'thousand years'],
    [1000, 'million years'],
  ];
  let v = s;
  let i = 0;
  while (i < units.length && v >= units[i][0]) {
    v /= units[i][0];
    i++;
  }
  if (i >= units.length) return 'longer than the universe has existed';
  const n = Math.floor(v);
  const name = units[i][1];
  if (name.endsWith('years')) return `${n.toLocaleString('en-US')} ${name}`;
  return `${n.toLocaleString('en-US')} ${name}${n === 1 ? '' : 's'}`;
}

// ---- The generators ----

export interface Settings {
  authBytes: number;
  authEnc: Encoding;
  jwtBytes: number;
  jwtEnc: Encoding;
  webhookBytes: number;
  webhookPrefix: string;
  apiPrefix: string;
  apiLength: number;
  uuidVersion: 4 | 7;
  pw: PasswordOpts;
}

export const DEFAULTS: Settings = {
  authBytes: 32,
  authEnc: 'base64',
  jwtBytes: 64,
  jwtEnc: 'base64url',
  webhookBytes: 32,
  webhookPrefix: 'whsec_',
  apiPrefix: 'sk_live_',
  apiLength: 32,
  uuidVersion: 4,
  pw: { length: 20, lower: true, upper: true, digits: true, symbols: true, noLookalikes: false },
};

/** Only letters, digits, underscore and dash in a prefix, so the key is safe in a URL, header or .env line. */
export function cleanPrefix(p: string): string {
  return p.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
}

export function generate(kind: Kind, s: Settings): string {
  switch (kind) {
    case 'auth':
      return encode(randomBytes(s.authBytes), s.authEnc);
    case 'jwt':
      return encode(randomBytes(s.jwtBytes), s.jwtEnc);
    case 'webhook':
      return cleanPrefix(s.webhookPrefix) + encode(randomBytes(s.webhookBytes), 'base64');
    case 'apikey':
      return cleanPrefix(s.apiPrefix) + randomString(s.apiLength, BASE62);
    case 'uuid':
      return s.uuidVersion === 7 ? uuidV7() : uuidV4();
    case 'password':
      return password(s.pw);
  }
}

/** Bits of randomness in a value of this kind (what makes it hard to guess). */
export function bits(kind: Kind, s: Settings): number {
  switch (kind) {
    case 'auth':
      return s.authBytes * 8;
    case 'jwt':
      return s.jwtBytes * 8;
    case 'webhook':
      return s.webhookBytes * 8;
    case 'apikey':
      return s.apiLength * Math.log2(62);
    case 'uuid':
      return s.uuidVersion === 7 ? 74 : 122;
    case 'password':
      return passwordBits(s.pw);
  }
}

/** Quote a value for a .env line only when it needs it. */
export function envValue(v: string): string {
  return /^[A-Za-z0-9_\-.:/+=@%~!^*?&]+$/.test(v) && !v.startsWith('#') ? v : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function envName(n: string): string {
  return n.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'SECRET';
}
