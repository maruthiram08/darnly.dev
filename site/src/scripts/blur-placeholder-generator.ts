// Blur placeholder generator: everything runs in the visitor's browser. Nothing is uploaded.
import { blurhashDecode, blurhashDetail, blurhashEncode, blurSvg, bytes, thumbhashDecode, thumbhashEncode, toBase64 } from './blur-placeholder-core';

type Kind = 'blur' | 'blurhash' | 'thumbhash';
type Tab = 'next' | 'css' | 'blurhash' | 'thumbhash' | 'uri';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>('bp-file');
const drop = $<HTMLLabelElement>('bp-drop');
const dropText = $<HTMLSpanElement>('bp-drop-text');
const error = $<HTMLParagraphElement>('bp-error');
const framePh = $<HTMLDivElement>('bp-frame-ph');
const frameReal = $<HTMLDivElement>('bp-frame-real');
const phImg = $<HTMLImageElement>('bp-ph');
const badge = $<HTMLSpanElement>('bp-badge');
const phSize = $<HTMLSpanElement>('bp-ph-size');
const realPh = $<HTMLImageElement>('bp-real-ph');
const realImg = $<HTMLImageElement>('bp-real');
const realSize = $<HTMLSpanElement>('bp-real-size');
const loading = $<HTMLDivElement>('bp-loading');
const bar = $<HTMLElement>('bp-bar');
const verdict = $<HTMLDivElement>('bp-verdict');
const playBtn = $<HTMLButtonElement>('bp-play');
const detail = $<HTMLInputElement>('bp-detail');
const detailOut = $<HTMLOutputElement>('bp-detail-out');
const sampleBtn = $<HTMLButtonElement>('bp-sample');
const kindsEl = $<HTMLDivElement>('bp-kinds');
const tabsEl = $<HTMLDivElement>('bp-tabs');
const hint = $<HTMLParagraphElement>('bp-hint');
const codeEl = $<HTMLElement>('bp-code');
const copyBtn = $<HTMLButtonElement>('bp-copy');
const promptBtn = $<HTMLButtonElement>('bp-prompt');
const said = $<HTMLSpanElement>('bp-said');

const KIND_NAMES: Record<Kind, string> = { blur: 'Blurred image', blurhash: 'BlurHash', thumbhash: 'ThumbHash' };

// The current image.
let src: HTMLCanvasElement | null = null; // scaled copy we work from
let natW = 1200;
let natH = 800;
let realUrl = '';
let realBytes = 0;
let fileName = 'photo.jpg';
let usingSample = true;
let seeThrough = false; // does the image have see-through parts?

// The current results.
let tinyUri = '';
let tinyW = 10;
let tinyH = 7;
let blurUri = '';
let hash = '';
let hashDetail: [number, number] = [4, 3];
let hashPng = '';
let thumb = '';
let thumbPng = '';

let kind: Kind = 'blur';
let tab: Tab = 'next';

// ---------- Sample photo: a sunset over hills and a lake, drawn on a canvas ----------

function drawSample(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 800;
  const x = c.getContext('2d')!;
  x.fillStyle = '#1E1B4B';
  x.fillRect(0, 0, 1200, 800);
  const sky = x.createLinearGradient(0, 0, 0, 470);
  sky.addColorStop(0, '#1E3A8A');
  sky.addColorStop(0.45, '#7C3AED');
  sky.addColorStop(0.75, '#F472B6');
  sky.addColorStop(1, '#FDBA74');
  x.fillStyle = sky;
  x.fillRect(0, 0, 1200, 470);
  const sun = x.createRadialGradient(760, 400, 10, 760, 400, 200);
  sun.addColorStop(0, 'rgba(255,247,214,1)');
  sun.addColorStop(0.28, 'rgba(254,215,170,0.95)');
  sun.addColorStop(1, 'rgba(253,186,116,0)');
  x.fillStyle = sun;
  x.fillRect(500, 180, 520, 300);
  // Clouds
  x.fillStyle = 'rgba(255,255,255,0.18)';
  for (const [cx, cy, r] of [[220, 150, 60], [290, 140, 80], [370, 160, 55], [900, 110, 50], [960, 95, 70], [1030, 115, 48]]) {
    x.beginPath();
    x.ellipse(cx, cy, r * 1.6, r * 0.55, 0, 0, Math.PI * 2);
    x.fill();
  }
  const hills = (base: number, amp: number, freq: number, phase: number, color: string) => {
    x.fillStyle = color;
    x.beginPath();
    x.moveTo(0, 470);
    for (let i = 0; i <= 1200; i += 10) {
      x.lineTo(i, base - amp * (Math.sin(i * freq + phase) * 0.6 + Math.sin(i * freq * 2.7 + phase * 2) * 0.4));
    }
    x.lineTo(1200, 470);
    x.closePath();
    x.fill();
  };
  hills(380, 70, 0.006, 1, '#6D28D9');
  hills(420, 55, 0.009, 2.5, '#4C1D95');
  hills(455, 35, 0.013, 4, '#2E1065');
  // Lake: mirror the top half, darkened.
  x.save();
  x.translate(0, 940);
  x.scale(1, -1);
  x.globalAlpha = 0.55;
  x.drawImage(c, 0, 0, 1200, 470, 0, 0, 1200, 470);
  x.restore();
  const lake = x.createLinearGradient(0, 470, 0, 800);
  lake.addColorStop(0, 'rgba(30,27,75,0.35)');
  lake.addColorStop(1, 'rgba(15,10,40,0.9)');
  x.fillStyle = lake;
  x.fillRect(0, 470, 1200, 330);
  x.fillStyle = 'rgba(255,240,210,0.5)';
  for (let i = 0; i < 14; i++) x.fillRect(700 + Math.sin(i * 1.7) * 40, 490 + i * 16, 120 - i * 6, 3);
  // Shore
  x.fillStyle = '#0B0720';
  x.beginPath();
  x.moveTo(0, 800);
  x.lineTo(0, 640);
  x.quadraticCurveTo(160, 610, 330, 680);
  x.quadraticCurveTo(420, 720, 520, 800);
  x.closePath();
  x.fill();
  return c;
}

// ---------- Image work ----------

/** Scale a canvas down in halving steps so tiny versions stay smooth, not jagged. */
function shrink(from: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  let cur = from;
  while (cur.width / 2 > w && cur.height / 2 > h) {
    const n = document.createElement('canvas');
    n.width = Math.max(w, Math.round(cur.width / 2));
    n.height = Math.max(h, Math.round(cur.height / 2));
    const nx = n.getContext('2d')!;
    nx.imageSmoothingQuality = 'high';
    nx.drawImage(cur, 0, 0, n.width, n.height);
    cur = n;
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ox = out.getContext('2d')!;
  ox.imageSmoothingQuality = 'high';
  ox.drawImage(cur, 0, 0, w, h);
  return out;
}

function fit(w: number, h: number, longest: number): [number, number] {
  const s = longest / Math.max(w, h);
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

function pixelsToPng(rgba: Uint8ClampedArray, w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  const data = x.createImageData(w, h);
  data.data.set(rgba);
  x.putImageData(data, 0, 0);
  return c.toDataURL('image/png');
}

function makeTiny() {
  if (!src) return;
  const d = Number(detail.value);
  [tinyW, tinyH] = fit(src.width, src.height, d);
  const t = shrink(src, tinyW, tinyH);
  if (!seeThrough) {
    // Scaling down can leave edge pixels a little see-through; a solid image should stay solid.
    const tx = t.getContext('2d')!;
    const d2 = tx.getImageData(0, 0, tinyW, tinyH);
    for (let i = 3; i < d2.data.length; i += 4) d2.data[i] = 255;
    tx.putImageData(d2, 0, 0);
  }
  const png = t.toDataURL('image/png');
  const webp = t.toDataURL('image/webp', 0.6);
  // Some browsers (older Safari) can't make WebP and hand back PNG instead.
  tinyUri = webp.startsWith('data:image/webp') && webp.length < png.length ? webp : png;
  blurUri = blurSvg(tinyUri, tinyW, tinyH, seeThrough);
}

function makeHashes() {
  if (!src) return;
  const [w, h] = fit(src.width, src.height, 100);
  const small = shrink(src, w, h);
  const rgba = small.getContext('2d')!.getImageData(0, 0, w, h).data;
  if (!seeThrough) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  hashDetail = blurhashDetail(w, h);
  hash = blurhashEncode(rgba, w, h, hashDetail[0], hashDetail[1]);
  const [dw, dh] = fit(w, h, 32);
  hashPng = pixelsToPng(blurhashDecode(hash, dw, dh), dw, dh);
  const th = thumbhashEncode(w, h, rgba);
  thumb = toBase64(th);
  const dec = thumbhashDecode(th);
  thumbPng = pixelsToPng(dec.rgba, dec.w, dec.h);
}

// ---------- Showing it ----------

const shown = (k: Kind) => (k === 'blur' ? blurUri : k === 'blurhash' ? hashPng : thumbPng);
const sizeOf = (k: Kind) => (k === 'blur' ? tinyUri.length : k === 'blurhash' ? hash.length : thumb.length);

function render() {
  const ratio = Math.min(2.2, Math.max(0.6, natW / natH));
  framePh.style.setProperty('--ratio', String(ratio));
  frameReal.style.setProperty('--ratio', String(ratio));

  for (const k of ['blur', 'blurhash', 'thumbhash'] as Kind[]) {
    const img = kindsEl.querySelector<HTMLImageElement>(`[data-thumb="${k}"]`)!;
    img.src = shown(k);
    kindsEl.querySelector(`[data-size="${k}"]`)!.textContent = k === 'blur' ? `${bytes(sizeOf(k))} · ${tinyW}×${tinyH} px` : `${sizeOf(k)} characters`;
  }
  kindsEl.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === kind)));
  detail.closest('label')!.classList.toggle('off', kind !== 'blur');

  phImg.src = shown(kind);
  realPh.src = shown(kind);
  const size = sizeOf(kind);
  badge.textContent = kind === 'blur' ? bytes(size) : `${size} characters`;
  phSize.textContent = `· ${KIND_NAMES[kind]}`;
  realSize.textContent = `· ${natW}×${natH}${realBytes ? `, ${bytes(realBytes)}` : ''}`;

  const pct = realBytes ? (size / realBytes) * 100 : 0;
  const share = realBytes ? `, ${pct < 0.1 ? 'less than 0.1' : pct < 10 ? pct.toFixed(1) : Math.round(pct)}% of your ${bytes(realBytes)} image` : '';
  verdict.textContent =
    kind === 'blur'
      ? `Your placeholder is ${bytes(size)}${share}. That’s small enough to put straight in your HTML, so it shows the moment the page opens.`
      : `Your ${KIND_NAMES[kind]} is ${size} characters${share}. Store it next to the image (in your database or CMS) and turn it back into a picture with the ${kind} library.`;

  renderCode();
}

function slug(name: string) {
  return (
    name
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'image'
  );
}

function codeFor(t: Tab): { hint: string; code: string } {
  const path = `/images/${fileName}`;
  const [dw, dh] = fit(natW, natH, 32);
  if (t === 'next') {
    return {
      hint: 'For images that come from a URL, a CMS or a database. Images you <code>import</code> from your project get a blur from Next.js automatically.',
      code: `import Image from 'next/image';

<Image
  src="${path}"
  alt=""
  width={${natW}}
  height={${natH}}
  placeholder="blur"
  blurDataURL="${tinyUri}"
/>`,
    };
  }
  if (t === 'css') {
    const cls = `blur-${slug(fileName)}`;
    return {
      hint: 'Works with any site or framework. The blur sits behind the image and is covered the moment the image arrives. Keep <code>width</code> and <code>height</code> so the page doesn’t jump.',
      code: `/* CSS */
.${cls} {
  background: url("${blurUri}") center / cover no-repeat;
}

<!-- HTML -->
<img
  class="${cls}"
  src="${path}"
  alt=""
  width="${natW}"
  height="${natH}"
  loading="lazy"
  decoding="async"
/>`,
    };
  }
  if (t === 'blurhash') {
    return {
      hint: `Store the hash with the image, then draw it while the image loads. This one has ${hashDetail[0]}×${hashDetail[1]} parts.`,
      code: `// Your BlurHash
${hash}

// npm install blurhash react-blurhash

// React
import { Blurhash } from 'react-blurhash';

<Blurhash hash="${hash}" width={${natW > natH ? 400 : Math.round((400 * natW) / natH)}} height={${natW > natH ? Math.round((400 * natH) / natW) : 400}} />

// Plain JavaScript: draw it on a <canvas>
import { decode } from 'blurhash';

const pixels = decode('${hash}', ${dw}, ${dh});
const ctx = canvas.getContext('2d');
const data = ctx.createImageData(${dw}, ${dh});
data.data.set(pixels);
ctx.putImageData(data, 0, 0);`,
    };
  }
  if (t === 'thumbhash') {
    return {
      hint: 'Store the hash with the image (it’s base64 text). The library turns it into a picture you can use as an image or a CSS background.',
      code: `// Your ThumbHash (base64)
${thumb}

// npm install thumbhash
import { thumbHashToDataURL } from 'thumbhash';

const hash = '${thumb}';
const bytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0));
const placeholder = thumbHashToDataURL(bytes);
// Use it as <img src={placeholder}> or background-image: url(placeholder)`,
    };
  }
  return {
    hint: 'The first is the tiny image (Next.js blurs it for you). The second already has the blur built in, for CSS or an <code>&lt;img&gt;</code>.',
    code: `// Tiny image, ${tinyW}×${tinyH} px (${bytes(tinyUri.length)})
${tinyUri}

// Blurred SVG, ready for CSS or <img> (${bytes(blurUri.length)})
${blurUri}`,
  };
}

function renderCode() {
  const c = codeFor(tab);
  hint.innerHTML = c.hint;
  codeEl.textContent = c.code;
  tabsEl.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
}

const PROMPT = `Add blur-up placeholders to the images on this site, so images never show as empty boxes while they load.

- next/image with images imported from the project: add placeholder="blur" (Next.js makes the blur itself).
- Images from a URL, CMS or database: make a tiny blurred placeholder when the image is added or at build time (the plaiceholder library, or sharp resized to about 10px wide, as a base64 data URI) and pass it as blurDataURL with placeholder="blur". Store it next to the image URL.
- Plain <img> tags: put the tiny blurred image behind the image as a CSS background (background-size: cover), keep width and height set so the page doesn't jump, and add loading="lazy" to every image except the first one on screen.

Don't change how images look once they've loaded. When you're done, list every image you changed.`;

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    said.textContent = done;
  } catch {
    said.textContent = 'Your browser blocked copying. Select the text instead.';
  }
  window.setTimeout(() => (said.textContent = ''), 2500);
}

// ---------- Slow-load simulation ----------

let playing = 0;
function play() {
  const run = ++playing;
  realImg.classList.add('hide');
  loading.hidden = false;
  bar.style.width = '0';
  const start = performance.now();
  const total = 2400;
  const step = (now: number) => {
    if (run !== playing) return;
    const t = Math.min(1, (now - start) / total);
    bar.style.width = `${Math.round(100 * (1 - Math.pow(1 - t, 2)))}%`;
    if (t < 1) requestAnimationFrame(step);
    else {
      loading.hidden = true;
      realImg.classList.remove('hide');
    }
  };
  requestAnimationFrame(step);
  frameReal.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- Loading images ----------

function use(canvas: HTMLCanvasElement) {
  const [w, h] = fit(canvas.width, canvas.height, Math.min(800, Math.max(canvas.width, canvas.height)));
  src = w === canvas.width ? canvas : shrink(canvas, w, h);
  const px = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
  let clear = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 250) clear++;
  seeThrough = clear > (px.length / 4) * 0.01;
  makeTiny();
  makeHashes();
  realImg.src = realUrl;
  render();
}

function showSample() {
  usingSample = true;
  sampleBtn.hidden = true;
  error.hidden = true;
  dropText.textContent = 'or click to choose one, or paste it. Below is a sample until you do.';
  const c = drawSample();
  natW = c.width;
  natH = c.height;
  fileName = 'sunset.jpg';
  c.toBlob(
    (blob) => {
      if (!usingSample) return;
      if (realUrl) URL.revokeObjectURL(realUrl);
      realUrl = blob ? URL.createObjectURL(blob) : c.toDataURL('image/jpeg', 0.85);
      realBytes = blob ? blob.size : 0;
      use(c);
    },
    'image/jpeg',
    0.85,
  );
}

function load(file: File) {
  error.hidden = true;
  if (!file.type.startsWith('image/')) {
    error.textContent = 'That file isn’t an image. Try a JPG, PNG, WebP or AVIF.';
    error.hidden = false;
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const w0 = img.naturalWidth || 1200;
    const h0 = img.naturalHeight || 800;
    const [w, h] = fit(w0, h0, Math.min(1600, Math.max(w0, h0)));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, w, h);
    usingSample = false;
    if (realUrl) URL.revokeObjectURL(realUrl);
    realUrl = url;
    realBytes = file.size;
    natW = w0;
    natH = h0;
    fileName = (file.name || 'image.png').replace(/[^\w.\-]+/g, '-');
    sampleBtn.hidden = false;
    dropText.textContent = `${file.name || 'Pasted image'} · choose another`;
    use(c);
    framePh.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    error.textContent = 'We couldn’t read that image. Try saving it as a JPG or PNG first.';
    error.hidden = false;
  };
  img.src = url;
}

// ---------- Events ----------

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) load(f);
  fileInput.value = '';
});
drop.addEventListener('dragenter', () => drop.classList.add('over'));
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', () => drop.classList.remove('over'));
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  const f = item?.getAsFile();
  if (f) {
    e.preventDefault();
    load(f);
  }
});

let detailTimer = 0;
detail.addEventListener('input', () => {
  detailOut.textContent = `${detail.value} px`;
  kind = 'blur';
  window.clearTimeout(detailTimer);
  detailTimer = window.setTimeout(() => {
    makeTiny();
    render();
  }, 30);
});

kindsEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-kind]');
  if (!b) return;
  kind = b.dataset.kind as Kind;
  if (kind === 'blurhash' || kind === 'thumbhash') tab = kind;
  else if (tab === 'blurhash' || tab === 'thumbhash') tab = 'next';
  render();
});

tabsEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');
  if (!b) return;
  tab = b.dataset.tab as Tab;
  renderCode();
});

playBtn.addEventListener('click', play);
sampleBtn.addEventListener('click', showSample);
copyBtn.addEventListener('click', () => copy(codeEl.textContent || '', 'Copied. Paste it into your project.'));
promptBtn.addEventListener('click', () => copy(PROMPT, 'Prompt copied. Paste it into Claude Code, Codex or Cursor.'));

showSample();
