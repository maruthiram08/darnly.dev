// Font finder: reads a page's HTML and stylesheets and works out which fonts it uses, where,
// in which weights, and where each font comes from (Google Fonts, Adobe Fonts, the site itself,
// or the visitor's computer). Plain functions so they can be tested without a Worker.

export type Source = 'google' | 'adobe' | 'bunny' | 'self' | 'system' | 'unknown';

export type Font = {
  name: string;
  source: Source;
  onGoogle: boolean; // also free on Google Fonts, even if the site hosts its own copy
  weights: string[];
  styles: string[];
  roles: string[]; // Body text, Headings, Code, Buttons and forms
  uses: number; // how many CSS rules ask for it first
  stack: string; // a full font-family value that uses it
};

export type FontsResult = { fonts: Font[]; sheets: number; sheetsFailed: number };

type Fetch = (url: string) => Promise<string | null>;

const MAX_SHEETS = 12;
const MAX_IMPORTS = 6;

const GENERIC = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif',
  'ui-monospace', 'ui-rounded', '-apple-system', 'blinkmacsystemfont', 'emoji', 'math', 'fangsong',
  'inherit', 'initial', 'unset', 'revert', 'revert-layer',
]);

const SYSTEM = new Set([
  'arial', 'helvetica', 'helvetica neue', 'segoe ui', 'times new roman', 'times', 'georgia', 'verdana',
  'tahoma', 'courier new', 'courier', 'menlo', 'monaco', 'consolas', 'sf mono', 'sfmono-regular',
  'sf pro text', 'sf pro display', 'apple color emoji', 'segoe ui emoji', 'segoe ui symbol',
  'noto color emoji', 'liberation mono', 'trebuchet ms', 'lucida grande', 'lucida console', 'impact',
  'garamond', 'palatino', 'palatino linotype', 'book antiqua', 'cambria', 'calibri', 'optima', 'avenir',
  'avenir next', 'roboto', 'ubuntu', 'cantarell', 'oxygen', 'fira sans', 'droid sans', 'noto sans',
  'dejavu sans mono', 'andale mono', 'arial black', 'comic sans ms', 'gill sans', 'futura', 'baskerville',
]);

// Fonts in SYSTEM that are also real web fonts people load on purpose.
const ALSO_WEB = new Set(['roboto', 'ubuntu', 'cantarell', 'oxygen', 'fira sans', 'noto sans']);

export async function findFonts(html: string, base: string, fetchText: Fetch): Promise<FontsResult> {
  const sheetUrls: string[] = [];
  const googleLinks: string[] = [];
  const blocks: { css: string; base: string }[] = [];

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel').toLowerCase().split(/\s+/);
    const as = attr(tag, 'as').toLowerCase();
    const href = attr(tag, 'href');
    if (!href) continue;
    if (!(rel.includes('stylesheet') || (rel.includes('preload') && as === 'style'))) continue;
    const abs = resolve(href, base);
    if (!abs) continue;
    if (/^https?:\/\/fonts\.googleapis\.com\/css/i.test(abs)) googleLinks.push(abs);
    else if (!sheetUrls.includes(abs)) sheetUrls.push(abs);
  }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) blocks.push({ css: m[1], base });
  // style="font-family: …" on elements counts too.
  const inline = [...html.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)]
    .map((m) => decodeEntities(m[2] ?? m[3] ?? ''))
    .filter((s) => /font/i.test(s))
    .map((s) => `[style]{${s}}`)
    .join('\n');
  if (inline) blocks.push({ css: inline, base });

  let failed = 0;
  const wanted = sheetUrls.slice(0, MAX_SHEETS);
  const texts = await Promise.all(wanted.map((u) => fetchText(u)));
  texts.forEach((t, i) => (t === null ? failed++ : blocks.push({ css: t, base: wanted[i] })));

  // One level of @import, which is how many sites pull in Google Fonts or a theme file.
  const imports: string[] = [];
  for (const b of blocks) {
    for (const m of stripComments(b.css).matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?[^;]*;/gi)) {
      const abs = resolve(m[1], b.base);
      if (!abs) continue;
      if (/^https?:\/\/fonts\.googleapis\.com\/css/i.test(abs)) googleLinks.push(abs);
      else if (!sheetUrls.includes(abs) && !imports.includes(abs)) imports.push(abs);
    }
  }
  const importTexts = await Promise.all(imports.slice(0, MAX_IMPORTS).map((u) => fetchText(u)));
  importTexts.forEach((t, i) => (t === null ? failed++ : blocks.push({ css: t, base: imports[i] })));

  const fonts = analyse(blocks, googleLinks);

  // Self-hosted fonts are often free Google fonts (Next.js does this for you). Ask Google.
  const toAsk = fonts.filter((f) => f.source === 'self' || f.source === 'unknown').slice(0, 6);
  const answers = await Promise.all(
    toAsk.map((f) => fetchText(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.name).replace(/%20/g, '+')}`)),
  );
  toAsk.forEach((f, i) => {
    if (answers[i] && /@font-face/.test(answers[i]!)) f.onGoogle = true;
  });

  return { fonts, sheets: blocks.length, sheetsFailed: failed };
}

type Entry = Font & { declared: Set<Source>; w: Set<string>; s: Set<string>; r: Set<string> };

export function analyse(blocks: { css: string; base: string }[], googleLinks: string[]): Font[] {
  const map = new Map<string, Entry>();
  const entry = (name: string): Entry => {
    const key = name.toLowerCase();
    let e = map.get(key);
    if (!e) {
      e = { name, source: 'unknown', onGoogle: false, weights: [], styles: [], roles: [], uses: 0, stack: '', declared: new Set(), w: new Set(), s: new Set(), r: new Set() };
      map.set(key, e);
    }
    return e;
  };

  for (const link of googleLinks) {
    for (const g of googleFamilies(link)) {
      const e = entry(g.name);
      e.declared.add('google');
      g.weights.forEach((w) => e.w.add(w));
      if (g.italic) e.s.add('italic');
    }
  }

  const vars = new Map<string, string>();
  const uses: { selector: string; value: string }[] = [];

  for (const b of blocks) {
    const css = stripComments(b.css);
    for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
      const d = decls(m[1]);
      const fam = cleanName(unquote(d.get('font-family') ?? ''));
      if (!fam) continue;
      const e = entry(fam);
      const src = d.get('src') ?? '';
      e.declared.add(sourceOf(src));
      const ws = (d.get('font-weight') ?? '400').split(/\s+/).filter(Boolean).map(weightName);
      e.w.add(ws.length === 2 ? `${ws[0]}–${ws[1]}` : ws[0]);
      e.s.add((d.get('font-style') ?? 'normal').split(/\s+/)[0]);
    }
    const rules = css.replace(/@font-face\s*\{[^}]*\}/gi, '');
    for (const m of rules.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const selector = m[1].trim().replace(/^@[^{]*$/, '');
      const d = decls(m[2]);
      for (const [k, v] of d) if (k.startsWith('--') && v.length < 300 && !vars.has(k)) vars.set(k, v);
      const ff = d.get('font-family') ?? familyFromShorthand(d.get('font') ?? '');
      if (ff) uses.push({ selector, value: ff });
    }
  }

  for (const u of uses) {
    const value = resolveVars(u.value, vars);
    const list = value.split(',').map((x) => unquote(x.trim())).filter(Boolean);
    const first = list.map(cleanName).find((n) => n && !/ fallback$/i.test(n));
    if (!first) continue;
    const isGeneric = GENERIC.has(first.toLowerCase());
    const name = isGeneric ? 'System font' : first;
    if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(first)) continue;
    const e = entry(name);
    e.uses++;
    if (!e.stack) e.stack = value.trim();
    const role = roleOf(u.selector);
    if (role) e.r.add(role);
  }

  const out: Font[] = [];
  for (const e of map.values()) {
    const key = e.name.toLowerCase();
    let source: Source = 'unknown';
    for (const s of ['google', 'adobe', 'bunny', 'self'] as Source[]) if (e.declared.has(s)) { source = s; break; }
    if (source === 'unknown' && (e.name === 'System font' || SYSTEM.has(key))) source = 'system';
    // A font nobody uses and nobody loads is just noise (icon fonts, leftovers).
    if (e.uses === 0 && source === 'unknown') continue;
    if (/icon|awesome|glyph|material symbols|dashicons/i.test(e.name)) continue;
    out.push({
      name: e.name,
      source,
      onGoogle: source === 'google',
      weights: [...e.w].sort((a, b) => parseInt(a) - parseInt(b)),
      styles: [...e.s].filter((s) => s !== 'normal'),
      roles: [...e.r],
      uses: e.uses,
      stack: e.stack || `'${e.name}', sans-serif`,
    });
  }

  const roleRank = (f: Font) => (f.roles.includes('Body text') ? 0 : f.roles.includes('Headings') ? 1 : f.roles.length ? 2 : 3);
  const sysRank = (f: Font) => (f.source === 'system' ? 1 : 0);
  out.sort((a, b) => sysRank(a) - sysRank(b) || roleRank(a) - roleRank(b) || b.uses - a.uses);
  // Fonts that look like system fonts but were loaded on purpose stay as web fonts.
  for (const f of out) if (f.source === 'system' && ALSO_WEB.has(f.name.toLowerCase())) f.source = 'unknown';
  return out.slice(0, 12);
}

// fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Roboto+Mono  or  css?family=Inter:400,700|Lato
export function googleFamilies(link: string): { name: string; weights: string[]; italic: boolean }[] {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return [];
  }
  const raw = u.searchParams.getAll('family').flatMap((f) => (u.pathname.endsWith('/css') ? f.split('|') : [f]));
  return raw
    .map((f) => {
      const [name, spec = ''] = f.split(':');
      const weights = new Set<string>();
      let italic = false;
      if (spec.includes('@')) {
        const [axes, values] = spec.split('@');
        const names = axes.split(',');
        for (const tuple of values.split(';')) {
          const parts = tuple.split(',');
          const wi = names.indexOf('wght');
          const ii = names.indexOf('ital');
          if (ii >= 0 && parts[ii] === '1') italic = true;
          if (wi >= 0 && parts[wi]) weights.add(parts[wi].replace('..', '–'));
        }
      } else {
        for (const p of spec.split(',')) {
          const m = p.match(/^(\d+)?(i|italic)?$/);
          if (!m || !p) continue;
          if (m[2]) italic = true;
          weights.add(m[1] ?? '400');
        }
      }
      if (!weights.size) weights.add('400');
      return { name: name.replace(/\+/g, ' ').trim(), weights: [...weights], italic };
    })
    .filter((f) => f.name);
}

// Looks at the element each selector styles (the last part, so ".card h2" counts as a heading).
function roleOf(selector: string): string | null {
  for (const sel of selector.toLowerCase().split(',')) {
    const subject = sel.trim().split(/[\s>+~]+/).pop() ?? '';
    if (/^(html|body|:root|\*)\b|^\*$/.test(subject)) return 'Body text';
    if (/^h[1-6]\b|[.#][\w-]*(heading|headline|title|display|hero)/.test(subject)) return 'Headings';
    if (/^(code|pre|kbd|samp)\b|[.#][\w-]*mono/.test(subject)) return 'Code';
    if (/^(button|input|select|textarea)\b|[.#][\w-]*(btn|button)/.test(subject)) return 'Buttons and forms';
  }
  return null;
}

function sourceOf(src: string): Source {
  if (/fonts\.gstatic\.com/i.test(src)) return 'google';
  if (/typekit\.net|use\.typekit|fonts\.adobe/i.test(src)) return 'adobe';
  if (/fonts\.bunny\.net/i.test(src)) return 'bunny';
  if (/url\(/i.test(src)) return 'self';
  if (/local\(/i.test(src)) return 'system';
  return 'self';
}

// Next.js renames fonts to things like __Inter_d65c78; give them their real names back.
export function cleanName(n: string): string {
  let s = n.trim();
  const next = s.match(/^__(.+?)(_Fallback)?_[0-9a-f]{5,8}$/i);
  if (next) s = next[2] ? `${next[1].replace(/_/g, ' ')} Fallback` : next[1].replace(/_/g, ' ');
  return s;
}

function familyFromShorthand(v: string): string {
  // font: italic 700 16px/1.5 "Inter", sans-serif  ->  "Inter", sans-serif
  const m = v.match(/(?:^|\s)[\d.]+(?:px|rem|em|%|pt|vw|vh|ch|ex)(?:\s*\/\s*[\d.a-z%]+)?\s+(.+)$/i);
  if (m) return m[1];
  return '';
}

function resolveVars(v: string, vars: Map<string, string>): string {
  let out = v;
  for (let i = 0; i < 4 && out.includes('var('); i++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name: string, fallback?: string) => vars.get(name) ?? fallback ?? '');
  }
  return out;
}

function decls(body: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of body.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).replace(/!important/i, '').trim();
    if (k && v) m.set(k.startsWith('--') ? part.slice(0, i).trim() : k, v);
  }
  return m;
}

function weightName(w: string): string {
  const named: Record<string, string> = { normal: '400', bold: '700', lighter: '300', bolder: '800' };
  return named[w.toLowerCase()] ?? w;
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '').trim();

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : '';
}

function resolve(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}
