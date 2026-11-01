// Fluid type scale math. Pure functions, no DOM, so they are easy to check.

export type Settings = {
  minVw: number; // screen width where the small sizes apply, in px
  maxVw: number; // screen width where the large sizes apply, in px
  minBase: number; // body size on the small screen, in px
  maxBase: number; // body size on the large screen, in px
  minRatio: number; // scale ratio on the small screen
  maxRatio: number; // scale ratio on the large screen
  root: number; // root font size, almost always 16
};

export const DEFAULTS: Settings = {
  minVw: 360,
  maxVw: 1280,
  minBase: 16,
  maxBase: 18,
  minRatio: 1.2,
  maxRatio: 1.333,
  root: 16,
};

// Named ratios from the musical scale, as most type tools use them.
export const RATIOS: { name: string; value: number }[] = [
  { name: 'Minor second', value: 1.067 },
  { name: 'Major second', value: 1.125 },
  { name: 'Minor third', value: 1.2 },
  { name: 'Major third', value: 1.25 },
  { name: 'Perfect fourth', value: 1.333 },
  { name: 'Augmented fourth', value: 1.414 },
  { name: 'Perfect fifth', value: 1.5 },
  { name: 'Golden ratio', value: 1.618 },
];

// Steps from small text up to a hero heading. Names match Tailwind's text sizes.
export const STEPS: { step: number; name: string; role: string }[] = [
  { step: -1, name: 'sm', role: 'Small text' },
  { step: 0, name: 'base', role: 'Body' },
  { step: 1, name: 'lg', role: 'H4' },
  { step: 2, name: 'xl', role: 'H3' },
  { step: 3, name: '2xl', role: 'H2' },
  { step: 4, name: '3xl', role: 'H1' },
  { step: 5, name: '4xl', role: 'Hero' },
];

export type Size = {
  step: number;
  name: string;
  role: string;
  min: number; // px on the small screen
  max: number; // px on the large screen
  slope: number; // px of font per px of screen width
  intercept: number; // px of font at a 0px wide screen
  clamp: string;
  zoomOk: boolean; // false when browser zoom may not reach 200% (WCAG 1.4.4)
};

export function fmt(n: number, digits = 4): string {
  const r = Number(n.toFixed(digits));
  return Object.is(r, -0) ? '0' : String(r);
}

export function ratioName(value: number): string | null {
  return RATIOS.find((r) => Math.abs(r.value - value) < 0.0005)?.name ?? null;
}

export function readNumber(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Returns an error in plain words, or null when the settings make sense.
export function check(s: Settings): string | null {
  if (s.minVw <= 0 || s.maxVw <= 0) return 'Screen widths must be above 0.';
  if (s.maxVw <= s.minVw) return 'The large screen width must be bigger than the small one.';
  if (s.minBase <= 0 || s.maxBase <= 0) return 'Body sizes must be above 0.';
  if (s.minRatio < 1 || s.maxRatio < 1) return 'Ratios must be 1 or more.';
  if (s.minRatio > 3 || s.maxRatio > 3) return 'Ratios above 3 make giant headings. Try 1.2 to 1.5.';
  return null;
}

export function sizeFor(s: Settings, step: number): { min: number; max: number } {
  return { min: s.minBase * s.minRatio ** step, max: s.maxBase * s.maxRatio ** step };
}

// The clamp() for one size: rem parts so browser zoom and user font settings still work.
export function clampFor(min: number, max: number, s: Settings): { clamp: string; slope: number; intercept: number } {
  const slope = (max - min) / (s.maxVw - s.minVw);
  const intercept = min - slope * s.minVw;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (Math.abs(max - min) < 1e-9) return { clamp: `${fmt(min / s.root)}rem`, slope: 0, intercept: min };
  const r = intercept / s.root;
  const v = slope * 100;
  // Write it the way people do by hand: rem + vw, or vw - rem when the rem part is negative.
  let middle: string;
  if (Math.abs(r) < 1e-6) middle = `${fmt(v)}vw`;
  else if (r > 0) middle = `${fmt(r)}rem ${v < 0 ? '-' : '+'} ${fmt(Math.abs(v))}vw`;
  else middle = `${fmt(v)}vw - ${fmt(-r)}rem`;
  return { clamp: `clamp(${fmt(lo / s.root)}rem, ${middle}, ${fmt(hi / s.root)}rem)`, slope, intercept };
}

export function scale(s: Settings): Size[] {
  return STEPS.map(({ step, name, role }) => {
    const { min, max } = sizeFor(s, step);
    const c = clampFor(min, max, s);
    return { step, name, role, min, max, ...c, zoomOk: max / min <= 2.5 };
  });
}

// What the browser renders at a given screen width.
export function sizeAt(size: Size, width: number): number {
  const lo = Math.min(size.min, size.max);
  const hi = Math.max(size.min, size.max);
  return Math.min(hi, Math.max(lo, size.intercept + size.slope * width));
}

export type Format = 'css' | 'tw4' | 'tw3';

export function output(sizes: Size[], format: Format): string {
  if (format === 'css') {
    const lines = sizes.map((z) => `  --text-${z.name}: ${z.clamp}; /* ${fmt(z.min, 2)}px → ${fmt(z.max, 2)}px · ${z.role} */`);
    return [
      ':root {',
      ...lines,
      '}',
      '',
      'body { font-size: var(--text-base); }',
      'h1 { font-size: var(--text-3xl); }',
      'h2 { font-size: var(--text-2xl); }',
      'h3 { font-size: var(--text-xl); }',
      'h4 { font-size: var(--text-lg); }',
      'small { font-size: var(--text-sm); }',
      '',
    ].join('\n');
  }
  if (format === 'tw4') {
    const lines = sizes.map((z) => `  --text-${z.name}: ${z.clamp};`);
    return [
      '/* In your main CSS file, after @import "tailwindcss"; */',
      '@theme {',
      ...lines,
      '}',
      '',
      '/* Then use the usual classes: text-base, text-xl, text-3xl… */',
      '',
    ].join('\n');
  }
  const lines = sizes.map((z) => `        '${z.name}': '${z.clamp}',`);
  return [
    '// tailwind.config.js',
    'module.exports = {',
    '  theme: {',
    '    extend: {',
    '      fontSize: {',
    ...lines,
    '      },',
    '    },',
    '  },',
    '};',
    '',
  ].join('\n');
}

export function agentPrompt(sizes: Size[], s: Settings, format: Format): string {
  const where =
    format === 'tw4'
      ? 'Add this @theme block to my main CSS file, right after @import "tailwindcss" (merge it with an existing @theme block if there is one).'
      : format === 'tw3'
        ? 'Add these font sizes to theme.extend.fontSize in my tailwind.config (keep anything else that is there).'
        : 'Add these CSS variables to my global stylesheet and use them for body text and headings.';
  return [
    `Make the font sizes in my project fluid: they should grow smoothly from a ${fmt(s.minVw)}px wide screen to a ${fmt(s.maxVw)}px wide screen.`,
    where,
    '',
    output(sizes, format).trim(),
    '',
    'Then replace hard-coded font sizes on headings and body text (and any responsive text classes like md:text-4xl that are now not needed) with these sizes:',
    ...sizes.map((z) => `- ${z.role}: text-${z.name} (${fmt(z.min, 1)}px on phones, ${fmt(z.max, 1)}px on desktop)`),
    'Keep the rem units so browser zoom still works. Do not change colors, spacing or layout. Show me the list of files you changed.',
  ].join('\n');
}

// Settings live in the address so a scale can be shared.
const KEYS: [keyof Settings, string][] = [
  ['minVw', 'minw'],
  ['maxVw', 'maxw'],
  ['minBase', 'minb'],
  ['maxBase', 'maxb'],
  ['minRatio', 'minr'],
  ['maxRatio', 'maxr'],
];

export function toQuery(s: Settings): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, p] of KEYS) if (s[k] !== DEFAULTS[k]) q.set(p, fmt(s[k]));
  return q;
}

export function fromQuery(q: URLSearchParams): Settings {
  const s = { ...DEFAULTS };
  for (const [k, p] of KEYS) {
    const v = readNumber(q.get(p) || '');
    if (v !== null) s[k] = v;
  }
  return check(s) ? { ...DEFAULTS } : s;
}
