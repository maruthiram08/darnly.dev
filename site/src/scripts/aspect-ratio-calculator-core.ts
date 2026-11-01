// Aspect ratio calculator: the pure math, kept apart from the page so it is easy to test.

// Up to 4 decimals, no trailing zeros.
export function fmt(n: number, places = 4): string {
  if (!Number.isFinite(n)) return '0';
  const m = 10 ** places;
  const r = Math.round(n * m) / m;
  return String(Object.is(r, -0) ? 0 : r);
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export type Ratio = { w: number; h: number };

// Well-known ratios, with where you meet them. Order matters for "closest" ties.
export const COMMON: { label: string; w: number; h: number; use: string }[] = [
  { label: '16:9', w: 16, h: 9, use: 'YouTube, laptops, TVs' },
  { label: '4:3', w: 4, h: 3, use: 'iPad, old monitors, slides' },
  { label: '1:1', w: 1, h: 1, use: 'Instagram square, avatars' },
  { label: '9:16', w: 9, h: 16, use: 'Stories, Reels, TikTok, Shorts' },
  { label: '1.91:1', w: 1.91, h: 1, use: 'Link previews (Open Graph)' },
  { label: '4:5', w: 4, h: 5, use: 'Instagram portrait post' },
  { label: '3:2', w: 3, h: 2, use: 'Photos, Surface laptops' },
  { label: '21:9', w: 21, h: 9, use: 'Ultrawide, cinema' },
  { label: '2:1', w: 2, h: 1, use: 'X / Twitter large card' },
  { label: '16:10', w: 16, h: 10, use: 'MacBooks' },
];

// Read "16:9", "16/9", "16x9", "16 by 9", "1.91" or "1.91:1". Returns null when it isn't a ratio.
export function parseRatio(input: string): Ratio | null {
  const s = input.trim().toLowerCase().replace(/\s*(by|×)\s*/g, ':');
  const m = s.match(/^(\d*\.?\d+)\s*(?:[:/x]\s*(\d*\.?\d+))?$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = m[2] === undefined ? 1 : Number(m[2]);
  if (!(w > 0) || !(h > 0)) return null;
  return { w, h };
}

// Read a size in px. Allows "1920", "1920px", "1,920".
export function readSize(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/px$/, '').replace(/,/g, '').trim();
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 100000 ? n : null;
}

// Whole-number ratio for two sizes: 1920 × 1080 → 16:9, 1200 × 630 → 40:21.
// Decimal sizes are scaled up first so 1.91 × 1 → 191:100.
export function simplify(w: number, h: number): Ratio {
  let scale = 1;
  while (scale < 10000 && (!Number.isInteger(Math.round(w * scale * 1e6) / 1e6) || !Number.isInteger(Math.round(h * scale * 1e6) / 1e6))) scale *= 10;
  const a = Math.round(w * scale);
  const b = Math.round(h * scale);
  const g = gcd(a, b);
  return { w: a / g, h: b / g };
}

// The nearest well-known ratio, and how far off it is (0.01 = 1%).
export function closest(w: number, h: number) {
  const r = w / h;
  let best = COMMON[0];
  let off = Infinity;
  for (const c of COMMON) {
    const d = Math.abs(r / (c.w / c.h) - 1);
    if (d < off) {
      off = d;
      best = c;
    }
  }
  return { ...best, off };
}

// The short name people use: "16:9", or "1.91:1" when the whole numbers are long (40:21 is really 1.91:1).
export function label(w: number, h: number): { main: string; exact: string; decimal: string; near?: string } {
  const s = simplify(w, h);
  const exact = `${s.w}:${s.h}`;
  const decimal = w >= h ? `${fmt(w / h, 3)}:1` : `1:${fmt(h / w, 3)}`;
  const c = closest(w, h);
  if (c.off < 0.0005) return { main: c.label, exact, decimal };
  const main = s.w <= 32 && s.h <= 32 ? exact : decimal;
  const near = c.off < 0.03 ? c.label : undefined;
  return { main, exact, decimal, near };
}

// The other side for a locked ratio.
export const heightFor = (width: number, r: Ratio) => (width * r.h) / r.w;
export const widthFor = (height: number, r: Ratio) => (height * r.w) / r.h;

// CSS aspect-ratio value: "16 / 9". Uses the simplified whole numbers when short, else the sizes.
export function cssValue(w: number, h: number): string {
  const s = simplify(w, h);
  if (s.w <= 1000 && s.h <= 1000) return `${s.w} / ${s.h}`;
  return `${fmt(w / h, 4)}`;
}

export function css(w: number, h: number): string {
  return `aspect-ratio: ${cssValue(w, h)};`;
}

// Tailwind: aspect-video and aspect-square are built in; anything else is an arbitrary value (works in v3 and v4).
export function tailwind(w: number, h: number): string {
  const s = simplify(w, h);
  if (s.w === 16 && s.h === 9) return 'aspect-video';
  if (s.w === 1 && s.h === 1) return 'aspect-square';
  return `aspect-[${cssValue(w, h).replace(/ /g, '')}]`;
}

// The old padding-top hack, for email templates and very old browsers.
export function paddingPercent(w: number, h: number): string {
  return `${fmt((h / w) * 100, 4)}%`;
}

export function paddingHack(w: number, h: number): string {
  return `.ratio-box {
  position: relative;
  width: 100%;
  padding-top: ${paddingPercent(w, h)}; /* ${label(w, h).main} */
}
.ratio-box > * {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}`;
}

// How your picture sits in a slot of another ratio.
// fit = the whole picture shows, with bars; fill = the slot is covered, and some of the picture is cut off.
// Returns the picture's box inside the slot in % of the slot, plus the bar or crop size in % of the picture.
export type Placement = { left: number; top: number; width: number; height: number; match: boolean; side: 'none' | 'sides' | 'topbottom'; lost: number };

export function place(picW: number, picH: number, slotW: number, slotH: number, mode: 'fit' | 'fill'): Placement {
  const pr = picW / picH;
  const sr = slotW / slotH;
  const match = Math.abs(pr / sr - 1) < 0.01;
  let width = 100;
  let height = 100;
  // Picture wider than the slot.
  const wider = pr > sr;
  if (mode === 'fit') {
    if (wider) height = (sr / pr) * 100;
    else width = (pr / sr) * 100;
  } else {
    if (wider) width = (pr / sr) * 100;
    else height = (sr / pr) * 100;
  }
  const left = (100 - width) / 2;
  const top = (100 - height) / 2;
  let lost: number;
  let side: Placement['side'];
  if (match) {
    lost = 0;
    side = 'none';
  } else if (mode === 'fit') {
    // Share of the slot that is empty bars.
    lost = wider ? 100 - height : 100 - width;
    side = wider ? 'topbottom' : 'sides';
  } else {
    // Share of the picture that is cut off.
    lost = wider ? 100 - 10000 / width : 100 - 10000 / height;
    side = wider ? 'sides' : 'topbottom';
  }
  return { left, top, width, height, match, side, lost };
}

// Common widths, for the table of sizes at this ratio.
export const WIDTHS = [320, 480, 640, 720, 768, 1024, 1080, 1200, 1280, 1366, 1440, 1600, 1920, 2560, 3840];
