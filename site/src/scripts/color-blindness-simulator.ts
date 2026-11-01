// Color blindness simulator: everything runs in the visitor's browser. Nothing is uploaded.

type RGB = [number, number, number];
type Mode = 'deutan' | 'protan' | 'tritan' | 'achroma';
type Color = { rgb: RGB; weight: number };
type Pair = { a: Color; b: Color; sa: RGB; sb: RGB; same: boolean };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const modesEl = $<HTMLDivElement>('cb-modes');
const stage = $<HTMLDivElement>('cb-stage');
const original = $<HTMLCanvasElement>('cb-original');
const sim = $<HTMLCanvasElement>('cb-sim');
const handle = $<HTMLDivElement>('cb-handle');
const tag = $<HTMLSpanElement>('cb-tag');
const swipe = $<HTMLInputElement>('cb-swipe');
const verdict = $<HTMLDivElement>('cb-verdict');
const pairsEl = $<HTMLUListElement>('cb-pairs');
const fileInput = $<HTMLInputElement>('cb-file');
const drop = $<HTMLLabelElement>('cb-drop');
const dropText = $<HTMLSpanElement>('cb-drop-text');
const sampleBtn = $<HTMLButtonElement>('cb-sample');
const download = $<HTMLButtonElement>('cb-download');
const error = $<HTMLParagraphElement>('cb-error');

const NAMES: Record<Mode, string> = {
  deutan: 'Deuteranopia',
  protan: 'Protanopia',
  tritan: 'Tritanopia',
  achroma: 'Achromatopsia',
};
const MODES = Object.keys(NAMES) as Mode[];

// Machado, Oliveira & Fernandes (2009), severity 1.0, applied in linear RGB.
const MATRIX: Record<Exclude<Mode, 'achroma'>, number[]> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

// sRGB <-> linear lookups, so each pixel costs a few multiplies.
const TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const LUT_SIZE = 4096;
const TO_SRGB = new Uint8ClampedArray(LUT_SIZE + 1);
for (let i = 0; i <= LUT_SIZE; i++) {
  const c = i / LUT_SIZE;
  TO_SRGB[i] = Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
}
const enc = (v: number) => TO_SRGB[v <= 0 ? 0 : v >= 1 ? LUT_SIZE : Math.round(v * LUT_SIZE)];

function simulate(mode: Mode, r: number, g: number, b: number): RGB {
  const R = TO_LIN[r];
  const G = TO_LIN[g];
  const B = TO_LIN[b];
  if (mode === 'achroma') {
    const y = enc(0.2126 * R + 0.7152 * G + 0.0722 * B);
    return [y, y, y];
  }
  const m = MATRIX[mode];
  return [enc(m[0] * R + m[1] * G + m[2] * B), enc(m[3] * R + m[4] * G + m[5] * B), enc(m[6] * R + m[7] * G + m[8] * B)];
}

// "Redmean" distance: close to how people see color differences, and cheap.
function dist([r1, g1, b1]: RGB, [r2, g2, b2]: RGB): number {
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
// CIEDE2000: the standard "how different do these two colors look" score. Under ~10 reads as the same color.
function lab([r, g, b]: RGB): RGB {
  const R = TO_LIN[r];
  const G = TO_LIN[g];
  const B = TO_LIN[b];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const rad = Math.PI / 180;
function deltaE(c1: RGB, c2: RGB): number {
  const [L1, a1, b1] = lab(c1);
  const [L2, a2, b2] = lab(c2);
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + G);
  const ap2 = a2 * (1 + G);
  const C1 = Math.hypot(ap1, b1);
  const C2 = Math.hypot(ap2, b2);
  const hue = (x: number, y: number) => (x || y ? (Math.atan2(y, x) / rad + 360) % 360 : 0);
  const h1 = hue(ap1, b1);
  const h2 = hue(ap2, b2);
  let dh = 0;
  if (C1 * C2) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dL = L2 - L1;
  const dC = C2 - C1;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh * rad) / 2);
  const Lb = (L1 + L2) / 2;
  const Cpb = (C1 + C2) / 2;
  let hb = h1 + h2;
  if (C1 * C2) hb = (Math.abs(h1 - h2) > 180 ? hb + (hb < 360 ? 360 : -360) : hb) / 2;
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const dt = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const RT = -Math.sin(2 * dt * rad) * 2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const SC = 1 + 0.045 * Cpb;
  const SH = 1 + 0.015 * Cpb * T;
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

const hex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

let mode: Mode = 'deutan';
let source: ImageData | null = null;
const simCache = new Map<Mode, ImageData>();
let colors: Color[] = [];
const pairCache = new Map<Mode, Pair[]>();
let usingSample = true;

// Main colors of the picture, biggest first. Used to find colors that collapse into one.
function mainColors(img: ImageData): Color[] {
  const { data, width, height } = img;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 60000)));
  const sums = new Map<number, [number, number, number, number]>();
  let total = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const cur = sums.get(key);
      if (cur) {
        cur[0] += r;
        cur[1] += g;
        cur[2] += b;
        cur[3]++;
      } else sums.set(key, [r, g, b, 1]);
      total++;
    }
  }
  const buckets = [...sums.values()]
    .map(([r, g, b, n]) => ({ rgb: [r / n, g / n, b / n] as RGB, weight: n }))
    .sort((p, q) => q.weight - p.weight);
  const out: Color[] = [];
  for (const bk of buckets) {
    const near = out.find((c) => dist(c.rgb, bk.rgb) < 40);
    if (near) near.weight += bk.weight;
    else out.push({ rgb: bk.rgb, weight: bk.weight });
  }
  // Ignore specks (anti-aliasing, photo noise): a color needs at least 0.15% of the picture.
  return out.filter((c) => c.weight / total >= 0.0015).slice(0, 24);
}

function pairsFor(m: Mode): Pair[] {
  const hit = pairCache.get(m);
  if (hit) return hit;
  const base = colors.map((c) => c.rgb.map(Math.round) as RGB);
  const sims = base.map((c) => simulate(m, ...c));
  const found: (Pair & { score: number })[] = [];
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const before = deltaE(base[i], base[j]);
      if (before < 20) continue; // already similar to everyone
      const after = deltaE(sims[i], sims[j]);
      // "Look the same" under 10; "hard to tell apart" when most of the difference is gone.
      if (after < 10 || (after < 20 && after < before / 3))
        found.push({ a: colors[i], b: colors[j], sa: sims[i], sb: sims[j], same: after < 10, score: before - after * 3 });
    }
  }
  found.sort((p, q) => q.score - p.score);
  // Keep one pair per look-alike color, so the list isn't five shades of the same problem.
  const kept: Pair[] = [];
  for (const p of found) {
    if (kept.some((k) => (dist(k.a.rgb, p.a.rgb) < 60 && dist(k.b.rgb, p.b.rgb) < 60) || (dist(k.a.rgb, p.b.rgb) < 60 && dist(k.b.rgb, p.a.rgb) < 60))) continue;
    kept.push(p);
    if (kept.length >= 6) break;
  }
  pairCache.set(m, kept);
  return kept;
}

function simImage(m: Mode): ImageData {
  const hit = simCache.get(m);
  if (hit) return hit;
  const src = source!;
  const out = new ImageData(src.width, src.height);
  const s = src.data;
  const d = out.data;
  const memo = new Map<number, number>(); // screenshots repeat colors a lot
  for (let i = 0; i < s.length; i += 4) {
    const key = (s[i] << 16) | (s[i + 1] << 8) | s[i + 2];
    let v = memo.get(key);
    if (v === undefined) {
      const [r, g, b] = simulate(m, s[i], s[i + 1], s[i + 2]);
      v = (r << 16) | (g << 8) | b;
      if (memo.size < 200000) memo.set(key, v);
    }
    d[i] = v >> 16;
    d[i + 1] = (v >> 8) & 255;
    d[i + 2] = v & 255;
    d[i + 3] = s[i + 3];
  }
  simCache.set(m, out);
  return out;
}

function setSwipe() {
  const p = Number(swipe.value);
  sim.style.clipPath = `inset(0 0 0 ${p}%)`;
  handle.style.left = `${p}%`;
}

function render() {
  if (!source) return;
  sim.width = source.width;
  sim.height = source.height;
  sim.getContext('2d')!.putImageData(simImage(mode), 0, 0);
  tag.textContent = NAMES[mode];
  for (const b of modesEl.querySelectorAll<HTMLButtonElement>('[data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));

  for (const m of MODES) {
    const em = modesEl.querySelector<HTMLElement>(`[data-count="${m}"]`)!;
    const n = pairsFor(m).length;
    em.textContent = n ? `${n} to fix` : 'All clear';
    em.className = n ? 'bad' : 'ok';
  }

  const pairs = pairsFor(mode);
  const who = mode === 'achroma' ? 'someone who sees no color' : `someone with ${NAMES[mode].toLowerCase()}`;
  if (pairs.length) {
    verdict.className = 'verdict bad';
    const n = pairs.length;
    verdict.innerHTML = `<strong>${n} pair${n === 1 ? '' : 's'} of colors ${n === 1 ? 'is' : 'are'} hard to tell apart for ${who}.</strong> If these colors carry meaning (error vs success, chart lines, links), add an icon or label, or make one clearly lighter. Then check text with the <a href="/tools/contrast-checker/">contrast checker</a>.`;
  } else {
    verdict.className = 'verdict ok';
    verdict.innerHTML = `<strong>No clashing colors for ${who}.</strong> The main colors in this picture stay different. Still check text with the <a href="/tools/contrast-checker/">contrast checker</a>.`;
  }
  pairsEl.replaceChildren(
    ...pairs.map((p) => {
      const li = document.createElement('li');
      const sw = (a: RGB, b: RGB) => {
        const d = document.createElement('span');
        d.className = 'duo';
        for (const c of [a, b]) {
          const i = document.createElement('i');
          i.style.background = hex(c);
          d.append(i);
        }
        return d;
      };
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '→';
      const txt = document.createElement('span');
      txt.innerHTML = `<strong>${hex(p.a.rgb)} + ${hex(p.b.rgb)}</strong><small>${p.same ? 'look the same' : 'hard to tell apart'}: ${hex(p.sa)} / ${hex(p.sb)}</small>`;
      li.append(sw(p.a.rgb, p.b.rgb), arrow, txt);
      li.insertBefore(sw(p.sa, p.sb), txt);
      return li;
    }),
  );
}

function useCanvas(c: HTMLCanvasElement) {
  original.width = c.width;
  original.height = c.height;
  const x = original.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(c, 0, 0);
  source = x.getImageData(0, 0, c.width, c.height);
  simCache.clear();
  pairCache.clear();
  colors = mainColors(source);
  render();
}

// A made-up dashboard full of the usual traps: red/green status, a two-line chart, a legend.
function drawSample(): HTMLCanvasElement {
  const W = 1200;
  const H = 720;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  const font = (w: number, s: number) => `${w} ${s}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const round = (X: number, Y: number, w: number, h: number, r: number, fill: string) => {
    x.beginPath();
    x.roundRect(X, Y, w, h, r);
    x.fillStyle = fill;
    x.fill();
  };
  x.fillStyle = '#F4F6FA';
  x.fillRect(0, 0, W, H);
  // Sidebar
  x.fillStyle = '#1E2A3B';
  x.fillRect(0, 0, 220, H);
  x.fillStyle = '#FFFFFF';
  x.font = font(700, 24);
  x.fillText('Acme', 32, 52);
  ['Overview', 'Orders', 'Customers', 'Settings'].forEach((t, i) => {
    if (i === 0) round(18, 84, 184, 40, 10, '#2F4058');
    x.fillStyle = i === 0 ? '#FFFFFF' : '#A9B6C8';
    x.font = font(500, 17);
    x.fillText(t, 34, 110 + i * 52);
  });
  // Header
  x.fillStyle = '#111827';
  x.font = font(700, 30);
  x.fillText('Orders this week', 260, 62);
  round(980, 30, 180, 46, 10, '#2563EB');
  x.fillStyle = '#FFFFFF';
  x.font = font(600, 17);
  x.fillText('+ New order', 1020, 59);
  // Stat cards
  const stats: [string, string, string, string][] = [
    ['Revenue', '$12,480', '+18%', '#16A34A'],
    ['Refunds', '$1,204', '+9%', '#DC2626'],
    ['New users', '842', '+4%', '#16A34A'],
  ];
  stats.forEach(([label, value, delta, col], i) => {
    const X = 260 + i * 305;
    round(X, 100, 285, 120, 14, '#FFFFFF');
    x.fillStyle = '#6B7280';
    x.font = font(500, 16);
    x.fillText(label, X + 22, 136);
    x.fillStyle = '#111827';
    x.font = font(700, 34);
    x.fillText(value, X + 22, 186);
    x.fillStyle = col;
    x.font = font(700, 17);
    x.fillText(delta, X + 210, 136);
  });
  // Chart
  round(260, 244, 590, 440, 14, '#FFFFFF');
  x.fillStyle = '#111827';
  x.font = font(700, 19);
  x.fillText('Sales vs returns', 284, 284);
  x.strokeStyle = '#E5E7EB';
  x.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    x.beginPath();
    x.moveTo(290, 340 + i * 70);
    x.lineTo(820, 340 + i * 70);
    x.stroke();
  }
  const line = (pts: number[], col: string) => {
    x.strokeStyle = col;
    x.lineWidth = 5;
    x.lineJoin = 'round';
    x.beginPath();
    pts.forEach((v, i) => (i ? x.lineTo(300 + i * 86, v) : x.moveTo(300, v)));
    x.stroke();
  };
  line([560, 520, 540, 470, 430, 450, 380], '#22A447');
  line([600, 590, 560, 575, 530, 545, 520], '#E0453A');
  const legend = (X: number, col: string, t: string) => {
    round(X, 300, 14, 14, 4, col);
    x.fillStyle = '#374151';
    x.font = font(500, 15);
    x.fillText(t, X + 22, 312);
  };
  legend(560, '#22A447', 'Sales');
  legend(660, '#E0453A', 'Returns');
  // Status list
  round(874, 244, 286, 440, 14, '#FFFFFF');
  x.fillStyle = '#111827';
  x.font = font(700, 19);
  x.fillText('Latest orders', 898, 284);
  const rows: [string, string, string, string][] = [
    ['#1042', 'Paid', '#DCFCE7', '#15803D'],
    ['#1041', 'Failed', '#FEE2E2', '#B91C1C'],
    ['#1040', 'Paid', '#DCFCE7', '#15803D'],
    ['#1039', 'Pending', '#FEF3C7', '#B45309'],
    ['#1038', 'Failed', '#FEE2E2', '#B91C1C'],
    ['#1037', 'Paid', '#DCFCE7', '#15803D'],
  ];
  rows.forEach(([id, st, bg, fg], i) => {
    const Y = 318 + i * 58;
    x.fillStyle = '#374151';
    x.font = font(500, 17);
    x.fillText(id, 898, Y + 26);
    round(1030, Y + 6, 104, 30, 15, bg);
    x.fillStyle = fg;
    x.font = font(700, 15);
    x.textAlign = 'center';
    x.fillText(st, 1082, Y + 27);
    x.textAlign = 'left';
  });
  return c;
}

function showSample() {
  usingSample = true;
  sampleBtn.hidden = true;
  dropText.textContent = 'or click to choose one, or paste it. Below is a sample until you do.';
  useCanvas(drawSample());
}

function load(file: File) {
  error.hidden = true;
  if (!file.type.startsWith('image/')) {
    error.textContent = 'That file isn’t an image. Try a PNG, JPG or WebP screenshot.';
    error.hidden = false;
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const max = 1600;
    const w0 = img.naturalWidth || 1200;
    const h0 = img.naturalHeight || 800;
    const s = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * s));
    c.height = Math.max(1, Math.round(h0 * s));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    usingSample = false;
    sampleBtn.hidden = false;
    dropText.textContent = `${file.name || 'Pasted image'} · choose another`;
    useCanvas(c);
    stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    error.textContent = 'We couldn’t read that image. Try saving it as a PNG or JPG first.';
    error.hidden = false;
  };
  img.src = url;
}

modesEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]');
  if (!b) return;
  mode = b.dataset.mode as Mode;
  render();
});
modesEl.addEventListener('keydown', (e) => {
  const i = MODES.indexOf(mode);
  const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!d) return;
  e.preventDefault();
  mode = MODES[(i + d + MODES.length) % MODES.length];
  render();
  modesEl.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)!.focus();
});
swipe.addEventListener('input', setSwipe);
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) load(f);
  fileInput.value = '';
});
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer?.files?.[0];
  if (f) load(f);
});
// Dropping anywhere on the preview works too.
stage.addEventListener('dragover', (e) => e.preventDefault());
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) load(f);
});
document.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
  if (f) load(f);
});
sampleBtn.addEventListener('click', showSample);
download.addEventListener('click', () => {
  if (!source) return;
  const a = document.createElement('a');
  a.download = `${usingSample ? 'sample' : 'screenshot'}-${mode === 'achroma' ? 'achromatopsia' : NAMES[mode].toLowerCase()}.png`;
  a.href = sim.toDataURL('image/png');
  a.click();
});

setSwipe();
showSample();
