// Text case converter: the pure logic, kept apart from the page so it is easy to test.

export type CaseId =
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'screaming'
  | 'kebab'
  | 'title'
  | 'sentence'
  | 'dot'
  | 'slug'
  | 'lower'
  | 'upper';

export type CaseInfo = { id: CaseId; name: string; example: string; use: string };

export const CASES: CaseInfo[] = [
  { id: 'camel', name: 'camelCase', example: 'userName', use: 'JavaScript and TypeScript variables, JSON from JS APIs' },
  { id: 'pascal', name: 'PascalCase', example: 'UserName', use: 'React components, classes, TypeScript types' },
  { id: 'snake', name: 'snake_case', example: 'user_name', use: 'Python, Ruby, database columns, Supabase' },
  { id: 'screaming', name: 'SCREAMING_SNAKE_CASE', example: 'USER_NAME', use: 'Environment variables and constants' },
  { id: 'kebab', name: 'kebab-case', example: 'user-name', use: 'CSS classes, file names, URLs, npm packages' },
  { id: 'title', name: 'Title Case', example: 'User Name', use: 'Headings, page titles, button labels' },
  { id: 'sentence', name: 'Sentence case', example: 'User name', use: 'UI text, descriptions, most headings' },
  { id: 'dot', name: 'dot.case', example: 'user.name', use: 'Config keys, translation keys (i18n)' },
  { id: 'slug', name: 'URL slug', example: 'user-name', use: 'Web addresses: lowercase, no accents or symbols' },
  { id: 'lower', name: 'lower case', example: 'user name', use: 'Plain lowercase words' },
  { id: 'upper', name: 'UPPER CASE', example: 'USER NAME', use: 'Plain uppercase words' },
];

// Split one name or phrase into words.
// "getHTTPResponse" -> get, HTTP, Response. "user_name-id" -> user, name, id. "it's fine" -> it's, fine.
export function words(input: string, splitCamel = true): string[] {
  const chunks = input.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
  if (!splitCamel) return chunks;
  const out: string[] = [];
  for (const chunk of chunks) {
    const parts = chunk
      // fooBar -> foo Bar, foo2Bar -> foo2 Bar
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
      // HTTPResponse -> HTTP Response
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
      .split(' ');
    for (const p of parts) if (p) out.push(p);
  }
  return out;
}

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'vs', 'via']);

const cap = (w: string) => (w ? w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase() : w);
const noQuote = (w: string) => w.replace(/['’]/g, '');
// Keep short all-caps words (API, URL, ID) as they are in Title and Sentence case.
// Also keep brand-style words with a capital inside (OpenAI, iPhone, GitHub).
const isAcronym = (w: string) => w.length > 1 && w.length <= 5 && w === w.toLocaleUpperCase() && /\p{Lu}/u.test(w);
const keep = (w: string) => isAcronym(w) || /^.+\p{Lu}/u.test(w) && /\p{Ll}/u.test(w);

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

// Convert one line. Code cases drop apostrophes ("it's" -> "its"); Title and Sentence case keep them.
export function convert(input: string, id: CaseId): string {
  const ws = words(input);
  if (ws.length === 0) return '';
  const code = ws.map(noQuote).filter(Boolean);
  // Plain sentences ("API key for OpenAI") keep their words whole in the word cases; single names get split.
  const prose = /\s/.test(input.trim()) ? words(input, false) : ws;
  switch (id) {
    case 'camel':
      return code.map((w, i) => (i === 0 ? w.toLocaleLowerCase() : cap(w))).join('');
    case 'pascal':
      return code.map(cap).join('');
    case 'snake':
      return code.join('_').toLocaleLowerCase();
    case 'screaming':
      return code.join('_').toLocaleUpperCase();
    case 'kebab':
      return code.join('-').toLocaleLowerCase();
    case 'dot':
      return code.join('.').toLocaleLowerCase();
    case 'slug':
      return stripAccents(code.join('-').toLocaleLowerCase())
        .replace(/[^a-z0-9-]+/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    case 'lower':
      return prose.join(' ').toLocaleLowerCase();
    case 'upper':
      return prose.join(' ').toLocaleUpperCase();
    case 'title':
      return prose
        .map((w, i) => {
          if (keep(w)) return w;
          const lw = w.toLocaleLowerCase();
          if (i > 0 && i < prose.length - 1 && SMALL.has(lw)) return lw;
          return cap(w);
        })
        .join(' ');
    case 'sentence':
      return prose.map((w, i) => (keep(w) ? w : i === 0 ? cap(w) : w.toLocaleLowerCase())).join(' ');
  }
}

// Convert every line on its own, so a pasted list stays a list. Blank lines stay blank.
export function convertLines(input: string, id: CaseId): string {
  return input
    .split(/\r?\n/)
    .map((line) => convert(line, id))
    .join('\n');
}

// Guess which case a single name is written in. Returns null for plain prose or a mix.
export function detect(input: string): CaseId | null {
  const s = input.trim();
  if (!s || /\n/.test(s)) return null;
  if (/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(s)) return 'camel';
  if (/^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/.test(s)) return 'pascal';
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(s)) return 'snake';
  if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(s)) return 'screaming';
  if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(s)) return 'kebab';
  if (/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/.test(s)) return 'dot';
  return null;
}

// ---- JSON keys ----

export type KeyResult = {
  value: unknown;
  changed: number;
  total: number;
  clashes: string[]; // keys that ended up with the same name as another key in the same object
};

export function convertKeys(data: unknown, id: CaseId, deep = true): KeyResult {
  let changed = 0;
  let total = 0;
  const clashes: string[] = [];
  const walk = (v: unknown, depth: number): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, depth));
    if (v && typeof v === 'object') {
      if (!deep && depth > 0) return v;
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        total++;
        // Leave keys that have no letters or digits (like "" or "$") alone.
        const nk = convert(k, id) || k;
        if (nk !== k) changed++;
        if (Object.prototype.hasOwnProperty.call(out, nk)) clashes.push(`${k} → ${nk}`);
        out[nk] = walk(val, depth + 1);
      }
      return out;
    }
    return v;
  };
  const value = walk(data, 0);
  return { value, changed, total, clashes };
}

// Parse JSON and say where it broke, in plain words.
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.replace(/^JSON\.parse: /, '') };
  }
}

// ---- .env names ----

export const ENV_PREFIXES = ['', 'NEXT_PUBLIC_', 'VITE_', 'EXPO_PUBLIC_', 'PUBLIC_', 'REACT_APP_'];

// Names that look like secrets. With a public prefix they would be sent to every visitor's browser.
export const looksSecret = (name: string) => /SECRET|PASSWORD|PASSWD|PRIVATE|TOKEN|SERVICE_ROLE|(^|_)KEY($|_)|API_KEY|DATABASE_URL|DB_URL/i.test(convert(name, 'screaming'));

export type EnvLine = { kind: 'name'; before: string; after: string; text: string } | { kind: 'other'; text: string };

// Convert the names in a .env file (or a list of names). Values, comments and blank lines are kept.
export function convertEnv(input: string, id: CaseId, prefix = ''): { lines: EnvLine[]; text: string; changed: number } {
  let changed = 0;
  const lines: EnvLine[] = input.split(/\r?\n/).map((line) => {
    const m = line.match(/^(\s*)(export\s+)?([^=#\s][^=]*?)(\s*=.*)?$/);
    if (!m || /^\s*#/.test(line)) return { kind: 'other', text: line };
    const [, lead, exp = '', name, rest = ''] = m;
    let after = convert(name, id);
    if (!after) return { kind: 'other', text: line };
    if (prefix) {
      // Avoid NEXT_PUBLIC_NEXT_PUBLIC_.
      if (!after.startsWith(convert(prefix, id))) after = convert(`${prefix} ${name}`, id);
    }
    if (after !== name) changed++;
    return { kind: 'name', before: name, after, text: `${lead}${exp}${after}${rest}` };
  });
  return { lines, text: lines.map((l) => l.text).join('\n'), changed };
}
