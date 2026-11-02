// Color converter math: parse any CSS color and write it out in every format. Pure functions, no DOM.
import { STEPS, V4 } from './tailwind-palettes';
import { CSS_NAMES } from './css-color-names';

export type Vec = [number, number, number];
export type Color = { lab: Vec; alpha: number }; // lab is OKLab, not clamped, so wide-gamut input keeps its exact value

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mul = (m: number[][], v: Vec): Vec => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

// ---------- sRGB <-> OKLab ----------

const toLin = (c: number) => {
  const a = Math.abs(c);
  return Math.sign(c) * (a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4);
};
const toGam = (c: number) => {
  const a = Math.abs(c);
  return Math.sign(c) * (a <= 0.0031308 ? 12.92 * a : 1.055 * a ** (1 / 2.4) - 0.055);
};

function linToOklab([r, g, b]: Vec): Vec {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLin([L, A, B]: Vec): Vec {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** sRGB 0..1 → OKLab */
export const rgbToLab = (rgb: Vec): Vec => linToOklab(rgb.map(toLin) as Vec);
/** OKLab → sRGB 0..1, not clamped (can be outside 0..1 for wide-gamut colors) */
export const labToRgbRaw = (lab: Vec): Vec => oklabToLin(lab).map(toGam) as Vec;

export const inGamut = (rgb: Vec, eps = 0.0005) => rgb.every((v) => v >= -eps && v <= 1 + eps);

export function labToLch([L, a, b]: Vec): Vec {
  const C = Math.hypot(a, b);
  const H = C < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}
export function lchToLab([L, C, H]: Vec): Vec {
  const h = (H * Math.PI) / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
}

/** The color any screen can show: in-gamut colors are clamped; others keep lightness and hue and lose chroma. */
export function displayRgb(lab: Vec): Vec {
  const L = clamp(lab[0], 0, 1);
  const raw = labToRgbRaw([L, lab[1], lab[2]]);
  if (inGamut(raw)) return raw.map((v) => clamp(v, 0, 1)) as Vec;
  const [, C, H] = labToLch([L, lab[1], lab[2]]);
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(labToRgbRaw(lchToLab([L, mid, H])), 0)) lo = mid;
    else hi = mid;
  }
  return labToRgbRaw(lchToLab([L, lo, H])).map((v) => clamp(v, 0, 1)) as Vec;
}

// ---------- CIE Lab (D50, as CSS lab() uses) ----------

const LIN_TO_XYZ = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const XYZ_TO_LIN = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const D65_TO_D50 = [
  [1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
  [0.029627815688159344, 0.990434484573249, -0.01707382502938514],
  [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
];
const D50_TO_D65 = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433799796, 1.3303659366080753],
];
const D50: Vec = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

/** OKLab → CIE Lab D50 (L 0..100) */
export function oklabToCie(lab: Vec): Vec {
  const xyz = mul(D65_TO_D50, mul(LIN_TO_XYZ, oklabToLin(lab)));
  const f = xyz.map((v, i) => {
    const t = v / D50[i];
    return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

/** CIE Lab D50 (L 0..100) → OKLab */
export function cieToOklab([L, a, b]: Vec): Vec {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const x = fx ** 3 > EPS ? fx ** 3 : (116 * fx - 16) / KAPPA;
  const y = L > KAPPA * EPS ? fy ** 3 : L / KAPPA;
  const z = fz ** 3 > EPS ? fz ** 3 : (116 * fz - 16) / KAPPA;
  const xyz: Vec = [x * D50[0], y * D50[1], z * D50[2]];
  return linToOklab(mul(XYZ_TO_LIN, mul(D50_TO_D65, xyz)));
}

// ---------- HSL and HWB (h 0..360, others 0..1) ----------

export function rgbToHsl([r, g, b]: Vec): Vec {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-9) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, clamp(s, 0, 1), l];
}

export function hslToRgb([h, s, l]: Vec): Vec {
  h = ((h % 360) + 360) % 360;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

export function rgbToHwb(rgb: Vec): Vec {
  const [h] = rgbToHsl(rgb);
  return [h, Math.min(...rgb), 1 - Math.max(...rgb)];
}

export function hwbToRgb([h, w, b]: Vec): Vec {
  if (w + b >= 1) {
    const g = w / (w + b);
    return [g, g, g];
  }
  return hslToRgb([h, 1, 0.5]).map((v) => v * (1 - w - b) + w) as Vec;
}

// ---------- Names and Tailwind ----------

export const NAMES: { name: string; hex: string; lab: Vec }[] = CSS_NAMES.split(' ').map((p) => {
  const [name, h] = p.split(':');
  return { name, hex: h, lab: rgbToLab(hexToRgb(h)) };
});

export const TAILWIND: { name: string; css: string; lab: Vec }[] = [
  ...Object.entries(V4).flatMap(([fam, row]) =>
    row.split(', ').map((t, i) => {
      const [L, C, H] = t.split(' ').map(Number);
      return { name: `${fam}-${STEPS[i]}`, css: `oklch(${+(L * 100).toFixed(2)}% ${C} ${H})`, lab: lchToLab([L, C, H]) };
    }),
  ),
  { name: 'black', css: '#000', lab: [0, 0, 0] as Vec },
  { name: 'white', css: '#fff', lab: [1, 0, 0] as Vec },
];

/** OKLab distance × 100: about 1 is the smallest difference most people can see side by side. */
export const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;

export function nearest<T extends { lab: Vec }>(lab: Vec, list: T[]): T & { d: number } {
  let best = list[0];
  let bd = Infinity;
  for (const it of list) {
    const d = dist(lab, it.lab);
    if (d < bd) {
      bd = d;
      best = it;
    }
  }
  return { ...best, d: bd };
}

/** Every CSS name with exactly this hex (aqua and cyan share one, for example). */
export const namesFor = (hex6: string) => NAMES.filter((n) => n.hex === hex6.toLowerCase()).map((n) => n.name);

// ---------- Contrast (WCAG 2) ----------

const lum = (rgb: Vec) => {
  const [r, g, b] = rgb.map(toLin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(a: Vec, b: Vec) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** The color you actually see when `rgb` with `alpha` sits on `bg`. */
export const over = (rgb: Vec, alpha: number, bg: Vec): Vec => rgb.map((v, i) => v * alpha + bg[i] * (1 - alpha)) as Vec;

// ---------- Parsing ----------

export function hexToRgb(h: string): Vec {
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Vec;
}

const NUM = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?(%|deg|grad|rad|turn)?$/;

function angle(s: string): number {
  const v = parseFloat(s);
  if (s.endsWith('turn')) return v * 360;
  if (s.endsWith('grad')) return v * 0.9;
  if (s.endsWith('rad')) return (v * 180) / Math.PI;
  return v;
}
/** A number or a percentage of `full`. */
const amt = (s: string, full: number) => (s.endsWith('%') ? (parseFloat(s) / 100) * full : parseFloat(s));
const none = (s: string) => (s === 'none' ? '0' : s);

function alphaOf(s: string | undefined): number | null {
  if (s === undefined) return 1;
  if (!NUM.test(s)) return null;
  return clamp(amt(s, 1), 0, 1);
}

const fromRgb = (rgb: Vec, alpha: number): Color => ({ lab: rgbToLab(rgb.map((v) => clamp(v, 0, 1)) as Vec), alpha });

/** Reads hex, rgb(), hsl(), hwb(), oklch(), oklab(), lab(), lch(), CSS names, Tailwind names like sky-500, or bare "5 147 198". */
export function parse(input: string): Color | null {
  let s = input.trim().toLowerCase().replace(/;$/, '').replace(/^(?:--[\w-]+|color|background(?:-color)?)\s*:\s*/, '').trim();
  if (!s) return null;

  let m = s.match(/^(?:#|0x)?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m && (s.startsWith('#') || s.startsWith('0x') || /[a-f]/.test(m[1]) || m[1].length === 6)) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    return { lab: rgbToLab(hexToRgb(h)), alpha: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }

  const named = NAMES.find((n) => n.name === s);
  if (named) return { lab: named.lab, alpha: 1 };
  if (s === 'transparent') return { lab: [0, 0, 0], alpha: 0 };

  const tw = s.match(/^(?:(?:bg|text|border|fill|stroke|ring|from|to|via|outline|decoration|accent|caret|divide|shadow)-)?([a-z]+-\d{2,3}|black|white)$/);
  if (tw) {
    const hit = TAILWIND.find((t) => t.name === tw[1]);
    if (hit) return { lab: hit.lab, alpha: 1 };
  }

  m = s.match(/^([a-z]+)\((.*)\)$/);
  let fn = 'rgb';
  let body = s;
  if (m) {
    fn = m[1].replace(/a$/, '');
    body = m[2];
  } else if (!/^[-+.\d]/.test(s)) return null;

  let alphaPart: string | undefined;
  const slash = body.split('/');
  if (slash.length > 2) return null;
  if (slash.length === 2) alphaPart = slash[1].trim();
  const parts = slash[0].trim().split(/\s*,\s*|\s+/).filter(Boolean).map(none);
  if (alphaPart === undefined && parts.length === 4) alphaPart = parts.pop();
  if (parts.length !== 3 || !parts.every((p) => NUM.test(p))) return null;
  const alpha = alphaOf(alphaPart);
  if (alpha === null) return null;
  const [p0, p1, p2] = parts;

  switch (fn) {
    case 'rgb': {
      const rgb = parts.map((p) => amt(p, 255) / 255) as Vec;
      return fromRgb(rgb, alpha);
    }
    case 'hsl': {
      const unit = (p: string) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p) / 100);
      return fromRgb(hslToRgb([angle(p0), clamp(unit(p1), 0, 1), clamp(unit(p2), 0, 1)]), alpha);
    }
    case 'hwb': {
      const unit = (p: string) => clamp(parseFloat(p) / 100, 0, 1);
      return fromRgb(hwbToRgb([angle(p0), unit(p1), unit(p2)]), alpha);
    }
    case 'oklch': {
      const L = clamp(amt(p0, 1), 0, 1);
      const C = Math.max(0, amt(p1, 0.4));
      return { lab: lchToLab([L, C, angle(p2)]), alpha };
    }
    case 'oklab':
      return { lab: [clamp(amt(p0, 1), 0, 1), amt(p1, 0.4), amt(p2, 0.4)], alpha };
    case 'lab':
      return { lab: cieToOklab([clamp(amt(p0, 100), 0, 100), amt(p1, 125), amt(p2, 125)]), alpha };
    case 'lch': {
      const h = (angle(p2) * Math.PI) / 180;
      const C = Math.max(0, amt(p1, 150));
      return { lab: cieToOklab([clamp(amt(p0, 100), 0, 100), C * Math.cos(h), C * Math.sin(h)]), alpha };
    }
  }
  return null;
}

// ---------- Writing out ----------

const n = (v: number, d: number) => String(+v.toFixed(d) || 0);
const a = (alpha: number) => n(alpha, 2);
const tail = (alpha: number) => (alpha < 1 ? ` / ${a(alpha)}` : '');

export const hex = (rgb: Vec, alpha = 1) =>
  '#' +
  [...rgb, ...(alpha < 1 ? [alpha] : [])]
    .map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

export type Formats = { hex: string; rgb: string; hsl: string; hwb: string; oklch: string; lab: string };

export function format(c: Color): Formats {
  const rgb = displayRgb(c.lab);
  const r255 = rgb.map((v) => Math.round(v * 255));
  const [h, s, l] = rgbToHsl(r255.map((v) => v / 255) as Vec);
  const [hh, w, bl] = rgbToHwb(r255.map((v) => v / 255) as Vec);
  const [L, C, H] = labToLch(c.lab);
  const cie = oklabToCie(c.lab);
  const al = c.alpha < 1;
  return {
    hex: hex(rgb, c.alpha),
    rgb: al ? `rgba(${r255.join(', ')}, ${a(c.alpha)})` : `rgb(${r255.join(', ')})`,
    hsl: al
      ? `hsla(${n(h, 1)}, ${n(s * 100, 1)}%, ${n(l * 100, 1)}%, ${a(c.alpha)})`
      : `hsl(${n(h, 1)}, ${n(s * 100, 1)}%, ${n(l * 100, 1)}%)`,
    hwb: `hwb(${n(hh, 1)} ${n(w * 100, 1)}% ${n(bl * 100, 1)}%${tail(c.alpha)})`,
    oklch: `oklch(${n(L * 100, 2)}% ${n(C, 5)} ${n(C < 0.0005 ? 0 : H, 2)}${tail(c.alpha)})`,
    lab: `lab(${n(cie[0], 2)}% ${n(cie[1], 2)} ${n(cie[2], 2)}${tail(c.alpha)})`,
  };
}
