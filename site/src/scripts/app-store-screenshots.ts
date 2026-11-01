// App Store screenshot maker: puts app screenshots in a device frame with a headline,
// at the exact App Store and Google Play sizes. Everything is drawn on a canvas in the browser.
import { makeZip, type ZipEntry } from './zip';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const cardsEl = $<HTMLDivElement>('ss-cards');
const verdict = $<HTMLParagraphElement>('ss-verdict');
const exampleNote = $<HTMLParagraphElement>('ss-example');
const fileInput = $<HTMLInputElement>('ss-file');
const drop = $<HTMLLabelElement>('ss-drop');
const dropTitle = $<HTMLElement>('ss-drop-title');
const dropText = $<HTMLSpanElement>('ss-drop-text');
const errorEl = $<HTMLParagraphElement>('ss-error');
const warnEl = $<HTMLParagraphElement>('ss-warn');
const swatchesEl = $<HTMLDivElement>('ss-swatches');
const customColor = $<HTMLInputElement>('ss-color');
const download = $<HTMLButtonElement>('ss-download');
const statusEl = $<HTMLSpanElement>('ss-status');
const textSel = $<HTMLSelectElement>('ss-text');
const posSel = $<HTMLSelectElement>('ss-pos');
const frameSel = $<HTMLSelectElement>('ss-frame');
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#ss .devices button'));

const MAX = 6;

type Kind = 'iphone' | 'ipad' | 'android';
type DeviceKey = 'iphone69' | 'iphone65' | 'ipad13' | 'play';
type Device = { label: string; w: number; h: number; kind: Kind; folder: string; store: string };

const DEVICES: Record<DeviceKey, Device> = {
  iphone69: { label: 'iPhone 6.9"', w: 1320, h: 2868, kind: 'iphone', folder: 'app-store-iphone-6.9', store: 'the App Store' },
  iphone65: { label: 'iPhone 6.5"', w: 1284, h: 2778, kind: 'iphone', folder: 'app-store-iphone-6.5', store: 'the App Store' },
  ipad13: { label: 'iPad 13"', w: 2064, h: 2752, kind: 'ipad', folder: 'app-store-ipad-13', store: 'the App Store' },
  play: { label: 'Google Play phone', w: 1080, h: 1920, kind: 'android', folder: 'google-play-phone', store: 'Google Play' },
};

// Screen shape and bezel of each frame, as fractions of the body's width.
const FRAMES: Record<Kind, { aspect: number; bezel: number; radius: number }> = {
  iphone: { aspect: 1320 / 2868, bezel: 0.034, radius: 0.15 },
  android: { aspect: 9 / 19.5, bezel: 0.03, radius: 0.11 },
  ipad: { aspect: 2064 / 2752, bezel: 0.035, radius: 0.055 },
};

type Bg = { id: string; name: string; stops: [string, string] };
const BGS: Bg[] = [
  { id: 'sky', name: 'Sky', stops: ['#38BDF8', '#0369A1'] },
  { id: 'sunset', name: 'Sunset', stops: ['#FB923C', '#DB2777'] },
  { id: 'grape', name: 'Grape', stops: ['#A78BFA', '#4C1D95'] },
  { id: 'mint', name: 'Mint', stops: ['#6EE7B7', '#0F766E'] },
  { id: 'night', name: 'Night', stops: ['#334155', '#020617'] },
  { id: 'cream', name: 'Cream', stops: ['#F7F1E3', '#F7F1E3'] },
  { id: 'white', name: 'White', stops: ['#FFFFFF', '#EEF3F6'] },
];

type Shot = { img: CanvasImageSource; w: number; h: number; caption: string };

let shots: Shot[] = [];
let isExample = true;
let device: DeviceKey = 'iphone69';
let bg: [string, string] = BGS[0].stops;
let bgId = 'sky';

const FONT = '"Bricolage Grotesque", system-ui, -apple-system, "Segoe UI", sans-serif';

// ---------- colors ----------

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function textColor(): string {
  if (textSel.value !== 'auto') return textSel.value;
  return (lum(bg[0]) + lum(bg[1])) / 2 > 0.45 ? '#0B1F2A' : '#FFFFFF';
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f),
  );
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// ---------- drawing ----------

function wrap(x: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (x.measureText(test).width > maxW && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    if (line) lines.push(line);
  }
  return lines;
}

// Every headline gets the same block (two lines at full size), so the phones line up across the set.
// Long headlines shrink until they fit in that block.
function layoutCaption(x: CanvasRenderingContext2D, text: string, W: number, base: number) {
  const maxW = W * 0.84;
  const block = base * 1.1 * 2;
  let size = base;
  let lines: string[] = [];
  for (let i = 0; i < 12; i++) {
    x.font = `800 ${size}px ${FONT}`;
    lines = wrap(x, text, maxW);
    const widest = Math.max(0, ...lines.map((l) => x.measureText(l).width));
    if (lines.length * size * 1.1 <= block && widest <= maxW) break;
    size *= 0.9;
  }
  return { size, lines, lineH: size * 1.1, block };
}

function drawCover(x: CanvasRenderingContext2D, s: Shot, dx: number, dy: number, dw: number, dh: number) {
  const scale = Math.max(dw / s.w, dh / s.h);
  const sw = dw / scale;
  const sh = dh / scale;
  // Keep the top of the screenshot (status bar and title) and crop from the bottom if needed.
  const sx = (s.w - sw) / 2;
  const sy = 0;
  x.drawImage(s.img, sx, sy, sw, sh, dx, dy, dw, dh);
}

// The frame to use for a screenshot: phone screenshots on the iPad size keep a phone frame.
function frameKind(d: Device, s: Shot): Kind {
  if (d.kind === 'ipad' && s.w / s.h < 0.62) return 'iphone';
  return d.kind;
}

function render(c: HTMLCanvasElement, d: Device, s: Shot, scale: number) {
  c.width = Math.round(d.w * scale);
  c.height = Math.round(d.h * scale);
  const x = c.getContext('2d')!;
  x.setTransform(scale, 0, 0, scale, 0, 0);
  x.imageSmoothingQuality = 'high';
  const W = d.w;
  const H = d.h;

  // Background
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, bg[0]);
  g.addColorStop(1, bg[1]);
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);

  // Headline
  const pad = W * 0.07;
  const wideCanvas = W / H > 0.65;
  const cap = s.caption.trim();
  const { size, lines, lineH, block } = layoutCaption(x, cap, W, W * (wideCanvas ? 0.058 : 0.082));
  const capH = block;
  const gap = H * 0.035;
  const top = H * (wideCanvas ? 0.06 : 0.065);
  const bottom = H * 0.045;
  const atTop = posSel.value !== 'bottom';

  // Device box
  const kind = frameKind(d, s);
  const noFrame = frameSel.value === 'none';
  const f = FRAMES[kind];
  const k = noFrame ? 0 : f.bezel;
  const ratio = (1 - 2 * k) / f.aspect + 2 * k; // body height / body width
  const availH = H - top - bottom - capH - gap;
  const maxW = W * (kind === 'ipad' ? 0.84 : wideCanvas ? 0.56 : 0.8);
  const bw = Math.min(maxW, availH / ratio);
  const bh = bw * ratio;
  const bx = (W - bw) / 2;
  const by = atTop ? top + capH + gap + (availH - bh) / 2 : top + (availH - bh) / 2;
  const capY = atTop ? top : by + bh + gap;

  x.fillStyle = textColor();
  x.font = `800 ${size}px ${FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'top';
  const textTop = capY + (capH - lines.length * lineH) / 2;
  lines.forEach((l, i) => x.fillText(l, W / 2, textTop + i * lineH + (lineH - size) / 2));

  drawDevice(x, s, kind, bx, by, bw, bh, k, noFrame);
}

function drawDevice(
  x: CanvasRenderingContext2D, s: Shot, kind: Kind,
  bx: number, by: number, bw: number, bh: number, k: number, noFrame: boolean,
) {
  const f = FRAMES[kind];
  const R = bw * f.radius;
  const b = bw * k;
  const sx = bx + b;
  const sy = by + b;
  const sw = bw - 2 * b;
  const sh = bh - 2 * b;
  const sr = noFrame ? sw * 0.06 : Math.max(0, R - b);

  // Shadow
  x.save();
  x.shadowColor = 'rgba(0, 0, 0, 0.32)';
  x.shadowBlur = bw * 0.08;
  x.shadowOffsetY = bw * 0.03;
  x.beginPath();
  x.roundRect(bx, by, bw, bh, noFrame ? sr : R);
  x.fillStyle = '#0A0A0C';
  x.fill();
  x.restore();

  if (!noFrame) {
    const silver = frameSel.value === 'silver';
    // Metal band, then the black glass bezel inside it.
    const band = x.createLinearGradient(bx, by, bx + bw, by + bh);
    band.addColorStop(0, silver ? '#F1F3F5' : '#4A4A50');
    band.addColorStop(0.5, silver ? '#BFC5CC' : '#1C1C20');
    band.addColorStop(1, silver ? '#E3E6EA' : '#3A3A40');
    x.beginPath();
    x.roundRect(bx, by, bw, bh, R);
    x.fillStyle = band;
    x.fill();
    const m = b * 0.32;
    x.beginPath();
    x.roundRect(bx + m, by + m, bw - 2 * m, bh - 2 * m, Math.max(0, R - m));
    x.fillStyle = '#060608';
    x.fill();
  }

  // Screen
  x.save();
  x.beginPath();
  x.roundRect(sx, sy, sw, sh, sr);
  x.clip();
  x.fillStyle = '#FFFFFF';
  x.fillRect(sx, sy, sw, sh);
  drawCover(x, s, sx, sy, sw, sh);
  x.restore();

  if (noFrame) return;
  x.fillStyle = '#000000';
  if (kind === 'iphone') {
    // Dynamic Island
    const iw = sw * 0.3;
    const ih = sw * 0.085;
    x.beginPath();
    x.roundRect(sx + (sw - iw) / 2, sy + sw * 0.03, iw, ih, ih / 2);
    x.fill();
  } else if (kind === 'android') {
    // Punch-hole camera
    x.beginPath();
    x.arc(sx + sw / 2, sy + sw * 0.055, sw * 0.03, 0, Math.PI * 2);
    x.fill();
  }
}

// ---------- example app (shown until the user drops screenshots) ----------

function exampleScreens(): Shot[] {
  const W = 1170;
  const H = 2532;
  const make = (draw: (x: CanvasRenderingContext2D) => void): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d')!;
    x.fillStyle = '#F6F8FB';
    x.fillRect(0, 0, W, H);
    // Status bar
    x.fillStyle = '#0B1F2A';
    x.font = `600 50px system-ui, -apple-system, sans-serif`;
    x.textBaseline = 'middle';
    x.fillText('9:41', 110, 95);
    x.beginPath();
    x.roundRect(W - 190, 78, 90, 38, 10);
    x.fill();
    draw(x);
    return c;
  };
  const title = (x: CanvasRenderingContext2D, t: string, sub: string) => {
    x.fillStyle = '#0B1F2A';
    x.font = `800 110px ${FONT}`;
    x.textBaseline = 'alphabetic';
    x.fillText(t, 80, 360);
    x.fillStyle = '#5B7280';
    x.font = `500 48px system-ui, -apple-system, sans-serif`;
    x.fillText(sub, 82, 440);
  };
  const cardBox = (x: CanvasRenderingContext2D, y: number, h: number) => {
    x.fillStyle = '#FFFFFF';
    x.beginPath();
    x.roundRect(60, y, W - 120, h, 48);
    x.fill();
  };
  const tabBar = (x: CanvasRenderingContext2D, active: number) => {
    x.fillStyle = '#FFFFFF';
    x.fillRect(0, H - 250, W, 250);
    for (let i = 0; i < 3; i++) {
      x.fillStyle = i === active ? '#0590C2' : '#B8C6CF';
      x.beginPath();
      x.roundRect(W * (0.2 + i * 0.3) - 40, H - 190, 80, 80, 24);
      x.fill();
    }
  };

  const habits: [string, string, boolean, number][] = [
    ['Drink water', '#38BDF8', true, 21],
    ['Read 10 pages', '#A78BFA', true, 12],
    ['Morning walk', '#34D399', true, 8],
    ['Meditate', '#FB923C', false, 5],
    ['No phone in bed', '#F472B6', false, 3],
  ];

  const today = make((x) => {
    title(x, 'Today', 'Wednesday · 3 of 5 done');
    habits.forEach(([name, color, done, streak], i) => {
      const y = 520 + i * 250;
      cardBox(x, y, 210);
      x.fillStyle = done ? color : '#FFFFFF';
      x.strokeStyle = color;
      x.lineWidth = 10;
      x.beginPath();
      x.arc(170, y + 105, 50, 0, Math.PI * 2);
      x.fill();
      x.stroke();
      if (done) {
        x.strokeStyle = '#FFFFFF';
        x.lineWidth = 14;
        x.lineCap = 'round';
        x.beginPath();
        x.moveTo(145, y + 105);
        x.lineTo(165, y + 125);
        x.lineTo(198, y + 88);
        x.stroke();
      }
      x.fillStyle = '#0B1F2A';
      x.font = `600 56px system-ui, -apple-system, sans-serif`;
      x.textBaseline = 'middle';
      x.fillText(name, 260, y + 105);
      x.fillStyle = '#5B7280';
      x.font = `600 46px system-ui, -apple-system, sans-serif`;
      x.textAlign = 'right';
      x.fillText(`🔥 ${streak}`, W - 110, y + 105);
      x.textAlign = 'left';
    });
    tabBar(x, 0);
  });

  const progress = make((x) => {
    title(x, 'Progress', 'Your best month yet');
    cardBox(x, 520, 560);
    x.fillStyle = '#0590C2';
    x.font = `800 230px ${FONT}`;
    x.textBaseline = 'alphabetic';
    x.fillText('21', 120, 830);
    x.fillStyle = '#0B1F2A';
    x.font = `600 60px system-ui, -apple-system, sans-serif`;
    x.fillText('day streak', 120, 930);
    x.fillStyle = '#5B7280';
    x.font = `500 46px system-ui, -apple-system, sans-serif`;
    x.fillText('Longest ever: 21 days', 120, 1010);
    cardBox(x, 1130, 900);
    const vals = [0.5, 0.7, 0.55, 0.9, 0.8, 1, 0.75];
    const days = 'MTWTFSS';
    vals.forEach((v, i) => {
      const bwid = 90;
      const gx = 140 + i * 130;
      const bh = 560 * v;
      const grad = x.createLinearGradient(0, 1800 - bh, 0, 1800);
      grad.addColorStop(0, '#38BDF8');
      grad.addColorStop(1, '#0369A1');
      x.fillStyle = grad;
      x.beginPath();
      x.roundRect(gx, 1800 - bh, bwid, bh, 24);
      x.fill();
      x.fillStyle = '#5B7280';
      x.font = `600 44px system-ui, -apple-system, sans-serif`;
      x.textAlign = 'center';
      x.fillText(days[i], gx + bwid / 2, 1900);
      x.textAlign = 'left';
    });
    tabBar(x, 1);
  });

  const reminders = make((x) => {
    title(x, 'Reminders', 'Gentle nudges, never spam');
    const rows: [string, string, boolean][] = [
      ['Drink water', 'Every 2 hours', true],
      ['Read 10 pages', '9:30 PM', true],
      ['Morning walk', '7:00 AM', true],
      ['Meditate', '8:00 AM', false],
      ['Weekly review', 'Sunday · 6:00 PM', true],
    ];
    rows.forEach(([name, time, on], i) => {
      const y = 520 + i * 250;
      cardBox(x, y, 210);
      x.fillStyle = '#0B1F2A';
      x.font = `600 56px system-ui, -apple-system, sans-serif`;
      x.textBaseline = 'alphabetic';
      x.fillText(name, 120, y + 95);
      x.fillStyle = '#5B7280';
      x.font = `500 44px system-ui, -apple-system, sans-serif`;
      x.fillText(time, 120, y + 160);
      x.fillStyle = on ? '#34C759' : '#D5DEE4';
      x.beginPath();
      x.roundRect(W - 300, y + 65, 170, 90, 45);
      x.fill();
      x.fillStyle = '#FFFFFF';
      x.beginPath();
      x.arc(on ? W - 175 : W - 255, y + 110, 37, 0, Math.PI * 2);
      x.fill();
    });
    tabBar(x, 2);
  });

  return [
    { img: today, w: W, h: H, caption: 'Build habits that actually stick' },
    { img: progress, w: W, h: H, caption: 'See your progress at a glance' },
    { img: reminders, w: W, h: H, caption: 'Reminders that fit your day' },
  ];
}

// ---------- UI ----------

const PREVIEW_SCALE = () => (DEVICES[device].kind === 'ipad' ? 520 : 400) / DEVICES[device].w;

function renderCard(i: number) {
  const c = cardsEl.querySelector<HTMLCanvasElement>(`canvas[data-i="${i}"]`);
  if (c) render(c, DEVICES[device], shots[i], PREVIEW_SCALE());
}

function renderAll() {
  shots.forEach((_, i) => renderCard(i));
  updateVerdict();
}

function updateVerdict() {
  const d = DEVICES[device];
  const n = shots.length;
  const phoneOnIpad = d.kind === 'ipad' && shots.some((s) => frameKind(d, s) !== 'ipad');
  if (phoneOnIpad && !isExample) {
    verdict.style.color = '#6B4A00';
    verdict.textContent = `${d.w} × ${d.h} · these look like phone screenshots, so a phone is shown. Use iPad screenshots for iPad.`;
  } else {
    verdict.style.color = '';
    verdict.textContent = `✓ ${n} screenshot${n === 1 ? '' : 's'} · ${d.w} × ${d.h} · the size ${d.store} asks for`;
  }
}

function buildCards() {
  cardsEl.textContent = '';
  const wide = DEVICES[device].kind === 'ipad';
  shots.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = wide ? 'card wide' : 'card';
    const c = document.createElement('canvas');
    c.dataset.i = String(i);
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', `Screenshot ${i + 1}: ${s.caption || 'no headline'}`);
    const cap = document.createElement('textarea');
    cap.className = 'cap';
    cap.rows = 2;
    cap.value = s.caption;
    cap.placeholder = 'Type a headline';
    cap.setAttribute('aria-label', `Headline for screenshot ${i + 1}`);
    cap.addEventListener('input', () => {
      shots[i].caption = cap.value;
      c.setAttribute('aria-label', `Screenshot ${i + 1}: ${cap.value || 'no headline'}`);
      renderCard(i);
    });
    card.append(c, cap);
    if (!isExample) {
      const tools = document.createElement('div');
      tools.className = 'tools';
      const btn = (label: string, title: string, disabled: boolean, fn: () => void) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.title = title;
        b.setAttribute('aria-label', `${title} (screenshot ${i + 1})`);
        b.disabled = disabled;
        b.addEventListener('click', fn);
        tools.append(b);
      };
      btn('←', 'Move left', i === 0, () => move(i, -1));
      btn('→', 'Move right', i === shots.length - 1, () => move(i, 1));
      btn('Remove', 'Remove', false, () => remove(i));
      card.append(tools);
    }
    cardsEl.append(card);
  });
  exampleNote.hidden = !isExample;
  dropTitle.textContent = isExample ? 'Drop your app screenshots here' : shots.length >= MAX ? 'You have 6 screenshots' : 'Add more screenshots';
  dropText.textContent = isExample
    ? '1 to 6 images, or click to choose. You can also paste a screenshot.'
    : shots.length >= MAX
      ? 'Remove one to add another.'
      : `${MAX - shots.length} more allowed. Drop, click or paste.`;
  renderAll();
}

function move(i: number, dir: number) {
  const j = i + dir;
  [shots[i], shots[j]] = [shots[j], shots[i]];
  buildCards();
}

function remove(i: number) {
  shots.splice(i, 1);
  if (!shots.length) {
    shots = exampleScreens();
    isExample = true;
  }
  buildCards();
}

function loadImage(file: File): Promise<Shot> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, w: img.naturalWidth, h: img.naturalHeight, caption: 'Your headline here' });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(file.name));
    };
    img.src = url;
  });
}

async function addFiles(files: File[]) {
  errorEl.hidden = true;
  warnEl.hidden = true;
  const images = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif)$/i.test(f.name));
  if (!images.length) {
    errorEl.textContent = 'That doesn’t look like an image. Use a PNG or JPG screenshot.';
    errorEl.hidden = false;
    return;
  }
  const loaded: Shot[] = [];
  const failed: string[] = [];
  for (const f of images) {
    try {
      loaded.push(await loadImage(f));
    } catch {
      failed.push(f.name);
    }
  }
  if (failed.length) {
    errorEl.textContent = `Couldn’t open ${failed.join(', ')}. Save it as PNG or JPG and try again (iPhone HEIC photos don’t open in most browsers).`;
    errorEl.hidden = false;
  }
  if (!loaded.length) return;
  if (isExample) {
    shots = [];
    isExample = false;
  }
  const room = MAX - shots.length;
  if (loaded.length > room) {
    warnEl.textContent = `You can use up to ${MAX} screenshots, so only ${room === 0 ? 'none' : `the first ${room}`} of these ${room === 1 ? 'was' : 'were'} added.`;
    warnEl.hidden = false;
  }
  shots.push(...loaded.slice(0, Math.max(0, room)));
  const landscape = loaded.some((s) => s.w > s.h);
  if (landscape) {
    warnEl.textContent = 'One of your screenshots is wider than it is tall. This tool makes portrait screenshots, so it gets cropped. Use a portrait screenshot for the best result.';
    warnEl.hidden = false;
  }
  buildCards();
  cardsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function buildSwatches() {
  for (const b of BGS) {
    const el = document.createElement('button');
    el.type = 'button';
    el.setAttribute('role', 'radio');
    el.setAttribute('aria-label', b.name);
    el.title = b.name;
    el.dataset.id = b.id;
    el.style.background = `linear-gradient(135deg, ${b.stops[0]}, ${b.stops[1]})`;
    el.addEventListener('click', () => {
      bg = b.stops;
      bgId = b.id;
      syncSwatches();
      renderAll();
    });
    swatchesEl.append(el);
  }
  syncSwatches();
}

function syncSwatches() {
  swatchesEl.querySelectorAll<HTMLButtonElement>('button').forEach((el) => {
    el.setAttribute('aria-checked', String(el.dataset.id === bgId));
  });
}

customColor.addEventListener('input', () => {
  const c = customColor.value;
  bg = [shade(c, 0.12), shade(c, -0.25)];
  bgId = 'custom';
  syncSwatches();
  renderAll();
});

tabs.forEach((t) =>
  t.addEventListener('click', () => {
    device = t.dataset.device as DeviceKey;
    tabs.forEach((o) => o.setAttribute('aria-selected', String(o === t)));
    buildCards();
  }),
);

[textSel, posSel, frameSel].forEach((s) => s.addEventListener('change', renderAll));

fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) addFiles(Array.from(fileInput.files));
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
  if (e.dataTransfer?.files.length) addFiles(Array.from(e.dataTransfer.files));
});
document.addEventListener('paste', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
  const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
  if (files.length) {
    e.preventDefault();
    addFiles(files);
  }
});

// ---------- download ----------

function toPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error('png'))), 'image/png'),
  );
}

const README = `App Store and Google Play screenshots, made with https://darnly.dev/tools/app-store-screenshots/

Folders
- app-store-iphone-6.9   1320 x 2868. Upload to App Store Connect under "iPhone 6.9" Display". Enough for every iPhone.
- app-store-iphone-6.5   1284 x 2778. Only if App Store Connect asks for the 6.5" size.
- app-store-ipad-13      2064 x 2752. Only if your app runs on iPad.
- google-play-phone      1080 x 1920. Upload in Google Play Console under Store listing > Phone screenshots.

The files are numbered in the order they should appear. The first 3 show in search results.
`;

download.addEventListener('click', async () => {
  download.disabled = true;
  const keys = Object.keys(DEVICES) as DeviceKey[];
  const total = keys.length * shots.length;
  const entries: ZipEntry[] = [{ name: 'README.txt', data: new TextEncoder().encode(README) }];
  const c = document.createElement('canvas');
  try {
    let n = 0;
    for (const key of keys) {
      const d = DEVICES[key];
      for (let i = 0; i < shots.length; i++) {
        n++;
        statusEl.textContent = `Making image ${n} of ${total}…`;
        await new Promise((r) => setTimeout(r, 0));
        render(c, d, shots[i], 1);
        entries.push({ name: `${d.folder}/${String(i + 1).padStart(2, '0')}.png`, data: await toPng(c) });
      }
    }
    const blob = new Blob([makeZip(entries) as BlobPart], { type: 'application/zip' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'app-store-screenshots.zip';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    statusEl.textContent = `Done: ${total} images in 4 sizes.`;
  } catch {
    statusEl.textContent = 'Something went wrong making the images. Try fewer or smaller screenshots.';
  } finally {
    download.disabled = false;
  }
});

// ---------- start ----------

buildSwatches();
shots = exampleScreens();
buildCards();
// Redraw once the headline font has loaded, so the canvas uses it.
document.fonts?.load(`800 40px "Bricolage Grotesque"`).then(() => {
  if (isExample) {
    shots = exampleScreens().map((s, i) => ({ ...s, caption: shots[i]?.caption ?? s.caption }));
  }
  renderAll();
}).catch(() => {});
