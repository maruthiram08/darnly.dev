// Image compressor: everything runs in the visitor's browser. Nothing is uploaded.
import { makeZip, type ZipEntry } from './zip';

type Format = 'webp' | 'jpeg' | 'png';
type Settings = { format: Format; quality: number; maxWidth: number | null };
type Item = {
  file: File;
  img: HTMLImageElement;
  base: string;
  out: Blob | null;
  row: HTMLLIElement;
  after: HTMLSpanElement;
  saved: HTMLSpanElement;
  dims: HTMLSpanElement;
  link: HTMLAnchorElement;
};

const MAX_FILES = 50;
const EXT: Record<Format, string> = { webp: 'webp', jpeg: 'jpg', png: 'png' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>('ic-file');
const drop = $<HTMLLabelElement>('ic-drop');
const error = $<HTMLParagraphElement>('ic-error');
const note = $<HTMLParagraphElement>('ic-note');
const result = $<HTMLDivElement>('ic-result');
const format = $<HTMLSelectElement>('ic-format');
const quality = $<HTMLInputElement>('ic-quality');
const qualityOut = $<HTMLOutputElement>('ic-quality-out');
const qualityWrap = $<HTMLLabelElement>('ic-quality-wrap');
const maxWidth = $<HTMLInputElement>('ic-width');
const list = $<HTMLUListElement>('ic-list');
const total = $<HTMLParagraphElement>('ic-total');
const zipBtn = $<HTMLButtonElement>('ic-zip');
const clear = $<HTMLButtonElement>('ic-clear');

let items: Item[] = [];
let run = 0;

function settings(): Settings {
  const w = Math.round(Number(maxWidth.value));
  return {
    format: format.value as Format,
    quality: Number(quality.value) / 100,
    maxWidth: w > 0 ? w : null,
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Scale down in halves so big shrinks stay sharp instead of jagged.
function draw(img: HTMLImageElement, w: number, h: number, fill: string | null): HTMLCanvasElement {
  let cur: CanvasImageSource = img;
  let cw = img.naturalWidth;
  let ch = img.naturalHeight;
  while (cw / 2 >= w) {
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
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  x.imageSmoothingQuality = 'high';
  if (fill) {
    x.fillStyle = fill;
    x.fillRect(0, 0, w, h);
  }
  x.drawImage(cur, 0, 0, w, h);
  return c;
}

function encode(c: HTMLCanvasElement, s: Settings): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), `image/${s.format}`, s.format === 'png' ? undefined : s.quality),
  );
}

async function compress(item: Item, s: Settings): Promise<{ blob: Blob; w: number; h: number }> {
  const nw = item.img.naturalWidth;
  const nh = item.img.naturalHeight;
  const w = s.maxWidth && nw > s.maxWidth ? s.maxWidth : nw;
  const h = Math.max(1, Math.round((nh * w) / nw));
  // JPG has no transparency, so see-through parts become white instead of black.
  const canvas = draw(item.img, w, h, s.format === 'jpeg' ? '#ffffff' : null);
  return { blob: await encode(canvas, s), w, h };
}

function outName(item: Item, type: string, taken: Set<string>): string {
  const ext = type === 'image/webp' ? 'webp' : type === 'image/jpeg' ? 'jpg' : 'png';
  let name = `${item.base}.${ext}`;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${item.base}-${i}.${ext}`;
  taken.add(name.toLowerCase());
  return name;
}

function updateTotal() {
  const done = items.filter((i) => i.out);
  const before = done.reduce((n, i) => n + i.file.size, 0);
  const after = done.reduce((n, i) => n + i.out!.size, 0);
  if (!done.length) {
    total.textContent = '';
    return;
  }
  const pct = Math.round((1 - after / before) * 100);
  const word = pct >= 0 ? `${pct}% smaller` : `${-pct}% bigger`;
  total.textContent = `${done.length} ${done.length === 1 ? 'image' : 'images'}: ${formatBytes(before)} → ${formatBytes(after)} (${word})`;
  zipBtn.disabled = done.length !== items.length;
}

async function processAll() {
  const id = ++run;
  const s = settings();
  qualityWrap.classList.toggle('off', s.format === 'png');
  quality.disabled = s.format === 'png';
  qualityOut.textContent = s.format === 'png' ? 'n/a' : quality.value;
  zipBtn.disabled = true;
  let fellBack = false;
  const taken = new Set<string>();

  for (const item of items) {
    item.out = null;
    item.after.textContent = 'Working…';
    item.saved.textContent = '';
    item.saved.className = 'saved';
    item.link.hidden = true;
  }
  for (const item of items) {
    if (id !== run) return;
    try {
      const { blob, w, h } = await compress(item, s);
      if (id !== run) return;
      if (blob.type !== `image/${s.format}`) fellBack = true;
      item.out = blob;
      item.after.textContent = formatBytes(blob.size);
      item.dims.textContent = `${w}×${h}`;
      const pct = Math.round((1 - blob.size / item.file.size) * 100);
      item.saved.textContent = pct >= 0 ? `−${pct}%` : `+${-pct}%`;
      item.saved.classList.toggle('worse', pct < 0);
      if (item.link.href) URL.revokeObjectURL(item.link.href);
      item.link.href = URL.createObjectURL(blob);
      item.link.download = outName(item, blob.type, taken);
      item.link.hidden = false;
    } catch {
      item.after.textContent = 'Couldn’t convert';
    }
    updateTotal();
  }
  const notes: string[] = [];
  if (fellBack) {
    const f = EXT[s.format].toUpperCase();
    notes.push(`Your browser can’t save ${f} files, so these were saved as PNG. Try Chrome, Edge or Firefox for ${f}.`);
  }
  if (items.some((i) => i.out && i.out.size > i.file.size)) {
    notes.push('Some images came out bigger (marked in red). They were already well compressed: keep the original, or try WebP or a lower quality.');
  }
  note.textContent = notes.join(' ');
  note.hidden = !notes.length;
  updateTotal();
}

let timer = 0;
function schedule() {
  clearTimeout(timer);
  timer = window.setTimeout(processAll, 200);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load'));
    img.src = URL.createObjectURL(file);
  });
}

function makeRow(file: File, img: HTMLImageElement): Item {
  const row = document.createElement('li');
  const thumb = img.cloneNode() as HTMLImageElement;
  thumb.alt = '';
  thumb.className = 'thumb';
  const info = document.createElement('div');
  info.className = 'info';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = file.name;
  name.title = file.name;
  const sizes = document.createElement('span');
  sizes.className = 'sizes';
  const before = document.createElement('span');
  before.textContent = formatBytes(file.size);
  const arrow = document.createTextNode(' → ');
  const after = document.createElement('span');
  after.className = 'after';
  const saved = document.createElement('span');
  saved.className = 'saved';
  sizes.append(before, arrow, after, ' ', saved);
  const dims = document.createElement('span');
  dims.className = 'dims';
  info.append(name, sizes, dims);
  const link = document.createElement('a');
  link.className = 'dl';
  link.textContent = 'Download';
  link.hidden = true;
  row.append(thumb, info, link);
  return { file, img, base: file.name.replace(/\.[^.]+$/, '') || 'image', out: null, row, after, saved, dims, link };
}

async function add(files: File[]) {
  error.hidden = true;
  const images = files.filter((f) => f.type.startsWith('image/'));
  const skipped = files.length - images.length;
  const room = MAX_FILES - items.length;
  const take = images.slice(0, Math.max(0, room));
  const problems: string[] = [];
  if (skipped) problems.push(`${skipped} ${skipped === 1 ? 'file wasn’t an image' : 'files weren’t images'}`);
  if (images.length > take.length) problems.push(`only ${MAX_FILES} images at a time, so ${images.length - take.length} were left out`);

  for (const file of take) {
    try {
      const img = await loadImage(file);
      const item = makeRow(file, img);
      items.push(item);
      list.append(item.row);
    } catch {
      problems.push(`we couldn’t read ${file.name}`);
    }
  }
  if (problems.length) {
    const msg = problems.join('; ');
    error.textContent = msg.charAt(0).toUpperCase() + msg.slice(1) + '.';
    error.hidden = false;
  }
  if (items.length) {
    result.hidden = false;
    schedule();
  }
}

fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) add([...fileInput.files]);
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
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) add(files);
});
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length) add(files);
});
format.addEventListener('input', schedule);
quality.addEventListener('input', () => {
  qualityOut.textContent = quality.value;
  schedule();
});
maxWidth.addEventListener('input', schedule);

zipBtn.addEventListener('click', async () => {
  if (!items.every((i) => i.out)) return;
  zipBtn.disabled = true;
  try {
    const entries: ZipEntry[] = [];
    for (const i of items) entries.push({ name: i.link.download, data: new Uint8Array(await i.out!.arrayBuffer()) });
    const blob = new Blob([makeZip(entries)], { type: 'application/zip' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'compressed-images.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } finally {
    zipBtn.disabled = false;
  }
});

clear.addEventListener('click', () => {
  run++;
  for (const i of items) {
    URL.revokeObjectURL(i.img.src);
    if (i.link.href) URL.revokeObjectURL(i.link.href);
  }
  items = [];
  list.replaceChildren();
  total.textContent = '';
  note.hidden = true;
  error.hidden = true;
  result.hidden = true;
});
