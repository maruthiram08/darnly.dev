// shadcn/ui theme generator: one brand color, a gray base and a corner radius in,
// a full light + dark set of shadcn CSS variables out (OKLCH for Tailwind v4, HSL for v3).
// No DOM here, so it can be tested on its own.

import { rgbToOklch, oklchToRgbRaw, fitGamut, rgbToHex, clampRgb, type RGB, type LCH } from './oklch';

export type BaseName = 'neutral' | 'zinc' | 'slate' | 'stone' | 'gray' | 'tinted';
export type AccentStyle = 'gray' | 'tint';
export type ChartStyle = 'shades' | 'mix';
export type Mode = 'light' | 'dark';

// A theme color: OKLCH plus optional alpha (shadcn uses see-through borders in dark mode).
export type Tone = { l: number; c: number; h: number; a?: number };
export type Palette = Record<string, Tone>;

export type Options = {
  primary: RGB;
  base: BaseName;
  radius: number; // rem
  accent: AccentStyle;
  chart: ChartStyle;
};

export type Theme = { radius: number; light: Palette; dark: Palette };

// Variable order, as in shadcn's own globals.css.
export const VARS = [
  'background', 'foreground',
  'card', 'card-foreground',
  'popover', 'popover-foreground',
  'primary', 'primary-foreground',
  'secondary', 'secondary-foreground',
  'muted', 'muted-foreground',
  'accent', 'accent-foreground',
  'destructive',
  'border', 'input', 'ring',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
  'sidebar', 'sidebar-foreground',
  'sidebar-primary', 'sidebar-primary-foreground',
  'sidebar-accent', 'sidebar-accent-foreground',
  'sidebar-border', 'sidebar-ring',
] as const;

// Tailwind v4's own gray scales (50 … 950), the same ones shadcn's base colors are built from.
type Scale = [number, number, number][]; // [L, C, H] per step
const STEP_KEYS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
export const BASES: Record<Exclude<BaseName, 'tinted'>, Scale> = {
  neutral: [[0.985, 0, 0], [0.97, 0, 0], [0.922, 0, 0], [0.87, 0, 0], [0.708, 0, 0], [0.556, 0, 0], [0.439, 0, 0], [0.371, 0, 0], [0.269, 0, 0], [0.205, 0, 0], [0.145, 0, 0]],
  zinc: [[0.985, 0, 0], [0.967, 0.001, 286.375], [0.92, 0.004, 286.32], [0.871, 0.006, 286.286], [0.705, 0.015, 286.067], [0.552, 0.016, 285.938], [0.442, 0.017, 285.786], [0.37, 0.013, 285.805], [0.274, 0.006, 286.033], [0.21, 0.006, 285.885], [0.141, 0.005, 285.823]],
  slate: [[0.984, 0.003, 247.858], [0.968, 0.007, 247.896], [0.929, 0.013, 255.508], [0.869, 0.022, 252.894], [0.704, 0.04, 256.788], [0.554, 0.046, 257.417], [0.446, 0.043, 257.281], [0.372, 0.044, 257.287], [0.279, 0.041, 260.031], [0.208, 0.042, 265.755], [0.129, 0.042, 264.695]],
  stone: [[0.985, 0.001, 106.423], [0.97, 0.001, 106.424], [0.923, 0.003, 48.717], [0.869, 0.005, 56.366], [0.709, 0.01, 56.259], [0.553, 0.013, 58.071], [0.444, 0.011, 73.639], [0.374, 0.01, 67.558], [0.268, 0.007, 34.298], [0.216, 0.006, 56.043], [0.147, 0.004, 49.25]],
  gray: [[0.985, 0.002, 247.839], [0.967, 0.003, 264.542], [0.928, 0.006, 264.531], [0.872, 0.01, 258.338], [0.707, 0.022, 261.325], [0.551, 0.027, 264.364], [0.446, 0.03, 256.802], [0.373, 0.034, 259.733], [0.278, 0.033, 256.848], [0.21, 0.034, 264.665], [0.13, 0.028, 261.692]],
};

// "Tinted": the neutral lightness steps with a whisper of the brand hue, so the grays belong to the brand.
const TINT = [0.003, 0.006, 0.01, 0.016, 0.026, 0.03, 0.03, 0.028, 0.024, 0.02, 0.016];
function tintedScale(hue: number, chroma: number): Scale {
  const k = chroma < 0.03 ? 0 : Math.min(1, 0.4 + chroma / 0.2);
  return BASES.neutral.map(([L], i) => [L, +(TINT[i] * k).toFixed(4), hue]);
}

export const scaleFor = (base: BaseName, primary: LCH): Scale =>
  base === 'tinted' ? tintedScale(primary[2], primary[1]) : BASES[base];

// ---- Contrast (WCAG 2) ----
function luminance(rgb: RGB) {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = clampRgb(rgb).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: RGB, b: RGB) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const tone = ([l, c, h]: [number, number, number], a?: number): Tone => (a === undefined ? { l, c, h } : { l, c, h, a });
export const toneRgb = (t: Tone): RGB => clampRgb(oklchToRgbRaw([t.l, t.c, t.h]));

// A see-through tone shown over a background, as the screen ends up painting it.
export function flatten(t: Tone, over: Tone): RGB {
  const a = t.a ?? 1;
  const top = toneRgb(t);
  const bottom = toneRgb(over);
  return top.map((v, i) => v * a + bottom[i] * (1 - a)) as RGB;
}

const fit = (l: number, c: number, h: number): Tone => {
  const [L, C, H] = fitGamut([l, c, h]);
  return { l: L, c: C, h: H };
};

// Light or dark text, whichever reads better on `bg`. Both carry a trace of the brand hue.
function textOn(bg: Tone, scale: Scale): Tone {
  const light = tone(scale[0]);
  const dark = tone(scale[9]);
  const rgb = toneRgb(bg);
  return contrast(toneRgb(light), rgb) >= contrast(toneRgb(dark), rgb) ? light : dark;
}

// In dark mode a deep brand color sinks into the background, so lift it until it stands out.
function darkPrimary(p: Tone, bg: Tone): Tone {
  if (p.c < 0.03 && p.l < 0.5) return { l: 0.922, c: p.c, h: p.h }; // near-black brand: flip to near-white like shadcn's default
  let t = p;
  for (let L = p.l; L <= 0.86 && contrast(toneRgb(t), toneRgb(bg)) < 4.5; L += 0.02) t = fit(L, p.c, p.h);
  return t;
}

function charts(p: Tone, style: ChartStyle, mode: Mode): Tone[] {
  if (style === 'shades') {
    // Like shadcn's colored themes: five steps of the brand color, light to deep.
    const c = Math.max(p.c, 0.08);
    return [0.81, 0.62, 0.55, 0.49, 0.42].map((L, i) => fit(L, c * [0.45, 0.9, 1, 1, 0.82][i], p.h));
  }
  // Mixed: the brand color plus four companions that sit well next to it.
  const lift = mode === 'dark' ? 0.04 : 0;
  const c = Math.min(0.17, Math.max(0.11, p.c));
  const set: [number, number, number][] = [
    [0.6, 1, 0],
    [0.7, 0.8, 150],
    [0.55, 0.9, 210],
    [0.8, 0.85, 50],
    [0.66, 0.95, -55],
  ];
  return set.map(([L, k, dh]) => fit(L + lift, c * k, (p.h + dh + 360) % 360));
}

export function buildTheme(o: Options): Theme {
  const [pl, pc, ph] = rgbToOklch(o.primary);
  const s = scaleFor(o.base, [pl, pc, ph]);
  const at = (step: number) => tone(s[STEP_KEYS.indexOf(step)]);
  const white: Tone = { l: 1, c: 0, h: 0 };
  const brand: Tone = { l: pl, c: pc, h: ph };

  // Light
  const lp = brand;
  const lAccent = o.accent === 'tint' ? fit(0.965, Math.min(0.03, pc * 0.25), ph) : at(100);
  const lAccentFg = o.accent === 'tint' ? fit(0.33, Math.min(0.12, pc * 0.8), ph) : at(900);
  const lCharts = charts(brand, o.chart, 'light');
  const light: Palette = {
    background: white,
    foreground: at(950),
    card: white,
    'card-foreground': at(950),
    popover: white,
    'popover-foreground': at(950),
    primary: lp,
    'primary-foreground': textOn(lp, s),
    secondary: at(100),
    'secondary-foreground': at(900),
    muted: at(100),
    'muted-foreground': at(500),
    accent: lAccent,
    'accent-foreground': lAccentFg,
    destructive: { l: 0.577, c: 0.245, h: 27.325 },
    border: at(200),
    input: at(200),
    ring: lp,
    'chart-1': lCharts[0], 'chart-2': lCharts[1], 'chart-3': lCharts[2], 'chart-4': lCharts[3], 'chart-5': lCharts[4],
    sidebar: at(50),
    'sidebar-foreground': at(950),
    'sidebar-primary': lp,
    'sidebar-primary-foreground': textOn(lp, s),
    'sidebar-accent': lAccent,
    'sidebar-accent-foreground': lAccentFg,
    'sidebar-border': at(200),
    'sidebar-ring': lp,
  };

  // Dark
  const dbg = at(950);
  const dp = darkPrimary(brand, dbg);
  const dAccent = o.accent === 'tint' ? fit(0.3, Math.min(0.05, pc * 0.35), ph) : at(800);
  const dAccentFg = o.accent === 'tint' ? fit(0.92, Math.min(0.05, pc * 0.3), ph) : at(50);
  const dCharts = charts(brand, o.chart, 'dark');
  const dark: Palette = {
    background: dbg,
    foreground: at(50),
    card: at(900),
    'card-foreground': at(50),
    popover: at(900),
    'popover-foreground': at(50),
    primary: dp,
    'primary-foreground': textOn(dp, s),
    secondary: at(800),
    'secondary-foreground': at(50),
    muted: at(800),
    'muted-foreground': at(400),
    accent: dAccent,
    'accent-foreground': dAccentFg,
    destructive: { l: 0.704, c: 0.191, h: 22.216 },
    border: { l: 1, c: 0, h: 0, a: 0.1 },
    input: { l: 1, c: 0, h: 0, a: 0.15 },
    ring: dp,
    'chart-1': dCharts[0], 'chart-2': dCharts[1], 'chart-3': dCharts[2], 'chart-4': dCharts[3], 'chart-5': dCharts[4],
    sidebar: at(900),
    'sidebar-foreground': at(50),
    'sidebar-primary': dp,
    'sidebar-primary-foreground': textOn(dp, s),
    'sidebar-accent': dAccent,
    'sidebar-accent-foreground': dAccentFg,
    'sidebar-border': { l: 1, c: 0, h: 0, a: 0.1 },
    'sidebar-ring': dp,
  };
  return { radius: o.radius, light, dark };
}

// ---- Output ----
const n3 = (v: number) => String(+v.toFixed(3));

export function oklchCss(t: Tone): string {
  const c = t.c < 0.0005 ? 0 : t.c;
  const h = c === 0 ? 0 : t.h;
  const a = t.a === undefined ? '' : ` / ${Math.round(t.a * 100)}%`;
  return `oklch(${n3(t.l)} ${n3(c)} ${n3(h)}${a})`;
}

// For the live preview: plain hex, or rgba for see-through tones.
export function previewCss(t: Tone): string {
  const hex = rgbToHex(toneRgb(t));
  if (t.a === undefined) return hex;
  const [r, g, b] = toneRgb(t).map((v) => Math.round(v * 255));
  return `rgba(${r}, ${g}, ${b}, ${t.a})`;
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max - min < 1e-6) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s * 100, l * 100];
}

// shadcn's v3 format: bare "H S% L%" numbers, no see-through colors (they're flattened onto the background).
export function hslCss(t: Tone, bg: Tone): string {
  const [h, s, l] = rgbToHsl(t.a === undefined ? toneRgb(t) : flatten(t, bg));
  const f = (v: number) => String(+v.toFixed(1));
  return `${f(h)} ${f(s)}% ${f(l)}%`;
}

const remStr = (r: number) => `${+r.toFixed(3)}rem`;

export function v4Css(t: Theme): string {
  const block = (sel: string, p: Palette, radius: boolean) =>
    `${sel} {\n${radius ? `  --radius: ${remStr(t.radius)};\n` : ''}${VARS.map((v) => `  --${v}: ${oklchCss(p[v])};`).join('\n')}\n}`;
  const inline = [
    '  --radius-sm: calc(var(--radius) - 4px);',
    '  --radius-md: calc(var(--radius) - 2px);',
    '  --radius-lg: var(--radius);',
    '  --radius-xl: calc(var(--radius) + 4px);',
    ...VARS.map((v) => `  --color-${v}: var(--${v});`),
  ].join('\n');
  return [
    '@import "tailwindcss";',
    '@import "tw-animate-css";',
    '',
    '@custom-variant dark (&:is(.dark *));',
    '',
    block(':root', t.light, true),
    '',
    block('.dark', t.dark, false),
    '',
    `@theme inline {\n${inline}\n}`,
    '',
    '@layer base {\n  * {\n    @apply border-border outline-ring/50;\n  }\n  body {\n    @apply bg-background text-foreground;\n  }\n}',
  ].join('\n');
}

// v3 names: sidebar is "sidebar-background", and destructive has its own foreground.
export function v3Css(t: Theme): string {
  const block = (sel: string, p: Palette, radius: boolean) => {
    const bg = p.background;
    const lines: string[] = [];
    for (const v of VARS) {
      const name = v === 'sidebar' ? 'sidebar-background' : v;
      lines.push(`    --${name}: ${hslCss(p[v], bg)};`);
      if (v === 'destructive') lines.push(`    --destructive-foreground: 0 0% 98%;`);
    }
    if (radius) lines.push(`    --radius: ${remStr(t.radius)};`);
    return `  ${sel} {\n${lines.join('\n')}\n  }`;
  };
  return `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n@layer base {\n${block(':root', t.light, true)}\n\n${block('.dark', t.dark, false)}\n}`;
}

export function agentPrompt(t: Theme, primaryHex: string): string {
  return [
    `Apply this shadcn/ui theme to my project. My brand color is ${primaryHex.toUpperCase()}.`,
    ``,
    `1. Find the global CSS file that holds the shadcn variables (usually app/globals.css, src/app/globals.css, src/index.css or styles/globals.css).`,
    `2. Check which Tailwind version it uses:`,
    `   - Tailwind v4: the file has @import "tailwindcss" and colors like oklch(...). Replace the --radius value and every variable in :root and .dark with the values below, and make sure the @theme inline block maps each one (add missing lines such as --color-chart-1 or --color-sidebar).`,
    `   - Tailwind v3: there is a tailwind.config file and colors look like "0 0% 100%". Use the v3 values at the bottom instead.`,
    `3. Keep everything else in the file (fonts, imports, custom styles). Don't edit component files: shadcn components read these variables.`,
    `4. Then check that buttons, inputs, cards and dark mode look right, and that no component still uses hard-coded colors like bg-blue-600 or text-gray-500 instead of bg-primary or text-muted-foreground. Fix any you find.`,
    ``,
    `Tailwind v4 (OKLCH):`,
    '```css',
    v4Css(t),
    '```',
    ``,
    `Tailwind v3 (HSL):`,
    '```css',
    v3Css(t),
    '```',
  ].join('\n');
}

// ---- "Randomize (tasteful)" ----
export const RADII = [0, 0.3, 0.5, 0.625, 0.75, 1];

// Picks a calm, usable brand color and a gray that suits it. It mostly steers clear of the
// indigo-to-purple range every AI-made app seems to use.
export function randomOptions(rand: () => number = Math.random): Options {
  let h = rand() * 360;
  if (h > 255 && h < 305 && rand() < 0.8) h = (h + 120) % 360;
  const yellowish = h > 70 && h < 115;
  const L = yellowish ? 0.78 + rand() * 0.06 : 0.48 + rand() * 0.18;
  const C = 0.09 + rand() * 0.1;
  const [l, c, hh] = fitGamut([L, C, h]);
  const primary = clampRgb(oklchToRgbRaw([l, c, hh]));
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const warm = h < 110 || h > 340;
  const cool = h > 180 && h < 300;
  const base: BaseName = warm ? pick(['stone', 'tinted', 'neutral']) : cool ? pick(['slate', 'zinc', 'gray', 'tinted']) : pick(['neutral', 'zinc', 'tinted']);
  return {
    primary,
    base,
    radius: pick(RADII),
    accent: rand() < 0.5 ? 'tint' : 'gray',
    chart: rand() < 0.5 ? 'mix' : 'shades',
  };
}

// A plain-words name for a hue, for status messages.
export function hueName(rgb: RGB): string {
  const [L, C, H] = rgbToOklch(rgb);
  if (C < 0.03) return L < 0.4 ? 'ink' : L > 0.8 ? 'light gray' : 'gray';
  const names: [number, string][] = [[20, 'pink'], [45, 'red'], [70, 'orange'], [105, 'amber'], [135, 'olive'], [165, 'green'], [195, 'teal'], [235, 'sky blue'], [270, 'blue'], [305, 'violet'], [345, 'magenta'], [361, 'pink']];
  const name = names.find(([max]) => H < max)![1];
  return (L < 0.45 ? 'deep ' : L > 0.75 ? 'soft ' : '') + name;
}
