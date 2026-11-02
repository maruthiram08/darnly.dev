// Image watermark: draws a text or logo watermark on one or many pictures with a canvas. Nothing is uploaded.
import { makeZip, type ZipEntry } from './zip';

type Kind = 'text' | 'logo';
type Pos = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br' | 'tile';
type Item = {
  id: number;
  name: string;
  type: string; // the original file type
  file: File | null; // null for the samples
  w: number;
  h: number;
  view: HTMLCanvasElement; // a copy up to PREVIEW_SIDE, for the big preview
  thumb: HTMLCanvasElement; // the thumbnail shown in the strip
  sample?: () => HTMLCanvasElement; // full-size sample picture
};

const MAX_SIDE = 8192;
const PREVIEW_SIDE = 1800;
const THUMB_H = 144;
const MAX_FILES = 60;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = $<HTMLDivElement>('wm');
const fileInput = $<HTMLInputElement>('wm-file');
const drop = $<HTMLLabelElement>('wm-drop');
const dropTitle = $<HTMLElement>('wm-drop-title');
const dropText = $<HTMLElement>('wm-drop-text');
const error = $<HTMLParagraphElement>('wm-error');
const canvas = $<HTMLCanvasElement>('wm-canvas');
const previewBox = $<HTMLDivElement>('wm-preview');
const badge = $<HTMLElement>('wm-badge');
const thumbs = $<HTMLUListElement>('wm-thumbs');
const oneBtn = $<HTMLButtonElement>('wm-one');
const zipBtn = $<HTMLButtonElement>('wm-zip');
const textInput = $<HTMLInputElement>('wm-text');
const textGroup = $<HTMLDivElement>('wm-text-group');
const logoGroup = $<HTMLDivElement>('wm-logo-group');
const logoInput = $<HTMLInputElement>('wm-logo');
const logoThumb = $<HTMLCanvasElement>('wm-logo-thumb');
const logoTitle = $<HTMLElement>('wm-logo-title');
const logoHint = $<HTMLElement>('wm-logo-hint');
const tint = $<HTMLInputElement>('wm-tint');
const colorPick = $<HTMLInputElement>('wm-color');
const shadow = $<HTMLInputElement>('wm-shadow');
const opacity = $<HTMLInputElement>('wm-opacity');
const size = $<HTMLInputElement>('wm-size');
const angle = $<HTMLInputElement>('wm-angle');
const gap = $<HTMLInputElement>('wm-gap');
const gapRow = $<HTMLLabelElement>('wm-gap-row');
const kindRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="wm-kind"]')];
const typeRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="wm-type"]')];
const fontBtns = [...document.querySelectorAll<HTMLButtonElement>('#wm-fonts button')];
const posBtns = [...document.querySelectorAll<HTMLButtonElement>('#wm-pos button')];
const colorBtns = [...document.querySelectorAll<HTMLButtonElement>('#wm-colors .sw[data-color]')];
const customSw = colorPick.closest('label')!;

const FONTS: Record<string, string> = {
  sans: '600 {px}px Figtree, system-ui, sans-serif',
  display: '800 {px}px "Bricolage Grotesque", system-ui, sans-serif',
  serif: 'italic 600 {px}px Georgia, "Times New Roman", serif',
  mono: '500 {px}px "JetBrains Mono", ui-monospace, monospace',
};

let items: Item[] = [];
let current = 0;
let nextId = 1;
let font = 'sans';
let pos: Pos = 'tile';
let color = '#0B2230';
let logo: HTMLCanvasElement = placeholderLogo();
let hasLogo = false;
let queued = false;

const kind = (): Kind => (kindRadios.find((r) => r.checked)?.value as Kind) ?? 'text';

// ---------- the watermark ----------

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

// The logo, painted in the chosen color when "Paint it in the color" is on.
let tinted: { key: string; c: HTMLCanvasElement } | null = null;
function logoSource(): HTMLCanvasElement {
  if (!tint.checked) return logo;
  const key = `${color}|${logo.width}x${logo.height}|${hasLogo}`;
  if (tinted?.key === key) return tinted.c;
  const c = document.createElement('canvas');
  c.width = logo.width;
  c.height = logo.height;
  const x = c.getContext('2d')!;
  x.drawImage(logo, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  tinted = { key, c };
  return c;
}

// Draws the watermark on a W×H canvas. Every size is measured from the shorter side, so it looks the same at any scale.
function drawMark(x: CanvasRenderingContext2D, W: number, H: number) {
  const short = Math.min(W, H);
  const s = Number(size.value) / 100;
  const tiled = pos === 'tile';
  const rad = (Number(angle.value) * Math.PI) / 180;
  const isText = kind() === 'text';
  const text = textInput.value.trim() || ' ';

  let bw: number;
  let bh: number;
  let fontPx = 0;
  if (isText) {
    fontPx = short * (0.018 + s * (tiled ? 0.09 : 0.14));
    x.font = FONTS[font].replace('{px}', String(fontPx));
    bw = x.measureText(text).width;
    bh = fontPx;
  } else {
    const src = logoSource();
    const target = short * (0.06 + s * (tiled ? 0.3 : 0.5));
    const k = target / Math.max(src.width, src.height);
    bw = src.width * k;
    bh = src.height * k;
  }

  x.save();
  x.globalAlpha = Number(opacity.value) / 100;
  if (shadow.checked) {
    const light = isText || tint.checked ? luminance(color) > 0.35 : true;
    x.shadowColor = light ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.7)';
    x.shadowBlur = Math.max(2, short * 0.012);
    x.shadowOffsetY = Math.max(1, short * 0.002);
  }
  const one = () => {
    if (isText) {
      x.fillStyle = color;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(text, 0, bh * 0.04);
    } else {
      x.drawImage(logoSource(), -bw / 2, -bh / 2, bw, bh);
    }
  };

  if (tiled) {
    const space = short * (0.02 + (Number(gap.value) / 100) * 0.35);
    const stepX = bw + space * 1.6;
    const stepY = bh + space;
    const reach = Math.hypot(W, H) / 2 + Math.max(stepX, stepY);
    x.translate(W / 2, H / 2);
    x.rotate(rad);
    let row = 0;
    for (let ty = -reach; ty <= reach; ty += stepY, row++) {
      const shift = row % 2 ? stepX / 2 : 0;
      for (let tx = -reach - shift; tx <= reach; tx += stepX) {
        x.save();
        x.translate(tx, ty);
        one();
        x.restore();
      }
    }
  } else {
    const m = short * 0.04;
    // The box that holds the turned watermark, so corners keep it inside the picture.
    const rw = Math.abs(bw * Math.cos(rad)) + Math.abs(bh * Math.sin(rad));
    const rh = Math.abs(bw * Math.sin(rad)) + Math.abs(bh * Math.cos(rad));
    const col = pos[1] === 'l' ? 0 : pos[1] === 'c' ? 1 : 2;
    const rowI = pos[0] === 't' ? 0 : pos[0] === 'm' ? 1 : 2;
    const cx = [m + rw / 2, W / 2, W - m - rw / 2][col];
    const cy = [m + rh / 2, H / 2, H - m - rh / 2][rowI];
    x.translate(cx, cy);
    x.rotate(rad);
    one();
  }
  x.restore();
}

function render(target: HTMLCanvasElement, src: CanvasImageSource, W: number, H: number) {
  target.width = W;
  target.height = H;
  const x = target.getContext('2d')!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, W, H);
  drawMark(x, W, H);
}

// ---------- preview ----------

function scaled(src: CanvasImageSource, w: number, h: number, maxSide: number) {
  const k = Math.min(1, maxSide / Math.max(w, h));
  let cur: CanvasImageSource = src;
  let cw = w;
  let ch = h;
  const tw = Math.max(1, Math.round(w * k));
  const th = Math.max(1, Math.round(h * k));
  // Halve in steps so big pictures still look sharp when shrunk.
  while (cw / 2 > tw) {
    cw = Math.round(cw / 2);
    ch = Math.round(ch / 2);
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const x = c.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, cw, ch);
    cur = c;
  }
  const out = document.createElement('canvas');
  out.width = tw;
  out.height = th;
  const x = out.getContext('2d')!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(cur, 0, 0, tw, th);
  return out;
}

function renderNow() {
  queued = false;
  const it = items[current];
  oneBtn.disabled = zipBtn.disabled = !it;
  if (!it) return;
  // Size the preview to the box, at the screen's pixel density.
  const boxW = previewBox.clientWidth - 28;
  // (46px of the box's top padding holds the name badge.)
  const boxH = Math.max(240, window.innerHeight * 0.7);
  const k = Math.min(boxW / it.w, boxH / it.h, 1e9);
  const cssW = Math.max(1, Math.floor(it.w * k));
  const cssH = Math.max(1, Math.floor(it.h * k));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.min(it.view.width, Math.round(cssW * dpr));
  const ph = Math.max(1, Math.round((pw * it.h) / it.w));
  render(canvas, it.view, pw, ph);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  badge.textContent = `${it.file ? it.name : 'Sample'} · ${it.w} × ${it.h}`;

  for (const li of thumbs.children) {
    const id = Number((li as HTMLElement).dataset.id);
    const t = items.find((i) => i.id === id);
    const c = li.querySelector('canvas');
    if (!t || !c) continue;
    const tw = Math.round((THUMB_H * t.w) / t.h);
    render(c, t.thumb, Math.min(tw, THUMB_H * 3), THUMB_H);
    (li.querySelector('.th') as HTMLElement).setAttribute('aria-current', t === it ? 'true' : 'false');
  }
}

function queue() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(renderNow);
}

function buildThumbs() {
  thumbs.replaceChildren(
    ...items.map((it) => {
      const li = document.createElement('li');
      li.dataset.id = String(it.id);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'th';
      b.setAttribute('aria-label', `Show ${it.file ? it.name : 'sample'} in the preview`);
      b.append(document.createElement('canvas'));
      b.addEventListener('click', () => {
        current = items.indexOf(it);
        queue();
      });
      li.append(b);
      if (it.file || items.length > 1) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'rm';
        rm.textContent = '×';
        rm.setAttribute('aria-label', `Remove ${it.file ? it.name : 'sample'}`);
        rm.addEventListener('click', () => {
          items.splice(items.indexOf(it), 1);
          if (current >= items.length) current = Math.max(0, items.length - 1);
          if (!items.length) sample();
          else buildThumbs();
          updateCounts();
        });
        li.append(rm);
      }
      return li;
    }),
  );
  queue();
}

function updateCounts() {
  const real = items.filter((i) => i.file).length;
  zipBtn.textContent = `Download all (${items.length}) as ZIP`;
  if (real) {
    dropTitle.textContent = real === 1 ? items[0].name : `${real} pictures`;
    dropText.textContent = 'Drop or paste more to add them. Click a thumbnail to see it big.';
  } else {
    dropTitle.textContent = 'Drop your pictures here';
    dropText.textContent = 'or click to choose one or many. You can also paste. Two samples show until you do.';
  }
}

// ---------- loading ----------

function showError(msg: string) {
  error.textContent = msg;
  error.hidden = false;
}

async function decode(file: File): Promise<{ img: CanvasImageSource; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    let w = img.naturalWidth || 1200;
    let h = img.naturalHeight || 1200;
    const big = Math.max(w, h);
    if (big > MAX_SIDE || !img.naturalWidth) {
      // Very large pictures (and SVGs without a size) are drawn once at a size every browser can handle.
      const k = big > MAX_SIDE ? MAX_SIDE / big : 1;
      w = Math.round(w * k);
      h = Math.round(h * k);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      return { img: c, w, h };
    }
    return { img, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const isPicture = (f: File) => f.type.startsWith('image/') || /\.(avif|webp|svg|heic|heif)$/i.test(f.name);

async function addFiles(files: File[]) {
  error.hidden = true;
  const pics = files.filter(isPicture);
  if (!pics.length) {
    showError('That doesn’t look like a picture. Try a PNG, JPG or WebP.');
    return;
  }
  // The samples go away as soon as real pictures arrive.
  if (items.every((i) => !i.file)) items = [];
  const room = MAX_FILES - items.length;
  const failed: string[] = [];
  const firstNew = items.length;
  for (const f of pics.slice(0, Math.max(0, room))) {
    try {
      const { img, w, h } = await decode(f);
      items.push({ id: nextId++, name: f.name, type: f.type, file: f, w, h, view: scaled(img, w, h, PREVIEW_SIDE), thumb: scaled(img, w, h, THUMB_H * 2) });
    } catch {
      failed.push(f.name);
    }
  }
  if (!items.length) sample();
  else {
    current = Math.min(firstNew, items.length - 1);
    buildThumbs();
  }
  updateCounts();
  const notes: string[] = [];
  if (pics.length > room) notes.push(`Only ${MAX_FILES} pictures fit at once, so the rest were left out.`);
  if (failed.length) {
    notes.push(failed.some((n) => /\.(heic|heif)$/i.test(n))
      ? 'This browser can’t open HEIC photos. On your iPhone, share them as JPG first, or try Safari.'
      : `${failed.length === 1 ? 'One picture' : `${failed.length} pictures`} couldn’t be opened (${failed.slice(0, 3).join(', ')}). Try saving as PNG or JPG first.`);
  }
  if (notes.length) showError(notes.join(' '));
}

async function setLogo(file: File) {
  try {
    const { img, w, h } = await decode(file);
    logo = scaled(img, w, h, 1600);
    hasLogo = true;
    tinted = null;
    logoTitle.textContent = file.name;
    logoHint.textContent = 'Click to swap it for another.';
    drawLogoThumb();
    queue();
  } catch {
    showError('That logo couldn’t be opened. Try a PNG or SVG.');
  }
}

function drawLogoThumb() {
  const x = logoThumb.getContext('2d')!;
  x.clearRect(0, 0, 88, 88);
  const k = 80 / Math.max(logo.width, logo.height);
  x.drawImage(logo, (88 - logo.width * k) / 2, (88 - logo.height * k) / 2, logo.width * k, logo.height * k);
}

// A stand-in logo until one is added, so "Logo" shows something right away.
function placeholderLogo() {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 200;
  const x = c.getContext('2d')!;
  x.fillStyle = '#FFFFFF';
  x.beginPath();
  x.arc(100, 100, 82, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#0593C6';
  x.font = '800 96px "Bricolage Grotesque", system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('Y', 100, 106);
  x.fillStyle = '#FFFFFF';
  x.textAlign = 'left';
  x.font = '800 104px "Bricolage Grotesque", system-ui, sans-serif';
  x.fillText('yourlogo', 205, 104);
  return c;
}

// ---------- samples ----------

// A screenshot of "unreleased work", the most common thing people watermark.
function sampleApp() {
  const w = 1600;
  const h = 1000;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  const rr = (X: number, Y: number, W: number, H: number, r: number, fill: string) => {
    x.fillStyle = fill;
    x.beginPath();
    x.roundRect(X, Y, W, H, r);
    x.fill();
  };
  x.fillStyle = '#F4F7FB';
  x.fillRect(0, 0, w, h);
  rr(0, 0, 300, h, 0, '#0B2230');
  rr(40, 44, 44, 44, 12, '#0593C6');
  x.fillStyle = '#fff';
  x.font = '800 30px "Bricolage Grotesque", system-ui, sans-serif';
  x.textBaseline = 'middle';
  x.fillText('Launchpad', 100, 68);
  x.font = '500 22px Figtree, system-ui, sans-serif';
  ['Overview', 'Customers', 'Revenue', 'Reports', 'Settings'].forEach((t, i) => {
    if (i === 0) rr(24, 140 + i * 64, 252, 48, 10, 'rgba(255,255,255,0.1)');
    x.fillStyle = i === 0 ? '#fff' : 'rgba(255,255,255,0.65)';
    x.fillText(t, 48, 164 + i * 64);
  });
  x.fillStyle = '#0B2230';
  x.font = '800 44px "Bricolage Grotesque", system-ui, sans-serif';
  x.fillText('Good morning, Sam', 350, 84);
  x.fillStyle = '#4A6472';
  x.font = '500 22px Figtree, system-ui, sans-serif';
  x.fillText('Here is how the new version is doing this week.', 350, 130);
  const stats: [string, string, string][] = [['Signups', '2,481', '#0593C6'], ['Revenue', '$18.2k', '#D83995'], ['Churn', '1.9%', '#3C8F6E']];
  stats.forEach(([k, v, col], i) => {
    const X = 350 + i * 410;
    rr(X, 180, 380, 170, 20, '#fff');
    x.fillStyle = '#4A6472';
    x.font = '600 22px Figtree, system-ui, sans-serif';
    x.fillText(k, X + 30, 225);
    x.fillStyle = '#0B2230';
    x.font = '800 56px "Bricolage Grotesque", system-ui, sans-serif';
    x.fillText(v, X + 30, 290);
    rr(X + 260, 270, 90, 36, 18, col + '22');
    x.fillStyle = col;
    x.font = '700 20px Figtree, system-ui, sans-serif';
    x.fillText('+12%', X + 278, 289);
  });
  rr(350, 380, 790, 570, 20, '#fff');
  x.fillStyle = '#0B2230';
  x.font = '700 26px Figtree, system-ui, sans-serif';
  x.fillText('Weekly active users', 385, 425);
  const bars = [0.35, 0.5, 0.42, 0.62, 0.58, 0.74, 0.69, 0.83, 0.78, 0.95];
  bars.forEach((v, i) => rr(395 + i * 72, 900 - v * 400, 46, v * 400, 10, i === bars.length - 1 ? '#D83995' : '#0593C6'));
  rr(1170, 380, 410, 570, 20, '#fff');
  x.fillStyle = '#0B2230';
  x.fillText('New customers', 1200, 425);
  ['Acme Inc.', 'Northwind', 'Globex', 'Initech', 'Umbrella', 'Hooli'].forEach((t, i) => {
    const Y = 480 + i * 76;
    rr(1200, Y, 48, 48, 24, ['#0593C6', '#D83995', '#F5B700', '#3C8F6E', '#6366F1', '#0B2230'][i]);
    x.fillStyle = '#0B2230';
    x.font = '600 22px Figtree, system-ui, sans-serif';
    x.fillText(t, 1266, Y + 24);
    x.fillStyle = '#4A6472';
    x.font = '500 20px "JetBrains Mono", monospace';
    x.fillText(`$${(9 + i * 7) * 10}`, 1470, Y + 24);
  });
  return c;
}

// A photo-like picture, to show the mark on a busy, colorful background.
function samplePhoto() {
  const w = 1500;
  const h = 1000;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  const sky = x.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0596D1');
  sky.addColorStop(0.6, '#7DD3F5');
  sky.addColorStop(1, '#FDE7D4');
  x.fillStyle = sky;
  x.fillRect(0, 0, w, h);
  const sun = x.createRadialGradient(w * 0.75, h * 0.28, 0, w * 0.75, h * 0.28, 170);
  sun.addColorStop(0, '#FFF6D6');
  sun.addColorStop(0.55, '#FFC64A');
  sun.addColorStop(1, 'rgba(255, 198, 74, 0)');
  x.fillStyle = sun;
  x.beginPath();
  x.arc(w * 0.75, h * 0.28, 170, 0, Math.PI * 2);
  x.fill();
  const hill = (base: number, amp: number, freq: number, phase: number, col: string) => {
    x.fillStyle = col;
    x.beginPath();
    x.moveTo(0, h);
    for (let i = 0; i <= w; i += 15) x.lineTo(i, base + Math.sin(i / freq + phase) * amp + Math.sin(i / (freq * 0.37)) * amp * 0.3);
    x.lineTo(w, h);
    x.fill();
  };
  hill(h * 0.66, 60, 200, 0.5, '#3C8F6E');
  hill(h * 0.79, 42, 150, 2.1, '#2A6F55');
  hill(h * 0.9, 26, 110, 4, '#1D4F3D');
  return c;
}

function sample() {
  items = [
    { id: nextId++, name: 'sample-app.png', type: 'image/png', file: null, w: 1600, h: 1000, view: sampleApp(), thumb: document.createElement('canvas') },
    { id: nextId++, name: 'sample-photo.jpg', type: 'image/jpeg', file: null, w: 1500, h: 1000, view: samplePhoto(), thumb: document.createElement('canvas') },
  ];
  for (const it of items) {
    it.thumb = scaled(it.view, it.w, it.h, THUMB_H * 2);
    const full = it.view;
    it.sample = () => full;
  }
  current = 0;
  buildThumbs();
  updateCounts();
}

// ---------- saving ----------

function outType(it: Item) {
  const pick = typeRadios.find((r) => r.checked)?.value ?? 'same';
  if (pick !== 'same') return pick;
  return ['image/jpeg', 'image/png', 'image/webp'].includes(it.type) ? it.type : 'image/png';
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function fileName(it: Item, type: string) {
  const base = it.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
  return `${base}-watermarked.${EXT[type] ?? 'png'}`;
}

async function makeFile(it: Item): Promise<{ blob: Blob; name: string }> {
  const src = it.file ? (await decode(it.file)).img : it.sample!();
  const c = document.createElement('canvas');
  const type = outType(it);
  c.width = it.w;
  c.height = it.h;
  const x = c.getContext('2d')!;
  if (type === 'image/jpeg') {
    // JPG has no see-through parts, so fill them white like most apps do.
    x.fillStyle = '#FFFFFF';
    x.fillRect(0, 0, it.w, it.h);
  }
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, it.w, it.h);
  drawMark(x, it.w, it.h);
  const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), type, 0.92));
  c.width = c.height = 1; // frees the memory right away
  return { blob, name: fileName(it, blob.type || type) };
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

oneBtn.addEventListener('click', async () => {
  const it = items[current];
  if (!it) return;
  oneBtn.disabled = true;
  try {
    const { blob, name } = await makeFile(it);
    save(blob, name);
  } catch {
    showError('Something went wrong saving this picture. Try PNG under “File type”.');
  } finally {
    oneBtn.disabled = false;
  }
});

zipBtn.addEventListener('click', async () => {
  if (!items.length) return;
  zipBtn.disabled = true;
  const label = zipBtn.textContent;
  try {
    const entries: ZipEntry[] = [];
    const used = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      zipBtn.textContent = `Making ${i + 1} of ${items.length}…`;
      const { blob, name } = await makeFile(items[i]);
      let n = name;
      for (let k = 2; used.has(n); k++) n = name.replace(/(\.\w+)$/, `-${k}$1`);
      used.add(n);
      entries.push({ name: n, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    const zip = makeZip(entries);
    save(new Blob([zip as BlobPart], { type: 'application/zip' }), 'watermarked-pictures.zip');
  } catch {
    showError('Something went wrong making the ZIP. Try downloading the pictures one by one.');
  } finally {
    zipBtn.disabled = false;
    zipBtn.textContent = label;
  }
});

// ---------- controls ----------

function pickRadio(btns: HTMLButtonElement[], on: HTMLButtonElement) {
  for (const b of btns) b.setAttribute('aria-checked', b === on ? 'true' : 'false');
}

function syncOutputs() {
  $('wm-opacity-out').textContent = `${opacity.value}%`;
  $('wm-size-out').textContent = size.value;
  $('wm-angle-out').textContent = `${angle.value}°`;
  $('wm-gap-out').textContent = gap.value;
  gapRow.hidden = pos !== 'tile';
}

for (const el of [textInput, opacity, size, angle, gap]) el.addEventListener('input', () => { syncOutputs(); queue(); });
for (const el of [shadow, tint]) el.addEventListener('change', queue);
for (const r of kindRadios) {
  r.addEventListener('change', () => {
    const k = kind();
    textGroup.hidden = k !== 'text';
    logoGroup.hidden = k !== 'logo';
    queue();
  });
}
for (const b of fontBtns) {
  b.addEventListener('click', async () => {
    font = b.dataset.font!;
    pickRadio(fontBtns, b);
    try {
      await document.fonts?.load(FONTS[font].replace('{px}', '40'), textInput.value);
    } catch { /* system font */ }
    queue();
  });
}
for (const b of posBtns) {
  b.addEventListener('click', () => {
    const was = pos;
    pos = b.dataset.pos as Pos;
    pickRadio(posBtns, b);
    // A corner mark reads best straight and a bit stronger; a tiled one at an angle and lighter.
    if (was === 'tile' && pos !== 'tile') {
      angle.value = '0';
      if (Number(opacity.value) < 60) opacity.value = '70';
    } else if (was !== 'tile' && pos === 'tile') {
      angle.value = '-30';
      if (Number(opacity.value) > 50) opacity.value = '30';
    }
    syncOutputs();
    queue();
  });
}
for (const b of colorBtns) {
  b.addEventListener('click', () => {
    color = b.dataset.color!;
    pickRadio(colorBtns, b);
    queue();
  });
}
colorPick.addEventListener('input', () => {
  color = colorPick.value.toUpperCase();
  pickRadio(colorBtns, null as unknown as HTMLButtonElement);
  customSw.style.outline = '3px solid var(--sky)';
  customSw.style.outlineOffset = '2px';
  queue();
});
for (const b of colorBtns) b.addEventListener('click', () => { customSw.style.outline = ''; });

fileInput.addEventListener('change', () => {
  const fs = [...(fileInput.files ?? [])];
  if (fs.length) addFiles(fs);
  fileInput.value = '';
});
logoInput.addEventListener('change', () => {
  const f = logoInput.files?.[0];
  if (f) setLogo(f);
  logoInput.value = '';
});
for (const ev of ['dragenter', 'dragover'] as const) drop.addEventListener(ev, () => drop.classList.add('over'));
for (const ev of ['dragleave', 'drop'] as const) drop.addEventListener(ev, () => drop.classList.remove('over'));
// Dropping pictures anywhere on the tool works too (a drop on the logo box sets the logo).
root.addEventListener('dragover', (e) => e.preventDefault());
root.addEventListener('drop', (e) => {
  const fs = [...(e.dataTransfer?.files ?? [])];
  if (!fs.length) return;
  e.preventDefault();
  if ((e.target as HTMLElement).closest('.logo-pick')) setLogo(fs[0]);
  else addFiles(fs);
});
document.addEventListener('paste', (e) => {
  if ((e.target as HTMLElement)?.closest?.('input[type="text"]')) return;
  const fs = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (fs.length) addFiles(fs);
});

new ResizeObserver(queue).observe(previewBox);
syncOutputs();
// Draw the samples once the fonts are in, so their words use the site's fonts.
(document.fonts?.ready ?? Promise.resolve()).then(() => {
  if (!hasLogo) {
    logo = placeholderLogo();
    drawLogoThumb();
  }
  if (!items.length) sample();
});
