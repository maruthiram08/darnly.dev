// Screenshot beautifier: frames a screenshot on a background, drawn on a canvas in the visitor's browser. Nothing is uploaded.

type Size = 'x' | 'linkedin' | 'square' | 'story' | 'fit';
type Frame = 'safari' | 'chrome' | 'phone' | 'none';
type Mode = 'light' | 'dark';
type Bg = { a: string; b: string; grad: boolean };

const SIZES: Record<Exclude<Size, 'fit'>, [number, number]> = {
  x: [1920, 1080],
  linkedin: [1200, 627],
  square: [1080, 1080],
  story: [1080, 1920],
};

// Ready-made backgrounds. Picking one fills in the color pickers, which can then be tweaked.
const BGS: Record<string, Bg> = {
  sky: { a: '#38C6F4', b: '#0593C6', grad: true },
  sunset: { a: '#FF9A5A', b: '#D83995', grad: true },
  peach: { a: '#FFE3B3', b: '#FF8A80', grad: true },
  mint: { a: '#C4F5D8', b: '#2BB38A', grad: true },
  lime: { a: '#F2FCC4', b: '#8FD694', grad: true },
  night: { a: '#24495E', b: '#0B2230', grad: true },
  sand: { a: '#F3EDE4', b: '#F3EDE4', grad: false },
  paper: { a: '#E9F0F3', b: '#E9F0F3', grad: false },
  ink: { a: '#14181C', b: '#14181C', grad: false },
};

const SHADOWS = [
  { name: 'None', blur: 0, y: 0, alpha: 0 },
  { name: 'Soft', blur: 0.02, y: 0.008, alpha: 0.18 },
  { name: 'Medium', blur: 0.045, y: 0.018, alpha: 0.3 },
  { name: 'Strong', blur: 0.08, y: 0.035, alpha: 0.42 },
];

// Height of the window bar, as a share of the frame's width.
const BAR: Record<Frame, number> = { safari: 0.045, chrome: 0.075, phone: 0, none: 0 };
const BEZEL = 0.04; // Phone edge, as a share of the screen's short side.
const MAX_FIT = 4096; // Biggest side of a "Fit" picture, so huge screenshots stay quick to save.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const stage = $<HTMLDivElement>('sb-stage');
const canvas = $<HTMLCanvasElement>('sb-canvas');
const ctx = canvas.getContext('2d')!;
const hint = $<HTMLDivElement>('sb-hint');
const over = $<HTMLDivElement>('sb-over');
const fileInput = $<HTMLInputElement>('sb-file');
const fileText = $<HTMLSpanElement>('sb-file-text');
const download = $<HTMLButtonElement>('sb-download');
const copy = $<HTMLButtonElement>('sb-copy');
const statusEl = $<HTMLParagraphElement>('sb-status');
const error = $<HTMLParagraphElement>('sb-error');
const bgsBox = $<HTMLDivElement>('sb-bgs');
const c1 = $<HTMLInputElement>('sb-c1');
const c2 = $<HTMLInputElement>('sb-c2');
const grad = $<HTMLInputElement>('sb-grad');
const pad = $<HTMLInputElement>('sb-pad');
const radius = $<HTMLInputElement>('sb-radius');
const shadow = $<HTMLInputElement>('sb-shadow');
const url = $<HTMLInputElement>('sb-url');
const caption = $<HTMLInputElement>('sb-caption');

const state = { size: 'x' as Size, frame: 'safari' as Frame, mode: 'light' as Mode };
let shot: CanvasImageSource = makeSample();
let shotW = 1600;
let shotH = 1000;
let isSample = true;

// A made-up app screen, so the preview shows something before the visitor adds their own.
function makeSample(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1600;
  c.height = 1000;
  const g = c.getContext('2d')!;
  g.fillStyle = '#F7FAFB';
  g.fillRect(0, 0, 1600, 1000);
  g.fillStyle = '#0B2230';
  g.fillRect(0, 0, 300, 1000);
  g.fillStyle = '#FCFFFF';
  g.font = '700 34px "Bricolage Grotesque", system-ui, sans-serif';
  g.fillText('Acme', 48, 82);
  const menu = ['Overview', 'Projects', 'Customers', 'Settings'];
  menu.forEach((m, i) => {
    if (i === 0) {
      g.fillStyle = 'rgba(56, 198, 244, 0.18)';
      round(g, 28, 140, 244, 56, 12);
      g.fill();
    }
    g.fillStyle = i === 0 ? '#FCFFFF' : '#8FB4C4';
    g.font = '600 24px Figtree, system-ui, sans-serif';
    g.fillText(m, 52, 177 + i * 72);
  });
  g.fillStyle = '#0B2230';
  g.font = '700 48px "Bricolage Grotesque", system-ui, sans-serif';
  g.fillText('Good morning 👋', 360, 112);
  g.fillStyle = '#4A6472';
  g.font = '400 24px Figtree, system-ui, sans-serif';
  g.fillText('Here’s how your app did this week.', 360, 156);
  const cards = [
    ['Visitors', '12,480', '+18%'],
    ['Sign-ups', '1,204', '+9%'],
    ['Revenue', '$8,930', '+24%'],
  ];
  cards.forEach(([k, v, d], i) => {
    const x = 360 + i * 400;
    g.fillStyle = '#FFFFFF';
    round(g, x, 210, 370, 170, 20);
    g.fill();
    g.strokeStyle = '#D7E9F0';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#4A6472';
    g.font = '600 22px Figtree, system-ui, sans-serif';
    g.fillText(k, x + 32, 262);
    g.fillStyle = '#0B2230';
    g.font = '800 54px "Bricolage Grotesque", system-ui, sans-serif';
    g.fillText(v, x + 32, 334);
    g.fillStyle = '#12A150';
    g.font = '700 22px Figtree, system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText(d, x + 338, 262);
    g.textAlign = 'left';
  });
  g.fillStyle = '#FFFFFF';
  round(g, 360, 420, 1170, 520, 20);
  g.fill();
  g.strokeStyle = '#D7E9F0';
  g.stroke();
  g.fillStyle = '#0B2230';
  g.font = '700 28px Figtree, system-ui, sans-serif';
  g.fillText('Weekly visitors', 400, 482);
  const bars = [0.42, 0.55, 0.48, 0.7, 0.62, 0.86, 0.78, 0.95, 0.74, 0.88, 0.69, 0.92];
  bars.forEach((h, i) => {
    const bh = h * 360;
    const gr = g.createLinearGradient(0, 900 - bh, 0, 900);
    gr.addColorStop(0, '#38C6F4');
    gr.addColorStop(1, '#0593C6');
    g.fillStyle = gr;
    round(g, 410 + i * 92, 900 - bh, 56, bh, 10);
    g.fill();
  });
  return c;
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

// Relative brightness of a #RRGGBB color, 0 (black) to 1 (white).
function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

// Frame height divided by frame width, for the current screenshot and frame.
function frameRatio() {
  const r = shotH / shotW;
  if (state.frame === 'phone') {
    const e = 2 * BEZEL * Math.min(1, r);
    return (r + e) / (1 + e);
  }
  return BAR[state.frame] + r;
}

function captionFont(size: number) {
  return `700 ${size}px "Bricolage Grotesque", "Avenir Next", system-ui, sans-serif`;
}

// Fits the caption on one line: starts at base size and shrinks until it fits the width.
function fitCaption(text: string, base: number, maxW: number) {
  let size = base;
  ctx.font = captionFont(size);
  while (size > 12 && ctx.measureText(text).width > maxW) {
    size -= 2;
    ctx.font = captionFont(size);
  }
  return size;
}

function draw() {
  const k = frameRatio();
  const padPct = Number(pad.value) / 100;
  const text = caption.value.trim();
  let W: number;
  let H: number;
  let fw: number;
  let p: number;
  let capSize = 0;
  let capH = 0;

  if (state.size === 'fit') {
    // Picture is sized around the screenshot, so nothing is shrunk or cropped.
    fw = state.frame === 'phone' ? shotW * (1 + 2 * BEZEL * Math.min(1, shotH / shotW)) : shotW;
    const scale = Math.min(1, MAX_FIT / Math.max(fw * (1 + 2 * padPct), fw * k + fw * 2 * padPct));
    fw *= scale;
    p = fw * padPct;
    W = Math.round(fw + 2 * p);
    if (text) {
      capSize = Math.round(Math.max(28, W * 0.04));
      capH = capSize * 1.9;
    }
    H = Math.round(fw * k + 2 * p + capH);
  } else {
    [W, H] = SIZES[state.size];
    const short = Math.min(W, H);
    p = short * padPct;
    if (text) {
      capSize = Math.round(short * 0.055);
      capH = capSize * 1.9;
    }
    const availW = W - 2 * p;
    const availH = H - 2 * p - capH;
    fw = Math.max(10, Math.min(availW, availH / k));
  }

  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }

  // Background.
  if (grad.checked) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, c1.value);
    g.addColorStop(1, c2.value);
    ctx.fillStyle = g;
  } else ctx.fillStyle = c1.value;
  ctx.fillRect(0, 0, W, H);

  const fh = fw * k;
  const top = state.size === 'fit' ? p + capH : capH + p + (H - 2 * p - capH - fh) / 2;
  const x = (W - fw) / 2;

  // Caption, above the frame, in black or white, whichever reads better on the background.
  if (text) {
    const bgLum = (lum(c1.value) + lum(grad.checked ? c2.value : c1.value)) / 2;
    const size = fitCaption(text, capSize, W - 2 * Math.max(p, W * 0.04));
    ctx.font = captionFont(size);
    ctx.fillStyle = bgLum > 0.4 ? '#0B2230' : '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const capY = state.size === 'fit' ? p + capH * 0.42 : top - capH * 0.55;
    ctx.fillText(text, W / 2, Math.max(size * 0.7, capY));
  }

  drawFrame(x, top, fw, fh);
}

function drawFrame(x: number, y: number, fw: number, fh: number) {
  const dark = state.mode === 'dark';
  const phone = state.frame === 'phone';
  // Phone edge and corners follow the screen's short side, so a sideways phone looks right too.
  const b = phone ? (fw * BEZEL * Math.min(1, shotH / shotW)) / (1 + 2 * BEZEL * Math.min(1, shotH / shotW)) : 0;
  const short = Math.min(fw, fh) - 2 * b;
  const r = phone ? b + short * 0.1 : (Number(radius.value) * fw) / 1000;
  const sh = SHADOWS[Number(shadow.value)] ?? SHADOWS[2];

  // Shadow: drawn once under the frame's shape.
  ctx.save();
  if (sh.alpha) {
    ctx.shadowColor = `rgba(0, 0, 0, ${sh.alpha})`;
    ctx.shadowBlur = sh.blur * fw;
    ctx.shadowOffsetY = sh.y * fw;
  }
  round(ctx, x, y, fw, fh, r);
  ctx.fillStyle = phone ? (dark ? '#111214' : '#D9DCE1') : dark ? '#1E1F22' : '#FFFFFF';
  ctx.fill();
  ctx.restore();

  ctx.save();
  round(ctx, x, y, fw, fh, r);
  ctx.clip();

  if (phone) {
    const sw = fw - 2 * b;
    const shh = fh - 2 * b;
    // Edge highlight, so a light phone doesn't vanish on a light background.
    ctx.strokeStyle = dark ? '#2C2E33' : '#B9BEC6';
    ctx.lineWidth = Math.max(2, fw * 0.006);
    round(ctx, x, y, fw, fh, r);
    ctx.stroke();
    ctx.save();
    round(ctx, x + b, y + b, sw, shh, Math.max(0, r - b));
    ctx.clip();
    ctx.drawImage(shot, x + b, y + b, sw, shh);
    ctx.restore();
    // Camera pill at the top of the screen.
    ctx.fillStyle = '#000000';
    const pl = short * 0.27;
    const pt = short * 0.075;
    if (sw >= shh) round(ctx, x + b + short * 0.025, y + (fh - pl) / 2, pt, pl, pt / 2);
    else round(ctx, x + (fw - pl) / 2, y + b + short * 0.025, pl, pt, pt / 2);
    ctx.fill();
  } else {
    const bar = fw * BAR[state.frame];
    if (state.frame === 'safari') drawSimpleBar(x, y, fw, bar, dark);
    if (state.frame === 'chrome') drawTabBar(x, y, fw, bar, dark);
    ctx.drawImage(shot, x, y + bar, fw, fh - bar);
  }
  ctx.restore();
}

function dots(x: number, cy: number, size: number) {
  const colors = ['#FF5F57', '#FEBC2E', '#28C840'];
  colors.forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(x + i * size * 3.2, cy, size, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });
}

function addressText(text: string, x: number, cy: number, size: number, maxW: number, color: string, align: CanvasTextAlign) {
  if (!text) return;
  ctx.font = `500 ${size}px Figtree, system-ui, sans-serif`;
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  if (t !== text) t = `${t.slice(0, -1)}…`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(t, x, cy);
}

// One bar: three dots and a centered address.
function drawSimpleBar(x: number, y: number, fw: number, bar: number, dark: boolean) {
  ctx.fillStyle = dark ? '#2B2D31' : '#F1F3F5';
  ctx.fillRect(x, y, fw, bar);
  ctx.fillStyle = dark ? '#18191C' : '#DDE1E6';
  ctx.fillRect(x, y + bar - Math.max(1, bar * 0.03), fw, Math.max(1, bar * 0.03));
  dots(x + bar * 0.62, y + bar / 2, bar * 0.13);
  const aw = fw * 0.4;
  const ah = bar * 0.58;
  ctx.fillStyle = dark ? '#3A3C42' : '#E3E6EA';
  round(ctx, x + (fw - aw) / 2, y + (bar - ah) / 2, aw, ah, ah * 0.3);
  ctx.fill();
  addressText(url.value.trim(), x + fw / 2, y + bar / 2, bar * 0.3, aw - ah, dark ? '#C3C6CC' : '#5F6670', 'center');
}

// Two rows: a tab strip, then a toolbar with a wide address field.
function drawTabBar(x: number, y: number, fw: number, bar: number, dark: boolean) {
  const strip = bar * 0.46;
  const tool = bar - strip;
  ctx.fillStyle = dark ? '#1F2023' : '#DFE3E8';
  ctx.fillRect(x, y, fw, strip);
  ctx.fillStyle = dark ? '#35363A' : '#FFFFFF';
  ctx.fillRect(x, y + strip, fw, tool);
  dots(x + strip * 0.75, y + strip / 2, strip * 0.16);
  // Active tab.
  ctx.fillStyle = dark ? '#35363A' : '#FFFFFF';
  const tx = x + strip * 2.7;
  const tw = Math.min(fw * 0.26, strip * 9);
  const tr = strip * 0.3;
  round(ctx, tx, y + strip * 0.2, tw, strip * 0.8 + tr, tr);
  ctx.fill();
  const name = url.value.trim() || 'New tab';
  addressText(name, tx + strip * 0.45, y + strip * 0.62, strip * 0.36, tw - strip * 0.9, dark ? '#E3E5E8' : '#3C4043', 'left');
  // Address field.
  const ah = tool * 0.66;
  const ax = x + tool * 1.9;
  const aw = fw - (ax - x) - tool * 0.6;
  ctx.fillStyle = dark ? '#202124' : '#EEF1F4';
  round(ctx, ax, y + strip + (tool - ah) / 2, aw, ah, ah / 2);
  ctx.fill();
  // Back and forward arrows, drawn as simple chevrons.
  ctx.strokeStyle = dark ? '#9AA0A6' : '#80868B';
  ctx.lineWidth = Math.max(1.5, tool * 0.06);
  ctx.lineCap = 'round';
  const cy = y + strip + tool / 2;
  const s = tool * 0.14;
  [x + tool * 0.55, x + tool * 1.25].forEach((cx, i) => {
    const d = i === 0 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.5 * d, cy - s);
    ctx.lineTo(cx - s * 0.5 * d, cy);
    ctx.lineTo(cx + s * 0.5 * d, cy + s);
    ctx.stroke();
  });
  addressText(url.value.trim(), ax + ah * 0.6, cy, tool * 0.34, aw - ah, dark ? '#E3E5E8' : '#3C4043', 'left');
}

// --- Controls ---

function chips(id: string, key: 'size' | 'frame' | 'mode') {
  const box = $<HTMLDivElement>(id);
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b || !box.contains(b)) return;
    (state as Record<string, string>)[key] = b.dataset.v!;
    for (const x of box.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    if (key === 'frame') syncFrameControls();
    draw();
  });
}
chips('sb-size', 'size');
chips('sb-frame', 'frame');
chips('sb-mode', 'mode');

// Rounded corners and the address only apply to some frames.
function syncFrameControls() {
  radius.disabled = state.frame === 'phone';
  url.disabled = state.frame !== 'safari' && state.frame !== 'chrome';
}

for (const [name, bg] of Object.entries(BGS)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.title = name[0].toUpperCase() + name.slice(1);
  b.setAttribute('aria-label', `${b.title} background`);
  b.setAttribute('aria-pressed', String(name === 'sky'));
  b.style.background = bg.grad ? `linear-gradient(135deg, ${bg.a}, ${bg.b})` : bg.a;
  b.addEventListener('click', () => {
    c1.value = bg.a;
    c2.value = bg.b;
    grad.checked = bg.grad;
    c2.disabled = !bg.grad;
    for (const x of bgsBox.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    draw();
  });
  bgsBox.append(b);
}

function clearBgPick() {
  for (const x of bgsBox.querySelectorAll('button')) x.setAttribute('aria-pressed', 'false');
}
c1.addEventListener('input', () => { clearBgPick(); draw(); });
c2.addEventListener('input', () => { clearBgPick(); draw(); });
grad.addEventListener('change', () => { c2.disabled = !grad.checked; clearBgPick(); draw(); });

const out = (id: string) => $<HTMLOutputElement>(id);
pad.addEventListener('input', () => { out('sb-pad-v').value = `${pad.value}%`; draw(); });
radius.addEventListener('input', () => { out('sb-radius-v').value = radius.value; draw(); });
shadow.addEventListener('input', () => { out('sb-shadow-v').value = SHADOWS[Number(shadow.value)].name; draw(); });
url.addEventListener('input', draw);
caption.addEventListener('input', draw);

// --- Loading a screenshot ---

function showError(msg: string) {
  error.textContent = msg;
  error.hidden = !msg;
}

function load(file: File | undefined | null) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showError('That file isn’t a picture. Try a PNG, JPG or WebP screenshot.');
    return;
  }
  const src = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(src);
    if (!img.naturalWidth || !img.naturalHeight) {
      showError('We couldn’t read that picture. Try saving it as PNG first.');
      return;
    }
    shot = img;
    shotW = img.naturalWidth;
    shotH = img.naturalHeight;
    isSample = false;
    hint.hidden = true;
    showError('');
    statusEl.textContent = '';
    fileText.textContent = `Change screenshot (${file.name || 'pasted'})`;
    draw();
  };
  img.onerror = () => {
    URL.revokeObjectURL(src);
    showError('We couldn’t read that picture. Try a PNG, JPG or WebP screenshot. (iPhone HEIC photos need converting first.)');
  };
  img.src = src;
}

fileInput.addEventListener('change', () => {
  load(fileInput.files?.[0]);
  fileInput.value = '';
});

document.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
  if (f) {
    e.preventDefault();
    load(f);
  }
});

// Drop anywhere on the page works, so a near miss doesn't open the picture in the tab.
let dragDepth = 0;
const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  over.hidden = false;
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) over.hidden = true;
});
document.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  over.hidden = true;
  load([...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/')) ?? e.dataTransfer?.files[0]);
});
stage.addEventListener('click', () => {
  if (isSample) fileInput.click();
});

// --- Saving ---

const pngBlob = () => new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('empty'))), 'image/png'));

function say(msg: string) {
  statusEl.textContent = msg;
  window.setTimeout(() => {
    if (statusEl.textContent === msg) statusEl.textContent = '';
  }, 4000);
}

download.addEventListener('click', async () => {
  try {
    const blob = await pngBlob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `screenshot-${state.size}-${canvas.width}x${canvas.height}.png`;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    say(isSample ? 'Saved the sample. Drop your own screenshot to frame it.' : 'Saved.');
  } catch {
    showError('The picture couldn’t be saved. Try a smaller size, like LinkedIn.');
  }
});

copy.addEventListener('click', async () => {
  if (!('ClipboardItem' in window) || !navigator.clipboard?.write) {
    showError('Your browser can’t copy pictures. Use “Download PNG” instead.');
    return;
  }
  try {
    // Passing the promise keeps Safari happy: the copy must start right inside the click.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]);
    showError('');
    say('Copied. Paste it into your post.');
  } catch {
    showError('Copying didn’t work in this browser. Use “Download PNG” instead.');
  }
});

syncFrameControls();
draw();
// Redraw once the site fonts arrive, so the sample and caption use them.
document.fonts?.ready.then(() => {
  if (isSample) shot = makeSample();
  draw();
});
