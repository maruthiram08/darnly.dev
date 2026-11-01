// Favicon generator: everything runs in the visitor's browser. Nothing is uploaded.
import { makeZip, type ZipEntry } from './zip';
import { makeIco } from './ico';

type Shape = 'square' | 'rounded' | 'circle';
type Options = { background: string | null; padding: number; shape: Shape };

const OUTPUTS = [
  { file: 'favicon-16x16.png', size: 16 },
  { file: 'favicon-32x32.png', size: 32 },
  { file: 'favicon-48x48.png', size: 48 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'android-chrome-192x192.png', size: 192 },
  { file: 'android-chrome-512x512.png', size: 512 },
] as const;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>('fg-file');
const drop = $<HTMLLabelElement>('fg-drop');
const dropText = $<HTMLSpanElement>('fg-drop-text');
const result = $<HTMLDivElement>('fg-result');
const error = $<HTMLParagraphElement>('fg-error');
const bgOn = $<HTMLInputElement>('fg-bg-on');
const bgColor = $<HTMLInputElement>('fg-bg');
const padding = $<HTMLInputElement>('fg-pad');
const shape = $<HTMLSelectElement>('fg-shape');
const siteName = $<HTMLInputElement>('fg-name');
const previews = $<HTMLDivElement>('fg-previews');
const tabIcon = $<HTMLImageElement>('fg-tab-icon');
const tabTitle = $<HTMLSpanElement>('fg-tab-title');
const download = $<HTMLButtonElement>('fg-download');
const html = $<HTMLElement>('fg-html');
const copy = $<HTMLButtonElement>('fg-copy');

let source: HTMLImageElement | null = null;
let sourceName = 'icon';

function options(): Options {
  return {
    background: bgOn.checked ? bgColor.value : null,
    padding: Number(padding.value) / 100,
    shape: shape.value as Shape,
  };
}

// Scale down in halves so small sizes stay sharp instead of jagged.
function scaled(img: CanvasImageSource, w: number, h: number, target: number): HTMLCanvasElement | CanvasImageSource {
  let cur: CanvasImageSource = img;
  let cw = w;
  let ch = h;
  while (Math.max(cw, ch) / 2 >= target) {
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
  return cur;
}

function render(img: HTMLImageElement, size: number, o: Options): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const x = c.getContext('2d')!;
  x.imageSmoothingQuality = 'high';

  if (o.shape !== 'square') {
    const r = o.shape === 'circle' ? size / 2 : size * 0.2;
    x.beginPath();
    x.roundRect(0, 0, size, size, r);
    x.clip();
  }
  if (o.background) {
    x.fillStyle = o.background;
    x.fillRect(0, 0, size, size);
  }

  const w = img.naturalWidth || 512;
  const h = img.naturalHeight || 512;
  const box = size * (1 - 2 * o.padding);
  const k = Math.min(box / w, box / h);
  const dw = w * k;
  const dh = h * k;
  const src = img.naturalWidth ? scaled(img, w, h, Math.max(dw, dh)) : img;
  x.drawImage(src, (size - dw) / 2, (size - dh) / 2, dw, dh);
  return c;
}

const toPng = (c: HTMLCanvasElement) =>
  new Promise<Uint8Array>((resolve, reject) =>
    c.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error('png'))), 'image/png'),
  );

function snippet(): string {
  return [
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
  ].join('\n');
}

function manifest(name: string, bg: string | null): string {
  return JSON.stringify(
    {
      name,
      short_name: name,
      icons: [
        { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
      theme_color: bg ?? '#ffffff',
      background_color: bg ?? '#ffffff',
      display: 'standalone',
    },
    null,
    2,
  );
}

function refresh() {
  if (!source) return;
  const o = options();
  bgColor.disabled = !bgOn.checked;
  previews.replaceChildren(
    ...OUTPUTS.map(({ size }) => {
      const fig = document.createElement('figure');
      const c = render(source!, size, o);
      const shown = Math.min(size, 96);
      c.style.width = `${shown}px`;
      c.style.height = `${shown}px`;
      if (size <= 48) c.style.imageRendering = 'pixelated';
      const cap = document.createElement('figcaption');
      cap.textContent = `${size}×${size}`;
      fig.append(c, cap);
      return fig;
    }),
  );
  tabIcon.src = render(source, 32, o).toDataURL('image/png');
  tabTitle.textContent = siteName.value.trim() || 'My site';
}

function load(file: File) {
  error.hidden = true;
  if (!file.type.startsWith('image/')) {
    error.textContent = 'That file isn’t an image. Try a PNG, JPG, SVG or WebP.';
    error.hidden = false;
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    source = img;
    sourceName = file.name.replace(/\.[^.]+$/, '') || 'icon';
    dropText.textContent = `${file.name} · choose another`;
    result.hidden = false;
    refresh();
  };
  img.onerror = () => {
    error.textContent = 'We couldn’t read that image. Try saving it as a PNG first.';
    error.hidden = false;
  };
  img.src = url;
}

async function buildZip(): Promise<Blob> {
  const o = options();
  const entries: ZipEntry[] = [];
  const pngs = new Map<number, Uint8Array>();
  for (const { file, size } of OUTPUTS) {
    const png = await toPng(render(source!, size, o));
    pngs.set(size, png);
    entries.push({ name: file, data: png });
  }
  const ico = makeIco([16, 32, 48].map((size) => ({ size, png: pngs.get(size)! })));
  const enc = new TextEncoder();
  entries.unshift({ name: 'favicon.ico', data: ico });
  entries.push({ name: 'site.webmanifest', data: enc.encode(manifest(siteName.value.trim() || 'My site', o.background)) });
  entries.push({ name: 'add-to-head.html', data: enc.encode(snippet() + '\n') });
  return new Blob([makeZip(entries)], { type: 'application/zip' });
}

fileInput.addEventListener('change', () => fileInput.files?.[0] && load(fileInput.files[0]));
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
document.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
  if (f) load(f);
});
for (const el of [bgOn, bgColor, padding, shape, siteName]) el.addEventListener('input', refresh);

download.addEventListener('click', async () => {
  if (!source) return;
  download.disabled = true;
  try {
    const blob = await buildZip();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${sourceName}-favicons.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } finally {
    download.disabled = false;
  }
});

html.textContent = snippet();
copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(snippet());
  copy.textContent = 'Copied';
  setTimeout(() => (copy.textContent = 'Copy'), 1500);
});
