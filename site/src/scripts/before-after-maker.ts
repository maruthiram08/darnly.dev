// Before and after maker: puts two screenshots side by side, stacked, or in an animated swipe,
// drawn on a canvas in the visitor's browser. GIFs are encoded with gifenc, videos with MediaRecorder. Nothing is uploaded.
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

type Layout = 'side' | 'stack' | 'swipe';
type Size = 'x' | 'linkedin' | 'square';
type Frame = 'browser' | 'card' | 'none';
type Mode = 'light' | 'dark';
type Labels = 'color' | 'plain' | 'off';
type Which = 'before' | 'after';
type Shot = { src: CanvasImageSource; w: number; h: number; sample: boolean; name: string; url: string; time: number };
type Bg = { a: string; b: string; grad: boolean };

const SIZES: Record<Size, [number, number]> = { x: [1600, 900], linkedin: [1200, 627], square: [1080, 1080] };

const BGS: Record<string, Bg> = {
  sky: { a: '#38C6F4', b: '#0593C6', grad: true },
  sunset: { a: '#FF9A5A', b: '#D83995', grad: true },
  peach: { a: '#FFE3B3', b: '#FF8A80', grad: true },
  mint: { a: '#C4F5D8', b: '#2BB38A', grad: true },
  night: { a: '#24495E', b: '#0B2230', grad: true },
  grape: { a: '#A78BFA', b: '#5B21B6', grad: true },
  sand: { a: '#F3EDE4', b: '#F3EDE4', grad: false },
  paper: { a: '#E9F0F3', b: '#E9F0F3', grad: false },
  ink: { a: '#14181C', b: '#14181C', grad: false },
};

const BAR = 0.045; // Browser bar height, as a share of the frame's width.
const GIF_W = 960; // GIFs are made at about this width so they stay small enough to post.

// The swipe's timeline, in seconds: hold on before, wipe to after, hold on after, wipe back.
const HOLD_BEFORE = 0.9;
const WIPE = 1.3;
const HOLD_AFTER = 1.6;
const LOOP = HOLD_BEFORE + WIPE + HOLD_AFTER + WIPE;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const stage = $<HTMLDivElement>('ba-stage');
const canvas = $<HTMLCanvasElement>('ba-canvas');
const ctx = canvas.getContext('2d')!;
const hint = $<HTMLDivElement>('ba-hint');
const over = $<HTMLDivElement>('ba-over');
const statusEl = $<HTMLParagraphElement>('ba-status');
const error = $<HTMLParagraphElement>('ba-error');
const gifBtn = $<HTMLButtonElement>('ba-gif');
const videoBtn = $<HTMLButtonElement>('ba-video');
const pngBtn = $<HTMLButtonElement>('ba-png');
const copyBtn = $<HTMLButtonElement>('ba-copy');
const bgsBox = $<HTMLDivElement>('ba-bgs');
const c1 = $<HTMLInputElement>('ba-c1');
const c2 = $<HTMLInputElement>('ba-c2');
const grad = $<HTMLInputElement>('ba-grad');
const pad = $<HTMLInputElement>('ba-pad');
const url = $<HTMLInputElement>('ba-url');
const caption = $<HTMLInputElement>('ba-caption');
const labelB = $<HTMLInputElement>('ba-lb');
const labelA = $<HTMLInputElement>('ba-la');

const state = { layout: 'side' as Layout, size: 'x' as Size, frame: 'browser' as Frame, mode: 'light' as Mode, labels: 'color' as Labels };
const shots: Record<Which, Shot> = { before: sampleShot(false), after: sampleShot(true) };
let busy = false;

// --- Sample screenshots: the same made-up settings page, broken and then fixed ---

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

function makeSample(fixed: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1600;
  c.height = 1000;
  const g = c.getContext('2d')!;
  const display = '"Bricolage Grotesque", system-ui, sans-serif';
  const body = 'Figtree, system-ui, sans-serif';
  g.fillStyle = '#F7FAFB';
  g.fillRect(0, 0, 1600, 1000);
  // Top bar.
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, 1600, 96);
  g.fillStyle = '#D7E9F0';
  g.fillRect(0, 95, 1600, 2);
  g.fillStyle = '#0B2230';
  g.font = `700 34px ${display}`;
  g.fillText('Acme', 56, 60);
  g.font = `600 22px ${body}`;
  g.fillStyle = '#4A6472';
  ['Dashboard', 'Projects', 'Settings'].forEach((m, i) => g.fillText(m, 980 + i * 170, 58));
  g.fillStyle = fixed ? '#38C6F4' : '#C9D6DC';
  g.beginPath();
  g.arc(1520, 48, 24, 0, Math.PI * 2);
  g.fill();

  if (!fixed) {
    // The bug: a red error banner across the top.
    g.fillStyle = '#FDECEE';
    g.fillRect(0, 97, 1600, 70);
    g.fillStyle = '#B4234F';
    g.font = `600 22px ${body}`;
    g.fillText('⚠  TypeError: Cannot read properties of undefined (reading ‘name’)', 56, 141);
  }

  const top = fixed ? 150 : 210;
  g.fillStyle = '#0B2230';
  g.font = `700 52px ${display}`;
  g.fillText(fixed ? 'Welcome back, Maya 👋' : 'Welcome back, undefined', 160, top + 30);
  g.fillStyle = '#4A6472';
  g.font = `400 24px ${body}`;
  g.fillText('Update your profile and how people see you.', 160, top + 80);

  // The form card.
  const cy = top + 130;
  g.fillStyle = '#FFFFFF';
  round(g, 160, cy, 1280, 560, 24);
  g.fill();
  g.strokeStyle = '#D7E9F0';
  g.lineWidth = 2;
  g.stroke();

  const field = (label: string, value: string, x: number, y: number, w: number, bad: boolean) => {
    g.fillStyle = '#0B2230';
    g.font = `600 22px ${body}`;
    g.fillText(label, x, y);
    g.fillStyle = '#FFFFFF';
    round(g, x, y + 16, w, 64, 12);
    g.fill();
    g.strokeStyle = bad ? '#E5484D' : '#C9D6DC';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = bad ? '#9AA9B1' : '#0B2230';
    g.font = `400 24px ${body}`;
    g.fillText(value, x + 22, y + 57);
  };
  if (fixed) {
    field('Name', 'Maya Patel', 220, cy + 80, 560, false);
    field('Email', 'maya@acme.dev', 820, cy + 80, 560, false);
    field('Company', 'Acme Studio', 220, cy + 230, 560, false);
    field('Role', 'Founder', 820, cy + 230, 560, false);
    // Neat, aligned button and a success note.
    g.fillStyle = '#0593C6';
    round(g, 1150, cy + 420, 230, 70, 35);
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.font = `700 24px ${body}`;
    g.textAlign = 'center';
    g.fillText('Save changes', 1265, cy + 464);
    g.textAlign = 'left';
    g.fillStyle = '#E3F6EC';
    round(g, 220, cy + 422, 330, 66, 33);
    g.fill();
    g.fillStyle = '#12A150';
    g.font = `700 22px ${body}`;
    g.fillText('✓  Changes saved', 252, cy + 463);
  } else {
    field('Name', '', 220, cy + 80, 560, true);
    field('Email', 'maya@acme.dev', 860, cy + 104, 520, false);
    field('Company', 'Acme Studio', 220, cy + 230, 760, false);
    field('Role', 'Founder', 820, cy + 268, 560, false);
    // The button spills out of the card and covers the field.
    g.fillStyle = '#0593C6';
    round(g, 1240, cy + 470, 300, 70, 35);
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.font = `700 24px ${body}`;
    g.fillText('Save chan…', 1290, cy + 514);
    g.fillStyle = '#B4234F';
    g.font = `600 20px ${body}`;
    g.fillText('Something went wrong', 220, cy + 455);
  }
  return c;
}

function sampleShot(fixed: boolean): Shot {
  const c = makeSample(fixed);
  return { src: c, w: c.width, h: c.height, sample: true, name: 'Sample', url: c.toDataURL('image/png'), time: 0 };
}

// --- Drawing ---

function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function captionFont(size: number) {
  return `700 ${size}px "Bricolage Grotesque", "Avenir Next", system-ui, sans-serif`;
}

type Box = { x: number; y: number; w: number; h: number };

// Where the frames go on a W×H picture. Both frames share the before screenshot's shape.
function plan(W: number, H: number) {
  const short = Math.min(W, H);
  const p = short * (Number(pad.value) / 100);
  const text = caption.value.trim();
  const capSize = text ? Math.round(short * 0.05) : 0;
  const capH = capSize * 1.8;
  const ratio = Math.min(3, Math.max(0.3, shots.before.h / shots.before.w));
  const bar = state.frame === 'browser' ? BAR : 0;
  const k = ratio + bar; // Frame height divided by frame width.
  const gap = short * 0.045;
  const availW = W - 2 * p;
  // Room for the labels that sit on the frames' top edge.
  const top = state.labels !== 'off' && state.layout !== 'swipe' ? short * 0.02 : 0;
  const availH = H - 2 * p - capH - top;
  let fw: number;
  if (state.layout === 'side') fw = Math.min((availW - gap) / 2, availH / k);
  else if (state.layout === 'stack') fw = Math.min(availW, (availH - gap) / (2 * k));
  else fw = Math.min(availW, availH / k);
  fw = Math.max(10, fw);
  const fh = fw * k;
  const totalW = state.layout === 'side' ? 2 * fw + gap : fw;
  const totalH = state.layout === 'stack' ? 2 * fh + gap : fh;
  const x0 = (W - totalW) / 2;
  const y0 = capH + p + top + (availH - totalH) / 2;
  const frames: Box[] = [{ x: x0, y: y0, w: fw, h: fh }];
  if (state.layout === 'side') frames.push({ x: x0 + fw + gap, y: y0, w: fw, h: fh });
  if (state.layout === 'stack') frames.push({ x: x0, y: y0 + fh + gap, w: fw, h: fh });
  return { frames, text, capSize, capY: y0 - capH * 0.5, p, bar };
}

// Draws the frame and returns the box the screenshot goes in, already clipped (caller restores).
function frameAt(g: CanvasRenderingContext2D, f: Box, bar: number): Box {
  const dark = state.mode === 'dark';
  const r = state.frame === 'none' ? f.w * 0.008 : f.w * 0.018;
  g.save();
  g.shadowColor = 'rgba(0, 0, 0, 0.28)';
  g.shadowBlur = f.w * 0.04;
  g.shadowOffsetY = f.w * 0.015;
  round(g, f.x, f.y, f.w, f.h, r);
  g.fillStyle = dark ? '#1E1F22' : '#FFFFFF';
  g.fill();
  g.restore();

  g.save();
  round(g, f.x, f.y, f.w, f.h, r);
  g.clip();
  const bh = f.w * bar;
  if (bar) {
    g.fillStyle = dark ? '#2B2D31' : '#F1F3F5';
    g.fillRect(f.x, f.y, f.w, bh);
    g.fillStyle = dark ? '#18191C' : '#DDE1E6';
    g.fillRect(f.x, f.y + bh - Math.max(1, bh * 0.03), f.w, Math.max(1, bh * 0.03));
    ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => {
      g.beginPath();
      g.arc(f.x + bh * 0.62 + i * bh * 0.42, f.y + bh / 2, bh * 0.13, 0, Math.PI * 2);
      g.fillStyle = c;
      g.fill();
    });
    const aw = f.w * 0.4;
    const ah = bh * 0.58;
    g.fillStyle = dark ? '#3A3C42' : '#E3E6EA';
    round(g, f.x + (f.w - aw) / 2, f.y + (bh - ah) / 2, aw, ah, ah * 0.3);
    g.fill();
    const t = url.value.trim();
    if (t) {
      g.font = `500 ${bh * 0.3}px Figtree, system-ui, sans-serif`;
      let s = t;
      while (s.length > 1 && g.measureText(s).width > aw - ah) s = s.slice(0, -1);
      if (s !== t) s = `${s.slice(0, -1)}…`;
      g.fillStyle = dark ? '#C3C6CC' : '#5F6670';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(s, f.x + f.w / 2, f.y + bh / 2);
    }
  }
  const box = { x: f.x, y: f.y + bh, w: f.w, h: f.h - bh };
  g.beginPath();
  g.rect(box.x, box.y, box.w, box.h);
  g.clip();
  return box;
}

// Fits the screenshot inside the box without cropping, centered at the top.
function drawShot(g: CanvasRenderingContext2D, s: Shot, b: Box) {
  const scale = Math.min(b.w / s.w, b.h / s.h);
  const w = s.w * scale;
  const h = s.h * scale;
  g.drawImage(s.src, b.x + (b.w - w) / 2, b.y, w, h);
}

// A label pill. 'edge' sits on the frame's top edge (outside the screenshot, so it hides nothing important);
// the bottom positions sit inside the screenshot, for the swipe.
function pill(g: CanvasRenderingContext2D, text: string, which: Which, b: Box, pos: 'edge' | 'bottom-left' | 'bottom-right', inset = 0) {
  if (state.labels === 'off' || !text) return;
  const size = Math.max(11, b.w * (pos === 'edge' ? 0.032 : 0.026));
  g.font = `700 ${size}px Figtree, system-ui, sans-serif`;
  const dotR = state.labels === 'color' ? size * 0.28 : 0;
  const padX = size * 0.75;
  const w = g.measureText(text).width + 2 * padX + (dotR ? dotR * 2 + size * 0.4 : 0);
  const h = size * 1.9;
  const m = Math.max(6, b.w * 0.022);
  const x = pos === 'edge' ? b.x + inset : pos === 'bottom-left' ? b.x + m : b.x + b.w - m - w;
  const y = pos === 'edge' ? b.y - h / 2 : b.y + b.h - m - h;
  g.save();
  g.shadowColor = 'rgba(0, 0, 0, 0.25)';
  g.shadowBlur = size * 0.6;
  g.shadowOffsetY = size * 0.15;
  round(g, x, y, w, h, h / 2);
  g.fillStyle = state.labels === 'color' ? (which === 'before' ? '#D93A45' : '#12A150') : 'rgba(11, 34, 48, 0.86)';
  g.fill();
  g.restore();
  g.fillStyle = '#FFFFFF';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  let tx = x + padX;
  if (dotR) {
    g.beginPath();
    g.arc(tx + dotR, y + h / 2, dotR, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255, 255, 255, 0.9)';
    g.fill();
    g.fillStyle = '#FFFFFF';
    tx += dotR * 2 + size * 0.4;
  }
  g.fillText(text, tx, y + h / 2 + size * 0.04);
}

// A round arrow badge between the two frames.
function arrow(g: CanvasRenderingContext2D, a: Box, b: Box) {
  const side = state.layout === 'side';
  const cx = side ? (a.x + a.w + b.x) / 2 : a.x + a.w / 2;
  const cy = side ? a.y + a.h / 2 : (a.y + a.h + b.y) / 2;
  const r = Math.max(12, a.w * 0.045);
  g.save();
  g.shadowColor = 'rgba(0, 0, 0, 0.25)';
  g.shadowBlur = r * 0.6;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = '#FFFFFF';
  g.fill();
  g.restore();
  g.save();
  g.translate(cx, cy);
  if (!side) g.rotate(Math.PI / 2);
  g.strokeStyle = '#0B2230';
  g.lineWidth = r * 0.16;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(-r * 0.42, 0);
  g.lineTo(r * 0.42, 0);
  g.moveTo(r * 0.08, -r * 0.34);
  g.lineTo(r * 0.42, 0);
  g.lineTo(r * 0.08, r * 0.34);
  g.stroke();
  g.restore();
}

// The wipe's handle: a white line with a round grip.
function divider(g: CanvasRenderingContext2D, x: number, b: Box) {
  const lw = Math.max(2, b.w * 0.004);
  g.save();
  g.shadowColor = 'rgba(0, 0, 0, 0.35)';
  g.shadowBlur = lw * 3;
  g.fillStyle = '#FFFFFF';
  g.fillRect(x - lw / 2, b.y, lw, b.h);
  const r = Math.max(10, b.w * 0.026);
  g.beginPath();
  g.arc(x, b.y + b.h / 2, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.fillStyle = '#0B2230';
  const cy = b.y + b.h / 2;
  const s = r * 0.32;
  [-1, 1].forEach((d) => {
    g.beginPath();
    g.moveTo(x + d * r * 0.18, cy - s);
    g.lineTo(x + d * (r * 0.18 + s), cy);
    g.lineTo(x + d * r * 0.18, cy + s);
    g.closePath();
    g.fill();
  });
}

// Draws the whole picture. t is where the swipe line sits: 1 shows all of before, 0 all of after.
function compose(g: CanvasRenderingContext2D, W: number, H: number, t: number) {
  if (grad.checked) {
    const gr = g.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, c1.value);
    gr.addColorStop(1, c2.value);
    g.fillStyle = gr;
  } else g.fillStyle = c1.value;
  g.fillRect(0, 0, W, H);

  const L = plan(W, H);
  if (L.text) {
    let size = L.capSize;
    g.font = captionFont(size);
    while (size > 12 && g.measureText(L.text).width > W - 2 * Math.max(L.p, W * 0.04)) {
      size -= 2;
      g.font = captionFont(size);
    }
    const bgLum = (lum(c1.value) + lum(grad.checked ? c2.value : c1.value)) / 2;
    g.fillStyle = bgLum > 0.4 ? '#0B2230' : '#FFFFFF';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(L.text, W / 2, Math.max(size * 0.7, L.capY));
  }

  const lb = labelB.value.trim();
  const la = labelA.value.trim();
  if (state.layout === 'swipe') {
    const f = L.frames[0];
    const box = frameAt(g, f, L.bar);
    drawShot(g, shots.after, box);
    const dx = box.x + box.w * t;
    g.save();
    g.beginPath();
    g.rect(dx, box.y, box.x + box.w - dx, box.h);
    g.clip();
    pill(g, la, 'after', box, 'bottom-right');
    g.restore();
    g.save();
    g.beginPath();
    g.rect(box.x, box.y, dx - box.x, box.h);
    g.clip();
    g.fillStyle = state.mode === 'dark' ? '#1E1F22' : '#FFFFFF';
    g.fillRect(box.x, box.y, box.w, box.h);
    drawShot(g, shots.before, box);
    pill(g, lb, 'before', box, 'bottom-left');
    g.restore();
    if (t > 0.001 && t < 0.999) divider(g, dx, box);
    g.restore();
    return;
  }
  (['before', 'after'] as Which[]).forEach((w, i) => {
    const f = L.frames[i];
    const box = frameAt(g, f, L.bar);
    drawShot(g, shots[w], box);
    g.restore();
    pill(g, w === 'before' ? lb : la, w, f, 'edge', L.bar ? f.w * L.bar * 2.3 : f.w * 0.04);
  });
  arrow(g, L.frames[0], L.frames[1]);
}

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

// Swipe position at a moment in the loop.
function tAt(sec: number) {
  const s = sec % LOOP;
  if (s < HOLD_BEFORE) return 1;
  if (s < HOLD_BEFORE + WIPE) return 1 - ease((s - HOLD_BEFORE) / WIPE);
  if (s < HOLD_BEFORE + WIPE + HOLD_AFTER) return 0;
  return ease((s - HOLD_BEFORE - WIPE - HOLD_AFTER) / WIPE);
}

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let raf = 0;
let start = performance.now();

function draw() {
  const [W, H] = SIZES[state.size];
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const t = state.layout === 'swipe' ? (reduceMotion ? 0.5 : tAt((performance.now() - start) / 1000)) : 0.5;
  compose(ctx, W, H, t);
}

function tick() {
  draw();
  raf = state.layout === 'swipe' && !reduceMotion ? requestAnimationFrame(tick) : 0;
}

function redraw() {
  if (!raf) tick();
}

// --- Controls ---

function syncButtons() {
  const swipe = state.layout === 'swipe';
  for (const b of document.querySelectorAll<HTMLElement>('#ba-actions .anim')) b.hidden = !swipe;
  pngBtn.textContent = swipe ? 'Still PNG' : 'Download PNG';
  pngBtn.className = swipe ? 'ghost' : 'primary';
  copyBtn.hidden = swipe;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#ba-mode button')) b.disabled = state.frame === 'none';
  url.disabled = state.frame !== 'browser';
}

function chips(id: string, key: keyof typeof state) {
  const box = $<HTMLDivElement>(id);
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b || !box.contains(b) || b.disabled) return;
    (state as Record<string, string>)[key] = b.dataset.v!;
    for (const x of box.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    if (key === 'layout') start = performance.now();
    syncButtons();
    redraw();
  });
}
chips('ba-layout', 'layout');
chips('ba-size', 'size');
chips('ba-frame', 'frame');
chips('ba-mode', 'mode');
chips('ba-labels', 'labels');

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
    redraw();
  });
  bgsBox.append(b);
}
function clearBgPick() {
  for (const x of bgsBox.querySelectorAll('button')) x.setAttribute('aria-pressed', 'false');
}
c1.addEventListener('input', () => { clearBgPick(); redraw(); });
c2.addEventListener('input', () => { clearBgPick(); redraw(); });
grad.addEventListener('change', () => { c2.disabled = !grad.checked; clearBgPick(); redraw(); });
pad.addEventListener('input', () => { $<HTMLOutputElement>('ba-pad-v').value = `${pad.value}%`; redraw(); });
for (const el of [url, caption, labelB, labelA]) el.addEventListener('input', redraw);

// --- Loading screenshots ---

function showError(msg: string) {
  error.textContent = msg;
  error.hidden = !msg;
}

function say(msg: string, keep = false) {
  statusEl.textContent = msg;
  if (!keep) window.setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ''; }, 5000);
}

function syncSlots() {
  for (const w of ['before', 'after'] as Which[]) {
    $<HTMLImageElement>(`ba-thumb-${w}`).src = shots[w].url;
    $<HTMLSpanElement>(`ba-name-${w}`).textContent = shots[w].name;
  }
  hint.hidden = !shots.before.sample && !shots.after.sample;
}

function load(file: File, which: Which) {
  if (!file.type.startsWith('image/')) {
    showError('That file isn’t a picture. Try a PNG, JPG or WebP screenshot.');
    return;
  }
  const src = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    if (!img.naturalWidth || !img.naturalHeight) {
      showError('We couldn’t read that picture. Try saving it as PNG first.');
      return;
    }
    const old = shots[which];
    if (!old.sample) URL.revokeObjectURL(old.url);
    shots[which] = { src: img, w: img.naturalWidth, h: img.naturalHeight, sample: false, name: file.name || 'Pasted picture', url: src, time: file.lastModified || Date.now() };
    showError('');
    syncSlots();
    redraw();
    if (shots.before.sample !== shots.after.sample) say(`Now add your ${shots.before.sample ? 'before' : 'after'} screenshot.`);
  };
  img.onerror = () => {
    URL.revokeObjectURL(src);
    showError('We couldn’t read that picture. Try a PNG, JPG or WebP screenshot. (iPhone HEIC photos need converting first.)');
  };
  img.src = src;
}

// One picture with no slot named: fill the sample slot first (before, then after), otherwise replace after.
const nextSlot = (): Which => (shots.before.sample ? 'before' : 'after');

function loadMany(files: File[]) {
  const imgs = files.filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) {
    if (files.length) showError('That file isn’t a picture. Try a PNG, JPG or WebP screenshot.');
    return;
  }
  if (imgs.length >= 2) {
    // The older file is the before.
    const [a, b] = imgs.slice(0, 2).sort((x, y) => x.lastModified - y.lastModified || x.name.localeCompare(y.name));
    load(a, 'before');
    load(b, 'after');
  } else load(imgs[0], nextSlot());
}

for (const w of ['before', 'after'] as Which[]) {
  const input = $<HTMLInputElement>(`ba-file-${w}`);
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) load(f, w);
    input.value = '';
  });
  const slot = $<HTMLDivElement>(`ba-slot-${w}`);
  slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('over'); });
  slot.addEventListener('dragleave', () => slot.classList.remove('over'));
  slot.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    slot.classList.remove('over');
    resetDrag();
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length >= 2) loadMany(files);
    else if (files[0]) load(files[0], w);
  });
}

$<HTMLButtonElement>('ba-swap').addEventListener('click', () => {
  [shots.before, shots.after] = [shots.after, shots.before];
  syncSlots();
  redraw();
});

document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])].filter((x) => x.type.startsWith('image/'));
  if (files.length) {
    e.preventDefault();
    loadMany(files);
  }
});

let dragDepth = 0;
const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
function resetDrag() {
  dragDepth = 0;
  over.hidden = true;
}
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
document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  resetDrag();
  loadMany([...(e.dataTransfer?.files ?? [])]);
});
stage.addEventListener('click', () => {
  if (shots.before.sample || shots.after.sample) $<HTMLInputElement>(`ba-file-${nextSlot()}`).click();
});

// --- Saving ---

const sampleNote = () => (shots.before.sample || shots.after.sample ? ' Add your own screenshots to replace the sample.' : '');

function save(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const mb = (n: number) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1000))} KB` : `${(n / 1e6).toFixed(1)} MB`);

function stillCanvas() {
  const [W, H] = SIZES[state.size];
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  compose(c.getContext('2d')!, W, H, 0.5);
  return c;
}

const pngBlob = () => new Promise<Blob>((res, rej) => stillCanvas().toBlob((b) => (b ? res(b) : rej(new Error('empty'))), 'image/png'));

function lock(on: boolean) {
  busy = on;
  for (const b of [gifBtn, videoBtn, pngBtn, copyBtn]) b.disabled = on;
}

pngBtn.addEventListener('click', async () => {
  try {
    const [W, H] = SIZES[state.size];
    save(await pngBlob(), `before-after-${state.layout}-${W}x${H}.png`);
    say(`Saved.${sampleNote()}`);
  } catch {
    showError('The picture couldn’t be saved. Try the LinkedIn size.');
  }
});

copyBtn.addEventListener('click', async () => {
  if (!('ClipboardItem' in window) || !navigator.clipboard?.write) {
    showError('Your browser can’t copy pictures. Use “Download PNG” instead.');
    return;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]);
    showError('');
    say('Copied. Paste it into your post.');
  } catch {
    showError('Copying didn’t work in this browser. Use “Download PNG” instead.');
  }
});

const pause = () => new Promise((r) => setTimeout(r, 0));

gifBtn.addEventListener('click', async () => {
  if (busy) return;
  lock(true);
  showError('');
  try {
    const [W, H] = SIZES[state.size];
    const s = Math.min(1, GIF_W / W);
    const w = Math.round(W * s);
    const h = Math.round(H * s);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const frame = (t: number) => {
      g.setTransform(s, 0, 0, s, 0, 0);
      compose(g, W, H, t);
      g.setTransform(1, 0, 0, 1, 0, 0);
      return g.getImageData(0, 0, w, h).data;
    };
    // One palette for every frame, taken from all-before, all-after and the halfway frame.
    const a = frame(1);
    const b = frame(0);
    const m = frame(0.5);
    const mix = new Uint8ClampedArray(a.length * 3);
    mix.set(a, 0);
    mix.set(b, a.length);
    mix.set(m, a.length * 2);
    const palette = quantize(mix, 256);
    const gif = GIFEncoder();
    const steps = 26;
    const stepMs = Math.round((WIPE * 1000) / steps);
    const plan: [number, number][] = [[1, HOLD_BEFORE * 1000]];
    for (let i = 1; i < steps; i++) plan.push([1 - ease(i / steps), stepMs]);
    plan.push([0, HOLD_AFTER * 1000]);
    for (let i = 1; i < steps; i++) plan.push([ease(i / steps), stepMs]);
    for (let i = 0; i < plan.length; i++) {
      const [t, delay] = plan[i];
      const data = t === 1 ? a : t === 0 ? b : frame(t);
      gif.writeFrame(applyPalette(data, palette), w, h, i === 0 ? { palette, delay } : { delay });
      if (i % 4 === 0) {
        say(`Making your GIF… ${Math.round((i / plan.length) * 100)}%`, true);
        await pause();
      }
    }
    gif.finish();
    const blob = new Blob([gif.bytes()], { type: 'image/gif' });
    save(blob, `before-after-${w}x${h}.gif`);
    say(`Saved a ${mb(blob.size)} GIF.${blob.size > 15e6 ? ' That’s over X’s 15 MB limit: post the video instead.' : ''}${sampleNote()}`);
  } catch {
    showError('The GIF couldn’t be made in this browser. Try “Download video” or a smaller size.');
    statusEl.textContent = '';
  } finally {
    lock(false);
  }
});

function videoType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = ['video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

videoBtn.addEventListener('click', async () => {
  if (busy) return;
  const type = videoType();
  const c = document.createElement('canvas');
  if (!type || typeof c.captureStream !== 'function') {
    showError('Your browser can’t record video. Use “Download GIF” instead.');
    return;
  }
  lock(true);
  showError('');
  try {
    const [W, H] = SIZES[state.size];
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    compose(g, W, H, 1);
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const done = new Promise<void>((res) => { rec.onstop = () => res(); });
    // Two loops, drawn in real time, so the video plays at the right speed.
    const length = LOOP * 2;
    const t0 = performance.now();
    rec.start(250);
    await new Promise<void>((res) => {
      const timer = window.setInterval(() => {
        const sec = (performance.now() - t0) / 1000;
        compose(g, W, H, tAt(Math.min(sec, length)));
        say(`Recording your video… ${Math.min(100, Math.round((sec / length) * 100))}%`, true);
        if (sec >= length) {
          window.clearInterval(timer);
          res();
        }
      }, 1000 / 30);
    });
    rec.stop();
    await done;
    for (const tr of stream.getTracks()) tr.stop();
    const mp4 = type.startsWith('video/mp4');
    const blob = new Blob(parts, { type: mp4 ? 'video/mp4' : 'video/webm' });
    save(blob, `before-after-${W}x${H}.${mp4 ? 'mp4' : 'webm'}`);
    say(`Saved a ${mb(blob.size)} ${mp4 ? 'MP4' : 'WebM'} video.${mp4 ? '' : ' X needs MP4: if it won’t upload, post the GIF.'}${sampleNote()}`);
  } catch {
    showError('The video couldn’t be recorded in this browser. Use “Download GIF” instead.');
    statusEl.textContent = '';
  } finally {
    lock(false);
  }
});

// --- Start ---

syncSlots();
syncButtons();
redraw();
// Redraw once the site fonts arrive, so the sample screenshots use them.
document.fonts?.ready.then(() => {
  if (shots.before.sample) shots.before = sampleShot(false);
  if (shots.after.sample) shots.after = sampleShot(true);
  syncSlots();
  redraw();
});
