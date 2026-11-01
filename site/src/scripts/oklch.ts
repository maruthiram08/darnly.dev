// Shared OKLCH color maths (OKLab by Björn Ottosson), used by the Tailwind shades and shadcn theme tools.
// No DOM here, so any page script can import it.

export type RGB = [number, number, number]; // 0–1 sRGB
export type LCH = [number, number, number]; // OKLCH: lightness 0–1, chroma, hue in degrees

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklch([r0, g0, b0]: RGB): LCH {
  const r = toLinear(r0);
  const g = toLinear(g0);
  const b = toLinear(b0);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, H];
}

// Returns gamma-encoded sRGB, possibly outside 0–1 when the color is out of gamut.
export function oklchToRgbRaw([L, C, H]: LCH): RGB {
  const h = (H * Math.PI) / 180;
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
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

// Keep lightness and hue, and lower chroma only as much as needed to fit on a normal screen.
export function fitGamut(lch: LCH): LCH {
  if (inGamut(oklchToRgbRaw(lch))) return lch;
  let lo = 0;
  let hi = lch[1];
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToRgbRaw([lch[0], mid, lch[2]]))) lo = mid;
    else hi = mid;
  }
  return [lch[0], lo, lch[2]];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const clampRgb = (rgb: RGB): RGB => rgb.map(clamp01) as RGB;
export const rgbToHex = (rgb: RGB) =>
  '#' + rgb.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');

export function parseHex(input: string): RGB | null {
  let s = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = [...s].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/.test(s)) return null;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as RGB;
}
