// Website color finder: reads a page's HTML and stylesheets and works out its color palette:
// the CSS custom properties that hold colors (with dark mode values), plus the most-used
// background, text and accent colors. Plain functions so they can be tested without a Worker.

export type Swatch = { hex: string; uses: number; vars: string[] };
export type ColorVar = { name: string; hex: string; value: string; dark: string | null; uses: number };
export type ColorsResult = {
  vars: ColorVar[];
  backgrounds: Swatch[];
  text: Swatch[];
  accents: Swatch[];
  themeColor: string | null;
  sheets: number;
  sheetsFailed: number;
};

type Fetch = (url: string) => Promise<string | null>;
type RGBA = [number, number, number, number];

const MAX_SHEETS = 12;
const MAX_IMPORTS = 6;
const MAX_VARS = 48;
const PER_GROUP = 6;

export async function findColors(html: string, base: string, fetchText: Fetch): Promise<ColorsResult> {
  const sheetUrls: string[] = [];
  const blocks: { css: string; base: string }[] = [];
  let themeColor: string | null = null;

  for (const tag of html.match(/<(link|meta)\b[^>]*>/gi) ?? []) {
    if (/^<meta/i.test(tag)) {
      if (themeColor === null && attr(tag, 'name').toLowerCase() === 'theme-color') {
        const c = parseColor(attr(tag, 'content'));
        if (c && c[3] > 0) themeColor = toHex(c);
      }
      continue;
    }
    const rel = attr(tag, 'rel').toLowerCase().split(/\s+/);
    const as = attr(tag, 'as').toLowerCase();
    const href = attr(tag, 'href');
    if (!href || !(rel.includes('stylesheet') || (rel.includes('preload') && as === 'style'))) continue;
    const abs = resolve(href, base);
    // Font stylesheets never hold colors.
    if (abs && !/fonts\.(googleapis|bunny)\.|use\.typekit/i.test(abs) && !sheetUrls.includes(abs)) sheetUrls.push(abs);
  }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) blocks.push({ css: m[1], base });
  // style="background: …" on elements counts too.
  const inline = [...html.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)]
    .map((m) => decodeEntities(m[2] ?? m[3] ?? ''))
    .filter((s) => /color|background|border|fill|stroke|--/i.test(s))
    .map((s) => `[style]{${s}}`)
    .join('\n');
  if (inline) blocks.push({ css: inline, base });

  let failed = 0;
  const wanted = sheetUrls.slice(0, MAX_SHEETS);
  const texts = await Promise.all(wanted.map((u) => fetchText(u)));
  texts.forEach((t, i) => (t === null ? failed++ : blocks.push({ css: t, base: wanted[i] })));

  // One level of @import, which is how many themes pull in their color files.
  const imports: string[] = [];
  for (const b of blocks) {
    for (const m of stripComments(b.css).matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?[^;]*;/gi)) {
      const abs = resolve(m[1], b.base);
      if (abs && !/fonts\.(googleapis|bunny)\./i.test(abs) && !sheetUrls.includes(abs) && !imports.includes(abs)) imports.push(abs);
    }
  }
  const importTexts = await Promise.all(imports.slice(0, MAX_IMPORTS).map((u) => fetchText(u)));
  importTexts.forEach((t, i) => (t === null ? failed++ : blocks.push({ css: t, base: imports[i] })));

  return { ...analyse(blocks.map((b) => b.css), html), themeColor, sheets: blocks.length, sheetsFailed: failed };
}

type Rule = { selector: string; decls: [string, string][]; dark: boolean };

export function analyse(sheets: string[], html: string): Omit<ColorsResult, 'themeColor' | 'sheets' | 'sheetsFailed'> {
  const rules: Rule[] = sheets.flatMap((css) => parseRules(stripComments(css)));
  const allCss = sheets.join('\n');

  // 1. Custom properties: first light value and first dark value of each.
  const light = new Map<string, string>();
  const dark = new Map<string, string>();
  const order = new Set<string>();
  for (const r of rules) {
    for (const [k, v] of r.decls) {
      if (!k.startsWith('--') || v.length > 200) continue;
      const target = r.dark ? dark : light;
      if (!target.has(k)) target.set(k, v);
      order.add(k);
    }
  }
  // Values only defined for dark mode still need something to resolve against.
  for (const [k, v] of dark) if (!light.has(k)) light.set(k, v);

  const refs = new Map<string, number>();
  for (const m of allCss.matchAll(/var\(\s*(--[\w-]+)/g)) refs.set(m[1], (refs.get(m[1]) ?? 0) + 1);
  const rgbChannelVars = new Set([...allCss.matchAll(/rgba?\(\s*var\(\s*(--[\w-]+)/g)].map((m) => m[1]));

  const varColor = (name: string, map: Map<string, string>): RGBA | null => {
    const raw = map.get(name);
    if (!raw) return null;
    const v = resolveVars(raw, map).trim();
    const c = parseColor(v);
    if (c) return c;
    // shadcn/ui style: --primary: 222 47% 11%, used as hsl(var(--primary)).
    if (/^-?[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%(\s*\/\s*[\d.]+%?)?$/.test(v)) return parseColor(`hsl(${v})`);
    // Tailwind v2/v3 plugins: --brand: 59 130 246, used as rgb(var(--brand)).
    if (rgbChannelVars.has(name) && /^\d{1,3}[\s,]+\d{1,3}[\s,]+\d{1,3}$/.test(v)) return parseColor(`rgb(${v})`);
    return null;
  };

  let vars: ColorVar[] = [];
  for (const name of order) {
    if (/^--tw-/.test(name)) continue; // Tailwind's own plumbing, not a color choice
    const c = varColor(name, light);
    if (!c || c[3] === 0) continue;
    const d = dark.has(name) ? varColor(name, new Map([...light, ...dark])) : null;
    const hex = toHex(c);
    const dhex = d && d[3] > 0 ? toHex(d) : null;
    vars.push({ name, hex, value: light.get(name)!.trim(), dark: dhex && dhex !== hex ? dhex : null, uses: refs.get(name) ?? 0 });
  }
  if (vars.length > MAX_VARS) {
    const keep = new Set([...vars].sort((a, b) => b.uses - a.uses).slice(0, MAX_VARS));
    vars = vars.filter((v) => keep.has(v));
  }

  // 2. How much each rule matters: how often its classes and tags appear in the page.
  const classCount = new Map<string, number>();
  for (const m of html.matchAll(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    for (const c of decodeEntities(m[2] ?? m[3] ?? '').split(/\s+/)) if (c) classCount.set(c, (classCount.get(c) ?? 0) + 1);
  }
  const tagCount = new Map<string, number>();
  for (const m of html.matchAll(/<([a-z][a-z0-9-]*)\b/gi)) {
    const t = m[1].toLowerCase();
    tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  }
  const weightOf = (selector: string): number => {
    let w = 0;
    for (const part of selector.split(',')) {
      const compounds = part.trim().split(/\s*[\s>+~]\s*/).filter(Boolean);
      const subject = compounds[compounds.length - 1];
      if (!subject) continue;
      if (/^(:root|html|body)\b/i.test(subject)) {
        w += 25;
        continue;
      }
      if (subject === '[style]') {
        w += 1;
        continue;
      }
      const pseudo = /:(hover|focus|active|visited|focus-visible|focus-within)/.test(subject) ? 0.4 : 1;
      // ".card span" can only match as often as .card appears, so take the rarest part.
      let n = Infinity;
      for (const c of compounds) {
        if (/^(:root|html|body)\b/i.test(c) || c === '*') continue;
        const classes = [...c.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
        const tag = c.match(/^([a-z][a-z0-9-]*)/i)?.[1].toLowerCase();
        if (classes.length) n = Math.min(n, ...classes.map((x) => classCount.get(x) ?? 0));
        else if (tag) n = Math.min(n, tagCount.get(tag) ?? 0);
      }
      w += pseudo * (n === Infinity ? 0.5 : Math.max(0.2, Math.min(n, 40)));
    }
    return Math.min(w, 200);
  };

  // 3. Count every color used as a background, as text, and anywhere (for accents).
  const bg = new Map<string, number>();
  const fg = new Map<string, number>();
  const accent = new Map<string, number>();
  const add = (m: Map<string, number>, hex: string, w: number) => m.set(hex, (m.get(hex) ?? 0) + w);

  for (const r of rules) {
    if (r.dark) continue; // the palette describes the default (light) look
    const w = weightOf(r.selector);
    if (!w) continue;
    // Most rules don't set their own variables, so only copy the map when one does.
    const own = r.decls.filter(([k]) => k.startsWith('--'));
    const local = own.length ? new Map([...light, ...own]) : light;
    const boost = /\b(a|button)\b|btn|button|link|primary|accent|brand|cta/i.test(r.selector) ? 2 : 1;
    for (const [prop, raw] of r.decls) {
      if (prop.startsWith('--')) continue;
      const kind =
        prop === 'background' || prop === 'background-color' || prop === 'background-image' ? 'bg' :
        prop === 'color' ? 'text' :
        /^(border(-[a-z]+)*-color|border(-(top|right|bottom|left|block|inline))?|outline(-color)?|fill|stroke|text-decoration-color|accent-color|caret-color)$/.test(prop) ? 'other' :
        null;
      if (!kind) continue;
      const value = resolveVars(raw, local);
      for (const c of colorsIn(value)) {
        if (c[3] < 0.35) continue; // see-through overlays and tints, not real palette colors
        const hex = toHex(c);
        if (kind === 'bg') add(bg, hex, w);
        if (kind === 'text') add(fg, hex, w);
        if (isAccent(c)) add(accent, hex, w * boost * (kind === 'other' ? 0.5 : 1));
      }
    }
  }

  const varsByHex = new Map<string, string[]>();
  for (const v of vars) varsByHex.set(v.hex, [...(varsByHex.get(v.hex) ?? []), v.name]);
  const top = (m: Map<string, number>, skip: Set<string> = new Set()): Swatch[] => {
    const sorted = [...m].filter(([h]) => !skip.has(h)).sort((a, b) => b[1] - a[1]);
    const out: Swatch[] = [];
    for (const [hex, uses] of sorted) {
      // Fold near-identical shades into the one used more.
      const near = out.find((s) => dist(rgbOf(s.hex), rgbOf(hex)) < 14);
      if (near) {
        near.uses += uses;
        continue;
      }
      out.push({ hex, uses, vars: (varsByHex.get(hex) ?? []).slice(0, 3) });
      if (out.length >= PER_GROUP) break;
    }
    return out.map((s) => ({ ...s, uses: Math.max(1, Math.round(s.uses)) }));
  };

  const backgrounds = top(bg);
  const text = top(fg);
  // Accents also come from variables named like brand colors, which a JavaScript-built page may not use in CSS rules.
  for (const v of vars) {
    const c = parseColor(v.hex)!;
    if (isAccent(c) && /primary|accent|brand|highlight|cta|link/i.test(v.name)) add(accent, v.hex, 3 + v.uses);
  }
  const accents = top(accent);
  return { vars, backgrounds, text, accents };
}

// Splits CSS into rules with their own declarations, noting which ones are for dark mode.
export function parseRules(css: string): Rule[] {
  const out: Rule[] = [];
  type Frame = { prelude: string; decls: string[]; dark: boolean };
  const stack: Frame[] = [];
  let start = 0;
  const re = /[{};]/g;
  let m: RegExpExecArray | null;
  const isDark = (p: string) => /prefers-color-scheme\s*:\s*dark/i.test(p) || (!p.startsWith('@') && /\bdark\b|=\s*["']?dark/i.test(p));
  while ((m = re.exec(css))) {
    const ch = m[0];
    const text = css.slice(start, m.index);
    start = m.index + 1;
    if (ch === '{') {
      const prelude = text.trim();
      stack.push({ prelude, decls: [], dark: isDark(prelude) || (stack.length > 0 && stack[stack.length - 1].dark) });
    } else if (ch === ';') {
      if (stack.length) stack[stack.length - 1].decls.push(text);
    } else {
      const f = stack.pop();
      if (!f) continue;
      f.decls.push(text);
      if (f.prelude.startsWith('@')) continue;
      // Nested rules (CSS nesting, or anything inside @media/@layer) keep their own selector.
      const decls: [string, string][] = [];
      for (const d of f.decls) {
        const i = d.indexOf(':');
        if (i < 0) continue;
        const k = d.slice(0, i).trim();
        const v = d.slice(i + 1).replace(/!important/i, '').trim();
        if (k && v) decls.push([k.startsWith('--') ? k : k.toLowerCase(), v]);
      }
      if (decls.length) out.push({ selector: f.prelude, decls, dark: f.dark });
    }
  }
  return out;
}

function resolveVars(v: string, vars: Map<string, string>): string {
  let out = v;
  for (let i = 0; i < 6 && out.includes('var('); i++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name: string, fallback?: string) => vars.get(name) ?? fallback ?? '');
  }
  return out;
}

// Every color written in a CSS value, like "1px solid #ddd" or "linear-gradient(red, rgb(0 0 0 / .5))".
export function colorsIn(value: string): RGBA[] {
  const v = value.replace(/url\([^)]*\)/gi, ' ');
  const out: RGBA[] = [];
  for (const m of v.matchAll(/(?:rgba?|hsla?|oklch|oklab|color)\([^()]*\)|#[0-9a-f]{3,8}\b|\b[a-z]{3,20}\b/gi)) {
    const c = parseColor(m[0]);
    if (c) out.push(c);
  }
  return out;
}

export function parseColor(raw: string): RGBA | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s[0] === '#') {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h) || ![3, 4, 6, 8].includes(h.length)) return null;
    const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
  }
  if (s in NAMED) {
    const n = NAMED[s];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  if (s === 'transparent') return [0, 0, 0, 0];
  const fn = s.match(/^(rgba?|hsla?|oklch|oklab|color)\(\s*([^()]*)\)$/);
  if (!fn) return null;
  const [main, alphaPart] = fn[2].split('/');
  let args = main.split(/[\s,]+/).filter(Boolean);
  // An alpha left empty by an unknown variable, like rgb(0 0 0 / var(--tw-bg-opacity)), counts as solid.
  let alpha = alphaPart !== undefined && alphaPart.trim() ? alphaPart.trim() : undefined;
  if (fn[1] === 'color') {
    // color(srgb r g b) or color(display-p3 r g b): close enough as sRGB.
    const space = args.shift();
    if (!space || !/srgb|display-p3|rec2020|a98-rgb/.test(space)) return null;
  }
  if (alpha === undefined && args.length === 4) alpha = args.pop();
  if (args.length !== 3) return null;
  const num = (x: string) => parseFloat(x);
  if (args.some((x) => isNaN(num(x)))) return null;
  const a = alpha === undefined ? 1 : alpha.endsWith('%') ? num(alpha) / 100 : num(alpha);
  if (isNaN(a)) return null;
  const pct = (x: string, scale: number) => (x.endsWith('%') ? (num(x) / 100) * scale : num(x));

  let rgb: [number, number, number];
  switch (fn[1]) {
    case 'rgb':
    case 'rgba':
      rgb = [pct(args[0], 255), pct(args[1], 255), pct(args[2], 255)];
      break;
    case 'color':
      rgb = [pct(args[0], 1) * 255, pct(args[1], 1) * 255, pct(args[2], 1) * 255];
      break;
    case 'hsl':
    case 'hsla':
      rgb = hslToRgb(hue(args[0]), num(args[1]) / 100, num(args[2]) / 100);
      break;
    case 'oklch': {
      const L = pct(args[0], 1);
      const C = pct(args[1], 0.4);
      const H = (hue(args[2]) * Math.PI) / 180;
      rgb = oklabToRgb(L, C * Math.cos(H), C * Math.sin(H));
      break;
    }
    default:
      rgb = oklabToRgb(pct(args[0], 1), pct(args[1], 0.4), pct(args[2], 0.4));
  }
  return [...(rgb.map((x) => Math.max(0, Math.min(255, Math.round(x)))) as [number, number, number]), Math.max(0, Math.min(1, a))];
}

function hue(x: string): number {
  const n = parseFloat(x);
  if (x.endsWith('turn')) return n * 360;
  if (x.endsWith('rad')) return (n * 180) / Math.PI;
  if (x.endsWith('grad')) return n * 0.9;
  return n;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055);
  return lin.map((x) => gamma(Math.max(0, Math.min(1, x))) * 255) as [number, number, number];
}

// A clear, saturated color that isn't nearly black or white: the kind used for buttons and links.
function isAccent([r, g, b]: RGBA): boolean {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return s >= 0.35 && l >= 0.18 && l <= 0.85;
}

const toHex = ([r, g, b]: RGBA) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const rgbOf = (hex: string): RGBA => parseColor(hex)!;

function dist([r1, g1, b1]: RGBA, [r2, g2, b2]: RGBA): number {
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

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

// CSS color keywords (without the grays' alternate spellings).
const NAMED: Record<string, number> = {
  black: 0x000000, white: 0xffffff, red: 0xff0000, green: 0x008000, blue: 0x0000ff, yellow: 0xffff00,
  orange: 0xffa500, purple: 0x800080, pink: 0xffc0cb, gray: 0x808080, grey: 0x808080, silver: 0xc0c0c0,
  maroon: 0x800000, navy: 0x000080, teal: 0x008080, olive: 0x808000, lime: 0x00ff00, aqua: 0x00ffff,
  cyan: 0x00ffff, fuchsia: 0xff00ff, magenta: 0xff00ff, brown: 0xa52a2a, gold: 0xffd700, indigo: 0x4b0082,
  violet: 0xee82ee, coral: 0xff7f50, crimson: 0xdc143c, salmon: 0xfa8072, tomato: 0xff6347, khaki: 0xf0e68c,
  beige: 0xf5f5dc, ivory: 0xfffff0, lavender: 0xe6e6fa, turquoise: 0x40e0d0, tan: 0xd2b48c, chocolate: 0xd2691e,
  whitesmoke: 0xf5f5f5, gainsboro: 0xdcdcdc, lightgray: 0xd3d3d3, lightgrey: 0xd3d3d3, darkgray: 0xa9a9a9,
  darkgrey: 0xa9a9a9, dimgray: 0x696969, dimgrey: 0x696969, slategray: 0x708090, slategrey: 0x708090,
  darkslategray: 0x2f4f4f, darkslategrey: 0x2f4f4f, ghostwhite: 0xf8f8ff, snow: 0xfffafa, linen: 0xfaf0e6,
  aliceblue: 0xf0f8ff, azure: 0xf0ffff, honeydew: 0xf0fff0, mintcream: 0xf5fffa, seashell: 0xfff5ee,
  oldlace: 0xfdf5e6, floralwhite: 0xfffaf0, cornsilk: 0xfff8dc, lemonchiffon: 0xfffacd, mistyrose: 0xffe4e1,
  darkblue: 0x00008b, darkred: 0x8b0000, darkgreen: 0x006400, royalblue: 0x4169e1, steelblue: 0x4682b4,
  dodgerblue: 0x1e90ff, deepskyblue: 0x00bfff, skyblue: 0x87ceeb, lightblue: 0xadd8e6, midnightblue: 0x191970,
  cornflowerblue: 0x6495ed, cadetblue: 0x5f9ea0, seagreen: 0x2e8b57, forestgreen: 0x228b22, limegreen: 0x32cd32,
  darkorange: 0xff8c00, orangered: 0xff4500, firebrick: 0xb22222, hotpink: 0xff69b4, deeppink: 0xff1493,
  rebeccapurple: 0x663399, darkviolet: 0x9400d3, orchid: 0xda70d6, plum: 0xdda0dd, goldenrod: 0xdaa520,
  sienna: 0xa0522d, peru: 0xcd853f, wheat: 0xf5deb3, lightyellow: 0xffffe0, lightgreen: 0x90ee90,
  palegreen: 0x98fb98, darkcyan: 0x008b8b, lightcyan: 0xe0ffff, mediumpurple: 0x9370db, slateblue: 0x6a5acd,
};
