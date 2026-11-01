// App icon generator: iOS, Android and Expo icons from one image. Everything runs in the browser.
import { makeZip, crc32, concat, type ZipEntry } from './zip';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>('ai-file');
const drop = $<HTMLLabelElement>('ai-drop');
const dropText = $<HTMLSpanElement>('ai-drop-text');
const result = $<HTMLDivElement>('ai-result');
const error = $<HTMLParagraphElement>('ai-error');
const warn = $<HTMLParagraphElement>('ai-warn');
const bgColor = $<HTMLInputElement>('ai-bg');
const padding = $<HTMLInputElement>('ai-pad');
const previews = $<HTMLDivElement>('ai-previews');
const download = $<HTMLButtonElement>('ai-download');
const promptBtn = $<HTMLButtonElement>('ai-prompt');
const appJson = $<HTMLElement>('ai-appjson');
const copyJson = $<HTMLButtonElement>('ai-copy');

let source: HTMLImageElement | null = null;
let sourceName = 'app';

// iOS AppIcon set: [idiom, point size, scale]. Xcode accepts the classic full list.
const IOS: [string, number, number][] = [
  ['iphone', 20, 2], ['iphone', 20, 3], ['iphone', 29, 2], ['iphone', 29, 3],
  ['iphone', 40, 2], ['iphone', 40, 3], ['iphone', 60, 2], ['iphone', 60, 3],
  ['ipad', 20, 1], ['ipad', 20, 2], ['ipad', 29, 1], ['ipad', 29, 2],
  ['ipad', 40, 1], ['ipad', 40, 2], ['ipad', 76, 1], ['ipad', 76, 2], ['ipad', 83.5, 2],
  ['ios-marketing', 1024, 1],
];

// Android densities: legacy launcher icon is 48dp, adaptive layers are 108dp.
const ANDROID: [string, number][] = [
  ['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4],
];

// Adaptive icons: launchers crop the 108dp layer to as little as a 66dp circle, so the logo stays inside that.
const SAFE = 66 / 108;

type Mask = 'none' | 'ios' | 'circle' | 'squircle';
type Layer = { bg: boolean; fg: boolean; scale: number; mask: Mask };

// Scale down in halves so small sizes stay sharp instead of jagged (same approach as the favicon tool).
function scaled(img: CanvasImageSource, w: number, h: number, target: number): CanvasImageSource {
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

function maskPath(x: CanvasRenderingContext2D, size: number, mask: Mask) {
  x.beginPath();
  if (mask === 'circle') {
    x.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  } else if (mask === 'ios') {
    x.roundRect(0, 0, size, size, size * 0.2237);
  } else if (mask === 'squircle') {
    // Superellipse, close to the "squircle" shape many Android launchers use.
    const r = size / 2;
    const n = 4;
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const px = r + r * Math.sign(c) * Math.abs(c) ** (2 / n);
      const py = r + r * Math.sign(s) * Math.abs(s) ** (2 / n);
      if (i === 0) x.moveTo(px, py);
      else x.lineTo(px, py);
    }
    x.closePath();
  }
  x.clip();
}

function render(size: number, l: Layer): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const x = c.getContext('2d')!;
  x.imageSmoothingQuality = 'high';
  if (l.mask !== 'none') maskPath(x, size, l.mask);
  if (l.bg) {
    x.fillStyle = bgColor.value;
    x.fillRect(0, 0, size, size);
  }
  if (l.fg && source) {
    const w = source.naturalWidth || 1024;
    const h = source.naturalHeight || 1024;
    const box = size * l.scale * (1 - (2 * Number(padding.value)) / 100);
    const k = Math.min(box / w, box / h);
    const dw = w * k;
    const dh = h * k;
    const src = source.naturalWidth ? scaled(source, w, h, Math.max(dw, dh)) : source;
    x.drawImage(src, (size - dw) / 2, (size - dh) / 2, dw, dh);
  }
  return c;
}

const FULL = (mask: Mask = 'none'): Layer => ({ bg: true, fg: true, scale: 1, mask });
const ADAPTIVE = (mask: Mask): Layer => ({ bg: true, fg: true, scale: SAFE, mask });

const toPng = (c: HTMLCanvasElement) =>
  new Promise<Uint8Array>((resolve, reject) =>
    c.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error('png'))), 'image/png'),
  );

// Apple rejects App Store icons that have an alpha channel at all, and canvas PNGs always have one.
// So opaque icons are written as plain RGB PNGs here.
async function toRgbPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const { width: w, height: h } = c;
  const px = c.getContext('2d')!.getImageData(0, 0, w, h).data;
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0, o = 0; y < h; y++) {
    raw[o++] = 0; // no filter
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[o++] = px[i];
      raw[o++] = px[i + 1];
      raw[o++] = px[i + 2];
    }
  }
  const zlib = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

const fmt = (n: number) => String(n);
const iosFile = (px: number) => `icon-${px}.png`;

function contentsJson(): string {
  return JSON.stringify(
    {
      images: IOS.map(([idiom, pt, scale]) => ({
        filename: iosFile(Math.round(pt * scale)),
        idiom,
        scale: `${scale}x`,
        size: `${fmt(pt)}x${fmt(pt)}`,
      })),
      info: { author: 'darnly.dev', version: 1 },
    },
    null,
    2,
  );
}

function appJsonSnippet(): string {
  return JSON.stringify(
    {
      expo: {
        icon: './assets/icon.png',
        android: {
          adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: bgColor.value.toUpperCase() },
        },
      },
    },
    null,
    2,
  );
}

const ADAPTIVE_XML = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;

const README = `App icons from darnly.dev/tools/app-icon-generator/

Expo (React Native)
  Copy expo/assets/icon.png and expo/assets/adaptive-icon.png into your project's assets/ folder,
  then merge expo/app.json into your app.json (or app.config.js). Rebuild the app to see the new icon.

iOS (Xcode, Capacitor, Flutter, React Native)
  Replace the AppIcon.appiconset folder inside your Assets.xcassets with ios/AppIcon.appiconset.
  Capacitor: ios/App/App/Assets.xcassets/AppIcon.appiconset
  Flutter:   ios/Runner/Assets.xcassets/AppIcon.appiconset

Android (Android Studio, Capacitor, Flutter, React Native)
  Copy everything in android/res/ into your app's res folder, replacing files with the same names.
  Capacitor / React Native: android/app/src/main/res/
  Flutter:                  android/app/src/main/res/
  android/play-store-512.png is the icon for the Google Play listing.
`;

function promptText(): string {
  return [
    'I generated app icons with darnly.dev and unzipped them. Install them in this project:',
    '',
    '- If this is an Expo app: copy expo/assets/icon.png and expo/assets/adaptive-icon.png into the assets folder and set these values in app.json (or app.config):',
    appJsonSnippet(),
    '- If there is a native ios/ folder: replace the AppIcon.appiconset inside Assets.xcassets with ios/AppIcon.appiconset from the ZIP.',
    '- If there is a native android/ folder: copy the mipmap-* folders from android/res/ into android/app/src/main/res/, replacing existing launcher icons. Make sure AndroidManifest.xml uses @mipmap/ic_launcher and @mipmap/ic_launcher_round.',
    '',
    'Only change icon files and icon settings. Tell me where the unzipped folder should be if you can’t find it, and how to rebuild so I can see the new icon.',
  ].join('\n');
}

function refresh() {
  if (!source) return;
  const shown: [string, Layer][] = [
    ['iPhone', FULL('ios')],
    ['Android circle', ADAPTIVE('circle')],
    ['Android squircle', ADAPTIVE('squircle')],
    ['Android legacy', FULL('ios')],
  ];
  previews.replaceChildren(
    ...shown.map(([label, l]) => {
      const fig = document.createElement('figure');
      const c = render(192, l);
      c.style.width = '96px';
      c.style.height = '96px';
      const cap = document.createElement('figcaption');
      cap.textContent = label;
      fig.append(c, cap);
      return fig;
    }),
  );
  appJson.textContent = appJsonSnippet();
}

// Use the image's corner color as the starting background when it's opaque, so most logos look right with no clicks.
function cornerColor(img: HTMLImageElement): string | null {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, Math.max(1, img.naturalWidth / 64), Math.max(1, img.naturalHeight / 64), 0, 0, 1, 1);
  const [r, g, b, a] = x.getImageData(0, 0, 1, 1).data;
  if (a < 250) return null;
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function load(file: File) {
  error.hidden = true;
  if (!file.type.startsWith('image/')) {
    error.textContent = 'That file isn’t an image. Try a PNG, JPG, SVG or WebP.';
    error.hidden = false;
    return;
  }
  const img = new Image();
  img.onload = () => {
    source = img;
    sourceName = file.name.replace(/\.[^.]+$/, '') || 'app';
    dropText.textContent = `${file.name} · choose another`;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const svg = file.type === 'image/svg+xml';
    warn.hidden = svg || side === 0 || side >= 1024;
    warn.textContent = `This image is ${img.naturalWidth}×${img.naturalHeight}. App stores want 1024×1024, so the biggest icons may look soft. Use a larger image or an SVG if you have one.`;
    const corner = cornerColor(img);
    bgColor.value = corner ?? '#ffffff';
    result.hidden = false;
    refresh();
  };
  img.onerror = () => {
    error.textContent = 'We couldn’t read that image. Try saving it as a PNG first.';
    error.hidden = false;
  };
  img.src = URL.createObjectURL(file);
}

async function buildZip(): Promise<Blob> {
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [];
  const add = async (name: string, size: number, l: Layer) => {
    const c = render(size, l);
    const opaque = l.bg && l.mask === 'none';
    entries.push({ name, data: await (opaque ? toRgbPng(c) : toPng(c)) });
  };

  // iOS: square and opaque (Apple rounds the corners and rejects transparency).
  const iosSizes = [...new Set(IOS.map(([, pt, s]) => Math.round(pt * s)))];
  for (const px of iosSizes) await add(`ios/AppIcon.appiconset/${iosFile(px)}`, px, FULL());
  entries.push({ name: 'ios/AppIcon.appiconset/Contents.json', data: enc.encode(contentsJson() + '\n') });

  // Android: legacy square and round icons, plus adaptive layers for Android 8+.
  for (const [d, k] of ANDROID) {
    const dir = `android/res/mipmap-${d}`;
    await add(`${dir}/ic_launcher.png`, Math.round(48 * k), FULL('ios'));
    await add(`${dir}/ic_launcher_round.png`, Math.round(48 * k), ADAPTIVE('circle'));
    await add(`${dir}/ic_launcher_foreground.png`, Math.round(108 * k), { bg: false, fg: true, scale: SAFE, mask: 'none' });
    await add(`${dir}/ic_launcher_background.png`, Math.round(108 * k), { bg: true, fg: false, scale: 1, mask: 'none' });
  }
  entries.push({ name: 'android/res/mipmap-anydpi-v26/ic_launcher.xml', data: enc.encode(ADAPTIVE_XML) });
  entries.push({ name: 'android/res/mipmap-anydpi-v26/ic_launcher_round.xml', data: enc.encode(ADAPTIVE_XML) });
  await add('android/play-store-512.png', 512, FULL());

  // Expo: icon.png is opaque; adaptive-icon.png is the transparent foreground, with the color in app.json.
  await add('expo/assets/icon.png', 1024, FULL());
  await add('expo/assets/adaptive-icon.png', 1024, { bg: false, fg: true, scale: SAFE, mask: 'none' });
  entries.push({ name: 'expo/app.json', data: enc.encode(appJsonSnippet() + '\n') });

  entries.push({ name: 'README.txt', data: enc.encode(README) });
  return new Blob([makeZip(entries)], { type: 'application/zip' });
}

async function copyText(btn: HTMLButtonElement, text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.textContent = label), 1500);
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
for (const el of [bgColor, padding]) el.addEventListener('input', refresh);

download.addEventListener('click', async () => {
  if (!source) return;
  download.disabled = true;
  download.textContent = 'Making your icons…';
  try {
    const blob = await buildZip();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${sourceName}-app-icons.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } finally {
    download.disabled = false;
    download.textContent = 'Download all (ZIP)';
  }
});

promptBtn.addEventListener('click', () => copyText(promptBtn, promptText(), 'Copy prompt for your AI agent'));
copyJson.addEventListener('click', () => copyText(copyJson, appJsonSnippet(), 'Copy'));
