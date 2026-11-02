// Asset extractor: asks /api/assets which pictures a page uses, shows each one, and fetches the
// files through /api/asset (other sites' files can't be read straight from the browser) so it can
// show their size and put them in a ZIP.
import { makeZip, type ZipEntry } from './zip';

type Kind = 'image' | 'svg' | 'icon' | 'background' | 'share';
type Asset = { url: string; kind: Kind; type: string; width?: number; height?: number; alt?: string; where: string };
type InlineSvg = { markup: string; width?: number; height?: number; label?: string };
type Result = { url: string; finalUrl: string; status: number; assets: Asset[]; svgs: InlineSvg[]; sheets: number; sheetsFailed: number; capped: boolean; error?: string };

// One entry per picture on screen, inline SVGs included.
type Item = {
  kind: Kind;
  name: string;
  type: string;
  where: string;
  url: string | null; // the original address (null for inline SVGs)
  width?: number;
  height?: number;
  blob?: Blob; // the file, once fetched or built
  failed?: string; // why the file couldn't be fetched
  loading?: Promise<void>;
  card?: HTMLElement;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('ax-form');
const input = $<HTMLInputElement>('ax-url');
const button = $<HTMLButtonElement>('ax-go');
const error = $<HTMLParagraphElement>('ax-error');
const out = $<HTMLDivElement>('ax-out');
const summary = $<HTMLParagraphElement>('ax-summary');
const zipBtn = $<HTMLButtonElement>('ax-zip');
const filters = $<HTMLDivElement>('ax-filters');
const status = $<HTMLParagraphElement>('ax-status');
const grid = $<HTMLDivElement>('ax-grid');
const note = $<HTMLParagraphElement>('ax-note');

const MAX_FILE = 5_000_000;
const MAX_ZIP = 25_000_000;
const PARALLEL = 6;

const LABELS: Record<Kind | 'all', string> = { all: 'All', image: 'Images', svg: 'SVG', icon: 'Icons', background: 'Backgrounds', share: 'Share image' };
const FOLDERS: Record<Kind, string> = { image: 'images', svg: 'svg', icon: 'icons', background: 'backgrounds', share: 'share' };
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/bmp': 'bmp', 'image/tiff': 'tiff', 'image/apng': 'png' };

let items: Item[] = [];
let filter: Kind | 'all' = 'all';
let site = '';
let run = 0; // bumps on every new search so old fetches stop updating the page
const urls: string[] = []; // object URLs to free on the next search

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

const kb = (n: number) => (n < 1000 ? `${n} B` : n < 1_000_000 ? `${Math.round(n / 1000)} KB` : `${(n / 1_000_000).toFixed(1)} MB`);

function fileName(url: string): string {
  if (url.startsWith('data:')) return 'embedded';
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '') || u.hostname;
    return last.slice(0, 80);
  } catch {
    return 'image';
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function dataBlob(url: string): Blob | null {
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const head = url.slice(5, comma);
  const type = head.split(';')[0] || 'image/png';
  const body = url.slice(comma + 1);
  try {
    if (/;base64/i.test(head)) {
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type });
    }
    return new Blob([decodeURIComponent(body)], { type });
  } catch {
    return null;
  }
}

function toItems(r: Result): Item[] {
  const list: Item[] = r.assets.map((a) => {
    const it: Item = { kind: a.kind, name: fileName(a.url), type: a.type, where: a.where, url: a.url, width: a.width, height: a.height };
    if (a.url.startsWith('data:')) {
      const b = dataBlob(a.url);
      if (b) it.blob = b;
      else it.failed = 'Couldn’t read this embedded picture.';
      it.url = null;
      it.name = `embedded.${a.type}`;
    }
    return it;
  });
  r.svgs.forEach((s, i) => {
    list.push({
      kind: 'svg',
      name: `${s.label ? slug(s.label) || 'inline' : 'inline'}-${i + 1}.svg`,
      type: 'svg',
      where: 'Drawn in the page',
      url: null,
      width: s.width,
      height: s.height,
      blob: new Blob([s.markup], { type: 'image/svg+xml' }),
    });
  });
  return list;
}

// Fetches one file through our Worker, at most PARALLEL at a time.
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= PARALLEL) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function load(it: Item, mine: number): Promise<void> {
  if (it.blob || it.failed || !it.url) return Promise.resolve();
  it.loading ??= slot(async () => {
    if (mine !== run) return;
    try {
      const res = await fetch(`/api/asset?url=${encodeURIComponent(it.url!)}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        it.failed = data.error ?? 'Couldn’t fetch this file.';
        return;
      }
      it.blob = await res.blob();
    } catch {
      it.failed = 'Couldn’t fetch this file.';
    }
  }).then(() => {
    if (mine === run && it.card) fill(it);
  });
  return it.loading;
}

function card(it: Item): HTMLElement {
  const box = el('article', 'card');
  const thumb = el('div', 'thumb');
  const body = el('div', 'body');
  const name = el('p', 'name', it.name);
  name.title = it.url ?? it.name;
  body.append(name, el('p', 'meta'), el('p', 'where', it.where), el('div', 'actions'));
  box.append(thumb, body);
  it.card = box;
  fill(it);
  return box;
}

// Draws (or redraws) a card from what we know so far.
function fill(it: Item) {
  const box = it.card!;
  const thumb = box.querySelector('.thumb') as HTMLElement;
  const meta = box.querySelector('.meta') as HTMLElement;
  const actions = box.querySelector('.actions') as HTMLElement;

  if (it.blob && !thumb.querySelector('img[data-blob]')) {
    const img = el('img');
    img.dataset.blob = '1';
    img.alt = '';
    img.decoding = 'async';
    const src = URL.createObjectURL(it.blob);
    urls.push(src);
    if (it.blob.type === 'image/svg+xml' && !it.width) svgSize(it).then(() => (meta.textContent = metaText(it)));
    img.onload = () => {
      // Browsers report 150×150 for an SVG with no size, so SVG sizes come from the file instead.
      if (img.naturalWidth && it.blob?.type !== 'image/svg+xml' && it.type !== 'svg') {
        it.width = img.naturalWidth;
        it.height = img.naturalHeight;
      }
      meta.textContent = metaText(it);
    };
    img.src = src;
    thumb.replaceChildren(img);
  } else if (!it.blob && it.failed && it.url?.startsWith('https:') && !thumb.querySelector('img')) {
    // Our copy failed; the browser may still be allowed to show the original.
    const img = el('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.loading = 'lazy';
    img.onload = () => {
      it.width ??= img.naturalWidth || undefined;
      it.height ??= img.naturalHeight || undefined;
      meta.textContent = metaText(it);
    };
    img.onerror = () => thumb.replaceChildren(el('span', 'broken', 'No preview'));
    img.src = it.url;
    thumb.replaceChildren(img);
  } else if (!it.blob && !it.failed && !thumb.childElementCount) {
    thumb.append(el('span', 'broken', 'Loading…'));
  } else if (!it.blob && it.failed && !thumb.querySelector('img')) {
    thumb.replaceChildren(el('span', 'broken', 'No preview'));
  }

  meta.textContent = metaText(it);

  const buttons: HTMLElement[] = [];
  if (it.blob) {
    const dl = el('button', '', 'Download');
    dl.type = 'button';
    dl.addEventListener('click', () => save(it.blob!, downloadName(it)));
    buttons.push(dl);
  } else if (it.url && it.failed) {
    const open = el('a', '', 'Open');
    open.href = it.url;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.title = it.failed;
    buttons.push(open);
  }
  if (it.url) {
    const copy = el('button', '', 'Copy link');
    copy.type = 'button';
    copy.addEventListener('click', () => copyText(it.url!, copy, 'Copy link'));
    buttons.push(copy);
  } else if (it.type === 'svg' && it.blob) {
    const copy = el('button', '', 'Copy SVG code');
    copy.type = 'button';
    copy.addEventListener('click', async () => copyText(await it.blob!.text(), copy, 'Copy SVG code'));
    buttons.push(copy);
  }
  actions.replaceChildren(...buttons);
}

// Width and height of an SVG file from its width/height or viewBox.
async function svgSize(it: Item) {
  const open = (await it.blob!.text()).match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const get = (n: string) => parseFloat(open.match(new RegExp(`\\s${n}\\s*=\\s*["']?([\\d.]+)(px)?["'\\s>]`, 'i'))?.[1] ?? '');
  const vb = (open.match(/\sviewBox\s*=\s*["']([^"']+)["']/i)?.[1] ?? '').trim().split(/[\s,]+/).map(Number);
  const w = get('width') || (vb.length === 4 ? vb[2] : 0);
  const h = get('height') || (vb.length === 4 ? vb[3] : 0);
  if (w > 0 && h > 0) {
    it.width = Math.round(w);
    it.height = Math.round(h);
  }
}

function metaText(it: Item): string {
  const parts = [extOf(it).toUpperCase()];
  if (it.width && it.height) parts.push(`${it.width}×${it.height}`);
  if (it.blob) parts.push(kb(it.blob.size));
  else if (it.failed) parts.push(/5 MB/.test(it.failed) ? 'over 5 MB' : 'size unknown');
  return parts.join(' · ');
}

function extOf(it: Item): string {
  return (it.blob && EXT[it.blob.type]) || (it.type === 'image' ? 'img' : it.type);
}

function downloadName(it: Item): string {
  const ext = extOf(it);
  const base = it.name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\\/:*?"<>|]+/g, '-') || 'image';
  return `${base}.${ext === 'img' ? 'png' : ext}`;
}

function save(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function copyText(text: string, btn: HTMLButtonElement, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.textContent = label), 1500);
}

const shown = () => items.filter((it) => filter === 'all' || it.kind === filter);

function drawFilters() {
  const kinds: (Kind | 'all')[] = ['all', 'image', 'svg', 'icon', 'background', 'share'];
  filters.replaceChildren(
    ...kinds
      .map((k) => ({ k, n: k === 'all' ? items.length : items.filter((it) => it.kind === k).length }))
      .filter(({ n }) => n > 0)
      .map(({ k, n }) => {
        const b = el('button', '', `${LABELS[k]} (${n})`);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(k === filter));
        b.addEventListener('click', () => {
          filter = k;
          drawFilters();
          drawGrid();
        });
        return b;
      }),
  );
  filters.hidden = items.length === 0;
}

// Only fetch the files people can see; the rest wait until they scroll or press "Download all".
const seen = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      const it = items.find((i) => i.card === e.target);
      if (it) load(it, run);
    }
  },
  { rootMargin: '400px' },
);

function drawGrid() {
  const list = shown();
  grid.replaceChildren(...list.map((it) => it.card ?? card(it)));
  for (const it of list) if (it.url && !it.blob && !it.failed) seen.observe(it.card!);
  zipBtn.textContent = filter === 'all' ? 'Download all as ZIP' : `Download ${LABELS[filter].toLowerCase()} as ZIP`;
  zipBtn.hidden = list.length === 0;
}

function render(r: Result) {
  site = host(r.finalUrl);
  items = toItems(r);
  filter = 'all';
  const n = items.length;
  summary.textContent = n ? `${site} uses ${n}${r.capped ? '+' : ''} picture${n === 1 ? '' : 's'}.` : `We couldn’t find any pictures on ${site}.`;
  drawFilters();
  drawGrid();
  status.hidden = true;
  const problems: string[] = [];
  if (r.status >= 400) problems.push(`The page answered with error ${r.status}, so this may not be the real page.`);
  if (r.capped) problems.push('We list the first 200 pictures.');
  if (r.sheetsFailed) problems.push(`${r.sheetsFailed} stylesheet${r.sheetsFailed === 1 ? '' : 's'} couldn’t be read, so some backgrounds may be missing.`);
  if (!n) problems.push('The site may add its pictures with JavaScript, or block automated visits. Try another page on the same site.');
  note.textContent = problems.join(' ');
  note.hidden = !problems.length;
}

zipBtn.addEventListener('click', async () => {
  const list = shown();
  const mine = run;
  zipBtn.disabled = true;
  let done = 0;
  status.hidden = false;
  status.textContent = `Getting ${list.length} file${list.length === 1 ? '' : 's'}…`;
  await Promise.all(
    list.map((it) =>
      load(it, mine).then(() => {
        done++;
        if (mine === run) status.textContent = `Getting files… ${done} of ${list.length}`;
      }),
    ),
  );
  if (mine !== run) return;

  const entries: ZipEntry[] = [];
  const used = new Set<string>();
  const skipped: string[] = [];
  let total = 0;
  for (const it of list) {
    if (!it.blob) {
      skipped.push(it.name);
      continue;
    }
    if (it.blob.size > MAX_FILE || total + it.blob.size > MAX_ZIP) {
      skipped.push(it.name);
      continue;
    }
    let name = `${FOLDERS[it.kind]}/${downloadName(it)}`;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${FOLDERS[it.kind]}/${downloadName(it).replace(/(\.[a-z0-9]+)$/i, `-${i}$1`)}`;
    used.add(name.toLowerCase());
    entries.push({ name, data: new Uint8Array(await it.blob.arrayBuffer()) });
    total += it.blob.size;
  }

  if (entries.length) save(new Blob([makeZip(entries) as BlobPart], { type: 'application/zip' }), `${slug(site) || 'site'}-${filter === 'all' ? 'assets' : FOLDERS[filter as Kind]}.zip`);
  status.textContent = entries.length
    ? `Saved ${entries.length} file${entries.length === 1 ? '' : 's'} (${kb(total)}).${skipped.length ? ` Skipped ${skipped.length} we couldn’t fetch or that went over the 25 MB limit. Use “Open” on those to get them from the site.` : ''}`
    : 'We couldn’t fetch any of these files. The site may block downloads from other places. Use “Open” on each one instead.';
  zipBtn.disabled = false;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  run++;
  seen.disconnect();
  for (const u of urls.splice(0)) URL.revokeObjectURL(u);
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Looking…';
  try {
    const res = await fetch(`/api/assets?url=${encodeURIComponent(url)}`);
    const data: Result = await res.json().catch(() => ({ error: 'Something went wrong. Try again.' }) as Result);
    if (!res.ok || data.error) throw new Error(data.error ?? 'Something went wrong. Try again.');
    out.hidden = false;
    render(data);
    history.replaceState(null, '', `?url=${encodeURIComponent(url)}`);
  } catch (err) {
    error.textContent = (err as Error).message;
    error.hidden = false;
    out.hidden = true;
  } finally {
    button.disabled = false;
    button.textContent = 'Find images';
  }
});

// Shared links like /tools/asset-extractor/?url=stripe.com run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
