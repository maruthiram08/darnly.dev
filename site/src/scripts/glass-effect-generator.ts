// Glassmorphism (frosted glass) generator with a live preview and a text contrast check.
// Everything runs in the visitor's browser. The contrast check redraws the background on a
// small canvas, blurs and saturates it like backdrop-filter does, lays the glass tint on top
// and measures the text against the worst spots under the card.

type RGB = [number, number, number];

export type Glass = {
  tint: RGB;
  alpha: number; // 0–100
  blur: number; // px
  sat: number; // percent, 100 = unchanged
  border: number; // 0–100, white border opacity
  shadow: number; // 0–100
  radius: number; // px
  shine: boolean;
  text: 'auto' | 'light' | 'dark';
};

export const LIGHT: RGB = [255, 255, 255];
export const DARK: RGB = [11, 34, 48]; // #0B2230

// ---- Colors ----
export function parseHex(input: string): RGB | null {
  let s = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = [...s].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/.test(s)) return null;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
}
export const toHex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const rgba = (c: RGB, a: number) => `rgba(${c.map(Math.round).join(', ')}, ${Math.round(a * 100) / 100})`;
const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function lin(v: number) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export const luminance = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export function contrast(a: number, b: number) {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
const LUM_LIGHT = luminance(LIGHT);
const LUM_DARK = luminance(DARK);

// ---- Output ----
const shadowParts = (g: Glass) => {
  const parts: string[] = [];
  if (g.shine) parts.push(`inset 0 1px 0 ${rgba(LIGHT, 0.4)}`);
  if (g.shadow > 0) parts.push(`0 8px 32px ${rgba([0, 0, 0], (g.shadow / 100) * 0.4)}`);
  return parts;
};
const filterValue = (g: Glass) => {
  const f = [`blur(${g.blur}px)`];
  if (g.sat !== 100) f.push(`saturate(${g.sat}%)`);
  return f.join(' ');
};

// The color behind the text when backdrop-filter isn't supported: the tint if it is solid enough to read on, else a plain panel.
function fallbackBg(g: Glass, textColor: RGB): string {
  if (contrast(luminance(g.tint), luminance(textColor)) >= 4.5) return rgba(g.tint, Math.max(0.9, g.alpha / 100));
  return same(textColor, LIGHT) ? rgba(DARK, 0.88) : rgba(LIGHT, 0.88);
}

export function glassCss(g: Glass, textColor: RGB): string {
  const lines = [
    `  background: ${rgba(g.tint, g.alpha / 100)};`,
    `  -webkit-backdrop-filter: ${filterValue(g)};`,
    `  backdrop-filter: ${filterValue(g)};`,
  ];
  if (g.border > 0) lines.push(`  border: 1px solid ${rgba(LIGHT, g.border / 100)};`);
  lines.push(`  border-radius: ${g.radius}px;`);
  const sh = shadowParts(g);
  if (sh.length) lines.push(`  box-shadow: ${sh.join(', ')};`);
  lines.push(`  color: ${toHex(textColor)};`);
  return [
    '.glass {',
    ...lines,
    '}',
    '',
    '/* Browsers without backdrop-filter get a more solid panel so the text stays readable. */',
    '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {',
    `  .glass { background: ${fallbackBg(g, textColor)}; }`,
    '}',
  ].join('\n');
}

// Named classes only where Tailwind v3 and v4 agree; otherwise an exact arbitrary value.
const BLUR_NAMES: Record<number, string> = { 0: 'none', 12: 'md', 16: 'lg', 24: 'xl', 40: '2xl' };
const RADIUS_NAMES: Record<number, string> = { 0: 'none', 6: 'md', 8: 'lg', 12: 'xl', 16: '2xl', 24: '3xl' };
const SAT_NAMES = new Set([0, 50, 150, 200]);

export function glassTailwind(g: Glass, textColor: RGB): string {
  const cls: string[] = [];
  const base = same(g.tint, LIGHT) ? 'white' : same(g.tint, [0, 0, 0]) ? 'black' : `[${toHex(g.tint)}]`;
  cls.push(g.alpha >= 100 ? `bg-${base}` : `bg-${base}/${g.alpha}`);
  cls.push(g.blur in BLUR_NAMES ? `backdrop-blur-${BLUR_NAMES[g.blur]}` : `backdrop-blur-[${g.blur}px]`);
  if (g.sat !== 100) cls.push(SAT_NAMES.has(g.sat) ? `backdrop-saturate-${g.sat}` : `backdrop-saturate-[${g.sat / 100}]`);
  if (g.border > 0) cls.push('border', g.border >= 100 ? 'border-white' : `border-white/${g.border}`);
  cls.push(g.radius in RADIUS_NAMES ? `rounded-${RADIUS_NAMES[g.radius]}` : `rounded-[${g.radius}px]`);
  const sh = shadowParts(g);
  if (sh.length) cls.push(`shadow-[${sh.join(',').replace(/, /g, ',').replace(/ /g, '_')}]`);
  cls.push(same(textColor, LIGHT) ? 'text-white' : `text-[${toHex(textColor)}]`);
  return cls.join(' ');
}

export function agentPrompt(g: Glass, textColor: RGB, ratio: number, bgName: string): string {
  const verdict = ratio >= 4.5 ? 'easy to read' : ratio >= 3 ? 'only OK for large text' : 'hard to read';
  return [
    'Give the panel I describe below a frosted glass look (glassmorphism). Ask me which element if it is not clear.',
    '',
    'If the project uses Tailwind, use these classes:',
    glassTailwind(g, textColor),
    '',
    'Otherwise use this CSS, and keep the @supports fallback:',
    glassCss(g, textColor),
    '',
    'Notes:',
    '- Glass only shows over something colorful (a photo, a gradient or colored shapes). Over a flat white section it just looks grey, so tell me if the panel sits on a plain background.',
    '- Keep both the -webkit-backdrop-filter and backdrop-filter lines so the blur works in Safari too.',
    `- I tested it over a "${bgName}" background: text contrast was ${ratio.toFixed(1)}:1 (${verdict}). Aim for 4.5:1 or more. If the real background behind the panel is busier, raise the background opacity.`,
    '',
    'Made with https://darnly.dev/tools/glass-effect-generator/',
  ].join('\n');
}

// ---- Backgrounds ----
// Each background is colored ellipses on a base color, so the same picture can be drawn in CSS and on a canvas.
type Blob = [hex: string, x: number, y: number, rx: number, ry: number];
type Bg = { id: string; name: string; base: string; blobs: Blob[]; stripes?: boolean };

const STRIPES = ['#FF5A5F', '#FFD23F', '#1B998B', '#0B2230'];
const STRIPE = 22; // px per stripe

export const BACKGROUNDS: Bg[] = [
  { id: 'sunset', name: 'Sunset', base: '#FF7E5F', blobs: [['#FEB47B', 20, 20, 60, 70], ['#FF3D77', 85, 30, 50, 65], ['#FFCF5C', 70, 90, 45, 55], ['#E8505B', 10, 85, 40, 50]] },
  { id: 'aurora', name: 'Aurora', base: '#0B3D4F', blobs: [['#18D5A7', 25, 30, 50, 60], ['#2F80ED', 80, 25, 45, 60], ['#F5D76E', 60, 95, 45, 45]] },
  { id: 'ocean', name: 'Ocean', base: '#0593C6', blobs: [['#6EE7F9', 20, 25, 50, 60], ['#0B2230', 85, 85, 55, 60], ['#FBD786', 88, 12, 30, 40]] },
  { id: 'candy', name: 'Candy', base: '#FFD1E8', blobs: [['#FF6FB5', 15, 30, 45, 60], ['#7AD7F0', 82, 25, 45, 60], ['#FFE066', 55, 90, 45, 50]] },
  { id: 'lime', name: 'Lime', base: '#D4F5C4', blobs: [['#34C759', 22, 72, 45, 60], ['#FFF275', 75, 18, 45, 55], ['#00A6A6', 88, 88, 35, 50]] },
  { id: 'midnight', name: 'Midnight', base: '#0B1020', blobs: [['#FF4D6D', 22, 30, 35, 50], ['#3A86FF', 80, 72, 40, 55], ['#FFBE0B', 70, 12, 22, 30]] },
  { id: 'busy', name: 'Busy stripes', base: '#0B2230', blobs: [], stripes: true },
];

function bgCss(bg: Bg): string {
  if (bg.stripes) {
    const s = STRIPES.map((c, i) => `${c} ${i * STRIPE}px ${(i + 1) * STRIPE}px`).join(', ');
    return `repeating-linear-gradient(45deg, ${s})`;
  }
  const layers = bg.blobs.map(([hex, x, y, rx, ry]) => {
    const c = parseHex(hex)!;
    return `radial-gradient(ellipse ${rx}% ${ry}% at ${x}% ${y}%, ${hex}, ${rgba(c, 0)})`;
  });
  return [...layers, `linear-gradient(${bg.base}, ${bg.base})`].join(', ');
}

// Draws the background at `scale` (canvas px per stage px). Blobs are drawn bottom layer first, like CSS.
function drawBg(ctx: CanvasRenderingContext2D, bg: Bg | HTMLImageElement, w: number, h: number, scale: number) {
  ctx.clearRect(0, 0, w, h);
  if (bg instanceof HTMLImageElement) {
    const r = Math.max(w / bg.naturalWidth, h / bg.naturalHeight);
    const dw = bg.naturalWidth * r;
    const dh = bg.naturalHeight * r;
    ctx.drawImage(bg, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return;
  }
  ctx.fillStyle = bg.base;
  ctx.fillRect(0, 0, w, h);
  if (bg.stripes) {
    // 45deg in CSS runs toward the top right; stripes are perpendicular to that direction.
    const period = STRIPE * STRIPES.length * scale;
    const d = Math.SQRT1_2;
    const img = ctx.getImageData(0, 0, w, h);
    const cols = STRIPES.map((c) => parseHex(c)!);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Distance along the gradient line, measured from the bottom-left corner.
        const t = (x * d + (h - y) * d) % period;
        const c = cols[Math.min(STRIPES.length - 1, Math.floor(t / (STRIPE * scale)))];
        const i = (y * w + x) * 4;
        img.data[i] = c[0];
        img.data[i + 1] = c[1];
        img.data[i + 2] = c[2];
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return;
  }
  for (const [hex, x, y, rx, ry] of [...bg.blobs].reverse()) {
    const c = parseHex(hex)!;
    ctx.save();
    ctx.translate((x / 100) * w, (y / 100) * h);
    ctx.scale((rx / 100) * w, (ry / 100) * h);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, hex);
    grad.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.restore();
  }
}

// Three box blurs in a row look close to a Gaussian blur with the same radius.
function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  if (r < 1) return;
  const tmp = new Float32Array(src.length);
  const pass = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    const n = horizontal ? w : h;
    const lines = horizontal ? h : w;
    for (let l = 0; l < lines; l++) {
      for (let ch = 0; ch < 3; ch++) {
        const at = (k: number) => {
          const kk = k < 0 ? 0 : k >= n ? n - 1 : k;
          return ((horizontal ? l * w + kk : kk * w + l) * 3) + ch;
        };
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += from[at(k)];
        for (let k = 0; k < n; k++) {
          to[at(k)] = sum / (2 * r + 1);
          sum += from[at(k + r + 1)] - from[at(k - r)];
        }
      }
    }
  };
  for (let i = 0; i < 3; i++) {
    pass(src, tmp, true);
    pass(tmp, src, false);
  }
}

// ---- Page ----
type Preset = { name: string } & Omit<Glass, 'text'>;
const PRESETS: Preset[] = [
  { name: 'Frosted', tint: LIGHT, alpha: 20, blur: 16, sat: 180, border: 30, shadow: 30, radius: 20, shine: true },
  { name: 'Clear', tint: LIGHT, alpha: 10, blur: 6, sat: 120, border: 25, shadow: 20, radius: 20, shine: true },
  { name: 'Milky', tint: LIGHT, alpha: 55, blur: 24, sat: 140, border: 40, shadow: 25, radius: 24, shine: true },
  { name: 'Smoked', tint: [0, 0, 0], alpha: 35, blur: 20, sat: 160, border: 15, shadow: 40, radius: 20, shine: true },
  { name: 'Rose', tint: [255, 214, 224], alpha: 30, blur: 16, sat: 160, border: 35, shadow: 25, radius: 16, shine: true },
];

function init() {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const stage = $('gl-stage');
  const card = $('gl-card');
  const badge = $('gl-badge');
  const btn = $('gl-btn');
  const status = $('gl-status');
  const fixBtn = $<HTMLButtonElement>('gl-fix');
  const hint = $('gl-drag-hint');

  const g: Glass = { ...PRESETS[0], text: 'auto' };
  let bg: Bg | HTMLImageElement = BACKGROUNDS[0];
  let bgName = BACKGROUNDS[0].name;
  let imageUrl = '';
  let pos = { x: 0.5, y: 0.5 }; // card center, as a share of the stage

  const sliders = {
    blur: { el: $<HTMLInputElement>('gl-blur'), out: $('gl-blur-out'), fmt: (v: number) => `${v}px` },
    alpha: { el: $<HTMLInputElement>('gl-alpha'), out: $('gl-alpha-out'), fmt: (v: number) => `${v}%` },
    sat: { el: $<HTMLInputElement>('gl-sat'), out: $('gl-sat-out'), fmt: (v: number) => `${v}%` },
    border: { el: $<HTMLInputElement>('gl-border'), out: $('gl-border-out'), fmt: (v: number) => `${v}%` },
    shadow: { el: $<HTMLInputElement>('gl-shadow'), out: $('gl-shadow-out'), fmt: (v: number) => `${v}%` },
    radius: { el: $<HTMLInputElement>('gl-radius'), out: $('gl-radius-out'), fmt: (v: number) => `${v}px` },
  } as const;
  type SliderKey = keyof typeof sliders;

  function copyText(text: string, done: (ok: boolean) => void) {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(fallback(text)));
    else done(fallback(text));
  }
  function fallback(text: string): boolean {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.append(t);
    t.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    t.remove();
    return ok;
  }

  // ---- Contrast measurement ----
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const SAMPLE_W = 220;
  let cacheKey = '';
  let filtered: Float32Array | null = null; // blurred + saturated background, RGB
  let cw = 0;
  let ch = 0;

  function backdrop(blur: number, sat: number) {
    const W = stage.clientWidth || 1;
    const H = stage.clientHeight || 1;
    const key = [bg instanceof HTMLImageElement ? imageUrl : bg.id, W, H, blur, sat].join('|');
    if (key === cacheKey && filtered) return;
    cw = SAMPLE_W;
    ch = Math.max(1, Math.round((SAMPLE_W * H) / W));
    canvas.width = cw;
    canvas.height = ch;
    const scale = cw / W;
    drawBg(ctx, bg, cw, ch, scale);
    const data = ctx.getImageData(0, 0, cw, ch).data;
    const px = new Float32Array(cw * ch * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      px[j] = data[i];
      px[j + 1] = data[i + 1];
      px[j + 2] = data[i + 2];
    }
    boxBlur(px, cw, ch, Math.round(blur * scale));
    const s = sat / 100;
    if (s !== 1) {
      for (let j = 0; j < px.length; j += 3) {
        const [r, gg, b] = [px[j], px[j + 1], px[j + 2]];
        px[j] = Math.min(255, Math.max(0, (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * gg + (0.072 - 0.072 * s) * b));
        px[j + 1] = Math.min(255, Math.max(0, (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * gg + (0.072 - 0.072 * s) * b));
        px[j + 2] = Math.min(255, Math.max(0, (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * gg + (0.072 + 0.928 * s) * b));
      }
    }
    filtered = px;
    cacheKey = key;
  }

  // Contrast at the worst 10% of spots under the card, for light and for dark text.
  function measure(glass: Glass): { light: number; dark: number } {
    backdrop(glass.blur, glass.sat);
    const W = stage.clientWidth || 1;
    const s = cw / W;
    const sr = stage.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const x0 = Math.max(0, Math.floor((cr.left - sr.left) * s));
    const y0 = Math.max(0, Math.floor((cr.top - sr.top) * s));
    const x1 = Math.min(cw, Math.ceil((cr.right - sr.left) * s));
    const y1 = Math.min(ch, Math.ceil((cr.bottom - sr.top) * s));
    const a = glass.alpha / 100;
    const t = glass.tint;
    const lums: number[] = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const j = (y * cw + x) * 3;
        lums.push(luminance([
          t[0] * a + filtered![j] * (1 - a),
          t[1] * a + filtered![j + 1] * (1 - a),
          t[2] * a + filtered![j + 2] * (1 - a),
        ]));
      }
    }
    if (!lums.length) return { light: 21, dark: 21 };
    lums.sort((p, q) => p - q);
    const pick = (q: number) => lums[Math.min(lums.length - 1, Math.floor(q * lums.length))];
    // Light text struggles on the brightest spots, dark text on the darkest.
    return { light: contrast(LUM_LIGHT, pick(0.9)), dark: contrast(LUM_DARK, pick(0.1)) };
  }

  function textFor(glass: Glass, m: { light: number; dark: number }): { color: RGB; ratio: number } {
    if (glass.text === 'light') return { color: LIGHT, ratio: m.light };
    if (glass.text === 'dark') return { color: DARK, ratio: m.dark };
    return m.light >= m.dark ? { color: LIGHT, ratio: m.light } : { color: DARK, ratio: m.dark };
  }

  // ---- Render ----
  let current = { color: LIGHT as RGB, ratio: 21 };

  function placeCard() {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const cwid = card.offsetWidth;
    const chei = card.offsetHeight;
    const pad = 8;
    const left = Math.min(Math.max(pos.x * W - cwid / 2, pad), Math.max(pad, W - cwid - pad));
    const top = Math.min(Math.max(pos.y * H - chei / 2, pad), Math.max(pad, H - chei - pad));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function render() {
    stage.style.backgroundImage = bg instanceof HTMLImageElement ? `url("${imageUrl}")` : bgCss(bg);
    card.style.background = rgba(g.tint, g.alpha / 100);
    const f = filterValue(g);
    card.style.setProperty('backdrop-filter', f);
    card.style.setProperty('-webkit-backdrop-filter', f);
    card.style.borderColor = g.border > 0 ? rgba(LIGHT, g.border / 100) : 'transparent';
    card.style.borderRadius = `${g.radius}px`;
    card.style.boxShadow = shadowParts(g).join(', ') || 'none';
    placeCard();

    current = textFor(g, measure(g));
    const light = same(current.color, LIGHT);
    card.style.color = toHex(current.color);
    btn.style.background = light ? '#FFFFFF' : toHex(DARK);
    btn.style.color = light ? toHex(DARK) : '#FFFFFF';

    const r = current.ratio;
    const rs = r.toFixed(1);
    badge.className = 'badge ' + (r >= 4.5 ? 'good' : r >= 3 ? 'mid' : 'bad');
    badge.textContent = r >= 4.5 ? `✓ Easy to read · ${rs}:1` : r >= 3 ? `Large text only · ${rs}:1` : `Hard to read · ${rs}:1`;
    status.textContent =
      r >= 4.5
        ? `Text contrast ${rs}:1 at the busiest spot under the card. Good for all text.`
        : r >= 3
          ? `Text contrast ${rs}:1. Fine for headings, too low for small text (aim for 4.5:1).`
          : `Text contrast ${rs}:1. Most people will struggle to read this.`;
    fixBtn.hidden = r >= 4.5;

    for (const [k, s] of Object.entries(sliders) as [SliderKey, (typeof sliders)[SliderKey]][]) {
      s.el.value = String(g[k]);
      s.out.textContent = s.fmt(g[k]);
    }
    $<HTMLInputElement>('gl-shine').checked = g.shine;
    $<HTMLInputElement>('gl-tint-picker').value = toHex(g.tint);
    for (const b of document.querySelectorAll<HTMLButtonElement>('#gl-tint button')) {
      b.setAttribute('aria-checked', String(same(parseHex(b.dataset.v!)!, g.tint)));
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#gl-text button')) {
      b.setAttribute('aria-checked', String(b.dataset.v === g.text));
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#gl-presets button')) {
      const p = PRESETS[Number(b.dataset.i)];
      const on = (Object.keys(p) as (keyof Preset)[]).every((k) => k === 'name' || (k === 'tint' ? same(p.tint, g.tint) : p[k] === g[k]));
      b.setAttribute('aria-pressed', String(on));
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('#gl-bgs button')) {
      b.setAttribute('aria-pressed', String(!(bg instanceof HTMLImageElement) && b.dataset.id === bg.id));
    }
    $('gl-bgs').querySelector('.upload')!.classList.toggle('on', bg instanceof HTMLImageElement);

    $('gl-css').textContent = glassCss(g, current.color);
    $('gl-tw').textContent = glassTailwind(g, current.color);
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  };

  // ---- Presets and backgrounds ----
  const mini = bgCss(BACKGROUNDS[0]);
  PRESETS.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.i = String(i);
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.backgroundImage = mini;
    const glass = document.createElement('i');
    glass.style.background = rgba(p.tint, p.alpha / 100);
    glass.style.border = `1px solid ${rgba(LIGHT, p.border / 100)}`;
    glass.style.setProperty('backdrop-filter', `blur(${Math.max(1, p.blur / 4)}px)`);
    glass.style.setProperty('-webkit-backdrop-filter', `blur(${Math.max(1, p.blur / 4)}px)`);
    chip.append(glass);
    b.append(chip, p.name);
    b.addEventListener('click', () => {
      Object.assign(g, p, { tint: [...p.tint] as RGB });
      render();
    });
    $('gl-presets').append(b);
  });

  const bgWrap = $('gl-bgs');
  for (const item of BACKGROUNDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = item.id;
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.backgroundImage = bgCss(item);
    b.append(chip, item.name);
    b.addEventListener('click', () => {
      bg = item;
      bgName = item.name;
      render();
    });
    bgWrap.insertBefore(b, bgWrap.querySelector('.upload'));
  }

  $<HTMLInputElement>('gl-file').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = url;
      bg = img;
      bgName = 'my own picture';
      const chip = bgWrap.querySelector<HTMLElement>('.upload .chip')!;
      chip.style.backgroundImage = `url("${url}")`;
      chip.textContent = '';
      render();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      status.textContent = 'That file could not be opened as a picture. Try a PNG, JPG or WebP.';
    };
    img.src = url;
  });
  // Clicking "Your image" again after a picture is loaded re-selects it without asking for a file.
  bgWrap.querySelector('.upload')!.addEventListener('click', (e) => {
    if (imageUrl && !(bg instanceof HTMLImageElement)) {
      e.preventDefault();
      const img = new Image();
      img.onload = () => {
        bg = img;
        bgName = 'my own picture';
        render();
      };
      img.src = imageUrl;
    }
  });

  // ---- Controls ----
  for (const [k, s] of Object.entries(sliders) as [SliderKey, (typeof sliders)[SliderKey]][]) {
    s.el.addEventListener('input', () => {
      g[k] = Number(s.el.value);
      schedule();
    });
  }
  $<HTMLInputElement>('gl-shine').addEventListener('change', (e) => {
    g.shine = (e.target as HTMLInputElement).checked;
    render();
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>('#gl-tint button')) {
    b.addEventListener('click', () => {
      g.tint = parseHex(b.dataset.v!)!;
      render();
    });
  }
  $<HTMLInputElement>('gl-tint-picker').addEventListener('input', (e) => {
    const c = parseHex((e.target as HTMLInputElement).value);
    if (c) {
      g.tint = c;
      schedule();
    }
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>('#gl-text button')) {
    b.addEventListener('click', () => {
      g.text = b.dataset.v as Glass['text'];
      render();
    });
  }

  // Raise opacity (and blur, if it is low) one step at a time until the text reaches 4.5:1.
  fixBtn.addEventListener('click', () => {
    const blurs = [...new Set([g.blur, Math.max(g.blur, 20)])];
    // If the chosen text color can't work on this tint, letting the tool pick the text color is part of the fix.
    const trialText = g.text;
    const texts = [...new Set([g.text, 'auto' as const])];
    for (let alpha = g.alpha; alpha <= 95; alpha += 5) {
      for (const blur of blurs) {
        for (const text of texts) {
          const trial = { ...g, alpha, blur, text };
          if (textFor(trial, measure(trial)).ratio < 4.5) continue;
          Object.assign(g, { alpha, blur, text });
          render();
          status.textContent = `Done: opacity ${alpha}%, blur ${blur}px${text !== trialText ? ', text color picked for you' : ''}. ` + status.textContent;
          return;
        }
      }
    }
    Object.assign(g, { alpha: 95, blur: blurs[blurs.length - 1], text: 'auto' });
    render();
  });

  // ---- Drag the card ----
  let drag: { dx: number; dy: number; id: number } | null = null;
  card.addEventListener('pointerdown', (e) => {
    const cr = card.getBoundingClientRect();
    drag = { dx: e.clientX - (cr.left + cr.width / 2), dy: e.clientY - (cr.top + cr.height / 2), id: e.pointerId };
    card.setPointerCapture(e.pointerId);
    card.classList.add('dragging');
    hint.classList.add('gone');
  });
  card.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const sr = stage.getBoundingClientRect();
    pos = {
      x: Math.min(1, Math.max(0, (e.clientX - drag.dx - sr.left) / sr.width)),
      y: Math.min(1, Math.max(0, (e.clientY - drag.dy - sr.top) / sr.height)),
    };
    schedule();
  });
  const end = () => {
    drag = null;
    card.classList.remove('dragging');
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
  // Arrow keys move the card too.
  card.tabIndex = 0;
  card.setAttribute('aria-label', 'Glass card preview. Use the arrow keys to move it.');
  card.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.03;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    pos = { x: Math.min(1, Math.max(0, pos.x + m[0])), y: Math.min(1, Math.max(0, pos.y + m[1])) };
    hint.classList.add('gone');
    schedule();
  });

  new ResizeObserver(schedule).observe(stage);

  // ---- Copy ----
  $('gl-prompt').addEventListener('click', (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    copyText(agentPrompt(g, current.color, current.ratio, bgName), (ok) => {
      status.textContent = ok ? 'Copied. Paste it into Claude Code, Codex or Cursor.' : 'Your browser blocked copying.';
      b.textContent = ok ? 'Copied prompt' : 'Copy failed';
      setTimeout(() => (b.textContent = 'Copy prompt for your AI agent'), 1600);
    });
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>('.gl [data-copy]')) {
    b.addEventListener('click', () => {
      copyText($(b.dataset.copy!).textContent ?? '', (ok) => {
        b.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(() => (b.textContent = 'Copy'), 1400);
      });
    });
  }

  render();
}

if (typeof document !== 'undefined') init();
