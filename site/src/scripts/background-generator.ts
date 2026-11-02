// Background generator: waves, blobs, mesh gradients, patterns and layered peaks as SVG.
// Everything runs in the visitor's browser; the SVG is built in code from a seed.

export type Kind = 'waves' | 'blobs' | 'mesh' | 'pattern' | 'peaks';
export type PatternStyle = 'dots' | 'grid' | 'lines';
export type State = {
  kind: Kind;
  bg: string;
  colors: string[]; // three hex colors
  complexity: number; // 1–10
  layers: number; // 1–6
  flip: boolean;
  soft: boolean;
  pattern: PatternStyle;
  w: number;
  h: number;
  seed: number;
};

type RGB = [number, number, number];
type Pt = [number, number];

// ---- Colors ----
export function parseHex(input: string): string | null {
  let s = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = [...s].map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/.test(s) ? '#' + s : null;
}
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const hex = (c: RGB) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a: string, b: string, t: number) => {
  const x = rgb(a);
  const y = rgb(b);
  return hex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as RGB);
};
export function luminance(h: string): number {
  const [r, g, b] = rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function hsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return hex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

// ---- Random numbers from a seed, so the same settings always draw the same picture ----
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const p = (pt: Pt) => `${r1(pt[0])} ${r1(pt[1])}`;

// Smooth line through points (Catmull-Rom turned into cubic Béziers).
function smooth(pts: Pt[], closed: boolean): string {
  const n = pts.length;
  const at = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${p(pts[0])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${p(c1)} ${p(c2)} ${p(p2)}`;
  }
  return closed ? d + 'Z' : d;
}

// Color of layer i out of n, blending through the three colors.
function layerColor(s: State, i: number, n: number): string {
  if (n === 1) return s.colors[0];
  const t = i / (n - 1);
  return t < 0.5 ? mix(s.colors[0], s.colors[1], t * 2) : mix(s.colors[1], s.colors[2], (t - 0.5) * 2);
}

// ---- Shapes ----
function ridges(s: State, sharp: boolean): string {
  const rand = rng(s.seed);
  const { w, h, layers } = s;
  const pts = sharp ? 3 + s.complexity * 2 : 2 + s.complexity;
  let out = '';
  for (let i = 0; i < layers; i++) {
    // Back layers sit higher, front layers lower.
    const base = h * (0.38 + (0.5 * (i + 1)) / (layers + 1));
    const amp = h * (sharp ? 0.16 : 0.09) * (1 - i / (layers + 2));
    const line: Pt[] = [];
    for (let j = 0; j <= pts; j++) {
      const x = (w * j) / pts;
      const jitter = sharp && j % 2 === 1 ? -0.6 : 0;
      line.push([x, base + amp * ((rand() * 2 - 1) + jitter)]);
    }
    const top = sharp ? 'M' + line.map(p).join('L') : smooth(line, false);
    let d = `${top}L${w} ${h}L0 ${h}Z`;
    if (s.flip) d = flipY(d, h);
    out += `<path d="${d}" fill="${layerColor(s, i, layers)}"/>`;
  }
  return out;
}
// Mirror a path top-to-bottom (all coordinates come in x y pairs).
function flipY(d: string, h: number): string {
  return d.replace(/(-?[\d.]+) (-?[\d.]+)/g, (_m, x, y) => `${x} ${r1(h - parseFloat(y))}`);
}

function blobs(s: State): string {
  const rand = rng(s.seed);
  const { w, h } = s;
  const count = Math.max(2, s.layers + 1);
  const pts = 4 + Math.round(s.complexity / 2);
  const wobble = 0.12 + s.complexity * 0.035;
  let out = '';
  for (let i = 0; i < count; i++) {
    const cx = w * (0.1 + rand() * 0.8);
    const cy = h * (0.1 + rand() * 0.8);
    const r = Math.min(w, h) * (0.18 + rand() * 0.22);
    const ring: Pt[] = [];
    for (let j = 0; j < pts; j++) {
      const a = (Math.PI * 2 * j) / pts;
      const rr = r * (1 - wobble + rand() * wobble * 2);
      ring.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    const op = s.soft ? 0.9 : 1;
    out += `<path d="${smooth(ring, true)}" fill="${s.colors[i % 3]}" fill-opacity="${op}"/>`;
  }
  if (s.soft) {
    const blur = r1(Math.min(w, h) * 0.08);
    return `<defs><filter id="bl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${blur}"/></filter></defs><g filter="url(#bl)">${out}</g>`;
  }
  return out;
}

export type MeshPoint = { x: number; y: number; r: number; color: string };
export function meshPoints(s: State): MeshPoint[] {
  const rand = rng(s.seed);
  const n = 3 + Math.round((s.complexity - 1) * 0.6);
  return Array.from({ length: n }, (_, i) => ({
    x: Math.round(rand() * 100),
    y: Math.round(rand() * 100),
    r: Math.round(40 + rand() * 40),
    color: s.colors[i % 3],
  }));
}
function mesh(s: State): string {
  const pts = meshPoints(s);
  // Each point is an ellipse sized as a share of the picture, matching the CSS version exactly.
  const defs = pts
    .map((m, i) => `<radialGradient id="m${i}" cx="${m.x / 100}" cy="${m.y / 100}" r="${m.r / 100}"><stop offset="0" stop-color="${m.color}"/><stop offset="1" stop-color="${m.color}" stop-opacity="0"/></radialGradient>`)
    .join('');
  const rects = pts.map((_, i) => `<rect width="100%" height="100%" fill="url(#m${i})"/>`).join('');
  return `<defs>${defs}</defs>${rects}`;
}

export function patternSize(s: State): number {
  return Math.round(52 - s.complexity * 4); // 48px … 12px
}
function pattern(s: State): string {
  const size = patternSize(s);
  const c = s.colors[0];
  let tile = '';
  if (s.pattern === 'dots') tile = `<circle cx="${size / 2}" cy="${size / 2}" r="${r1(Math.max(1.5, size / 10))}" fill="${c}"/>`;
  else if (s.pattern === 'grid') tile = `<path d="M${size} 0H0V${size}" fill="none" stroke="${c}" stroke-width="2"/>`;
  else tile = `<path d="M0 ${size}L${size} 0M-2 2L2 -2M${size - 2} ${size + 2}L${size + 2} ${size - 2}" stroke="${c}" stroke-width="2"/>`;
  return `<defs><pattern id="pt" width="${size}" height="${size}" patternUnits="userSpaceOnUse">${tile}</pattern></defs><rect width="100%" height="100%" fill="url(#pt)"/>`;
}

export function buildSvg(s: State): string {
  let body = '';
  if (s.kind === 'waves') body = ridges(s, false);
  else if (s.kind === 'peaks') body = ridges(s, true);
  else if (s.kind === 'blobs') body = blobs(s);
  else if (s.kind === 'mesh') body = mesh(s);
  else body = pattern(s);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.w} ${s.h}" width="${s.w}" height="${s.h}" preserveAspectRatio="xMidYMid slice"><rect width="100%" height="100%" fill="${s.bg}"/>${body}</svg>`;
}

// ---- Code exports ----
// Data URI with only the characters that must be escaped, so it stays short and readable.
export function svgDataUri(svg: string, forTailwind = false): string {
  let enc = svg.replace(/"/g, "'").replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E');
  if (forTailwind) enc = enc.replace(/ /g, '%20').replace(/_/g, '%5F');
  return `data:image/svg+xml,${enc}`;
}

export function cssLayers(s: State): { image: string; size?: string; position?: string } | null {
  if (s.kind === 'mesh') {
    // In CSS the first layer is drawn on top, so reverse the SVG order.
    const image = meshPoints(s)
      .reverse()
      .map((m) => `radial-gradient(ellipse ${m.r}% ${m.r}% at ${m.x}% ${m.y}%, ${m.color} 0%, transparent 100%)`)
      .join(',\n    ');
    return { image };
  }
  if (s.kind === 'pattern') {
    const size = patternSize(s);
    const c = s.colors[0];
    if (s.pattern === 'dots') {
      const r = r1(Math.max(1.5, size / 10));
      return { image: `radial-gradient(circle, ${c} ${r}px, transparent ${r1(r + 0.6)}px)`, size: `${size}px ${size}px` };
    }
    if (s.pattern === 'grid') {
      return { image: `linear-gradient(${c} 2px, transparent 2px),\n    linear-gradient(90deg, ${c} 2px, transparent 2px)`, size: `${size}px ${size}px` };
    }
    return { image: `repeating-linear-gradient(-45deg, transparent 0 ${r1(size * 0.707 - 2)}px, ${c} 0 ${r1(size * 0.707)}px)` };
  }
  return null;
}

export function buildCss(s: State): string {
  const l = cssLayers(s);
  if (l) {
    let css = `.hero {\n  background-color: ${s.bg};\n  background-image:\n    ${l.image};\n`;
    if (l.size) css += `  background-size: ${l.size};\n`;
    return css + '}';
  }
  return `.hero {\n  background: ${s.bg} url("${svgDataUri(buildSvg(s))}") center / cover no-repeat;\n}`;
}

export function buildTailwind(s: State): string {
  const l = cssLayers(s);
  if (l) {
    const img = l.image.replace(/\n\s*/g, '').replace(/,\s+/g, ',').replace(/ /g, '_');
    let cls = `bg-[${s.bg}] bg-[${img}]`;
    if (l.size) cls += ` bg-[length:${l.size.replace(/ /g, '_')}]`;
    return cls;
  }
  return `bg-[${s.bg}] bg-[url("${svgDataUri(buildSvg(s), true)}")] bg-cover bg-center`;
}

// ---- Palettes ----
export const PALETTES: { name: string; bg: string; colors: string[] }[] = [
  { name: 'Sunset', bg: '#FFF4E8', colors: ['#FFB38A', '#FF7A59', '#C2410C'] },
  { name: 'Ocean', bg: '#EAF6F8', colors: ['#9ED8E0', '#3AA6B9', '#0B5563'] },
  { name: 'Forest', bg: '#F1F5EC', colors: ['#B9D7A1', '#6A9E5B', '#2F5233'] },
  { name: 'Peach', bg: '#FFF1EE', colors: ['#FFD3C4', '#F7A399', '#E26D7A'] },
  { name: 'Ink', bg: '#0B2230', colors: ['#1E4A5F', '#3C7A8F', '#8FC1CF'] },
  { name: 'Lemon', bg: '#FFFBE6', colors: ['#FFE58A', '#F6C445', '#E08E0B'] },
  { name: 'Night', bg: '#11131A', colors: ['#F25F5C', '#FFB347', '#3DDC97'] },
  { name: 'Clay', bg: '#F6EFE9', colors: ['#E3C9B5', '#C48B6A', '#7A4A33'] },
];

export function randomPalette(rand: () => number): { bg: string; colors: string[] } {
  const hue = Math.floor(rand() * 360);
  const dark = rand() < 0.3;
  const spread = 20 + rand() * 50;
  const colors = [0, 1, 2].map((i) => hsl((hue + i * spread) % 360, 0.55 + rand() * 0.3, dark ? 0.45 + i * 0.1 : 0.72 - i * 0.14));
  const bg = dark ? hsl(hue, 0.3, 0.08) : hsl(hue, 0.6, 0.96);
  return { bg, colors };
}

export const SIZES: { key: string; label: string; w: number; h: number }[] = [
  { key: 'hero', label: 'Website hero 1920×1080', w: 1920, h: 1080 },
  { key: 'wide', label: 'Wide banner 2560×800', w: 2560, h: 800 },
  { key: 'og', label: 'Share picture 1200×630', w: 1200, h: 630 },
  { key: 'square', label: 'Square 1080×1080', w: 1080, h: 1080 },
  { key: 'phone', label: 'Phone 1080×1920', w: 1080, h: 1920 },
];

// ---- Page ----
if (typeof document !== 'undefined' && document.getElementById('bg-stage')) init();

function init() {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const stage = $('bg-stage');
  const art = $('bg-art');
  const hero = $('bg-hero');
  const status = $('bg-status');
  const kindSeg = $('bg-kind');
  const patSeg = $('bg-pattern');
  const presets = $('bg-presets');
  const pickers = ['bg-c0', 'bg-c1', 'bg-c2'].map((id) => $<HTMLInputElement>(id));
  const bgPicker = $<HTMLInputElement>('bg-bg');
  const complexity = $<HTMLInputElement>('bg-complexity');
  const layers = $<HTMLInputElement>('bg-layers');
  const flip = $<HTMLInputElement>('bg-flip');
  const soft = $<HTMLInputElement>('bg-soft');
  const size = $<HTMLSelectElement>('bg-size');
  const showText = $<HTMLInputElement>('bg-text');

  const first = PALETTES[0];
  const state: State = {
    kind: 'waves',
    bg: first.bg,
    colors: [...first.colors],
    complexity: 5,
    layers: 3,
    flip: false,
    soft: true,
    pattern: 'dots',
    w: 1920,
    h: 1080,
    seed: Math.floor(Math.random() * 1e9),
  };

  // Palette chips
  PALETTES.forEach((pal, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.background = `linear-gradient(135deg, ${pal.bg} 0 25%, ${pal.colors[0]} 25% 50%, ${pal.colors[1]} 50% 75%, ${pal.colors[2]} 75%)`;
    b.append(chip, document.createTextNode(pal.name));
    b.addEventListener('click', () => {
      state.bg = pal.bg;
      state.colors = [...pal.colors];
      markPreset(i);
      syncPickers();
      render();
    });
    presets.append(b);
  });
  function markPreset(i: number) {
    presets.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', i === j ? 'true' : 'false'));
  }
  function syncPickers() {
    bgPicker.value = state.bg.toLowerCase();
    pickers.forEach((pk, i) => (pk.value = state.colors[i].toLowerCase()));
  }

  function segment(el: HTMLElement, onPick: (v: string) => void) {
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      el.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
      onPick(b.dataset.v || '');
    });
  }
  segment(kindSeg, (v) => {
    state.kind = v as Kind;
    render();
  });
  segment(patSeg, (v) => {
    state.pattern = v as PatternStyle;
    render();
  });

  pickers.forEach((pk, i) =>
    pk.addEventListener('input', () => {
      state.colors[i] = pk.value;
      markPreset(-1);
      render();
    }),
  );
  bgPicker.addEventListener('input', () => {
    state.bg = bgPicker.value;
    markPreset(-1);
    render();
  });
  complexity.addEventListener('input', () => {
    state.complexity = +complexity.value;
    render();
  });
  layers.addEventListener('input', () => {
    state.layers = +layers.value;
    render();
  });
  flip.addEventListener('change', () => {
    state.flip = flip.checked;
    render();
  });
  soft.addEventListener('change', () => {
    state.soft = soft.checked;
    render();
  });
  size.addEventListener('change', () => {
    const sz = SIZES.find((x) => x.key === size.value) || SIZES[0];
    state.w = sz.w;
    state.h = sz.h;
    render();
  });
  showText.addEventListener('change', () => (hero.hidden = !showText.checked));

  $('bg-shuffle').addEventListener('click', () => {
    state.seed = Math.floor(Math.random() * 1e9);
    render();
    say('New shape. Press Shuffle again for another.');
  });
  $('bg-colors').addEventListener('click', () => {
    const pal = randomPalette(Math.random);
    state.bg = pal.bg;
    state.colors = pal.colors;
    markPreset(-1);
    syncPickers();
    render();
  });

  // Downloads and copies
  const fileBase = () => `darnly-${state.kind}-${state.w}x${state.h}`;
  function save(blob: Blob, file: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
  $('bg-dl-svg').addEventListener('click', () => {
    save(new Blob([buildSvg(state)], { type: 'image/svg+xml' }), fileBase() + '.svg');
    say('SVG downloaded.');
  });
  $('bg-dl-png').addEventListener('click', () => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([buildSvg(state)], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = state.w;
      c.height = state.h;
      c.getContext('2d')!.drawImage(img, 0, 0, state.w, state.h);
      URL.revokeObjectURL(url);
      c.toBlob((b) => {
        if (b) {
          save(b, fileBase() + '.png');
          say('PNG downloaded.');
        } else say('Your browser couldn’t make the PNG. Try the SVG.');
      }, 'image/png');
    };
    img.onerror = () => say('Your browser couldn’t make the PNG. Try the SVG.');
    img.src = url;
  });

  function copyText(text: string, done: string) {
    const ok = () => say(done);
    const fail = () => say('Couldn’t copy. Select the code and copy it by hand.');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, () => (fallback(text) ? ok() : fail()));
    else if (fallback(text)) ok();
    else fail();
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
  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault(); // the SVG copy button sits inside a <summary>; don't fold it open or shut
      copyText($(b.dataset.copy!).textContent || '', 'Copied.');
    }),
  );
  $('bg-prompt').addEventListener('click', () => {
    const what = { waves: 'layered waves', blobs: 'soft blobs', mesh: 'mesh gradient', pattern: `${state.pattern} pattern`, peaks: 'layered peaks' }[state.kind];
    const prompt =
      `Use this ${what} as the background of the hero section on my landing page. ` +
      `It should cover the whole hero at every screen size (background-size: cover for pictures). ` +
      `Keep the headline readable on top of it: if the text is hard to read, add a soft overlay behind the text instead of changing the background. ` +
      `Base color ${state.bg}, accent colors ${state.colors.join(', ')}. Here is the CSS:\n\n${buildCss(state)}\n\n` +
      `If the project uses Tailwind, you can use these classes instead:\n${buildTailwind(state)}`;
    copyText(prompt, 'Prompt copied. Paste it into Claude Code, Codex or Cursor.');
  });

  function say(text: string) {
    status.textContent = text;
  }

  function render() {
    const svg = buildSvg(state);
    art.innerHTML = svg;
    stage.style.aspectRatio = `${state.w} / ${state.h}`;
    stage.classList.toggle('tall', state.h > state.w);
    // Light or dark sample text, whichever reads better on the background.
    const tones = state.kind === 'mesh' || state.kind === 'blobs' ? [state.bg, ...state.colors] : [state.bg];
    const dark = tones.reduce((a, c) => a + luminance(c), 0) / tones.length < 0.3;
    hero.classList.toggle('on-dark', dark);

    const k = state.kind;
    $('bg-layers-field').hidden = k === 'mesh' || k === 'pattern';
    $('bg-layers-label').textContent = k === 'blobs' ? 'Blobs' : 'Layers';
    $('bg-flip-field').hidden = k !== 'waves' && k !== 'peaks';
    $('bg-soft-field').hidden = k !== 'blobs';
    $('bg-pattern-field').hidden = k !== 'pattern';
    $('bg-complexity-label').textContent = k === 'pattern' ? 'Density' : 'Complexity';
    // A pattern uses only the background and one color.
    pickers[1].closest('label')!.hidden = k === 'pattern';
    pickers[2].closest('label')!.hidden = k === 'pattern';
    $('bg-c0-label').textContent = k === 'pattern' ? 'Pattern color' : 'Color 1';

    $('bg-svg-out').textContent = svg;
    $('bg-css-out').textContent = buildCss(state);
    $('bg-tw-out').textContent = buildTailwind(state);
    const kb = (new Blob([svg]).size / 1024).toFixed(1);
    $('bg-size-out').textContent = `${state.w}×${state.h} · SVG ${kb} KB`;
  }

  syncPickers();
  render();
}
