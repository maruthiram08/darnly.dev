// CSS button generator: one button design in, CSS, Tailwind, React and a shadcn variant out.
// Pure functions only, so the page script and tests can share them. Everything runs in the browser.

export type Preset = 'solid' | 'outline' | 'soft' | 'gradient' | '3d' | 'glass' | 'brutal';
export type Hover = 'darken' | 'lift' | 'glow' | 'grow' | 'none';
export type Press = 'sink' | 'shrink' | 'none';
export type ShadowKey = 'none' | 'soft' | 'medium' | 'strong';
export type FontKey = 'system' | 'inter' | 'figtree' | 'dm-sans' | 'space-grotesk' | 'poppins' | 'mono' | 'serif';

export type Btn = {
  preset: Preset;
  color: string; // #rrggbb
  text: string; // 'auto' or #rrggbb
  radius: number; // px, 999 = pill
  padX: number;
  padY: number;
  size: number; // font size px
  font: FontKey;
  weight: number;
  shadow: ShadowKey;
  hover: Hover;
  press: Press;
  label: string;
  icon: boolean;
};

export const PRESETS: { key: Preset; name: string }[] = [
  { key: 'solid', name: 'Solid' },
  { key: 'outline', name: 'Outline' },
  { key: 'soft', name: 'Soft' },
  { key: 'gradient', name: 'Gradient' },
  { key: '3d', name: '3D' },
  { key: 'glass', name: 'Glass' },
  { key: 'brutal', name: 'Neo-brutal' },
];

// Styles with their own built-in hover and press movement.
export const OWN_MOTION: Preset[] = ['3d', 'brutal'];

export const FONTS: Record<FontKey, { name: string; stack: string; google?: string; weights?: number[]; tw: string }> = {
  system: { name: 'System UI', stack: 'system-ui, -apple-system, "Segoe UI", sans-serif', tw: 'font-sans' },
  inter: { name: 'Inter', stack: '"Inter", system-ui, sans-serif', google: 'Inter', weights: [400, 500, 600, 700, 800], tw: "font-['Inter',sans-serif]" },
  figtree: { name: 'Figtree', stack: '"Figtree", system-ui, sans-serif', google: 'Figtree', weights: [400, 500, 600, 700, 800], tw: "font-['Figtree',sans-serif]" },
  'dm-sans': { name: 'DM Sans', stack: '"DM Sans", system-ui, sans-serif', google: 'DM+Sans', weights: [400, 500, 600, 700, 800], tw: "font-['DM_Sans',sans-serif]" },
  'space-grotesk': { name: 'Space Grotesk', stack: '"Space Grotesk", system-ui, sans-serif', google: 'Space+Grotesk', weights: [400, 500, 600, 700], tw: "font-['Space_Grotesk',sans-serif]" },
  poppins: { name: 'Poppins', stack: '"Poppins", system-ui, sans-serif', google: 'Poppins', weights: [400, 500, 600, 700, 800], tw: "font-['Poppins',sans-serif]" },
  mono: { name: 'JetBrains Mono', stack: '"JetBrains Mono", ui-monospace, monospace', google: 'JetBrains+Mono', weights: [400, 500, 600, 700, 800], tw: "font-['JetBrains_Mono',monospace]" },
  serif: { name: 'Serif', stack: 'Georgia, "Times New Roman", serif', tw: 'font-serif' },
};

/** Google Fonts stylesheet: every weight for the preview, or just the one in use for the export. */
export function googleFontUrl(f: FontKey, weight?: number): string {
  const font = FONTS[f];
  if (!font.google) return '';
  const w = weight ? [fontWeight(f, weight)] : font.weights!;
  return `https://fonts.googleapis.com/css2?family=${font.google}:wght@${w.join(';')}&display=swap`;
}
/** The closest weight the font has. */
export function fontWeight(f: FontKey, weight: number): number {
  const w = FONTS[f].weights;
  return w ? w.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a)) : weight;
}

export const DEFAULT: Btn = {
  preset: 'solid',
  color: '#0f766e',
  text: 'auto',
  radius: 12,
  padX: 24,
  padY: 12,
  size: 16,
  font: 'system',
  weight: 600,
  shadow: 'soft',
  hover: 'darken',
  press: 'sink',
  label: 'Get started',
  icon: true,
};

// What picking a preset changes, on top of the current color and label.
export const PRESET_LOOK: Record<Preset, Partial<Btn>> = {
  solid: { weight: 600, radius: 12, shadow: 'soft', hover: 'darken', press: 'sink' },
  outline: { weight: 600, radius: 12, shadow: 'none', hover: 'darken', press: 'shrink' },
  soft: { weight: 600, radius: 12, shadow: 'none', hover: 'darken', press: 'shrink' },
  gradient: { weight: 600, radius: 999, shadow: 'medium', hover: 'lift', press: 'sink' },
  '3d': { weight: 600, radius: 14, shadow: 'none' },
  glass: { weight: 600, radius: 16, shadow: 'soft', hover: 'darken', press: 'shrink' },
  brutal: { radius: 6, shadow: 'none', weight: 700 },
};

// ---- Color maths (OKLab by Björn Ottosson, same as the Tailwind color generator) ----
type RGB = [number, number, number]; // 0–1
type LCH = [number, number, number];
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function parseHex(input: string): string | null {
  let s = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = [...s].map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/.test(s) ? '#' + s : null;
}
const toRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
const toHex = (rgb: RGB) => '#' + rgb.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');

function rgbToOklch([r0, g0, b0]: RGB): LCH {
  const r = toLinear(r0), g = toLinear(g0), b = toLinear(b0);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, Math.hypot(A, B), H];
}
function oklchToRgbRaw([L, C, H]: LCH): RGB {
  const h = (H * Math.PI) / 180;
  const A = C * Math.cos(h), B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
const inGamut = (rgb: RGB) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);
function fromLch(lch: LCH): string {
  if (!inGamut(oklchToRgbRaw(lch))) {
    let lo = 0, hi = lch[1];
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToRgbRaw([lch[0], mid, lch[2]]))) lo = mid;
      else hi = mid;
    }
    lch = [lch[0], lo, lch[2]];
  }
  return toHex(oklchToRgbRaw(lch));
}
export const lightness = (hex: string) => rgbToOklch(toRgb(hex))[0];
/** Shift lightness (OKLCH, 0–1) and optionally hue and chroma. */
export function shade(hex: string, dL: number, dH = 0, chroma = 1): string {
  const [L, C, H] = rgbToOklch(toRgb(hex));
  return fromLch([clamp(L + dL, 0, 1), C * chroma, (H + dH + 360) % 360]);
}
export function withLightness(hex: string, L: number, chroma = 1): string {
  const [, C, H] = rgbToOklch(toRgb(hex));
  return fromLch([L, C * chroma, H]);
}
/** a laid over b with opacity t. */
export function blend(a: string, b: string, t: number): string {
  const x = toRgb(a), y = toRgb(b);
  return toHex(x.map((v, i) => v * t + y[i] * (1 - t)) as RGB);
}
const rgba = (hex: string, a: number) => `rgba(${toRgb(hex).map((v) => Math.round(v * 255)).join(', ')}, ${a})`;
const rgbaTw = (hex: string, a: number) => `rgba(${toRgb(hex).map((v) => Math.round(v * 255)).join(',')},${a})`;

// WCAG 2 contrast.
function lum(hex: string) {
  const [r, g, b] = toRgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ---- Derived colors ----
const INK = '#111111';
export const gradientEnd = (c: string) => shade(c, lightness(c) > 0.75 ? -0.04 : 0.05, 40);

/** The colors right behind the label, on a page of color `surface`. */
export function labelBackgrounds(b: Btn, surface: string): string[] {
  const c = b.color;
  switch (b.preset) {
    case 'outline': return [surface];
    case 'soft': return [softBg(c)];
    case 'gradient': return [c, gradientEnd(c)];
    case 'glass': return [blend('#ffffff', c, 0.16)]; // glass sits on a splash of your color
    default: return [c];
  }
}
const softBg = (c: string) => withLightness(c, 0.95, 0.45);

export function textColor(b: Btn): string {
  if (b.text !== 'auto') return b.text;
  const c = b.color;
  if (b.preset === 'outline') return c;
  if (b.preset === 'soft') return withLightness(c, Math.min(0.42, lightness(c)));
  if (b.preset === 'glass') return '#ffffff';
  const bgs = labelBackgrounds(b, '#ffffff');
  const dark = b.preset === 'brutal' ? INK : '#0f172a';
  const worst = (t: string) => Math.min(...bgs.map((g) => contrast(t, g)));
  return worst('#ffffff') >= Math.min(4.5, worst(dark)) ? '#ffffff' : dark;
}

// ---- One design, as CSS declarations and matching Tailwind classes ----
type Part = { css: [string, string][]; tw: string[]; x: number; y: number; s: number };
const part = (): Part => ({ css: [], tw: [], x: 0, y: 0, s: 1 });
const add = (p: Part, prop: string, val: string, tw?: string) => {
  const i = p.css.findIndex(([k]) => k === prop);
  if (i >= 0) p.css[i] = [prop, val];
  else p.css.push([prop, val]);
  if (tw) p.tw.push(tw);
};
const tws = (v: string) => v.replace(/\s*,\s*/g, ',').replace(/ /g, '_');

// Tailwind spacing that exists in both v3 and v4, else an exact arbitrary value.
const SCALE = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16];
function sp(prefix: string, px: number) {
  const n = px / 4;
  return SCALE.includes(n) ? `${prefix}-${n}` : `${prefix}-[${px}px]`;
}
const TEXT: Record<number, string> = { 12: 'text-xs', 14: 'text-sm', 16: 'text-base', 18: 'text-lg', 20: 'text-xl', 24: 'text-2xl' };
const WEIGHT: Record<number, string> = { 400: 'font-normal', 500: 'font-medium', 600: 'font-semibold', 700: 'font-bold', 800: 'font-extrabold' };
const moveTw = (axis: 'x' | 'y', px: number) =>
  px === 0 ? '' : Math.abs(px) === 1 ? `${px < 0 ? '-' : ''}translate-${axis}-px` : `${px < 0 ? '-' : ''}translate-${axis}-[${Math.abs(px)}px]`;

function shadowFor(key: ShadowKey, c: string): string {
  if (key === 'soft') return '0 1px 2px rgba(16, 24, 40, 0.08), 0 2px 6px rgba(16, 24, 40, 0.08)';
  if (key === 'medium') return `0 1px 2px rgba(16, 24, 40, 0.1), 0 6px 16px -4px ${rgba(c, 0.45)}`;
  if (key === 'strong') return `0 2px 4px rgba(16, 24, 40, 0.12), 0 14px 28px -8px ${rgba(c, 0.6)}`;
  return '';
}
const shadowTw = (v: string) => (v ? `shadow-[${tws(v)}]` : 'shadow-none');

export type Spec = { base: Part; hover: Part; active: Part; text: string; ring: string };

export function build(b: Btn): Spec {
  const c = b.color;
  const text = textColor(b);
  const base = part(), hover = part(), active = part();
  const font = FONTS[b.font];

  add(base, 'display', 'inline-flex', 'inline-flex');
  add(base, 'align-items', 'center', 'items-center');
  add(base, 'justify-content', 'center', 'justify-center');
  add(base, 'gap', '0.5em', 'gap-[0.5em]');
  add(base, 'padding', `${b.padY}px ${b.padX}px`, `${sp('px', b.padX)} ${sp('py', b.padY)}`);
  add(base, 'font-family', font.stack, font.tw);
  add(base, 'font-size', `${b.size}px`, TEXT[b.size] ?? `text-[${b.size}px]`);
  const weight = fontWeight(b.font, b.weight);
  add(base, 'font-weight', String(weight), WEIGHT[weight]);
  add(base, 'line-height', '1.25', 'leading-tight');
  add(base, 'color', text, `text-[${text}]`);
  add(base, 'border-radius', b.radius >= 999 ? '9999px' : `${b.radius}px`, b.radius >= 999 ? 'rounded-full' : `rounded-[${b.radius}px]`);

  const ring = b.preset === 'glass' ? '#ffffff' : b.preset === 'brutal' ? INK : c;
  let baseShadow = shadowFor(b.shadow, c);

  switch (b.preset) {
    case 'solid':
      add(base, 'background', c, `bg-[${c}]`);
      add(base, 'border', '0', 'border-0');
      break;
    case 'outline':
      add(base, 'background', 'transparent', 'bg-transparent');
      add(base, 'border', `2px solid ${c}`, `border-2 border-solid border-[${c}]`);
      break;
    case 'soft':
      add(base, 'background', softBg(c), `bg-[${softBg(c)}]`);
      add(base, 'border', '0', 'border-0');
      break;
    case 'gradient': {
      const g = `linear-gradient(135deg, ${c}, ${gradientEnd(c)})`;
      add(base, 'background', g, `bg-[${tws(g)}]`);
      add(base, 'border', '0', 'border-0');
      break;
    }
    case '3d': {
      const edge = shade(c, -0.14);
      add(base, 'background', c, `bg-[${c}]`);
      add(base, 'border', '0', 'border-0');
      baseShadow = `0 4px 0 ${edge}`;
      add(hover, 'background', shade(c, 0.03), `hover:bg-[${shade(c, 0.03)}]`);
      add(hover, 'box-shadow', `0 6px 0 ${edge}`, `hover:shadow-[${tws(`0 6px 0 ${edge}`)}]`);
      hover.y = -2;
      add(active, 'box-shadow', `0 0 0 ${edge}`, `active:shadow-[${tws(`0 0 0 ${edge}`)}]`);
      active.y = 4;
      break;
    }
    case 'glass':
      add(base, 'background', 'rgba(255, 255, 255, 0.16)', 'bg-[rgba(255,255,255,0.16)]');
      add(base, 'border', '1px solid rgba(255, 255, 255, 0.4)', 'border border-solid border-[rgba(255,255,255,0.4)]');
      add(base, '-webkit-backdrop-filter', 'blur(12px) saturate(160%)');
      add(base, 'backdrop-filter', 'blur(12px) saturate(160%)', 'backdrop-blur-[12px] backdrop-saturate-[1.6]');
      break;
    case 'brutal':
      add(base, 'background', c, `bg-[${c}]`);
      add(base, 'border', `2px solid ${INK}`, `border-2 border-solid border-[${INK}]`);
      baseShadow = `4px 4px 0 ${INK}`;
      add(hover, 'box-shadow', `6px 6px 0 ${INK}`, `hover:shadow-[${tws(`6px 6px 0 ${INK}`)}]`);
      hover.x = -2;
      hover.y = -2;
      add(active, 'box-shadow', `0 0 0 ${INK}`, 'active:shadow-none');
      active.x = 4;
      active.y = 4;
      break;
  }
  add(base, 'box-shadow', baseShadow || 'none', shadowTw(baseShadow));
  add(base, 'cursor', 'pointer', 'cursor-pointer');
  add(base, 'transition', 'transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, filter 0.15s ease', 'transition duration-150 ease-out');

  if (!OWN_MOTION.includes(b.preset)) {
    switch (b.hover) {
      case 'darken':
        if (b.preset === 'solid') add(hover, 'background', shade(c, -0.07), `hover:bg-[${shade(c, -0.07)}]`);
        if (b.preset === 'outline') add(hover, 'background', rgba(c, 0.1), `hover:bg-[${rgbaTw(c, 0.1)}]`);
        if (b.preset === 'soft') add(hover, 'background', withLightness(c, 0.9, 0.55), `hover:bg-[${withLightness(c, 0.9, 0.55)}]`);
        if (b.preset === 'gradient') add(hover, 'filter', 'brightness(1.1)', 'hover:brightness-110');
        if (b.preset === 'glass') add(hover, 'background', 'rgba(255, 255, 255, 0.26)', 'hover:bg-[rgba(255,255,255,0.26)]');
        break;
      case 'lift': {
        hover.y = -2;
        const lifted = baseShadow ? `0 2px 4px rgba(16, 24, 40, 0.1), 0 12px 24px -8px ${rgba(c, 0.6)}` : `0 8px 20px -6px ${rgba(c, 0.5)}`;
        add(hover, 'box-shadow', lifted, `hover:shadow-[${tws(lifted)}]`);
        break;
      }
      case 'glow': {
        const g = `0 0 0 4px ${rgba(c, 0.18)}, 0 8px 24px -4px ${rgba(c, 0.55)}`;
        add(hover, 'box-shadow', g, `hover:shadow-[${tws(g)}]`);
        break;
      }
      case 'grow':
        hover.s = 1.04;
        break;
    }
    if (b.press === 'sink') {
      active.y = 1;
      if (baseShadow || b.hover === 'lift' || b.hover === 'glow') {
        const pressed = '0 1px 2px rgba(16, 24, 40, 0.12)';
        add(active, 'box-shadow', pressed, `active:shadow-[${tws(pressed)}]`);
      }
    } else if (b.press === 'shrink') active.s = 0.97;
  }
  return { base, hover, active, text, ring };
}

function transformCss(p: Part): string {
  const bits: string[] = [];
  if (p.x || p.y) bits.push(`translate(${p.x}px, ${p.y}px)`);
  if (p.s !== 1) bits.push(`scale(${Math.round(p.s * 100) / 100})`);
  return bits.join(' ');
}
function transformTw(p: Part, prefix: string): string[] {
  const out = [moveTw('x', p.x), moveTw('y', p.y)].filter(Boolean);
  if (p.s !== 1) out.push(`scale-[${Math.round(p.s * 100) / 100}]`);
  return out.map((c) => prefix + c);
}

// ---- CSS ----
export function css(b: Btn, sel = '.btn', preview = false): string {
  const s = build(b);
  // Like Tailwind, a press keeps whatever part of the hover movement it doesn't replace.
  const pressed: Part = { ...s.active, x: s.active.x || s.hover.x, y: s.active.y || s.hover.y, s: s.active.s !== 1 ? s.active.s : s.hover.s };
  const block = (selector: string, p: Part, withTransform: boolean) => {
    const lines = p.css.map(([k, v]) => `  ${k}: ${v};`);
    const t = transformCss(p);
    if (withTransform && t) lines.push(`  transform: ${t};`);
    return lines.length ? `${selector} {\n${lines.join('\n')}\n}` : '';
  };
  const hov = preview ? `${sel}:hover:not(:disabled), ${sel}.is-hover` : `${sel}:hover:not(:disabled)`;
  const act = preview ? `${sel}:active:not(:disabled), ${sel}.is-active` : `${sel}:active:not(:disabled)`;
  const out = [
    block(sel, s.base, false),
    block(hov, s.hover, true),
    block(act, transformCss(pressed) === transformCss(s.hover) ? { ...s.active, x: 0, y: 0, s: 1 } : pressed, true),
    `${sel}:focus-visible {\n  outline: 3px solid ${s.ring};\n  outline-offset: 2px;\n}`,
    `${sel}:disabled {\n  opacity: 0.5;\n  cursor: not-allowed;\n}`,
    `@media (prefers-reduced-motion: reduce) {\n  ${sel} { transition: none; }\n}`,
  ];
  return out.filter(Boolean).join('\n\n');
}

// ---- Tailwind ----
export function tailwind(b: Btn, opts: { layout?: boolean } = {}): string {
  const s = build(b);
  const base = s.base.tw.filter((c) => opts.layout !== false || !/^(inline-flex|items-center|justify-center|gap-|transition|duration-|ease-|cursor-pointer)/.test(c));
  const hover = [...s.hover.tw, ...transformTw(s.hover, 'hover:')];
  const active = [...s.active.tw, ...transformTw(s.active, 'active:')];
  const focus = ['focus-visible:outline', 'focus-visible:outline-[3px]', 'focus-visible:outline-offset-2', `focus-visible:outline-[${s.ring}]`];
  const rest = ['disabled:opacity-50', 'disabled:cursor-not-allowed', 'motion-reduce:transition-none'];
  return [...base, ...hover, ...active, ...focus, ...rest].join(' ');
}

const ARROW_SVG = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const ARROW_JSX = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>';
export const arrowSvg = ARROW_SVG;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const label = (b: Btn) => b.label.trim() || 'Button';

export function cssExport(b: Btn): string {
  const lines: string[] = [];
  const url = googleFontUrl(b.font, b.weight);
  if (url) lines.push(`/* Font: put this first in your CSS, or use a <link> tag */\n@import url("${url}");\n`);
  lines.push(css(b));
  lines.push(`\n/* HTML:\n<button class="btn" type="button">${esc(label(b))}${b.icon ? ' ' + ARROW_SVG : ''}</button>\n*/`);
  return lines.join('\n');
}

export function reactExport(b: Btn): string {
  const classes = tailwind(b);
  return `import type { ButtonHTMLAttributes } from "react";

// Needs Tailwind CSS. No Tailwind? Use the CSS tab instead.
export function PrimaryButton({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={\`${classes} \${className}\`}
      {...props}
    >
      {children}
    </button>
  );
}

// Use it:
// <PrimaryButton onClick={start}>${esc(label(b))}${b.icon ? ' ' + ARROW_JSX : ''}</PrimaryButton>`;
}

export function shadcnExport(b: Btn): string {
  const look = tailwind({ ...b }, { layout: false })
    .split(' ')
    .filter((c) => !/^(px-|py-|text-xs|text-sm|text-base|text-lg|text-xl|text-2xl|text-\[\d+px\]|leading-|font-(normal|medium|semibold|bold|extrabold)$|focus-visible:|disabled:|motion-reduce:)/.test(c))
    .join(' ');
  const size = [sp('px', b.padX), sp('py', b.padY), TEXT[b.size] ?? `text-[${b.size}px]`, WEIGHT[fontWeight(b.font, b.weight)]].join(' ');
  return `// components/ui/button.tsx → inside buttonVariants({ variants: { ... } })

variant: {
  // ...keep default, outline, ghost and the others
  brand: "${look}",
},
size: {
  // ...keep default, sm, lg, icon
  brand: "h-auto ${size}",
},

// Use it:
// <Button variant="brand" size="brand">${esc(label(b))}</Button>`;
}

export function agentPrompt(b: Btn): string {
  const name = PRESETS.find((p) => p.key === b.preset)!.name.toLowerCase();
  return `Restyle the main call-to-action button in my app with this design (a ${name} button, color ${b.color}).

Scope: change only the primary call-to-action buttons (like "${label(b)}"). Do not restyle every button in the app. If you are not sure which buttons count, list them and ask me first.

If the project uses Tailwind, use these classes (for shadcn/ui, add them as a new "brand" variant in components/ui/button.tsx instead of editing the default one):
${tailwind(b)}

If it does not use Tailwind, add this CSS and give those buttons the class "btn":
${css(b)}
${googleFontUrl(b.font, b.weight) ? `\nLoad the font from ${googleFontUrl(b.font, b.weight)} if it is not already loaded.\n` : ''}
Keep the focus outline and the reduced-motion rule; they are for keyboard users and people who turn off animations.`;
}

// ---- Share links ----
export function toQuery(b: Btn): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(b)) if (v !== (DEFAULT as Record<string, unknown>)[k]) p.set(k, String(v).replace(/^#/, ''));
  return p.toString();
}
export function fromQuery(q: string): Btn {
  const p = new URLSearchParams(q);
  const b: Btn = { ...DEFAULT };
  const num = (k: keyof Btn, lo: number, hi: number) => {
    const v = Number(p.get(k));
    if (p.has(k) && Number.isFinite(v)) (b as Record<string, unknown>)[k] = clamp(Math.round(v), lo, hi);
  };
  const pick = <T extends string>(k: keyof Btn, list: readonly T[]) => {
    const v = p.get(k) as T;
    if (v && list.includes(v)) (b as Record<string, unknown>)[k] = v;
  };
  pick('preset', PRESETS.map((x) => x.key));
  pick('font', Object.keys(FONTS) as FontKey[]);
  pick('shadow', ['none', 'soft', 'medium', 'strong'] as const);
  pick('hover', ['darken', 'lift', 'glow', 'grow', 'none'] as const);
  pick('press', ['sink', 'shrink', 'none'] as const);
  const col = parseHex(p.get('color') ?? '');
  if (col) b.color = col;
  const t = p.get('text');
  if (t === 'auto') b.text = 'auto';
  else if (t && parseHex(t)) b.text = parseHex(t)!;
  num('radius', 0, 999);
  if (b.radius > 32) b.radius = 999;
  num('padX', 8, 48);
  num('padY', 4, 24);
  num('size', 12, 24);
  num('weight', 400, 800);
  b.weight = clamp(Math.round(b.weight / 100) * 100, 400, 800);
  if (p.has('label')) b.label = (p.get('label') ?? '').slice(0, 40);
  if (p.has('icon')) b.icon = p.get('icon') === 'true';
  return b;
}

export const TASTEFUL = ['#0f766e', '#e8590c', '#be123c', '#15803d', '#1d4ed8', '#ca8a04', '#0b2230', '#db2777', '#0891b2', '#9a3412', '#4d7c0f', '#f59e0b', '#14b8a6', '#ef4444'];
