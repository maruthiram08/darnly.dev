// Logo maker: a name, an icon, a font and colors become an SVG and PNG logo. Everything runs in the browser.
import { ICONS } from '../data/logo-icons';

type Layout = 'left' | 'above' | 'wordmark';
type IconStyle = 'plain' | 'tile' | 'circle';
type Variant = 'light' | 'dark';

const FONTS = [
  { key: 'bricolage-grotesque', name: 'Bricolage Grotesque', weight: 700, fallback: 'sans-serif' },
  { key: 'inter', name: 'Inter', weight: 700, fallback: 'sans-serif' },
  { key: 'space-grotesk', name: 'Space Grotesk', weight: 700, fallback: 'sans-serif' },
  { key: 'poppins', name: 'Poppins', weight: 700, fallback: 'sans-serif' },
  { key: 'outfit', name: 'Outfit', weight: 700, fallback: 'sans-serif' },
  { key: 'sora', name: 'Sora', weight: 700, fallback: 'sans-serif' },
  { key: 'fraunces', name: 'Fraunces', weight: 700, fallback: 'serif' },
  { key: 'dm-serif-display', name: 'DM Serif Display', weight: 400, fallback: 'serif' },
  { key: 'jetbrains-mono', name: 'JetBrains Mono', weight: 700, fallback: 'monospace' },
  { key: 'pacifico', name: 'Pacifico', weight: 400, fallback: 'cursive' },
] as const;
type Font = (typeof FONTS)[number];

const PRESETS: [string, string][] = [
  ['#0593C6', '#0B2230'],
  ['#D83995', '#1F1030'],
  ['#7C3AED', '#1E1B4B'],
  ['#16A34A', '#052E16'],
  ['#EA580C', '#2A1205'],
  ['#E11D48', '#111827'],
  ['#0F172A', '#0F172A'],
  ['#FACC15', '#18181B'],
];

const ICON_MAP = new Map(ICONS);
const DARK_BG = '#0E1A22';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const nameInput = $<HTMLInputElement>('lm-name');
const stageLight = $<HTMLDivElement>('lm-light');
const stageDark = $<HTMLDivElement>('lm-dark');
const appIcon = $<HTMLDivElement>('lm-app');
const appLabel = $<HTMLSpanElement>('lm-app-label');
const tabIcon = $<HTMLCanvasElement>('lm-tab-icon');
const tabTitle = $<HTMLSpanElement>('lm-tab-title');
const fav32 = $<HTMLCanvasElement>('lm-fav-32');
const fav16 = $<HTMLCanvasElement>('lm-fav-16');
const fontGrid = $<HTMLDivElement>('lm-fonts');
const iconGrid = $<HTMLDivElement>('lm-icons');
const iconSearch = $<HTMLInputElement>('lm-icon-search');
const iconEmpty = $<HTMLParagraphElement>('lm-icon-empty');
const presetRow = $<HTMLDivElement>('lm-presets');
const brandInput = $<HTMLInputElement>('lm-brand');
const textInput = $<HTMLInputElement>('lm-text');
const svgCode = $<HTMLElement>('lm-svg-code');
const copySvg = $<HTMLButtonElement>('lm-copy-svg');
const status = $<HTMLParagraphElement>('lm-status');

const state = {
  name: nameInput.value || 'Lumen',
  icon: 'sparkles',
  font: FONTS[0] as Font,
  layout: 'left' as Layout,
  iconStyle: 'tile' as IconStyle,
  brand: PRESETS[0][0],
  text: PRESETS[0][1],
  variant: 'light' as Variant,
};

// ---------- colors ----------

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// The color drawn on top of the brand color inside a tile or circle. White wins unless the brand color is very light.
const onBrand = (brand: string) => (contrast(brand, '#FFFFFF') >= 2.4 ? '#FFFFFF' : '#0B2230');
// On a dark background, text that would be hard to read turns light.
const textFor = (v: Variant) => (v === 'dark' && contrast(state.text, DARK_BG) < 3 ? '#F5FAFC' : state.text);
// A plain icon that would vanish on the background gets lightened or darkened the same way.
const plainIconFor = (v: Variant) => {
  const bg = v === 'dark' ? DARK_BG : '#FFFFFF';
  if (contrast(state.brand, bg) >= 1.6) return state.brand;
  return v === 'dark' ? '#F5FAFC' : '#0B2230';
};

// ---------- fonts ----------

const family = (f: Font) => `LM ${f.name}`;
const loaded = new Map<string, Promise<void>>();
function loadFont(f: Font): Promise<void> {
  let p = loaded.get(f.key);
  if (!p) {
    const face = new FontFace(family(f), `url(/fonts/logo/${f.key}.woff2) format("woff2")`, { weight: String(f.weight) });
    p = face
      .load()
      .then((ff) => {
        document.fonts.add(ff);
      })
      .catch(() => {});
    loaded.set(f.key, p);
  }
  return p;
}

const fontData = new Map<string, Promise<string>>();
// Base64 of the font file, so the downloaded SVG shows the right font on its own.
function fontBase64(f: Font): Promise<string> {
  let p = fontData.get(f.key);
  if (!p) {
    p = fetch(`/fonts/logo/${f.key}.woff2`)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
      });
    fontData.set(f.key, p);
  }
  return p;
}

// ---------- layout ----------

type Op =
  | { t: 'shape'; kind: 'tile' | 'circle'; x: number; y: number; s: number; fill: string }
  | { t: 'icon'; d: string; x: number; y: number; s: number; stroke: string }
  | { t: 'letter'; ch: string; x: number; y: number; size: number; fill: string }
  | { t: 'text'; text: string; x: number; y: number; size: number; fill: string };
type Scene = { w: number; h: number; ops: Op[] };

const measureCtx = document.createElement('canvas').getContext('2d')!;
const fontCss = (f: Font, size: number) => `${f.weight} ${size}px "${family(f)}", ${f.fallback}`;
function measure(text: string, size = 100) {
  measureCtx.font = fontCss(state.font, size);
  const m = measureCtx.measureText(text);
  const cap = measureCtx.measureText('H').actualBoundingBoxAscent || size * 0.7;
  return {
    width: m.width,
    left: m.actualBoundingBoxLeft,
    right: m.actualBoundingBoxRight,
    asc: Math.max(m.actualBoundingBoxAscent, cap),
    desc: Math.max(m.actualBoundingBoxDescent, 0),
    cap,
  };
}

const initial = () => (state.name.trim()[0] || 'A').toUpperCase();

// The mark on its own: icon (or first letter) in the chosen style, at size s with top-left x, y.
function markOps(x: number, y: number, s: number, style: IconStyle, v: Variant): Op[] {
  const d = ICON_MAP.get(state.icon) || '';
  if (style === 'plain') return [{ t: 'icon', d, x, y, s, stroke: plainIconFor(v) }];
  const fg = onBrand(state.brand);
  const ops: Op[] = [{ t: 'shape', kind: style, x, y, s, fill: state.brand }];
  const inner = s * (style === 'circle' ? 0.56 : 0.6);
  ops.push({ t: 'icon', d, x: x + (s - inner) / 2, y: y + (s - inner) / 2, s: inner, stroke: fg });
  return ops;
}

function letterOps(x: number, y: number, s: number, v: Variant, style: 'tile' | 'circle'): Op[] {
  const ch = initial();
  const size = s * 0.62;
  const m = measure(ch, size);
  return [
    { t: 'shape', kind: style, x, y, s, fill: state.brand },
    { t: 'letter', ch, x: x + s / 2 - (m.right - m.left) / 2, y: y + s / 2 + (m.asc - m.desc) / 2, size, fill: onBrand(state.brand) },
  ];
}

function logoScene(v: Variant): Scene {
  const name = state.name.trim() || 'Your name';
  const m = measure(name);
  const fill = textFor(v);
  const ops: Op[] = [];
  let w: number, h: number;
  const style = state.iconStyle;

  if (state.layout === 'wordmark') {
    const pad = 10;
    w = m.left + m.right + pad * 2;
    h = m.asc + m.desc + pad * 2;
    ops.push({ t: 'text', text: name, x: pad + m.left, y: pad + m.asc, size: 100, fill });
    return { w, h, ops };
  }

  if (state.layout === 'left') {
    const s = m.cap * (style === 'plain' ? 1.5 : 1.75);
    const gap = s * (style === 'plain' ? 0.28 : 0.34);
    const pad = s * 0.12;
    const cy = pad + Math.max(s / 2, m.asc - m.cap / 2);
    const baseline = cy + m.cap / 2;
    ops.push(...markOps(pad, cy - s / 2, s, style, v));
    const tx = pad + s + gap + m.left;
    ops.push({ t: 'text', text: name, x: tx, y: baseline, size: 100, fill });
    w = tx + m.right + pad;
    h = Math.max(cy + s / 2, baseline + m.desc) + pad;
    return { w, h, ops };
  }

  // Icon above the name.
  const s = m.cap * 2.6;
  const gap = s * 0.22;
  const pad = s * 0.1;
  const textW = m.left + m.right;
  w = Math.max(s, textW) + pad * 2;
  ops.push(...markOps((w - s) / 2, pad, s, style, v));
  const baseline = pad + s + gap + m.asc;
  ops.push({ t: 'text', text: name, x: (w - textW) / 2 + m.left, y: baseline, size: 100, fill });
  h = baseline + m.desc + pad;
  return { w, h, ops };
}

// The square app icon and favicon: the mark on a full tile, or the first letter when there's no icon.
function iconScene(size: number): Scene {
  const ops: Op[] = [];
  if (state.layout === 'wordmark') ops.push(...letterOps(0, 0, size, 'light', 'tile'));
  else ops.push(...markOps(0, 0, size, 'tile', 'light'));
  return { w: size, h: size, ops };
}

// ---------- renderers ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (n: number) => Math.round(n * 100) / 100;

function toSvg(scene: Scene, opts: { fontFamily: string; fontFace?: string; background?: string; title?: string }): string {
  const f = state.font;
  const parts: string[] = [];
  const tileR = (s: number) => r2(s * 0.225);
  if (opts.background) parts.push(`<rect width="100%" height="100%" fill="${opts.background}"/>`);
  for (const op of scene.ops) {
    if (op.t === 'shape') {
      parts.push(
        op.kind === 'tile'
          ? `<rect x="${r2(op.x)}" y="${r2(op.y)}" width="${r2(op.s)}" height="${r2(op.s)}" rx="${tileR(op.s)}" fill="${op.fill}"/>`
          : `<circle cx="${r2(op.x + op.s / 2)}" cy="${r2(op.y + op.s / 2)}" r="${r2(op.s / 2)}" fill="${op.fill}"/>`,
      );
    } else if (op.t === 'icon') {
      const k = op.s / 24;
      parts.push(
        `<path transform="translate(${r2(op.x)} ${r2(op.y)}) scale(${Math.round(k * 10000) / 10000})" d="${op.d}" fill="none" stroke="${op.stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    } else {
      const text = op.t === 'text' ? op.text : op.ch;
      parts.push(
        `<text x="${r2(op.x)}" y="${r2(op.y)}" font-family="${esc(opts.fontFamily)}" font-weight="${f.weight}" font-size="${r2(op.size)}" fill="${op.fill}">${esc(text)}</text>`,
      );
    }
  }
  const style = opts.fontFace ? `<style>${opts.fontFace}</style>` : '';
  const title = opts.title ? `<title>${esc(opts.title)}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(scene.w)} ${r2(scene.h)}" width="${Math.round(scene.w)}" height="${Math.round(scene.h)}">${title}${style}${parts.join('')}</svg>`;
}

function toCanvas(scene: Scene, scale: number, background?: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(scene.w * scale));
  c.height = Math.max(1, Math.round(scene.h * scale));
  const x = c.getContext('2d')!;
  if (background) {
    x.fillStyle = background;
    x.fillRect(0, 0, c.width, c.height);
  }
  x.scale(scale, scale);
  for (const op of scene.ops) {
    if (op.t === 'shape') {
      x.fillStyle = op.fill;
      x.beginPath();
      if (op.kind === 'tile') x.roundRect(op.x, op.y, op.s, op.s, op.s * 0.225);
      else x.arc(op.x + op.s / 2, op.y + op.s / 2, op.s / 2, 0, Math.PI * 2);
      x.fill();
    } else if (op.t === 'icon') {
      x.save();
      x.translate(op.x, op.y);
      x.scale(op.s / 24, op.s / 24);
      x.strokeStyle = op.stroke;
      x.lineWidth = 2;
      x.lineCap = 'round';
      x.lineJoin = 'round';
      x.stroke(new Path2D(op.d));
      x.restore();
    } else {
      x.fillStyle = op.fill;
      x.font = fontCss(state.font, op.size);
      x.textBaseline = 'alphabetic';
      x.fillText(op.t === 'text' ? op.text : op.ch, op.x, op.y);
    }
  }
  return c;
}

const previewFamily = () => `"${family(state.font)}", ${state.font.fallback}`;

// ---------- preview ----------

function drawFavicon(canvas: HTMLCanvasElement, cssSize: number) {
  const dpr = Math.min(3, Math.ceil(window.devicePixelRatio || 1));
  const px = cssSize * dpr;
  const c = toCanvas(iconScene(px), 1);
  canvas.width = px;
  canvas.height = px;
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  canvas.getContext('2d')!.drawImage(c, 0, 0);
}

let current = { light: '', dark: '' };
function render() {
  const fam = previewFamily();
  const title = state.name.trim() || 'Your name';
  current = {
    light: toSvg(logoScene('light'), { fontFamily: fam, title }),
    dark: toSvg(logoScene('dark'), { fontFamily: fam, title }),
  };
  stageLight.innerHTML = current.light;
  stageDark.innerHTML = current.dark;
  appIcon.innerHTML = toSvg(iconScene(120), { fontFamily: fam });
  appLabel.textContent = title;
  tabTitle.textContent = title;
  drawFavicon(tabIcon, 16);
  drawFavicon(fav32, 32);
  drawFavicon(fav16, 16);
  svgCode.textContent = toSvg(logoScene(state.variant), { fontFamily: `${state.font.name}, ${state.font.fallback}` });
}

let pending = 0;
function refresh() {
  const id = ++pending;
  render();
  // Draw again once the chosen font has arrived, so sizes are measured with the real letters.
  loadFont(state.font).then(() => id === pending && render());
}

// ---------- controls ----------

function setPressed(container: HTMLElement, attr: string, value: string) {
  for (const b of container.querySelectorAll<HTMLButtonElement>(`[${attr}]`)) {
    b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value));
  }
}

for (const f of FONTS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.font = f.key;
  b.textContent = f.name;
  b.style.fontFamily = `"${family(f)}", ${f.fallback}`;
  b.style.fontWeight = String(f.weight);
  b.addEventListener('click', () => {
    state.font = f;
    setPressed(fontGrid, 'data-font', f.key);
    refresh();
  });
  fontGrid.append(b);
}
setPressed(fontGrid, 'data-font', state.font.key);

const iconSvg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
for (const [name, d] of ICONS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.icon = name;
  b.title = name.replace(/-/g, ' ');
  b.setAttribute('aria-label', b.title);
  b.innerHTML = iconSvg(d);
  b.addEventListener('click', () => {
    state.icon = name;
    if (state.layout === 'wordmark') {
      state.layout = 'left';
      setPressed(document.body, 'data-layout', 'left');
    }
    setPressed(iconGrid, 'data-icon', name);
    refresh();
  });
  iconGrid.append(b);
}
setPressed(iconGrid, 'data-icon', state.icon);

iconSearch.addEventListener('input', () => {
  const q = iconSearch.value.trim().toLowerCase().replace(/\s+/g, '-');
  let shown = 0;
  for (const b of iconGrid.querySelectorAll<HTMLButtonElement>('[data-icon]')) {
    const hit = !q || b.dataset.icon!.includes(q);
    b.hidden = !hit;
    if (hit) shown++;
  }
  iconEmpty.hidden = shown > 0;
});

for (const [brand, text] of PRESETS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.dataset.preset = brand;
  b.style.background = `linear-gradient(135deg, ${brand} 0 55%, ${text} 55% 100%)`;
  b.setAttribute('aria-label', `Colors ${brand} and ${text}`);
  b.addEventListener('click', () => {
    state.brand = brand;
    state.text = text;
    brandInput.value = brand;
    textInput.value = text;
    setPressed(presetRow, 'data-preset', brand);
    refresh();
  });
  presetRow.append(b);
}
setPressed(presetRow, 'data-preset', state.brand);
brandInput.value = state.brand;
textInput.value = state.text;
brandInput.addEventListener('input', () => {
  state.brand = brandInput.value.toUpperCase();
  setPressed(presetRow, 'data-preset', '');
  refresh();
});
textInput.addEventListener('input', () => {
  state.text = textInput.value.toUpperCase();
  setPressed(presetRow, 'data-preset', '');
  refresh();
});

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-layout]')) {
  b.addEventListener('click', () => {
    state.layout = b.dataset.layout as Layout;
    setPressed(document.body, 'data-layout', state.layout);
    refresh();
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-style]')) {
  b.addEventListener('click', () => {
    state.iconStyle = b.dataset.style as IconStyle;
    setPressed(document.body, 'data-style', state.iconStyle);
    refresh();
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-variant]')) {
  b.addEventListener('click', () => {
    state.variant = b.dataset.variant as Variant;
    setPressed(document.body, 'data-variant', state.variant);
    render();
  });
}
setPressed(document.body, 'data-layout', state.layout);
setPressed(document.body, 'data-style', state.iconStyle);
setPressed(document.body, 'data-variant', state.variant);

nameInput.addEventListener('input', () => {
  state.name = nameInput.value;
  refresh();
});

$<HTMLButtonElement>('lm-shuffle').addEventListener('click', () => {
  const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
  state.icon = pick(ICONS)[0];
  state.font = pick(FONTS);
  const [brand, text] = pick(PRESETS);
  state.brand = brand;
  state.text = text;
  state.iconStyle = pick(['plain', 'tile', 'circle'] as const);
  if (state.layout === 'wordmark') state.layout = 'left';
  brandInput.value = brand;
  textInput.value = text;
  setPressed(fontGrid, 'data-font', state.font.key);
  setPressed(iconGrid, 'data-icon', state.icon);
  setPressed(presetRow, 'data-preset', brand);
  setPressed(document.body, 'data-layout', state.layout);
  setPressed(document.body, 'data-style', state.iconStyle);
  iconGrid.querySelector<HTMLButtonElement>(`[data-icon="${state.icon}"]`)?.scrollIntoView({ block: 'nearest' });
  refresh();
});

// ---------- downloads ----------

const slug = () =>
  (state.name.trim() || 'logo')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'logo';

function save(blob: Blob, file: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

function say(text: string) {
  status.textContent = text;
  status.hidden = false;
  clearTimeout((say as unknown as { t?: number }).t);
  (say as unknown as { t?: number }).t = window.setTimeout(() => (status.hidden = true), 4000);
}

async function portableSvg(scene: Scene, title?: string): Promise<string> {
  const f = state.font;
  let face = '';
  try {
    const b64 = await fontBase64(f);
    face = `@font-face{font-family:"${f.name}";font-weight:${f.weight};src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
  } catch {
    // Without the font file the SVG still names the font, so it works where the font is installed.
  }
  return toSvg(scene, { fontFamily: `${f.name}, ${f.fallback}`, fontFace: face || undefined, title });
}

const canvasBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG failed'))), 'image/png'));

async function ready() {
  await loadFont(state.font);
  await document.fonts.ready;
}

$<HTMLButtonElement>('lm-dl-png').addEventListener('click', async () => {
  await ready();
  const scene = logoScene(state.variant);
  const scale = Math.min(8, 2000 / scene.w);
  save(await canvasBlob(toCanvas(scene, scale)), `${slug()}-logo${state.variant === 'dark' ? '-dark' : ''}.png`);
  say('PNG saved. It has a see-through background.');
});

$<HTMLButtonElement>('lm-dl-svg').addEventListener('click', async () => {
  await ready();
  const svg = await portableSvg(logoScene(state.variant), state.name.trim() || undefined);
  save(new Blob([svg], { type: 'image/svg+xml' }), `${slug()}-logo${state.variant === 'dark' ? '-dark' : ''}.svg`);
  say('SVG saved. The font is built into the file.');
});

$<HTMLButtonElement>('lm-dl-icon').addEventListener('click', async () => {
  await ready();
  save(await canvasBlob(toCanvas(iconScene(1024), 1)), `${slug()}-icon-1024.png`);
  say('App icon saved at 1024×1024.');
});

$<HTMLButtonElement>('lm-favicons').addEventListener('click', async () => {
  await ready();
  const url = toCanvas(iconScene(512), 1).toDataURL('image/png');
  try {
    sessionStorage.setItem('darnly:handoff-image', JSON.stringify({ from: 'logo-maker', name: state.name.trim(), file: `${slug()}-icon.png`, url }));
  } catch {
    say('Your browser blocked the hand-off. Download the app icon and drop it into the favicon generator.');
    return;
  }
  location.href = '/tools/favicon-generator/?from=logo-maker';
});

copySvg.addEventListener('click', async () => {
  await navigator.clipboard.writeText(svgCode.textContent || '');
  copySvg.textContent = 'Copied';
  setTimeout(() => (copySvg.textContent = 'Copy'), 1500);
});

// Load every font in the background so the font buttons show their own letters.
for (const f of FONTS) loadFont(f).then(() => f.key === state.font.key && render());
refresh();
