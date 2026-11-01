// CSS to Tailwind: the converter itself. No DOM here, so it can be tested in Node.
// It handles common CSS, not everything: anything it can't map becomes an exact value in square brackets.
import { STEPS, V3, V4 } from './tailwind-palettes';

export type Version = 'v4' | 'v3';
export type Kind = 'exact' | 'near' | 'arbitrary';
export type Decl = { prop: string; value: string; important: boolean };

/** One Tailwind class, with the CSS it really produces (used to draw the preview) and how clean a match it is. */
export type Token = {
  cls: string; // full class, variants included
  kind: Kind;
  css: [string, string][]; // declarations this class sets
  from: string; // the CSS line it came from
  note?: string;
  variants: Variant[];
};

export type Variant = { prefix: string; minPx?: number; maxPx?: number; pseudo?: string; dark?: boolean; motion?: boolean };

export type RuleOut = {
  selector: string; // the element the classes go on
  tokens: Token[];
  original: { decls: Decl[]; variants: Variant[] }[]; // for the "Your CSS" preview
  notes: string[];
};

export type Result = { rules: RuleOut[]; error?: string; counts: Record<Kind, number> };

export type Options = { version: Version; snapColors: boolean; parseColor?: (s: string) => RGBA | null };

type RGBA = [number, number, number, number]; // 0..255, alpha 0..1
type Lab = [number, number, number];

// ---------------- CSS parsing ----------------

type RawRule = { selectors: string[]; decls: Decl[]; media: string[] };

function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseDecls(body: string): Decl[] {
  const out: Decl[] = [];
  for (const part of splitTop(body, ';')) {
    const i = part.indexOf(':');
    if (i < 1) continue;
    const prop = part.slice(0, i).trim();
    let value = part.slice(i + 1).trim().replace(/\s+/g, ' ');
    if (!prop || !value) continue;
    let important = false;
    if (/!\s*important$/i.test(value)) {
      important = true;
      value = value.replace(/\s*!\s*important$/i, '').trim();
    }
    out.push({ prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value, important });
  }
  return out;
}

/** Reads a stylesheet into flat rules. Plain declarations with no selector (an inline style) become one rule. */
export function parseCss(input: string): { rules: RawRule[]; error?: string } {
  let css = input.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const attr = css.match(/^style\s*=\s*(["'])([\s\S]*)\1$/i);
  if (attr) css = attr[2];
  if (!css) return { rules: [] };
  if (!css.includes('{')) {
    return { rules: [{ selectors: ['element'], decls: parseDecls(css), media: [] }] };
  }
  const rules: RawRule[] = [];
  let pos = 0;
  let error: string | undefined;

  function block(media: string[]): void {
    while (pos < css.length) {
      const open = nextBrace(pos);
      const close = css.indexOf('}', pos);
      if (close !== -1 && (open === -1 || close < open)) {
        if (css.slice(pos, close).trim()) {
          // declarations right inside an @media block, or stray text
          const decls = parseDecls(css.slice(pos, close));
          if (decls.length) rules.push({ selectors: ['element'], decls, media });
        }
        pos = close + 1;
        return;
      }
      if (open === -1) {
        if (css.slice(pos).trim()) error = 'Some CSS at the end has no { } around it, so we skipped it.';
        pos = css.length;
        return;
      }
      const head = css.slice(pos, open).trim().replace(/\s+/g, ' ');
      pos = open + 1;
      if (/^@media\b/i.test(head)) {
        block([...media, head.replace(/^@media\s*/i, '')]);
      } else if (/^@(supports|layer|container)\b/i.test(head)) {
        block(media);
      } else if (head.startsWith('@')) {
        skipBlock();
      } else {
        const end = findClose(pos);
        const body = css.slice(pos, end);
        pos = end + 1;
        if (body.includes('{')) {
          error = 'Nested CSS (a rule inside a rule) isn’t supported yet, so we skipped it.';
          continue;
        }
        const selectors = splitTop(head, ',').map((s) => s.trim()).filter(Boolean);
        if (selectors.length) rules.push({ selectors, decls: parseDecls(body), media });
      }
    }
  }
  function nextBrace(from: number): number {
    return css.indexOf('{', from);
  }
  function findClose(from: number): number {
    let depth = 0;
    for (let i = from; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        if (depth === 0) return i;
        depth--;
      }
    }
    error = 'A { is missing its closing }.';
    return css.length;
  }
  function skipBlock(): void {
    pos = findClose(pos) + 1;
  }
  block([]);
  return { rules, error };
}

// ---------------- Values ----------------

const n = (x: number) => +x.toFixed(4);

/** Length in px, or null for things like %, em, vh or calc(). */
export function toPx(v: string): number | null {
  const m = v.trim().match(/^(-?\d*\.?\d+)(px|rem)?$/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!m[2]) return num === 0 ? 0 : null;
  return m[2].toLowerCase() === 'rem' ? num * 16 : num;
}

const V3_SPACING = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96];

/** Spacing scale step for a px length ("4" for 16px), or null if it isn't on the scale. */
function spacingStep(px: number, v: Version): string | null {
  if (px === 1) return 'px';
  const step = px / 4;
  if (v === 'v3') return V3_SPACING.includes(step) ? String(step) : null;
  return Number.isInteger(step * 2) ? String(step) : null;
}

const FRACTIONS: [number, string][] = [
  [50, '1/2'], [100 / 3, '1/3'], [200 / 3, '2/3'], [25, '1/4'], [75, '3/4'], [20, '1/5'], [40, '2/5'], [60, '3/5'], [80, '4/5'],
  [100 / 6, '1/6'], [500 / 6, '5/6'], [100 / 12, '1/12'], [500 / 12, '5/12'], [700 / 12, '7/12'], [1100 / 12, '11/12'],
];

function fraction(v: string): string | null {
  const m = v.match(/^(\d*\.?\d+)%$/);
  if (!m) return null;
  const p = parseFloat(m[1]);
  if (p === 100) return 'full';
  const f = FRACTIONS.find(([x]) => Math.abs(x - p) < 0.01);
  return f ? f[1] : null;
}

/** Square-bracket value: spaces become underscores, as Tailwind expects. */
export function bracket(v: string): string {
  return '[' + v.trim().replace(/_/g, '\\_').replace(/\s*,\s*/g, ',').replace(/\s+/g, '_') + ']';
}

// ---------------- Colors ----------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToLab(r0: number, g0: number, b0: number): Lab {
  const r = toLinear(r0 / 255);
  const g = toLinear(g0 / 255);
  const b = toLinear(b0 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labToHex([L, A, B]: Lab): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return (
    '#' +
    [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
      .map((v) => Math.round(clamp(toGamma(v), 0, 1) * 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

type Swatch = { name: string; hex: string; lab: Lab };
const palettes: Partial<Record<Version, Swatch[]>> = {};

function palette(v: Version): Swatch[] {
  if (palettes[v]) return palettes[v]!;
  const out: Swatch[] = [
    { name: 'black', hex: '#000000', lab: [0, 0, 0] },
    { name: 'white', hex: '#ffffff', lab: [1, 0, 0] },
  ];
  if (v === 'v3') {
    for (const [fam, row] of Object.entries(V3)) {
      row.split(' ').forEach((h, i) => {
        out.push({ name: `${fam}-${STEPS[i]}`, hex: '#' + h, lab: rgbToLab(...hexToRgb(h)) });
      });
    }
  } else {
    for (const [fam, row] of Object.entries(V4)) {
      row.split(', ').forEach((t, i) => {
        const [L, C, H] = t.split(' ').map(Number);
        const h = (H * Math.PI) / 180;
        const lab: Lab = [L, C * Math.cos(h), C * Math.sin(h)];
        out.push({ name: `${fam}-${STEPS[i]}`, hex: labToHex(lab), lab });
      });
    }
  }
  return (palettes[v] = out);
}

const hexToRgb = (h: string): [number, number, number] => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

const NAMED: Record<string, string> = { white: 'ffffff', black: '000000', red: 'ff0000', blue: '0000ff', green: '008000', gray: '808080', grey: '808080', orange: 'ffa500', yellow: 'ffff00', purple: '800080', pink: 'ffc0cb' };

function num(s: string, scale: number): number {
  return s.endsWith('%') ? (parseFloat(s) / 100) * scale : parseFloat(s);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const k = (x: number) => (x + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (x: number) => l - a * Math.max(-1, Math.min(k(x) - 3, 9 - k(x), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export function parseColorBasic(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (NAMED[s]) return [...hexToRgb(NAMED[s]), 1];
  let m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
    return [...hexToRgb(h), a];
  }
  m = s.match(/^(rgba?|hsla?)\((.*)\)$/);
  if (m) {
    const parts = m[2].replace(/\s*\/\s*/, ',').split(/\s*,\s*|\s+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    if (parts.some((p) => !/^[-+]?(\d+\.?\d*|\.\d+)(%|deg)?$/.test(p))) return null;
    const a = parts[3] ? clamp(num(parts[3], 1), 0, 1) : 1;
    if (m[1].startsWith('rgb')) {
      const [r, g, b] = parts.slice(0, 3).map((p) => clamp(num(p, 255), 0, 255));
      return [r, g, b, a];
    }
    const sat = clamp(parseFloat(parts[1]) / 100, 0, 1);
    const lig = clamp(parseFloat(parts[2]) / 100, 0, 1);
    return [...hslToRgb(parseFloat(parts[0]), sat, lig), a];
  }
  return null;
}

const SNAP_LIMIT = 2.5; // OKLab x100. Under about 2.5 the two colors look the same side by side.

type ColorPick = { name: string; css: string; kind: Kind; note?: string };

function color(value: string, o: Options, typeHint: string): ColorPick | null {
  const v = value.trim();
  const low = v.toLowerCase();
  if (low === 'transparent') return { name: 'transparent', css: 'transparent', kind: 'exact' };
  if (low === 'currentcolor') return { name: 'current', css: 'currentColor', kind: 'exact' };
  if (low === 'inherit') return { name: 'inherit', css: 'inherit', kind: 'exact' };
  if (/^var\(/.test(low)) {
    return { name: bracket(`${typeHint}:${v}`), css: v, kind: 'arbitrary', note: 'A CSS variable. In Tailwind v4 you can also add it to your @theme.' };
  }
  const rgba = parseColorBasic(v) ?? o.parseColor?.(v) ?? null;
  if (!rgba) return null;
  const [r, g, b, a] = rgba;
  const lab = rgbToLab(r, g, b);
  let best: Swatch | null = null;
  let bestD = Infinity;
  for (const sw of palette(o.version)) {
    const d = Math.hypot(lab[0] - sw.lab[0], lab[1] - sw.lab[1], lab[2] - sw.lab[2]) * 100;
    if (d < bestD) {
      bestD = d;
      best = sw;
    }
  }
  const alpha = Math.round(a * 100);
  let suffix = '';
  let cssAlpha = '';
  if (alpha < 100) {
    suffix = o.version === 'v4' || alpha % 5 === 0 ? `/${alpha}` : `/[${n(a)}]`;
    cssAlpha = Math.round(a * 255).toString(16).padStart(2, '0');
  }
  if (best && (bestD < SNAP_LIMIT || o.snapColors)) {
    const exact = bestD < 0.5;
    return {
      name: best.name + suffix,
      css: best.hex + cssAlpha,
      kind: exact ? 'exact' : 'near',
      note: exact ? undefined : `Closest Tailwind color (difference ${bestD.toFixed(1)}, under 2.5 looks the same).`,
    };
  }
  const hex = '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  const val = alpha < 100 ? hex + cssAlpha : hex;
  return {
    name: `[${val}]`,
    css: val,
    kind: 'arbitrary',
    note: best ? `No Tailwind color is close. Nearest is ${best.name} (difference ${bestD.toFixed(1)}).` : undefined,
  };
}

// ---------------- Lookup tables ----------------

const FONT_SIZES_V3: [number, string, number][] = [
  [12, 'xs', 16], [14, 'sm', 20], [16, 'base', 24], [18, 'lg', 28], [20, 'xl', 28], [24, '2xl', 32], [30, '3xl', 36],
  [36, '4xl', 40], [48, '5xl', 0], [60, '6xl', 0], [72, '7xl', 0], [96, '8xl', 0], [128, '9xl', 0],
];

const WEIGHTS: Record<string, string> = { '100': 'thin', '200': 'extralight', '300': 'light', '400': 'normal', normal: 'normal', '500': 'medium', '600': 'semibold', '700': 'bold', bold: 'bold', '800': 'extrabold', '900': 'black' };

const LEADING: Record<string, string> = { '1': 'none', '1.25': 'tight', '1.375': 'snug', '1.5': 'normal', '1.625': 'relaxed', '2': 'loose' };

const TRACKING: Record<string, string> = { '-0.05em': 'tighter', '-0.025em': 'tight', '0': 'normal', '0em': 'normal', normal: 'normal', '0.025em': 'wide', '0.05em': 'wider', '0.1em': 'widest' };

const RADIUS_V3: Record<number, string> = { 0: 'none', 2: 'sm', 4: '', 6: 'md', 8: 'lg', 12: 'xl', 16: '2xl', 24: '3xl' };
const RADIUS_V4: Record<number, string> = { 0: 'none', 2: 'xs', 4: 'sm', 6: 'md', 8: 'lg', 12: 'xl', 16: '2xl', 24: '3xl', 32: '4xl' };

const SHADOWS_V3: Record<string, string> = {
  'shadow-sm': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  shadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  'shadow-md': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  'shadow-lg': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  'shadow-xl': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  'shadow-2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  'shadow-inner': 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
  'shadow-none': 'none',
};
const SHADOWS_V4: Record<string, string> = {
  'shadow-2xs': '0 1px rgb(0 0 0 / 0.05)',
  'shadow-xs': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  'shadow-sm': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  'shadow-md': SHADOWS_V3['shadow-md'],
  'shadow-lg': SHADOWS_V3['shadow-lg'],
  'shadow-xl': SHADOWS_V3['shadow-xl'],
  'shadow-2xl': SHADOWS_V3['shadow-2xl'],
  'inset-shadow-xs': 'inset 0 1px 1px rgb(0 0 0 / 0.05)',
  'shadow-none': 'none',
};

const MAX_W: [number, string, Version | 'both'][] = [
  [256, '3xs', 'v4'], [288, '2xs', 'v4'], [320, 'xs', 'both'], [384, 'sm', 'both'], [448, 'md', 'both'], [512, 'lg', 'both'], [576, 'xl', 'both'],
  [672, '2xl', 'both'], [768, '3xl', 'both'], [896, '4xl', 'both'], [1024, '5xl', 'both'], [1152, '6xl', 'both'], [1280, '7xl', 'both'],
];

const KEYWORDS: Record<string, Record<string, string>> = {
  display: { block: 'block', 'inline-block': 'inline-block', inline: 'inline', flex: 'flex', 'inline-flex': 'inline-flex', grid: 'grid', 'inline-grid': 'inline-grid', none: 'hidden', contents: 'contents', table: 'table', 'flow-root': 'flow-root', 'list-item': 'list-item' },
  position: { static: 'static', relative: 'relative', absolute: 'absolute', fixed: 'fixed', sticky: 'sticky' },
  'flex-direction': { row: 'flex-row', 'row-reverse': 'flex-row-reverse', column: 'flex-col', 'column-reverse': 'flex-col-reverse' },
  'flex-wrap': { wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' },
  'justify-content': { 'flex-start': 'justify-start', start: 'justify-start', center: 'justify-center', 'flex-end': 'justify-end', end: 'justify-end', 'space-between': 'justify-between', 'space-around': 'justify-around', 'space-evenly': 'justify-evenly', stretch: 'justify-stretch', normal: 'justify-normal' },
  'align-items': { 'flex-start': 'items-start', start: 'items-start', center: 'items-center', 'flex-end': 'items-end', end: 'items-end', baseline: 'items-baseline', stretch: 'items-stretch' },
  'align-self': { auto: 'self-auto', 'flex-start': 'self-start', start: 'self-start', center: 'self-center', 'flex-end': 'self-end', end: 'self-end', stretch: 'self-stretch', baseline: 'self-baseline' },
  'align-content': { 'flex-start': 'content-start', start: 'content-start', center: 'content-center', 'flex-end': 'content-end', end: 'content-end', 'space-between': 'content-between', 'space-around': 'content-around', 'space-evenly': 'content-evenly', stretch: 'content-stretch' },
  'justify-items': { start: 'justify-items-start', center: 'justify-items-center', end: 'justify-items-end', stretch: 'justify-items-stretch' },
  'justify-self': { auto: 'justify-self-auto', start: 'justify-self-start', center: 'justify-self-center', end: 'justify-self-end', stretch: 'justify-self-stretch' },
  'place-items': { start: 'place-items-start', center: 'place-items-center', end: 'place-items-end', stretch: 'place-items-stretch' },
  'place-content': { start: 'place-content-start', center: 'place-content-center', end: 'place-content-end', 'space-between': 'place-content-between', stretch: 'place-content-stretch' },
  'text-align': { left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify', start: 'text-start', end: 'text-end' },
  'text-transform': { uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case' },
  'text-decoration': { underline: 'underline', 'line-through': 'line-through', overline: 'overline', none: 'no-underline' },
  'text-decoration-line': { underline: 'underline', 'line-through': 'line-through', overline: 'overline', none: 'no-underline' },
  'font-style': { italic: 'italic', normal: 'not-italic' },
  'white-space': { normal: 'whitespace-normal', nowrap: 'whitespace-nowrap', pre: 'whitespace-pre', 'pre-line': 'whitespace-pre-line', 'pre-wrap': 'whitespace-pre-wrap', 'break-spaces': 'whitespace-break-spaces' },
  'text-overflow': { ellipsis: 'text-ellipsis', clip: 'text-clip' },
  'vertical-align': { baseline: 'align-baseline', top: 'align-top', middle: 'align-middle', bottom: 'align-bottom', 'text-top': 'align-text-top', 'text-bottom': 'align-text-bottom', sub: 'align-sub', super: 'align-super' },
  overflow: { auto: 'overflow-auto', hidden: 'overflow-hidden', visible: 'overflow-visible', scroll: 'overflow-scroll', clip: 'overflow-clip' },
  'overflow-x': { auto: 'overflow-x-auto', hidden: 'overflow-x-hidden', visible: 'overflow-x-visible', scroll: 'overflow-x-scroll', clip: 'overflow-x-clip' },
  'overflow-y': { auto: 'overflow-y-auto', hidden: 'overflow-y-hidden', visible: 'overflow-y-visible', scroll: 'overflow-y-scroll', clip: 'overflow-y-clip' },
  'box-sizing': { 'border-box': 'box-border', 'content-box': 'box-content' },
  'object-fit': { contain: 'object-contain', cover: 'object-cover', fill: 'object-fill', none: 'object-none', 'scale-down': 'object-scale-down' },
  'object-position': { center: 'object-center', top: 'object-top', bottom: 'object-bottom', left: 'object-left', right: 'object-right' },
  cursor: { auto: 'cursor-auto', default: 'cursor-default', pointer: 'cursor-pointer', wait: 'cursor-wait', text: 'cursor-text', move: 'cursor-move', 'not-allowed': 'cursor-not-allowed', grab: 'cursor-grab', grabbing: 'cursor-grabbing', help: 'cursor-help', 'zoom-in': 'cursor-zoom-in', 'zoom-out': 'cursor-zoom-out', crosshair: 'cursor-crosshair' },
  'pointer-events': { none: 'pointer-events-none', auto: 'pointer-events-auto' },
  'user-select': { none: 'select-none', text: 'select-text', all: 'select-all', auto: 'select-auto' },
  visibility: { hidden: 'invisible', visible: 'visible', collapse: 'collapse' },
  'list-style-type': { none: 'list-none', disc: 'list-disc', decimal: 'list-decimal' },
  'list-style': { none: 'list-none', disc: 'list-disc', decimal: 'list-decimal' },
  'background-size': { cover: 'bg-cover', contain: 'bg-contain', auto: 'bg-auto' },
  'background-position': { center: 'bg-center', top: 'bg-top', bottom: 'bg-bottom', left: 'bg-left', right: 'bg-right' },
  'background-repeat': { 'no-repeat': 'bg-no-repeat', repeat: 'bg-repeat', 'repeat-x': 'bg-repeat-x', 'repeat-y': 'bg-repeat-y' },
  'background-attachment': { fixed: 'bg-fixed', local: 'bg-local', scroll: 'bg-scroll' },
  'border-style': { solid: 'border-solid', dashed: 'border-dashed', dotted: 'border-dotted', double: 'border-double', none: 'border-none', hidden: 'border-hidden' },
  'outline-style': { none: 'outline-none', solid: 'outline-solid', dashed: 'outline-dashed', dotted: 'outline-dotted' },
  'table-layout': { auto: 'table-auto', fixed: 'table-fixed' },
  'border-collapse': { collapse: 'border-collapse', separate: 'border-separate' },
  resize: { none: 'resize-none', vertical: 'resize-y', horizontal: 'resize-x', both: 'resize' },
  'mix-blend-mode': { multiply: 'mix-blend-multiply', screen: 'mix-blend-screen', overlay: 'mix-blend-overlay', normal: 'mix-blend-normal' },
  isolation: { isolate: 'isolate', auto: 'isolation-auto' },
  'scroll-behavior': { smooth: 'scroll-smooth', auto: 'scroll-auto' },
  appearance: { none: 'appearance-none', auto: 'appearance-auto' },
  'word-break': { 'break-all': 'break-all', 'keep-all': 'break-keep', normal: 'break-normal' },
  'font-family': { 'sans-serif': 'font-sans', serif: 'font-serif', monospace: 'font-mono' },
};

// ---------------- Converting one declaration ----------------

type Piece = { cls: string; kind: Kind; css: [string, string][]; note?: string };

const ex = (cls: string, css: [string, string][], note?: string): Piece => ({ cls, kind: 'exact', css, note });
const arb = (cls: string, css: [string, string][], note?: string): Piece => ({ cls, kind: 'arbitrary', css, note });

/** Any property, as an arbitrary property class like [mask-type:luminance]. */
function rawProp(d: Decl): Piece {
  return arb(`[${d.prop}:${bracket(d.value).slice(1)}`, [[d.prop, d.value]], 'No ready-made Tailwind class for this, so it’s kept as written.');
}

function spacing(prefix: string, prop: string, value: string, v: Version, allowNeg = true): Piece {
  const val = value.trim();
  if (val === 'auto') return ex(`${prefix}-auto`, [[prop, 'auto']]);
  const px = toPx(val);
  if (px !== null) {
    const neg = px < 0;
    const step = spacingStep(Math.abs(px), v);
    if (step !== null && (!neg || allowNeg)) {
      return ex(`${neg ? '-' : ''}${prefix}-${step}`, [[prop, px === 0 ? '0' : `${n(px / 16)}rem`]]);
    }
    return arb(`${prefix}-${bracket(val)}`, [[prop, val]], 'Not on Tailwind’s spacing scale (steps of 4px).');
  }
  const f = fraction(val);
  if (f && ['top', 'right', 'bottom', 'left', 'inset'].includes(prefix)) return ex(`${prefix}-${f}`, [[prop, val]]);
  return arb(`${prefix}-${bracket(val)}`, [[prop, val]]);
}

/** margin / padding / inset with 1–4 values, written the short way when sides match. */
function boxSides(kind: 'm' | 'p', base: string, value: string, v: Version): Piece[] {
  const parts = splitTop(value, ' ').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 1 || parts.length > 4) return [];
  const [t, r = t, b = t, l = r] = parts;
  const side = (s: string, p: string) => spacing(`${kind}${s}`, `${base}-${p}`, p === 'top' ? t : p === 'right' ? r : p === 'bottom' ? b : l, v, kind === 'm');
  if (t === r && r === b && b === l) {
    const one = spacing(kind, base, t, v, kind === 'm');
    one.css = ['top', 'right', 'bottom', 'left'].map((p) => [`${base}-${p}`, one.css[0][1]]);
    return [one];
  }
  const out: Piece[] = [];
  if (t === b) {
    const y = spacing(`${kind}y`, `${base}-top`, t, v, kind === 'm');
    y.css.push([`${base}-bottom`, y.css[0][1]]);
    out.push(y);
  } else out.push(side('t', 'top'), side('b', 'bottom'));
  if (l === r) {
    const x = spacing(`${kind}x`, `${base}-left`, l, v, kind === 'm');
    x.css.push([`${base}-right`, x.css[0][1]]);
    out.push(x);
  } else out.push(side('l', 'left'), side('r', 'right'));
  return out;
}

function size(prefix: string, prop: string, value: string, v: Version): Piece {
  const val = value.trim().toLowerCase();
  const kw: Record<string, string> = { auto: 'auto', 'fit-content': 'fit', 'min-content': 'min', 'max-content': 'max', none: 'none' };
  if (kw[val] && (val !== 'none' || prefix.startsWith('max'))) return ex(`${prefix}-${kw[val]}`, [[prop, val]]);
  if (val === '100vw' && prefix.includes('w')) return ex(`${prefix}-screen`, [[prop, '100vw']]);
  if (val === '100vh' && prefix.includes('h')) return ex(`${prefix}-screen`, [[prop, '100vh']]);
  if (val === '100dvh' && prefix.includes('h')) return ex(`${prefix}-dvh`, [[prop, '100dvh']]);
  if (val === '65ch' && prefix === 'max-w') return ex('max-w-prose', [[prop, '65ch']]);
  const f = fraction(val);
  if (f) return ex(`${prefix}-${f}`, [[prop, val]]);
  const px = toPx(val);
  if (px !== null && prefix === 'max-w') {
    const hit = MAX_W.find(([p, , ver]) => p === px && (ver === 'both' || ver === v));
    if (hit) return ex(`max-w-${hit[1]}`, [[prop, `${hit[0] / 16}rem`]]);
  }
  if (px !== null && px >= 0) {
    const step = spacingStep(px, v);
    if (step !== null) return ex(`${prefix}-${step}`, [[prop, px === 0 ? '0' : `${n(px / 16)}rem`]]);
  }
  return arb(`${prefix}-${bracket(value)}`, [[prop, value]], px !== null ? 'Not on Tailwind’s size scale.' : undefined);
}

function radius(prefix: string, props: string[], value: string, v: Version): Piece {
  const px = toPx(value);
  const table = v === 'v4' ? RADIUS_V4 : RADIUS_V3;
  const css = (val: string) => props.map((p) => [p, val] as [string, string]);
  if (px !== null && px >= 999) return ex(`${prefix}-full`, css('9999px'));
  if (px !== null && table[px] !== undefined) {
    const s = table[px];
    return ex(s ? `${prefix}-${s}` : prefix, css(px === 0 ? '0' : `${n(px / 16)}rem`));
  }
  return arb(`${prefix}-${bracket(value)}`, css(value), value.trim() === '50%' ? 'rounded-full looks the same on a square.' : undefined);
}

function borderWidth(prefix: string, props: string[], value: string, v: Version): Piece | null {
  const px = toPx(value) ?? ({ thin: 1, medium: 3, thick: 5 } as Record<string, number>)[value];
  if (px === undefined || px === null) return null;
  const css = (val: string) => props.map((p) => [p, val] as [string, string]);
  if (px === 1) return ex(prefix, css('1px'));
  if ([0, 2, 4, 8].includes(px) || (v === 'v4' && Number.isInteger(px) && px >= 0)) return ex(`${prefix}-${px}`, css(`${px}px`));
  return arb(`${prefix}-${bracket(value)}`, css(value));
}

const SIDES: Record<string, string> = { top: 't', right: 'r', bottom: 'b', left: 'l' };

function colorPiece(prefix: string, props: string[], value: string, o: Options, hint = 'color'): Piece | null {
  const c = color(value, o, hint);
  if (!c) return null;
  return { cls: `${prefix}-${c.name}`, kind: c.kind, css: props.map((p) => [p, c.css]), note: c.note };
}

function border(prefix: string, sideProps: string[], value: string, o: Options): Piece[] {
  const v = value.trim().toLowerCase();
  if (v === 'none' || v === '0') return [ex(`${prefix}-0`, sideProps.map((p) => [`${p}-width`, '0px']))];
  const out: Piece[] = [];
  let style = '';
  for (const part of splitTop(value, ' ').map((s) => s.trim()).filter(Boolean)) {
    const w = borderWidth(prefix, sideProps.map((p) => `${p}-width`), part, o.version);
    if (w) {
      out.push(w);
      continue;
    }
    if (KEYWORDS['border-style'][part.toLowerCase()]) {
      style = part.toLowerCase();
      continue;
    }
    const c = colorPiece(prefix, sideProps.map((p) => `${p}-color`), part, o);
    if (c) out.push(c);
    else out.push(arb(`${prefix}-${bracket(part)}`, sideProps.map((p) => [p, part])));
  }
  // CSS draws a 3px ("medium") border when no width is given
  if (!out.some((p) => p.css[0]?.[0].endsWith('-width'))) out.unshift(borderWidth(prefix, sideProps.map((p) => `${p}-width`), '3px', o.version)!);
  const styleProps = sideProps.map((p) => [`${p}-style`, style || 'solid'] as [string, string]);
  if (style && style !== 'solid') out.push(ex(`border-${style}`, [['border-style', style]]));
  else out[0].css.push(...styleProps); // Tailwind's border classes are solid by default
  return out;
}

function normShadow(s: string): string {
  return s
    .toLowerCase()
    .replace(/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([\d.]+)\s*\)/g, (_, a) => `rgb(0 0 0 / ${parseFloat(a)})`)
    .replace(/rgb\(0 0 0 \/ 0?(\.\d+)\)/g, 'rgb(0 0 0 / 0$1)')
    .replace(/\b0px\b/g, '0')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shadow(value: string, v: Version): Piece {
  const table = v === 'v4' ? SHADOWS_V4 : SHADOWS_V3;
  const want = normShadow(value);
  for (const [cls, css] of Object.entries(table)) if (normShadow(css) === want) return ex(cls, [['box-shadow', css]]);
  // closest preset by blur, for the hint
  const blur = (s: string) => parseFloat(s.replace(/^inset /, '').split(' ')[2] ?? '0') || 0;
  const mine = blur(want);
  let near = '';
  let d = Infinity;
  for (const [cls, css] of Object.entries(table)) {
    if (css === 'none' || cls.includes('inset') !== want.startsWith('inset')) continue;
    const dd = Math.abs(blur(normShadow(css)) - mine);
    if (dd < d) {
      d = dd;
      near = cls;
    }
  }
  return arb(`shadow-${bracket(value)}`, [['box-shadow', value]], near ? `Not a Tailwind preset. The closest look is ${near}.` : undefined);
}

function fontSize(value: string, v: Version): Piece {
  const px = toPx(value);
  const hit = px !== null ? FONT_SIZES_V3.find(([p]) => p === px) : undefined;
  if (hit) {
    const css: [string, string][] = [['font-size', `${n(hit[0] / 16)}rem`]];
    css.push(['line-height', hit[2] ? (v === 'v4' ? String(n(hit[2] / hit[0])) : `${n(hit[2] / 16)}rem`) : '1']);
    return ex(`text-${hit[1]}`, css, 'Tailwind’s text sizes also set a line height. Add a leading-* class to change it.');
  }
  const val = /^var\(/.test(value) ? `length:${value}` : value;
  return arb(`text-${bracket(val)}`, [['font-size', value]]);
}

function lineHeight(value: string, v: Version): Piece {
  const val = value.trim();
  if (LEADING[val]) return ex(`leading-${LEADING[val]}`, [['line-height', val]]);
  if (val === 'normal') return ex('leading-normal', [['line-height', '1.5']], 'Tailwind’s leading-normal is 1.5, a bit taller than the browser’s “normal”.');
  const px = toPx(val);
  if (px !== null && px > 0) {
    const step = px / 4;
    if ((v === 'v3' && step >= 3 && step <= 10 && Number.isInteger(step)) || (v === 'v4' && Number.isInteger(step * 2))) {
      return ex(`leading-${step}`, [['line-height', `${n(px / 16)}rem`]]);
    }
  }
  return arb(`leading-${bracket(val)}`, [['line-height', val]]);
}

function gridTemplate(prefix: string, prop: string, value: string): Piece {
  const v = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (v === 'none') return ex(`${prefix}-none`, [[prop, 'none']]);
  if (v === 'subgrid') return ex(`${prefix}-subgrid`, [[prop, 'subgrid']]);
  let m = v.match(/^repeat\((\d+), ?(minmax\(0, ?1fr\)|1fr)\)$/);
  if (m) return { cls: `${prefix}-${m[1]}`, kind: m[2] === '1fr' ? 'near' : 'exact', css: [[prop, `repeat(${m[1]}, minmax(0, 1fr))`]], note: m[2] === '1fr' ? 'Tailwind uses minmax(0, 1fr), which stops long content from stretching a column.' : undefined };
  const parts = v.split(' ');
  if (parts.every((p) => p === '1fr')) return { cls: `${prefix}-${parts.length}`, kind: 'near', css: [[prop, `repeat(${parts.length}, minmax(0, 1fr))`]], note: 'Tailwind uses minmax(0, 1fr), which stops long content from stretching a column.' };
  return arb(`${prefix}-${bracket(value)}`, [[prop, value]]);
}

function gridSpan(prefix: 'col' | 'row', prop: string, value: string): Piece {
  const v = value.trim().toLowerCase().replace(/\s+/g, ' ');
  let m = v.match(/^span (\d+)(?: \/ span \1)?$/);
  if (m) return ex(`${prefix}-span-${m[1]}`, [[prop, `span ${m[1]} / span ${m[1]}`]]);
  if (v === '1 / -1') return ex(`${prefix}-span-full`, [[prop, '1 / -1']]);
  m = v.match(/^(\d+) \/ (\d+)$/);
  if (m) return ex(`${prefix}-start-${m[1]} ${prefix}-end-${m[2]}`, [[`${prop}-start`, m[1]], [`${prop}-end`, m[2]]]);
  return arb(`${prefix}-${bracket(value)}`, [[prop, value]]);
}

function opacity(value: string, v: Version): Piece {
  const val = value.trim();
  const a = val.endsWith('%') ? parseFloat(val) : parseFloat(val) * 100;
  if (Number.isFinite(a) && Number.isInteger(+a.toFixed(4)) && (v === 'v4' || a % 5 === 0)) return ex(`opacity-${+a.toFixed(4)}`, [['opacity', String(n(a / 100))]]);
  return arb(`opacity-${bracket(val)}`, [['opacity', val]]);
}

function zIndex(value: string, v: Version): Piece {
  const val = value.trim();
  if (val === 'auto') return ex('z-auto', [['z-index', 'auto']]);
  const z = Number(val);
  if (Number.isInteger(z) && ([0, 10, 20, 30, 40, 50].includes(z) || (v === 'v4' && z >= 0))) return ex(`z-${z}`, [['z-index', String(z)]]);
  if (Number.isInteger(z) && z < 0 && [10, 20, 30, 40, 50].includes(-z)) return ex(`-z-${-z}`, [['z-index', String(z)]]);
  return arb(`z-${bracket(val)}`, [['z-index', val]]);
}

function flex(value: string): Piece {
  const v = value.trim().toLowerCase().replace(/\s+/g, ' ');
  const map: Record<string, [string, string]> = {
    '1': ['flex-1', '1 1 0%'], '1 1 0%': ['flex-1', '1 1 0%'], '1 1 0': ['flex-1', '1 1 0%'],
    auto: ['flex-auto', '1 1 auto'], '1 1 auto': ['flex-auto', '1 1 auto'],
    none: ['flex-none', 'none'], '0 0 auto': ['flex-none', 'none'],
    initial: ['flex-initial', '0 1 auto'], '0 1 auto': ['flex-initial', '0 1 auto'],
  };
  if (map[v]) return ex(map[v][0], [['flex', map[v][1]]]);
  return arb(`flex-${bracket(value)}`, [['flex', value]]);
}

function convertDecl(d: Decl, o: Options): Piece[] {
  const v = o.version;
  const p = d.prop;
  const val = d.value.trim();
  const low = val.toLowerCase();

  if (p.startsWith('--')) return [rawProp(d)];
  if (['inherit', 'initial', 'unset', 'revert'].includes(low) && !['color', 'background-color'].includes(p)) return [rawProp(d)];

  if (KEYWORDS[p]?.[low]) {
    const cls = KEYWORDS[p][low];
    const css: [string, string][] = [[p, val]];
    if (cls === 'hidden') css[0] = ['display', 'none'];
    if (p === 'font-family') return [{ cls, kind: 'near', css: [[p, val]], note: 'Uses Tailwind’s default font stack for this family.' }];
    return [ex(cls, css)];
  }

  switch (p) {
    case 'margin':
      return boxSides('m', 'margin', val, v);
    case 'padding':
      return boxSides('p', 'padding', val, v);
    case 'margin-top': case 'margin-right': case 'margin-bottom': case 'margin-left':
      return [spacing(`m${SIDES[p.slice(7)]}`, p, val, v)];
    case 'padding-top': case 'padding-right': case 'padding-bottom': case 'padding-left':
      return [spacing(`p${SIDES[p.slice(8)]}`, p, val, v, false)];
    case 'margin-inline': case 'padding-inline':
      return [spacing(`${p[0]}x`, p, val, v, p[0] === 'm')];
    case 'margin-block': case 'padding-block':
      return [spacing(`${p[0]}y`, p, val, v, p[0] === 'm')];
    case 'gap': {
      const parts = splitTop(val, ' ').filter(Boolean);
      if (parts.length === 2) return [spacing('gap-y', 'row-gap', parts[0], v, false), spacing('gap-x', 'column-gap', parts[1], v, false)];
      const g = spacing('gap', 'gap', val, v, false);
      return [g];
    }
    case 'row-gap':
      return [spacing('gap-y', p, val, v, false)];
    case 'column-gap':
      return [spacing('gap-x', p, val, v, false)];
    case 'top': case 'right': case 'bottom': case 'left':
      return [spacing(p, p, val, v)];
    case 'inset': {
      const parts = splitTop(val, ' ').filter(Boolean);
      if (parts.length === 1) {
        const one = spacing('inset', 'inset', val, v);
        return [one];
      }
      return [rawProp(d)];
    }
    case 'width': return [size('w', p, val, v)];
    case 'height': return [size('h', p, val, v)];
    case 'min-width': return [size('min-w', p, val, v)];
    case 'min-height': return [size('min-h', p, val, v)];
    case 'max-width': return [size('max-w', p, val, v)];
    case 'max-height': return [size('max-h', p, val, v)];
    case 'flex-basis': return [size('basis', p, val, v)];

    case 'color': {
      const c = colorPiece('text', ['color'], val, o);
      return [c ?? rawProp(d)];
    }
    case 'background-color': {
      const c = colorPiece('bg', ['background-color'], val, o);
      return [c ?? rawProp(d)];
    }
    case 'background': {
      if (low === 'none') return [ex('bg-none', [['background-image', 'none']])];
      const c = colorPiece('bg', ['background-color'], val, o);
      if (c) return [c];
      return [rawProp(d)];
    }
    case 'background-image':
      if (low === 'none') return [ex('bg-none', [[p, 'none']])];
      return [arb(`bg-${bracket(val)}`, [[p, val]])];
    case 'border-color': {
      const c = colorPiece('border', [p], val, o);
      return [c ?? rawProp(d)];
    }
    case 'outline-color': case 'text-decoration-color': case 'caret-color': case 'accent-color': case 'fill': case 'stroke': {
      const pre = { 'outline-color': 'outline', 'text-decoration-color': 'decoration', 'caret-color': 'caret', 'accent-color': 'accent', fill: 'fill', stroke: 'stroke' }[p]!;
      const c = colorPiece(pre, [p], val, o);
      return [c ?? rawProp(d)];
    }

    case 'font-size': return [fontSize(val, v)];
    case 'font-weight':
      if (WEIGHTS[low]) return [ex(`font-${WEIGHTS[low]}`, [[p, low === 'bold' ? '700' : low === 'normal' ? '400' : low]])];
      return [arb(`font-${bracket(val)}`, [[p, val]])];
    case 'line-height': return [lineHeight(val, v)];
    case 'letter-spacing':
      if (TRACKING[low]) return [ex(`tracking-${TRACKING[low]}`, [[p, low === 'normal' ? '0' : low]])];
      return [arb(`tracking-${bracket(val)}`, [[p, val]])];
    case 'font-family': {
      const first = splitTop(val, ',')[0].trim().replace(/^["']|["']$/g, '');
      return [arb(`font-${bracket(val.replace(/"/g, "'"))}`, [[p, val]], `A custom font. In Tailwind v4 you can add “--font-brand: ${first}, …” to your @theme and use font-brand.`)];
    }

    case 'border': return border('border', ['border'], val, o);
    case 'border-top': case 'border-right': case 'border-bottom': case 'border-left':
      return border(`border-${SIDES[p.slice(7)]}`, [p], val, o);
    case 'border-width': {
      const w = borderWidth('border', [p], val, v);
      return [w ?? rawProp(d)];
    }
    case 'border-top-width': case 'border-right-width': case 'border-bottom-width': case 'border-left-width': {
      const w = borderWidth(`border-${SIDES[p.split('-')[1]]}`, [p], val, v);
      return [w ?? rawProp(d)];
    }
    case 'border-top-color': case 'border-right-color': case 'border-bottom-color': case 'border-left-color': {
      const c = colorPiece(`border-${SIDES[p.split('-')[1]]}`, [p], val, o);
      return [c ?? rawProp(d)];
    }
    case 'border-radius': {
      const parts = splitTop(val, ' ').filter(Boolean);
      if (parts.length === 1 && !val.includes('/')) return [radius('rounded', [p], val, v)];
      if (val.includes('/') || parts.length > 4) return [rawProp(d)];
      const [tl, tr = tl, br = tl, bl = tr] = parts;
      return [
        radius('rounded-tl', ['border-top-left-radius'], tl, v),
        radius('rounded-tr', ['border-top-right-radius'], tr, v),
        radius('rounded-br', ['border-bottom-right-radius'], br, v),
        radius('rounded-bl', ['border-bottom-left-radius'], bl, v),
      ];
    }
    case 'border-top-left-radius': return [radius('rounded-tl', [p], val, v)];
    case 'border-top-right-radius': return [radius('rounded-tr', [p], val, v)];
    case 'border-bottom-right-radius': return [radius('rounded-br', [p], val, v)];
    case 'border-bottom-left-radius': return [radius('rounded-bl', [p], val, v)];
    case 'box-shadow': return [shadow(val, v)];
    case 'outline': {
      if (low === 'none' || low === '0') return [ex('outline-none', [['outline-style', 'none']])];
      const out: Piece[] = [];
      let style = 'solid';
      for (const part of splitTop(val, ' ').map((x) => x.trim()).filter(Boolean)) {
        const w = borderWidth('outline', ['outline-width'], part, v);
        if (w) out.push(w);
        else if (KEYWORDS['outline-style'][part.toLowerCase()]) style = part.toLowerCase();
        else {
          const c = colorPiece('outline', ['outline-color'], part, o);
          if (!c) return [rawProp(d)];
          out.push(c);
        }
      }
      if (style !== 'solid') out.push(ex(`outline-${style}`, [['outline-style', style]]));
      else if (v === 'v3') out.unshift(ex('outline', [['outline-style', 'solid']]));
      else if (out[0]) out[0].css.push(['outline-style', 'solid']);
      return out;
    }
    case 'transition': {
      const parts = low.split(' ');
      if (low.includes(',') || parts.length < 2 || parts.length > 3) return [rawProp(d)];
      const props: Record<string, [string, string]> = {
        all: ['transition-all', 'all'], background: ['transition-colors', 'color, background-color, border-color'], 'background-color': ['transition-colors', 'color, background-color, border-color'],
        color: ['transition-colors', 'color, background-color, border-color'], 'border-color': ['transition-colors', 'color, background-color, border-color'],
        opacity: ['transition-opacity', 'opacity'], transform: ['transition-transform', 'transform'], 'box-shadow': ['transition-shadow', 'box-shadow'],
      };
      const pr = props[parts[0]];
      const dur = parts[1].endsWith('ms') ? parseFloat(parts[1]) : parseFloat(parts[1]) * 1000;
      const ease: Record<string, string> = { ease: 'ease-in-out', 'ease-in-out': 'ease-in-out', 'ease-in': 'ease-in', 'ease-out': 'ease-out', linear: 'ease-linear' };
      const e = parts[2] ? ease[parts[2]] : undefined;
      if (!pr || !Number.isFinite(dur) || (parts[2] && !e)) return [rawProp(d)];
      const note = 'Tailwind’s timing curves differ slightly from plain CSS ones; you won’t notice the difference.';
      const outT: Piece[] = [
        { cls: pr[0], kind: 'near', css: [['transition-property', pr[1]], ['transition-timing-function', 'cubic-bezier(0.4, 0, 0.2, 1)']], note },
        [0, 75, 100, 150, 200, 300, 500, 700, 1000].includes(dur) || (v === 'v4' && Number.isInteger(dur)) ? ex(`duration-${dur}`, [['transition-duration', `${dur}ms`]]) : arb(`duration-${bracket(parts[1])}`, [['transition-duration', parts[1]]]),
      ];
      if (e && e !== 'ease-in-out') outT.push({ cls: e, kind: 'near', css: [['transition-timing-function', parts[2] === 'linear' ? 'linear' : parts[2] === 'ease-in' ? 'cubic-bezier(0.4, 0, 1, 1)' : 'cubic-bezier(0, 0, 0.2, 1)']], note });
      return outT;
    }
    case 'outline-width': {
      const w = borderWidth('outline', [p], val, v);
      return [w ?? rawProp(d)];
    }
    case 'outline-offset': {
      const px = toPx(val);
      if (px !== null && [0, 1, 2, 4, 8].includes(px)) return [ex(`outline-offset-${px}`, [[p, `${px}px`]])];
      return [arb(`outline-offset-${bracket(val)}`, [[p, val]])];
    }

    case 'opacity': return [opacity(val, v)];
    case 'z-index': return [zIndex(val, v)];
    case 'flex': return [flex(val)];
    case 'flex-grow':
      if (val === '1') return [ex('grow', [[p, '1']])];
      if (val === '0') return [ex('grow-0', [[p, '0']])];
      return [rawProp(d)];
    case 'flex-shrink':
      if (val === '1') return [ex('shrink', [[p, '1']])];
      if (val === '0') return [ex('shrink-0', [[p, '0']])];
      return [rawProp(d)];
    case 'order': {
      const o2 = Number(val);
      if (Number.isInteger(o2) && o2 >= 1 && o2 <= 12) return [ex(`order-${o2}`, [[p, val]])];
      if (o2 === 0) return [ex('order-none', [[p, '0']])];
      return [arb(`order-${bracket(val)}`, [[p, val]])];
    }
    case 'grid-template-columns': return [gridTemplate('grid-cols', p, val)];
    case 'grid-template-rows': return [gridTemplate('grid-rows', p, val)];
    case 'grid-column': return [gridSpan('col', p, val)];
    case 'grid-row': return [gridSpan('row', p, val)];
    case 'grid-auto-flow': {
      const m: Record<string, string> = { row: 'grid-flow-row', column: 'grid-flow-col', dense: 'grid-flow-dense', 'row dense': 'grid-flow-row-dense', 'column dense': 'grid-flow-col-dense' };
      return m[low] ? [ex(m[low], [[p, val]])] : [rawProp(d)];
    }
    case 'aspect-ratio': {
      const r = low.replace(/\s+/g, '');
      if (r === '1/1' || r === '1') return [ex('aspect-square', [[p, '1 / 1']])];
      if (r === '16/9') return [ex('aspect-video', [[p, '16 / 9']])];
      if (r === 'auto') return [ex('aspect-auto', [[p, 'auto']])];
      return [arb(`aspect-${bracket(r)}`, [[p, val]])];
    }
    case 'transition-duration': {
      const ms = low.endsWith('ms') ? parseFloat(low) : parseFloat(low) * 1000;
      if ([0, 75, 100, 150, 200, 300, 500, 700, 1000].includes(ms) || (v === 'v4' && Number.isInteger(ms))) return [ex(`duration-${ms}`, [[p, `${ms}ms`]])];
      return [arb(`duration-${bracket(val)}`, [[p, val]])];
    }
    case 'content':
      return [arb(`content-${bracket(val.replace(/"/g, "'"))}`, [[p, val]], val === '""' || val === "''" ? 'Needed for before: and after: to show up.' : undefined)];
  }
  return [rawProp(d)];
}

// ---------------- Selectors and variants ----------------

const BREAKPOINTS: [number, string][] = [[640, 'sm'], [768, 'md'], [1024, 'lg'], [1280, 'xl'], [1536, '2xl']];

function mediaVariant(media: string): { variant?: Variant; note?: string } {
  const m = media.toLowerCase().replace(/^(only\s+)?(screen|all)\s+and\s+/, '').trim();
  let x = m.match(/^\(\s*min-width\s*:\s*([\d.]+)(px|rem|em)\s*\)$/);
  if (x) {
    const px = parseFloat(x[1]) * (x[2] === 'px' ? 1 : 16);
    const bp = BREAKPOINTS.find(([b]) => b === px);
    return { variant: { prefix: bp ? `${bp[1]}:` : `min-[${n(px)}px]:`, minPx: px } };
  }
  x = m.match(/^\(\s*max-width\s*:\s*([\d.]+)(px|rem|em)\s*\)$/);
  if (x) {
    const px = parseFloat(x[1]) * (x[2] === 'px' ? 1 : 16);
    const bp = BREAKPOINTS.find(([b]) => b === px || b - 1 === px || Math.abs(b - 0.02 - px) < 0.05);
    return { variant: { prefix: bp ? `max-${bp[1]}:` : `max-[${n(px)}px]:`, maxPx: bp ? bp[0] - 0.02 : px }, note: bp && bp[0] === px ? `max-${bp[1]}: stops 1px below ${px}px.` : undefined };
  }
  if (/^\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/.test(m)) return { variant: { prefix: 'dark:', dark: true }, note: 'dark: follows the system setting by default.' };
  if (/^\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/.test(m)) return { variant: { prefix: 'motion-reduce:', motion: true } };
  if (/^print$/.test(m)) return { variant: { prefix: 'print:' } };
  return { note: `We couldn’t turn “@media ${media}” into a Tailwind prefix, so those lines were skipped.` };
}

const PSEUDO: Record<string, string> = {
  hover: 'hover', focus: 'focus', 'focus-visible': 'focus-visible', 'focus-within': 'focus-within', active: 'active', visited: 'visited',
  disabled: 'disabled', checked: 'checked', 'first-child': 'first', 'last-child': 'last', 'nth-child(odd)': 'odd', 'nth-child(even)': 'even',
  'nth-child(2n+1)': 'odd', 'nth-child(2n)': 'even', 'only-child': 'only', empty: 'empty', invalid: 'invalid', required: 'required',
  ':placeholder': 'placeholder', ':before': 'before', ':after': 'after', ':selection': 'selection', ':first-line': 'first-line', ':first-letter': 'first-letter', ':marker': 'marker',
  before: 'before', after: 'after',
};

/** Splits ".btn:hover" into the element ".btn" and the variant "hover:". */
function selectorParts(sel: string): { target: string; prefixes: string[]; pseudo: string[]; note?: string } {
  const s = sel.trim().replace(/\s+/g, ' ');
  // ".card:hover .title" → group-hover on .title
  const group = s.match(/^(.+?):(hover|focus|focus-within|active) (.+)$/);
  if (group && !/[ >+~]/.test(group[1]) && !/:/.test(group[3])) {
    return { target: group[3], prefixes: [`group-${group[2]}:`], pseudo: [`:${group[2]}`], note: `Add the class “group” to ${group[1]} so group-${group[2]}: works.` };
  }
  const prefixes: string[] = [];
  const pseudo: string[] = [];
  let target = s;
  for (;;) {
    const m = target.match(/::?((?:[a-z-]+)(?:\([^)]*\))?)$/i);
    if (!m) break;
    const key = (m[0].startsWith('::') ? ':' : '') + m[1].toLowerCase();
    const tw = PSEUDO[key] ?? PSEUDO[m[1].toLowerCase()];
    if (!tw) break;
    prefixes.unshift(`${tw}:`);
    pseudo.unshift(m[0]);
    target = target.slice(0, -m[0].length);
  }
  return { target: target || '*', prefixes, pseudo };
}

// ---------------- The whole thing ----------------

export function convert(input: string, o: Options): Result {
  const { rules: raw, error } = parseCss(input);
  const byTarget = new Map<string, RuleOut & { keyed: Map<string, Token[]> }>();
  const counts: Record<Kind, number> = { exact: 0, near: 0, arbitrary: 0 };

  for (const r of raw) {
    const mediaPrefixes: string[] = [];
    const mediaVariants: Variant[] = [];
    const mediaNotes: string[] = [];
    let skip = false;
    for (const m of r.media) {
      const mv = mediaVariant(m);
      if (mv.note) mediaNotes.push(mv.note);
      if (!mv.variant) skip = true;
      else {
        mediaPrefixes.push(mv.variant.prefix);
        mediaVariants.push(mv.variant);
      }
    }
    for (const sel of r.selectors) {
      const sp = selectorParts(sel);
      let out = byTarget.get(sp.target);
      if (!out) {
        out = { selector: sp.target, tokens: [], original: [], notes: [], keyed: new Map() };
        byTarget.set(sp.target, out);
      }
      for (const nt of [...mediaNotes, ...(sp.note ? [sp.note] : [])]) if (!out.notes.includes(nt)) out.notes.push(nt);
      if (skip) continue;
      const variants: Variant[] = [...mediaVariants, ...sp.prefixes.map((p, i) => ({ prefix: p, pseudo: sp.pseudo[i] }))];
      out.original.push({ decls: r.decls, variants });
      const prefix = [...mediaPrefixes, ...sp.prefixes].join('');
      for (const d of r.decls) {
        const pieces = convertDecl(d, o);
        const toks = pieces.map((pc) => {
          const imp = d.important ? (o.version === 'v4' ? { pre: '', post: '!' } : { pre: '!', post: '' }) : { pre: '', post: '' };
          const cls = pc.cls
            .split(' ')
            .map((c) => prefix + imp.pre + c + imp.post)
            .join(' ');
          return { cls, kind: pc.kind, css: pc.css, from: `${d.prop}: ${d.value}${d.important ? ' !important' : ''}`, note: pc.note, variants } as Token;
        });
        // A later line for the same property and variant replaces the earlier one, like in CSS.
        out.keyed.set(`${prefix}|${d.prop}`, toks);
      }
    }
  }

  const rules: RuleOut[] = [];
  for (const out of byTarget.values()) {
    const tokens: Token[] = [];
    const seen = new Set<string>();
    for (const toks of out.keyed.values()) {
      for (const t of toks) {
        if (seen.has(t.cls)) continue;
        seen.add(t.cls);
        tokens.push(t);
        counts[t.kind]++;
      }
    }
    // base classes first, then hover:, then breakpoints, like people usually write them
    const rank = (c: string) => {
      const parts = c.split(':');
      if (parts.length === 1) return 0;
      const first = parts[0];
      const bp = ['sm', 'md', 'lg', 'xl', '2xl'].indexOf(first);
      if (bp >= 0) return 10 + bp;
      if (first.startsWith('min-') || first.startsWith('max-')) return 20;
      if (first === 'dark') return 30;
      return 1;
    };
    tokens.sort((a, b) => rank(a.cls) - rank(b.cls));
    rules.push({ selector: out.selector, tokens, original: out.original, notes: out.notes });
  }
  return { rules, error, counts };
}

/** Class list as a string, the way it goes in class="…". */
export const classString = (r: RuleOut) => r.tokens.map((t) => t.cls).join(' ');
