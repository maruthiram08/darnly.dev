// Social image resizer: crops one picture for every social size with a canvas. Nothing is uploaded.
import { makeZip, type ZipEntry } from './zip';
import { SLOTS, type Slot } from './social-image-slots';

type Type = 'image/jpeg' | 'image/png';
type Mode = 'fill' | 'fit';
type Source = { levels: CanvasImageSource[]; sizes: [number, number][]; w: number; h: number; name: string };
type Card = { slot: Slot; el: HTMLLIElement; canvas: HTMLCanvasElement; zoom: HTMLInputElement; warn: HTMLElement; cx: number; cy: number; queued: boolean };

const MAX_SIDE = 8192;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const root = $<HTMLDivElement>('sr');
const fileInput = $<HTMLInputElement>('sr-file');
const drop = $<HTMLLabelElement>('sr-drop');
const dropTitle = $<HTMLElement>('sr-drop-title');
const dropText = $<HTMLElement>('sr-drop-text');
const error = $<HTMLParagraphElement>('sr-error');
const bg = $<HTMLInputElement>('sr-bg');
const bgWrap = $<HTMLLabelElement>('sr-bg-wrap');
const coverToggle = $<HTMLInputElement>('sr-cover');
const zipBtn = $<HTMLButtonElement>('sr-zip');
const resetBtn = $<HTMLButtonElement>('sr-reset');
const modeRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="sr-mode"]')];
const typeRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="sr-type"]')];

const mode = (): Mode => (modeRadios.find((r) => r.checked)?.value as Mode) ?? 'fill';
const type = (): Type => (typeRadios.find((r) => r.checked)?.value as Type) ?? 'image/jpeg';

let src: Source | null = null;

const cards: Card[] = [...document.querySelectorAll<HTMLLIElement>('#sr-grid .card')].map((el) => ({
  slot: SLOTS.find((s) => s.key === el.dataset.key)!,
  el,
  canvas: el.querySelector('canvas')!,
  zoom: el.querySelector<HTMLInputElement>('input[type="range"]')!,
  warn: el.querySelector<HTMLElement>('.warn')!,
  cx: 0.5,
  cy: 0.5,
  queued: false,
}));

// Halved copies of the picture, so shrinking it a lot still looks sharp.
function pyramid(img: CanvasImageSource, w: number, h: number): Pick<Source, 'levels' | 'sizes'> {
  const levels: CanvasImageSource[] = [img];
  const sizes: [number, number][] = [[w, h]];
  let cur = img;
  while (w > 600 && h > 600) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, w, h);
    levels.push(c);
    sizes.push([w, h]);
    cur = c;
  }
  return { levels, sizes };
}

// Where the picture goes in a W×H output, with the crop's center point kept in view.
function place(card: Card, W: number, H: number) {
  const s = src!;
  const fit = mode() === 'fit';
  const zoom = Number(card.zoom.value) / 100;
  const scale = (fit ? Math.min(W / s.w, H / s.h) : Math.max(W / s.w, H / s.h)) * zoom;
  const dw = s.w * scale;
  const dh = s.h * scale;
  const axis = (out: number, d: number, c: number) => (d <= out ? (out - d) / 2 : Math.min(0, Math.max(out - d, out / 2 - c * d)));
  return { dx: axis(W, dw, card.cx), dy: axis(H, dh, card.cy), dw, dh, scale };
}

function paint(card: Card, ctx: CanvasRenderingContext2D, W: number, H: number, k: number, forFile: boolean) {
  const s = src!;
  const p = place(card, W, H);
  const fit = mode() === 'fit';
  ctx.clearRect(0, 0, W * k, H * k);
  if (fit || (forFile && type() === 'image/jpeg')) {
    ctx.fillStyle = fit ? bg.value : '#ffffff';
    ctx.fillRect(0, 0, W * k, H * k);
  }
  // Smallest halved copy that is still at least as big as what we draw.
  const need = p.dw * k;
  let i = 0;
  while (i + 1 < s.levels.length && s.sizes[i + 1][0] >= need) i++;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(s.levels[i], p.dx * k, p.dy * k, p.dw * k, p.dh * k);
  return p;
}

function paintCover(card: Card, ctx: CanvasRenderingContext2D, cw: number, ch: number) {
  const shapes = card.slot.cover?.shapes;
  if (!shapes || !coverToggle.checked) return;
  ctx.save();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = Math.max(1.5, cw / 400);
  ctx.setLineDash([6, 4]);
  for (const sh of shapes) {
    ctx.beginPath();
    if (sh.kind === 'circle') ctx.arc(sh.cx * cw, sh.cy * ch, sh.r * cw, 0, Math.PI * 2);
    else ctx.roundRect(sh.x * cw, sh.y * ch, sh.w * cw, sh.h * ch, 4);
    ctx.fill();
    ctx.stroke();
    if (sh.kind === 'rect' && sh.label) {
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${Math.round(sh.h * ch * 0.55)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sh.label, (sh.x + sh.w / 2) * cw, (sh.y + sh.h / 2) * ch);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    }
  }
  ctx.restore();
}

function render(card: Card) {
  if (!src) return;
  const { slot, canvas } = card;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const ch = Math.max(1, Math.round((cw * slot.h) / slot.w));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext('2d')!;
  const p = paint(card, ctx, slot.w, slot.h, cw / slot.w, false);
  paintCover(card, ctx, cw, ch);
  // Warn when the picture has to be blown up more than a little to fill this size.
  card.warn.hidden = p.scale <= 1.15 || src.name === 'sample';
}

function queue(card: Card) {
  if (card.queued) return;
  card.queued = true;
  requestAnimationFrame(() => {
    card.queued = false;
    render(card);
  });
}

const renderAll = () => cards.forEach(queue);

// After a move, keep the center point where the picture actually ended up, so there is no dead zone at the edges.
function settle(card: Card) {
  const p = place(card, card.slot.w, card.slot.h);
  if (p.dw > card.slot.w) card.cx = (card.slot.w / 2 - p.dx) / p.dw;
  if (p.dh > card.slot.h) card.cy = (card.slot.h / 2 - p.dy) / p.dh;
}

function move(card: Card, dxOut: number, dyOut: number) {
  if (!src) return;
  const p = place(card, card.slot.w, card.slot.h);
  card.cx = Math.min(1, Math.max(0, card.cx - dxOut / p.dw));
  card.cy = Math.min(1, Math.max(0, card.cy - dyOut / p.dh));
  settle(card);
  queue(card);
}

function makeFile(card: Card): Promise<Blob> {
  const { w, h } = card.slot;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(card, c.getContext('2d')!, w, h, 1, true);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), type(), 0.92));
}

function fileName(card: Card) {
  const base = (src?.name ?? 'image').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image';
  return `${base}-${card.slot.key}-${card.slot.w}x${card.slot.h}.${type() === 'image/png' ? 'png' : 'jpg'}`;
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

function showError(msg: string) {
  error.textContent = msg;
  error.hidden = false;
}

function useSource(img: CanvasImageSource, w: number, h: number, name: string) {
  src = { ...pyramid(img, w, h), w, h, name };
  for (const card of cards) {
    card.cx = 0.5;
    card.cy = 0.5;
    card.zoom.value = '100';
  }
  renderAll();
}

async function load(file: File) {
  error.hidden = true;
  if (!file.type.startsWith('image/') && !/\.(avif|webp|svg|heic|heif)$/i.test(file.name)) {
    showError('That doesn’t look like a picture. Try a PNG, JPG or WebP.');
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    let w = img.naturalWidth || 1200;
    let h = img.naturalHeight || 1200;
    const big = Math.max(w, h);
    let source: CanvasImageSource = img;
    if (big > MAX_SIDE || !img.naturalWidth) {
      // Very large pictures (and SVGs without a size) are drawn once at a size every browser can handle.
      const k = big > MAX_SIDE ? MAX_SIDE / big : 1;
      w = Math.round(w * k);
      h = Math.round(h * k);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      source = c;
    }
    useSource(source, w, h, file.name);
    dropTitle.textContent = file.name;
    dropText.textContent = `${img.naturalWidth || w} × ${img.naturalHeight || h}. Drop or paste another picture to swap it.`;
  } catch {
    showError(/\.(heic|heif)$/i.test(file.name)
      ? 'This browser can’t open HEIC photos. On your iPhone, share the photo as a JPG first, or try Safari.'
      : 'This picture couldn’t be opened. Try saving it as a PNG or JPG first.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// A sample picture, so the page shows what it does before anyone drops one in.
function sample() {
  const w = 2400;
  const h = 1600;
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
  const sun = x.createRadialGradient(w * 0.8, h * 0.24, 0, w * 0.8, h * 0.24, 220);
  sun.addColorStop(0, '#FFF6D6');
  sun.addColorStop(0.55, '#FFC64A');
  sun.addColorStop(1, 'rgba(255, 198, 74, 0)');
  x.fillStyle = sun;
  x.beginPath();
  x.arc(w * 0.8, h * 0.24, 220, 0, Math.PI * 2);
  x.fill();
  const hill = (base: number, amp: number, freq: number, phase: number, color: string) => {
    x.fillStyle = color;
    x.beginPath();
    x.moveTo(0, h);
    for (let i = 0; i <= w; i += 20) x.lineTo(i, base + Math.sin(i / freq + phase) * amp + Math.sin(i / (freq * 0.37)) * amp * 0.3);
    x.lineTo(w, h);
    x.fill();
  };
  hill(h * 0.68, 70, 260, 0.5, '#3C8F6E');
  hill(h * 0.8, 50, 190, 2.1, '#2A6F55');
  hill(h * 0.9, 30, 140, 4, '#1D4F3D');
  x.fillStyle = '#ffffff';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = '800 150px "Bricolage Grotesque", system-ui, sans-serif';
  x.fillText('Your picture here', w / 2, h * 0.43);
  x.font = '500 64px Figtree, system-ui, sans-serif';
  x.fillText('Drop one in above to try it', w / 2, h * 0.43 + 120);
  useSource(c, w, h, 'sample');
}

// Dragging inside a frame moves that crop.
for (const card of cards) {
  let last: { x: number; y: number } | null = null;
  card.canvas.addEventListener('pointerdown', (e) => {
    last = { x: e.clientX, y: e.clientY };
    card.canvas.setPointerCapture(e.pointerId);
  });
  card.canvas.addEventListener('pointermove', (e) => {
    if (!last) return;
    const k = card.slot.w / card.canvas.clientWidth;
    move(card, (e.clientX - last.x) * k, (e.clientY - last.y) * k);
    last = { x: e.clientX, y: e.clientY };
  });
  const end = () => (last = null);
  card.canvas.addEventListener('pointerup', end);
  card.canvas.addEventListener('pointercancel', end);
  card.canvas.addEventListener('keydown', (e) => {
    const step = card.slot.w * 0.03;
    const d: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (!d[e.key]) return;
    e.preventDefault();
    move(card, ...d[e.key]);
  });
  card.zoom.addEventListener('input', () => {
    if (src) settle(card);
    queue(card);
  });
  card.el.querySelector('.dl')!.addEventListener('click', async () => {
    if (!src) return;
    save(await makeFile(card), fileName(card));
  });
}

zipBtn.addEventListener('click', async () => {
  if (!src) return;
  zipBtn.disabled = true;
  try {
    const entries: ZipEntry[] = [];
    for (const card of cards) entries.push({ name: fileName(card), data: new Uint8Array(await (await makeFile(card)).arrayBuffer()) });
    const base = fileName(cards[0]).split(`-${cards[0].slot.key}`)[0];
    save(new Blob([makeZip(entries) as BlobPart], { type: 'application/zip' }), `${base}-social-sizes.zip`);
  } catch {
    showError('Something went wrong making the ZIP. Try downloading the sizes one by one.');
  } finally {
    zipBtn.disabled = false;
  }
});

resetBtn.addEventListener('click', () => {
  for (const card of cards) {
    card.cx = 0.5;
    card.cy = 0.5;
    card.zoom.value = '100';
  }
  renderAll();
});

for (const r of modeRadios) r.addEventListener('change', () => {
  bgWrap.hidden = mode() !== 'fit';
  cards.forEach((c) => src && settle(c));
  renderAll();
});
for (const r of typeRadios) r.addEventListener('change', renderAll);
bg.addEventListener('input', renderAll);
coverToggle.addEventListener('change', () => {
  root.classList.toggle('no-cover', !coverToggle.checked);
  renderAll();
});

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) load(f);
  fileInput.value = '';
});
for (const ev of ['dragenter', 'dragover'] as const) drop.addEventListener(ev, () => drop.classList.add('over'));
for (const ev of ['dragleave', 'drop'] as const) drop.addEventListener(ev, () => drop.classList.remove('over'));
// Dropping a picture anywhere on the tool works too.
root.addEventListener('dragover', (e) => e.preventDefault());
root.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  e.preventDefault();
  load(f);
});
document.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
  if (f) load(f);
});

new ResizeObserver(renderAll).observe($('sr-grid'));
// Draw the sample once the fonts are in, so its words use the site's fonts.
(document.fonts?.ready ?? Promise.resolve()).then(() => {
  if (!src) sample();
});
