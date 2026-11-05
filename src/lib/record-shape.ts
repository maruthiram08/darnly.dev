/**
 * "The data behind this element": the shape of the record that filled the boxed element.
 *
 * The page recorder keeps the last few JSON responses the page loaded. At capture it looks for
 * the object whose values appear in the boxed element's text, and describes that object by its
 * shape only: field names, kinds, which fields are empty or missing, text lengths, array sizes,
 * dates as ages, and the record's id. Real values never leave the recorder (except the id and
 * short status-like words such as "active"), so customer names and emails stay on the page.
 *
 * findRecordShape runs in the page (it is page-visible code); cleanRecordShape runs in the walled-off
 * picker and rebuilds the result from fixed patterns, because the page can send anything.
 */

export interface RecordField {
  name: string;
  /** Our own wording only: `null`, `true`, `0`, `<text, 61 chars>`, `"active"`, `<date, 14 months ago>`. */
  shape: string;
  /** "set on 37 of 40 other records", for a null or empty field the other records fill in. */
  note?: string;
}

export interface RecordShape {
  /** Where it came from: method and path, with query names but no query values. */
  source: string;
  /** Where in the response: `data[3]`. */
  path?: string;
  /** Position in its list: record 4 of 412. */
  index?: number;
  total?: number;
  id?: string;
  /** "14 months ago", from created_at or similar. */
  age?: string;
  /** The record matched the element itself, or the row/card around it. */
  via: 'element' | 'around';
  fields: RecordField[];
  /** Fields most other records in the same list have, and this one doesn't. */
  missing: { name: string; others: number; of: number }[];
  /** Fields left out because their name looks secret (tokens, passwords). */
  hidden: number;
  /** Fields beyond the first MAX_FIELDS. */
  more: number;
}

/** One JSON response the recorder kept. */
export interface SeenResponse {
  t: number;
  method: string;
  url: string;
  body: unknown;
}

const MAX_FIELDS = 40;
const MAX_NODES = 20_000;
const MAX_SIBLINGS = 500;

const ENUM_KEY = /(status|state|type|kind|role|plan|tier|level|mode|stage|priority|visibility|category|currency|locale|lang|language|variant|format|unit|provider|source)$/i;
const ENUM_VALUE = /^[a-z0-9][a-z0-9_-]{0,23}$/i;
const ID_KEY = /^(id|_id|uuid|pk)$/i;
const ID_VALUE = /^[\w-]{1,64}$/;
const CREATED_KEY = /^(created|inserted|date_?created|creation_?date)(_?at|_?on|_?date|_?time)?$/i;
const DATE_KEY = /(_at|At|_on|On|date|Date|time|Time|timestamp|Timestamp)$/;
const KEY_OK = /^[A-Za-z_$][\w$-]{0,59}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_LIKE = /^(https?:\/\/|\/\/|data:|blob:)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Names whose values are secrets: the whole field is left out. Compared without _ and - and case. */
export function isSecretKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[_-]/g, '');
  return /password|passwd|secret|token|apikey|accesskey|privatekey|session|cookie|jwt|otp|credential|signature|authcode|refresh|ssn|cvv|cvc|cardnumber|iban|hash|salt/.test(k);
}

/** "14 months ago", "in 3 days". */
export function ageWords(ms: number, now: number): string {
  const diff = now - ms;
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  const units: [number, string][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [30.44, 'day'],
    [12, 'month'],
    [Infinity, 'year'],
  ];
  if (s < 45) return 'just now';
  let v = s;
  for (const [size, unit] of units) {
    if (v < size || size === Infinity) {
      const n = Math.max(1, Math.round(v));
      const w = `${n} ${unit}${n === 1 ? '' : 's'}`;
      return future ? `in ${w}` : `${w} ago`;
    }
    v /= size;
  }
  return 'just now';
}

/** A date value as epoch ms, or undefined. Numbers count only under date-like names. */
function dateValue(key: string, v: unknown): number | undefined {
  if (typeof v === 'string' && ISO_DATE.test(v)) {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : undefined;
  }
  if (typeof v === 'number' && DATE_KEY.test(key)) {
    if (v > 1e9 && v < 4e9) return v * 1000;
    if (v > 1e12 && v < 4e12) return v;
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    // Firestore timestamps: { seconds, nanoseconds } or { _seconds, _nanoseconds }.
    const o = v as Record<string, unknown>;
    const sec = o.seconds ?? o._seconds;
    const keys = Object.keys(o);
    if (typeof sec === 'number' && keys.length === 2 && keys.some((k) => /nanoseconds$/.test(k))) return sec * 1000;
  }
  return undefined;
}

function textShape(v: string): string {
  if (v === '') return '<empty text>';
  if (!v.trim()) return `<blank text, ${v.length} chars>`;
  if (EMAIL.test(v.trim())) return '<email>';
  if (URL_LIKE.test(v)) return '<url>';
  if (UUID.test(v)) return '<uuid>';
  if (/^-?\d+(\.\d+)?$/.test(v)) return `<number as text, ${v.replace(/[-.]/g, '').length} digits>`;
  if (/^\s*[[{]/.test(v) && /[\]}]\s*$/.test(v)) return `<JSON as text, ${v.length} chars>`;
  const extras: string[] = [];
  if (/\n/.test(v)) extras.push(`${v.split('\n').length} lines`);
  if (/\p{Extended_Pictographic}/u.test(v)) extras.push('has emoji');
  if (v !== v.trim()) extras.push('extra spaces');
  return `<text, ${[...v].length} chars${extras.length ? `, ${extras.join(', ')}` : ''}>`;
}

/** The shape of one value, in our own words. Real values only for ids, booleans, 0 and status-like words. */
export function valueShape(key: string, v: unknown, now: number): string {
  if (v === null) return 'null';
  if (v === undefined) return '<missing>';
  const date = dateValue(key, v);
  if (date !== undefined) return `<date, ${ageWords(date, now)}>`;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (v === 0) return '0';
    if (Number.isInteger(v)) return `<${v < 0 ? 'negative ' : ''}integer, ${String(Math.abs(v)).length} digits>`;
    return `<${v < 0 ? 'negative ' : ''}decimal>`;
  }
  if (typeof v === 'string') {
    if (ID_KEY.test(key) && ID_VALUE.test(v)) return `"${v}"`;
    if (ENUM_KEY.test(key) && ENUM_VALUE.test(v)) return `"${v}"`;
    return textShape(v);
  }
  if (Array.isArray(v)) return v.length ? `<list, ${v.length} items>` : '<list, empty>';
  if (typeof v === 'object') {
    const keys = Object.keys(v as object);
    if (!keys.length) return '<object, empty>';
    const names = keys.filter((k) => KEY_OK.test(k) && !isSecretKey(k)).slice(0, 8);
    return `<object: ${names.join(', ')}${keys.length > names.length ? `, +${keys.length - names.length} more` : ''}>`;
  }
  return '<other>';
}

const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** The normalized text the user saw, to match values against. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** How strongly an object's own values appear in the element's text. Longer matches count more. */
function score(obj: Record<string, unknown>, hay: string): number {
  let total = 0;
  const seen = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    if (isSecretKey(k)) continue;
    let s: string | undefined;
    if (typeof v === 'string') s = normalize(v);
    else if (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) >= 100) s = String(v);
    if (!s || s.length < 3 || s.length > 300 || seen.has(s)) continue;
    if (typeof v === 'number' ? new RegExp(`(^|[^\\d.,])${s}($|[^\\d])`).test(hay) : hay.includes(s)) {
      seen.add(s);
      total += Math.min(s.length, 24);
    }
  }
  return total;
}

interface Found {
  obj: Record<string, unknown>;
  path: string[];
  siblings?: unknown[];
  index?: number;
  score: number;
}

/** Walks a response for the object that best matches the text. */
function bestIn(body: unknown, hay: string): Found | undefined {
  let best: Found | undefined;
  let nodes = 0;
  const walk = (v: unknown, path: string[], siblings?: unknown[], index?: number) => {
    if (++nodes > MAX_NODES || path.length > 12 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, [...path.slice(0, -1), `${path.at(-1) ?? ''}[${i}]`], v, i));
      return;
    }
    const obj = v as Record<string, unknown>;
    const s = score(obj, hay);
    // Ties go to the deeper (more specific) object found first.
    if (s > 0 && (!best || s > best.score)) best = { obj, path, siblings, index, score: s };
    for (const [k, child] of Object.entries(obj)) if (child && typeof child === 'object') walk(child, [...path, KEY_OK.test(k) ? k : '?']);
  };
  walk(body, []);
  return best;
}

function sourceOf(method: string, url: string): string {
  try {
    const u = new URL(url);
    const names = [...new Set(Array.from(u.searchParams.keys()))].filter((k) => KEY_OK.test(k)).slice(0, 8);
    const path = u.pathname
      .split('/')
      .map((p) => (/@/.test(p) || p.length > 40 ? '…' : p.replace(/[^\w\-.~%:+]/g, '')))
      .join('/');
    return `${method} ${path}${names.length ? `?${names.map((n) => `${n}=…`).join('&')}` : ''}`;
  } catch {
    return method;
  }
}

/**
 * Finds the record behind the element. `texts` is the element's own text first, then the text of
 * the row or card around it (used only when the element itself matches nothing, such as an empty badge).
 */
export function findRecordShape(responses: SeenResponse[], texts: string[], now = Date.now()): RecordShape | undefined {
  for (let level = 0; level < texts.length; level++) {
    const hay = normalize(texts[level] ?? '');
    if (hay.length < 3) continue;
    let best: (Found & { r: SeenResponse }) | undefined;
    // Newest response first, so the latest copy of a record wins a tie.
    for (const r of [...responses].sort((a, b) => b.t - a.t)) {
      const f = bestIn(r.body, hay);
      if (f && (!best || f.score > best.score)) best = { ...f, r };
    }
    // One short word ("pro", "yes") is too weak to call a match.
    if (best && best.score >= 5) return describe(best, best.r, level === 0 ? 'element' : 'around', now);
  }
  return undefined;
}

function describe(f: Found, r: SeenResponse, via: RecordShape['via'], now: number): RecordShape {
  const others = (f.siblings ?? [])
    .filter((s, i): s is Record<string, unknown> => i !== f.index && !!s && typeof s === 'object' && !Array.isArray(s))
    .slice(0, MAX_SIBLINGS);
  const fields: RecordField[] = [];
  let hidden = 0;
  let more = 0;
  let id: string | undefined;
  let age: string | undefined;
  for (const [k, v] of Object.entries(f.obj)) {
    if (!KEY_OK.test(k) || isSecretKey(k)) {
      hidden++;
      continue;
    }
    if (ID_KEY.test(k) && id === undefined && (typeof v === 'number' || (typeof v === 'string' && ID_VALUE.test(v)))) id = String(v);
    if (CREATED_KEY.test(k) && age === undefined) {
      const d = dateValue(k, v);
      if (d !== undefined) age = ageWords(d, now);
    }
    if (fields.length >= MAX_FIELDS) {
      more++;
      continue;
    }
    const field: RecordField = { name: k, shape: valueShape(k, v, now) };
    if (empty(v) && others.length) {
      const filled = others.filter((o) => !empty(o[k])).length;
      if (filled) field.note = `set on ${filled} of ${others.length} other records`;
    }
    fields.push(field);
  }
  // Fields most of the other records have and this one lacks: the classic "added after this row was made".
  const counts = new Map<string, number>();
  for (const o of others) for (const k of Object.keys(o)) if (!(k in f.obj) && KEY_OK.test(k) && !isSecretKey(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  const missing = [...counts]
    .filter(([, n]) => n * 2 >= others.length)
    .slice(0, 20)
    .map(([name, n]) => ({ name, others: n, of: others.length }));
  return {
    source: sourceOf(r.method, r.url),
    path: f.path.join('.').slice(0, 120) || undefined,
    ...(f.siblings && f.index !== undefined && { index: f.index + 1, total: f.siblings.length }),
    id,
    age,
    via,
    fields,
    missing,
    hidden,
    more,
  };
}

/* ---------- In the picker: rebuild from fixed patterns, because the page can send anything ---------- */

const SHAPE_OK = new RegExp(
  [
    '^null$',
    '^true$',
    '^false$',
    '^0$',
    '^<missing>$',
    '^<other>$',
    '^<empty text>$',
    '^<email>$',
    '^<url>$',
    '^<uuid>$',
    '^<list, empty>$',
    '^<object, empty>$',
    '^<list, \\d{1,9} items>$',
    '^<blank text, \\d{1,9} chars>$',
    '^<number as text, \\d{1,9} digits>$',
    '^<JSON as text, \\d{1,9} chars>$',
    '^<text, \\d{1,9} chars(, \\d{1,9} lines)?(, has emoji)?(, extra spaces)?>$',
    '^<(negative )?integer, \\d{1,9} digits>$',
    '^<(negative )?decimal>$',
    '^<date, (just now|(in )?\\d{1,4} (second|minute|hour|day|month|year)s?( ago)?)>$',
    '^"[A-Za-z0-9_-]{1,64}"$',
    '^<object: [A-Za-z_$][\\w$-]{0,59}(, [A-Za-z_$][\\w$-]{0,59}){0,7}(, \\+\\d{1,6} more)?>$',
  ].join('|'),
);
const AGE_OK = /^(just now|(in )?\d{1,4} (second|minute|hour|day|month|year)s?( ago)?)$/;
const NOTE_OK = /^set on \d{1,4} of \d{1,4} other records$/;
const SOURCE_OK = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)( \/[\w\-./~%:+…]{0,200}(\?[\w$-]{1,60}=…(&[\w$-]{1,60}=…){0,7})?)?$/;
const PATH_OK = /^[\w$\-.[\]?]{1,120}$/;

const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined);
const name = (v: unknown) => (typeof v === 'string' && KEY_OK.test(v) && !isSecretKey(v) ? v : undefined);

export function cleanRecordShape(raw: unknown): RecordShape | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.source !== 'string' || !Array.isArray(r.fields)) return undefined;
  const method = r.source.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/)?.[1];
  const source = SOURCE_OK.test(r.source) ? r.source : method;
  if (!source) return undefined;
  const fields: RecordField[] = [];
  for (const f of r.fields.slice(0, MAX_FIELDS) as Record<string, unknown>[]) {
    const n = name(f?.name);
    if (!n || typeof f.shape !== 'string' || !SHAPE_OK.test(f.shape)) continue;
    // A quoted value is kept only under an id or status-like name (the rules findRecordShape follows).
    if (f.shape.startsWith('"') && !(ID_KEY.test(n) || (ENUM_KEY.test(n) && ENUM_VALUE.test(f.shape.slice(1, -1))))) continue;
    fields.push({ name: n, shape: f.shape, ...(typeof f.note === 'string' && NOTE_OK.test(f.note) && { note: f.note }) });
  }
  if (!fields.length) return undefined;
  const missing = Array.isArray(r.missing)
    ? (r.missing.slice(0, 20) as Record<string, unknown>[]).flatMap((m) => {
        const n = name(m?.name);
        const others = int(m?.others, 1e6);
        const of = int(m?.of, 1e6);
        return n && others !== undefined && of !== undefined ? [{ name: n, others, of }] : [];
      })
    : [];
  const index = int(r.index, 1e7);
  const total = int(r.total, 1e7);
  return {
    source,
    path: typeof r.path === 'string' && PATH_OK.test(r.path) ? r.path : undefined,
    ...(index && total && { index, total }),
    id: typeof r.id === 'string' && ID_VALUE.test(r.id) ? r.id : undefined,
    age: typeof r.age === 'string' && AGE_OK.test(r.age) ? r.age : undefined,
    via: r.via === 'around' ? 'around' : 'element',
    fields,
    missing,
    hidden: int(r.hidden, 1e4) ?? 0,
    more: int(r.more, 1e6) ?? 0,
  };
}

/** The report section. Goes inside the page-data markers: names come from the page's own data. */
export function recordLines(s: RecordShape): string[] {
  const facts = [
    s.id && `record id ${s.id}`,
    s.age && `created ${s.age}`,
    s.total && s.index && `record ${s.index} of ${s.total} in this list`,
  ].filter(Boolean);
  const lines = [
    '## The data behind this element',
    `${s.via === 'around' ? 'The row or card around the red box' : 'The red box'} shows this record, from \`${s.source}\`${s.path ? ` at \`${s.path}\`` : ''}${facts.length ? ` (${facts.join(', ')})` : ''}.`,
    'Only its shape is shown: field names, kinds, lengths and ages. The real values stayed in the browser.',
    ...s.fields.map((f) => `- ${f.name}: ${f.shape}${f.note ? `  ← empty here, ${f.note}` : ''}`),
    ...s.missing.map((m) => `- ${m.name}: <missing>  ← not on this record, but on ${m.others} of ${m.of} other records`),
  ];
  if (s.more) lines.push(`- …and ${s.more} more field${s.more === 1 ? '' : 's'}`);
  if (s.hidden) lines.push(`- (${s.hidden} field${s.hidden === 1 ? '' : 's'} with secret-looking names left out)`);
  lines.push('');
  return lines;
}
