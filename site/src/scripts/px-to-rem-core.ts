// px to rem: the pure math, kept apart from the page so it is easy to test.

// Up to 4 decimals, no trailing zeros: 0.875, 1.5, 0.0625.
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 10000) / 10000;
  return String(Object.is(r, -0) ? 0 : r);
}

export const toRem = (px: number, base: number) => px / base;
export const toPx = (rem: number, base: number) => rem * base;

// Tailwind's default spacing scale (v3 names it; v4 accepts any multiple of 0.25rem).
const SPACING_V3 = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72,
  80, 96,
];

export type Match = { cls: string; exact: boolean; note?: string };

// Spacing class for a rem value, as a padding example (p-4). Tailwind's scale is in rem, so it follows the base.
export function spacing(rem: number, px: number, prefix = 'p'): Match {
  const n = Math.round(rem * 4 * 10000) / 10000;
  if (px === 1) return { cls: `${prefix}-px`, exact: true };
  if (SPACING_V3.includes(n)) return { cls: `${prefix}-${n}`, exact: true };
  if (n > 0 && Number.isInteger(n * 4)) return { cls: `${prefix}-${n}`, exact: true, note: 'Tailwind v4' };
  return { cls: `${prefix}-[${fmt(rem)}rem]`, exact: false };
}

// Tailwind's font sizes, in rem.
export const TEXT: [string, number][] = [
  ['xs', 0.75],
  ['sm', 0.875],
  ['base', 1],
  ['lg', 1.125],
  ['xl', 1.25],
  ['2xl', 1.5],
  ['3xl', 1.875],
  ['4xl', 2.25],
  ['5xl', 3],
  ['6xl', 3.75],
  ['7xl', 4.5],
  ['8xl', 6],
  ['9xl', 8],
];

export function text(rem: number): Match {
  const hit = TEXT.find(([, r]) => Math.abs(r - rem) < 1e-6);
  if (hit) return { cls: `text-${hit[0]}`, exact: true };
  return { cls: `text-[${fmt(rem)}rem]`, exact: false };
}

export type CssOptions = { base: number; keep1px: boolean; skipMedia: boolean };

// Turns every px number in a block of CSS into rem. Leaves comments, url() and strings alone,
// and optionally 1px (hairline borders) and @media lines.
export function convertCss(css: string, opts: CssOptions): { out: string; count: number } {
  let count = 0;
  // Pieces to leave as they are: comments, strings, url(...), and @media preludes when asked.
  const skip = opts.skipMedia
    ? /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\([^)]*\)|@media[^{;]*/gi
    : /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\([^)]*\)/gi;
  const num = /(^|[^\w.#-])(-?(?:\d+\.?\d*|\.\d+))px\b/gi;
  const swap = (chunk: string) =>
    chunk.replace(num, (all, pre: string, n: string) => {
      const v = parseFloat(n);
      if (v === 0) {
        count++;
        return `${pre}0`;
      }
      if (opts.keep1px && Math.abs(v) === 1) return all;
      count++;
      return `${pre}${fmt(v / opts.base)}rem`;
    });
  let out = '';
  let last = 0;
  for (const m of css.matchAll(skip)) {
    out += swap(css.slice(last, m.index)) + m[0];
    last = (m.index ?? 0) + m[0].length;
  }
  out += swap(css.slice(last));
  return { out, count };
}

// Reads "24", "24px", "1.5rem" or "1.5" from a text box. Returns null when it isn't a number.
export function readNumber(s: string): number | null {
  const t = s.trim().replace(/,/g, '.').replace(/\s*(px|rem|em)$/i, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return parseFloat(t);
}
