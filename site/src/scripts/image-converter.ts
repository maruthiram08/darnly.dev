// Image converter: everything runs in the visitor's browser with a canvas. Nothing is uploaded.
import { makeZip, type ZipEntry } from './zip';

type Format = 'image/png' | 'image/jpeg' | 'image/webp';
const EXT: Record<Format, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const LABEL: Record<Format, string> = { 'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/webp': 'WebP' };
const MAX_FILES = 50;
const MAX_SIDE = 8192; // keeps the canvas inside every browser's limit
const SVG_DEFAULT = 1024; // size for SVGs that don't say how big they are

type Item = {
  file: File;
  img: HTMLImageElement;
  w: number;
  h: number;
  out?: { blob: Blob; name: string; w: number; h: number; url: string };
  svg: boolean;
  row: HTMLLIElement;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>('ic-file');
const drop = $<HTMLLabelElement>('ic-drop');
const dropText = $<HTMLSpanElement>('ic-drop-text');
const error = $<HTMLParagraphElement>('ic-error');
const result = $<HTMLDivElement>('ic-result');
const formatRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="ic-format"]')];
const quality = $<HTMLInputElement>('ic-quality');
const qualityWrap = $<HTMLLabelElement>('ic-quality-wrap');
const qualityOut = $<HTMLOutputElement>('ic-quality-out');
const bg = $<HTMLInputElement>('ic-bg');
const bgWrap = $<HTMLLabelElement>('ic-bg-wrap');
const width = $<HTMLInputElement>('ic-width');
const list = $<HTMLUListElement>('ic-list');
const note = $<HTMLParagraphElement>('ic-note');
const zipBtn = $<HTMLButtonElement>('ic-zip');
const clearBtn = $<HTMLButtonElement>('ic-clear');

let items: Item[] = [];
let run = 0;

const format = (): Format => (formatRadios.find((r) => r.checked)?.value as Format) ?? 'image/png';

function kb(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}\u00a0KB` : `${(n / 1024 / 1024).toFixed(1)}\u00a0MB`;
}

function showError(msg: string) {
  error.textContent = msg;
  error.hidden = false;
}

// Output size: an optional width. Photos are never blown up past their own size; SVGs can be, since they stay sharp.
function targetSize(w: number, h: number, svg: boolean): [number, number] {
  const want = Number(width.value);
  let k = want > 0 && (svg || want < w) ? want / w : 1;
  const side = Math.max(w * k, h * k);
  if (side > MAX_SIDE) k *= MAX_SIDE / side;
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

// Scale down in halves so big reductions stay sharp.
function draw(img: HTMLImageElement, w: number, h: number, tw: number, th: number, fill: string | null): HTMLCanvasElement {
  let cur: CanvasImageSource = img;
  let cw = w;
  let ch = h;
  while (cw / 2 >= tw && ch / 2 >= th) {
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
  c.width = tw;
  c.height = th;
  const x = c.getContext('2d')!;
  x.imageSmoothingQuality = 'high';
  if (fill) {
    x.fillStyle = fill;
    x.fillRect(0, 0, tw, th);
  }
  x.drawImage(cur, 0, 0, tw, th);
  return c;
}

const toBlob = (c: HTMLCanvasElement, type: Format, q: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), type, q));

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '') || 'image';
}

function row(item: Item, text: string, extra?: Node) {
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = item.file.name;
  const info = document.createElement('span');
  info.className = 'info';
  info.textContent = text;
  item.row.replaceChildren(name, info, ...(extra ? [extra] : []));
}

async function convertAll() {
  const id = ++run;
  const type = format();
  const q = Number(quality.value) / 100;
  const fill = type === 'image/jpeg' ? bg.value : null;
  qualityWrap.hidden = type === 'image/png';
  bgWrap.hidden = type !== 'image/jpeg';
  qualityOut.textContent = quality.value;
  zipBtn.disabled = true;
  let fellBack = false;

  for (const item of items) {
    if (id !== run) return; // settings changed; a newer run takes over
    const [tw, th] = targetSize(item.w, item.h, item.svg);
    row(item, 'Converting…');
    try {
      const blob = await toBlob(draw(item.img, item.w, item.h, tw, th, fill), type, q);
      if (id !== run) return;
      // Safari can't make WebP and quietly hands back a PNG instead.
      const got = (blob.type in EXT ? blob.type : 'image/png') as Format;
      if (got !== type) fellBack = true;
      if (item.out) URL.revokeObjectURL(item.out.url);
      const name = `${baseName(item.file.name)}.${EXT[got]}`;
      item.out = { blob, name, w: tw, h: th, url: URL.createObjectURL(blob) };
      const a = document.createElement('a');
      a.href = item.out.url;
      a.download = name;
      a.className = 'dl';
      a.textContent = `Download ${LABEL[got]}`;
      const change = blob.size - item.file.size;
      const pct = item.file.size ? Math.round((Math.abs(change) / item.file.size) * 100) : 0;
      const times = item.file.size ? blob.size / item.file.size : 1;
      const trend =
        times >= 2 ? `${times < 10 ? times.toFixed(1) : Math.round(times)}× bigger` : change < 0 ? `${pct}% smaller` : change > 0 ? `${pct}% bigger` : 'same size';
      row(item, `${tw}×${th} · ${kb(item.file.size)} → ${kb(blob.size)} (${trend})`, a);
    } catch {
      item.out = undefined;
      row(item, 'Couldn’t convert this one. Try a smaller width.');
    }
  }
  if (id !== run) return;
  note.hidden = !fellBack;
  note.textContent = fellBack ? 'Your browser can’t save WebP, so you got PNG instead. Chrome, Edge and Firefox can save WebP.' : '';
  const done = items.filter((i) => i.out);
  zipBtn.hidden = done.length < 2;
  zipBtn.disabled = false;
  zipBtn.textContent = `Download all ${done.length} (ZIP)`;
}

// An SVG's own size. Browsers guess 300×150 when the SVG leaves out width and height, so use its viewBox shape instead.
async function svgBox(file: File): Promise<[number, number] | null> {
  const root = (await file.text()).match(/<svg\b[^>]*>/i)?.[0] ?? '';
  if (/\swidth\s*=/i.test(root) && /\sheight\s*=/i.test(root)) return null;
  const m = root.match(/viewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)/i);
  const w = m ? Number(m[1]) : 0;
  const h = m ? Number(m[2]) : 0;
  if (!(w > 0 && h > 0)) return null;
  const k = SVG_DEFAULT / Math.max(w, h);
  return [Math.round(w * k), Math.round(h * k)];
}

async function decode(file: File): Promise<Item | null> {
  const svg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  const box = svg ? await svgBox(file).catch(() => null) : null;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let [w, h] = box ?? [img.naturalWidth, img.naturalHeight];
      if (!w || !h) [w, h] = [SVG_DEFAULT, SVG_DEFAULT];
      const li = document.createElement('li');
      resolve({ file, img, w, h, svg, row: li });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

const isImage = (f: File) => f.type.startsWith('image/') || /\.(avif|webp|png|jpe?g|svg|gif|bmp)$/i.test(f.name);

async function add(files: File[]) {
  error.hidden = true;
  const images = files.filter(isImage);
  if (!images.length) {
    showError('That file isn’t an image. Try WebP, AVIF, PNG, JPG or SVG.');
    return;
  }
  const room = MAX_FILES - items.length;
  const take = images.slice(0, Math.max(0, room));
  const decoded = await Promise.all(take.map(decode));
  const bad = decoded.filter((d) => !d).length;
  const good = decoded.filter((d): d is Item => !!d);
  items.push(...good);
  list.append(...good.map((i) => i.row));
  const problems: string[] = [];
  if (bad) problems.push(`${bad} file${bad > 1 ? 's' : ''} couldn’t be read by your browser (some browsers can’t open AVIF or HEIC).`);
  if (images.length > take.length) problems.push(`Only the first ${MAX_FILES} images are kept.`);
  if (problems.length) showError(problems.join(' '));
  if (!items.length) return;
  result.hidden = false;
  dropText.textContent = `${items.length} image${items.length > 1 ? 's' : ''} added · add more`;
  convertAll();
}

function clear() {
  run++;
  for (const i of items) {
    URL.revokeObjectURL(i.img.src);
    if (i.out) URL.revokeObjectURL(i.out.url);
  }
  items = [];
  list.replaceChildren();
  result.hidden = true;
  error.hidden = true;
  fileInput.value = '';
  dropText.textContent = 'or click to choose files. You can also paste an image.';
}

fileInput.addEventListener('change', () => {
  const files = [...(fileInput.files ?? [])];
  fileInput.value = '';
  if (files.length) add(files);
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
  const files = [...(e.clipboardData?.files ?? [])].filter(isImage);
  if (files.length) add(files);
});

// Start on the format named in the address, e.g. /tools/image-converter/?to=jpg
const to = new URLSearchParams(location.search).get('to');
const start = formatRadios.find((r) => EXT[r.value as Format] === to || (to === 'jpeg' && r.value === 'image/jpeg'));
if (start) start.checked = true;
qualityWrap.hidden = format() === 'image/png';
bgWrap.hidden = format() !== 'image/jpeg';

for (const r of formatRadios) r.addEventListener('change', () => items.length && convertAll());
quality.addEventListener('input', () => (qualityOut.textContent = quality.value));
for (const el of [quality, bg]) el.addEventListener('change', () => items.length && convertAll());
let typing = 0;
width.addEventListener('input', () => {
  clearTimeout(typing);
  typing = window.setTimeout(() => items.length && convertAll(), 400);
});
clearBtn.addEventListener('click', clear);

zipBtn.addEventListener('click', async () => {
  const done = items.filter((i) => i.out);
  if (!done.length) return;
  zipBtn.disabled = true;
  try {
    const used = new Map<string, number>();
    const entries: ZipEntry[] = [];
    for (const i of done) {
      let name = i.out!.name;
      const n = used.get(name) ?? 0;
      used.set(name, n + 1);
      if (n) name = name.replace(/(\.[^.]+)$/, `-${n + 1}$1`);
      entries.push({ name, data: new Uint8Array(await i.out!.blob.arrayBuffer()) });
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([makeZip(entries) as BlobPart], { type: 'application/zip' }));
    a.download = 'converted-images.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } finally {
    zipBtn.disabled = false;
  }
});
