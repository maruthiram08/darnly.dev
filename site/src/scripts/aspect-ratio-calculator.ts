// Aspect ratio calculator: everything runs in the visitor's browser. Nothing is uploaded.
import {
  WIDTHS,
  closest,
  css,
  fmt,
  heightFor,
  label,
  paddingHack,
  parseRatio,
  place,
  readSize,
  simplify,
  tailwind,
  widthFor,
  type Ratio,
} from './aspect-ratio-calculator-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const stage = $<HTMLDivElement>('ar-stage');
const big = $<HTMLButtonElement>('ar-big');
const dims = $<HTMLElement>('ar-dims');
const verdict = $<HTMLParagraphElement>('ar-verdict');
const wIn = $<HTMLInputElement>('ar-w');
const hIn = $<HTMLInputElement>('ar-h');
const rIn = $<HTMLInputElement>('ar-r');
const lockBtn = $<HTMLButtonElement>('ar-lock');
const note = $<HTMLParagraphElement>('ar-note');
const err = $<HTMLParagraphElement>('ar-error');
const cssOut = $<HTMLPreElement>('ar-css');
const twOut = $<HTMLPreElement>('ar-tw');
const padOut = $<HTMLPreElement>('ar-pad');
const table = $<HTMLTableSectionElement>('ar-table');
const linkBtn = $<HTMLButtonElement>('ar-link');
const status = $<HTMLParagraphElement>('ar-status');
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab')];
const segs = [...document.querySelectorAll<HTMLButtonElement>('.seg-b')];
const presets = [...document.querySelectorAll<HTMLButtonElement>('.preset')];

type SlotId = 'box' | 'youtube' | 'phone' | 'og' | 'insta' | 'story';
// The shape of each place, and how that place usually treats a picture of another shape.
const SLOTS: Record<SlotId, { name: string; w: number; h: number; mode: 'fit' | 'fill' }> = {
  box: { name: 'your shape', w: 16, h: 9, mode: 'fit' },
  youtube: { name: 'a YouTube player', w: 16, h: 9, mode: 'fit' },
  phone: { name: 'a phone screen', w: 390, h: 844, mode: 'fit' },
  og: { name: 'a link preview', w: 1200, h: 630, mode: 'fill' },
  insta: { name: 'an Instagram portrait post', w: 4, h: 5, mode: 'fill' },
  story: { name: 'a Story or Reel', w: 9, h: 16, mode: 'fill' },
};

let w = 1920;
let h = 1080;
let ratio: Ratio = { w: 16, h: 9 };
let locked = true;
let slot: SlotId = 'youtube';
let mode: 'fit' | 'fill' = 'fit';

function say(msg: string) {
  status.textContent = msg;
  window.setTimeout(() => {
    if (status.textContent === msg) status.textContent = '';
  }, 3000);
}

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
  } catch {
    say('Your browser blocked copying. Select the text instead.');
  }
}

const round = (n: number) => Math.max(1, Math.round(n));

function ratioText(r: Ratio) {
  return label(r.w, r.h).main;
}

// The picture drawn inside the active slot: a dashed ghost for what gets cut off, the visible part clipped to the slot.
function drawSlot() {
  const el = stage.querySelector<HTMLDivElement>(`.slot[data-for="${slot}"]`);
  if (!el) return;
  const pr = ratio.w / ratio.h;
  const dimsLabel = `${fmt(w)} × ${fmt(h)}`;
  if (slot === 'box') {
    el.style.setProperty('--pr', String(pr));
    el.innerHTML = `<div class="clip"><div class="pic" style="inset:0"><i class="sun"></i><span>${dimsLabel}</span></div></div>`;
    return;
  }
  const s = SLOTS[slot];
  const p = place(ratio.w, ratio.h, s.w, s.h, mode);
  const pos = `left:${p.left}%;top:${p.top}%;width:${p.width}%;height:${p.height}%`;
  const ghost = mode === 'fill' && !p.match ? `<div class="pic ghost-pic" style="${pos}"></div>` : '';
  el.innerHTML = `${ghost}<div class="clip"><div class="pic" style="${pos}"><i class="sun"></i><span>${dimsLabel}</span></div></div>`;
}

function setVerdict() {
  verdict.className = 'verdict';
  if (slot === 'box') {
    const c = closest(ratio.w, ratio.h);
    if (c.off < 0.0005) verdict.textContent = `Used for: ${c.use}`;
    else if (c.off < 0.03) verdict.textContent = `Close to ${c.label} (${c.use.split(',')[0]})`;
    else verdict.textContent = 'Not a common ratio';
    return;
  }
  const s = SLOTS[slot];
  const p = place(ratio.w, ratio.h, s.w, s.h, mode);
  if (p.match) {
    verdict.textContent = `✓ Fits ${s.name} exactly`;
    verdict.classList.add('ok');
    return;
  }
  verdict.classList.add('warn');
  const pct = Math.round(p.lost);
  if (mode === 'fit') {
    verdict.textContent = p.side === 'sides' ? `Black bars on the sides (${pct}% empty)` : `Black bars top and bottom (${pct}% empty)`;
  } else {
    verdict.textContent = p.side === 'sides' ? `${pct}% cut off the sides` : `${pct}% cut off the top and bottom`;
  }
}

function fillTable() {
  const rows = WIDTHS.map((width) => {
    const exact = heightFor(width, ratio);
    const whole = Math.abs(exact - Math.round(exact)) < 1e-6;
    return `<tr data-w="${width}"><td>${width}</td><td>${round(exact)}</td><td>${whole ? '' : `<small>from ${fmt(exact, 2)}</small>`}</td></tr>`;
  });
  table.innerHTML = rows.join('');
}

function render() {
  const l = label(ratio.w, ratio.h);
  big.textContent = l.main;
  const extra = l.main !== l.exact && simplify(ratio.w, ratio.h).w <= 400 ? ` · ${l.exact}` : l.main === l.decimal ? '' : ` · ${l.decimal}`;
  dims.textContent = `${fmt(w)} × ${fmt(h)} px${extra}`;
  if (document.activeElement !== rIn) rIn.value = l.main;

  cssOut.textContent = css(ratio.w, ratio.h);
  twOut.textContent = tailwind(ratio.w, ratio.h);
  padOut.textContent = paddingHack(ratio.w, ratio.h);

  for (const b of presets) {
    const on = Math.abs(Number(b.dataset.w) / Number(b.dataset.h) / (ratio.w / ratio.h) - 1) < 0.0005;
    b.classList.toggle('on', on);
  }
  stage.dataset.slot = slot;
  stage.dataset.mode = mode;
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.slot === slot));
  for (const b of segs) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  drawSlot();
  setVerdict();
  fillTable();
  saveUrl();
}

function showNote(text: string) {
  note.textContent = text;
  note.hidden = !text;
}

function showError(text: string) {
  err.textContent = text;
  err.hidden = !text;
}

// The side the visitor typed stays; the other follows the ratio.
function fromWidth(newW: number) {
  w = newW;
  if (locked) {
    const exact = heightFor(w, ratio);
    h = round(exact);
    hIn.value = String(h);
    showNote(Math.abs(exact - h) > 1e-6 ? `Height rounded from ${fmt(exact, 2)}px.` : '');
  } else {
    ratio = simplify(w, h);
    showNote('');
  }
}

function fromHeight(newH: number) {
  h = newH;
  if (locked) {
    const exact = widthFor(h, ratio);
    w = round(exact);
    wIn.value = String(w);
    showNote(Math.abs(exact - w) > 1e-6 ? `Width rounded from ${fmt(exact, 2)}px.` : '');
  } else {
    ratio = simplify(w, h);
    showNote('');
  }
}

// A new ratio keeps the width and works out the height, whether or not the lock is on.
function setRatio(r: Ratio) {
  ratio = r;
  const exact = heightFor(w, ratio);
  h = round(exact);
  hIn.value = String(h);
  showNote(Math.abs(exact - h) > 1e-6 ? `Height rounded from ${fmt(exact, 2)}px.` : '');
}

wIn.addEventListener('input', () => {
  const n = readSize(wIn.value);
  if (n === null) return showError('Type a width in pixels, like 1920.');
  showError('');
  fromWidth(n);
  render();
});

hIn.addEventListener('input', () => {
  const n = readSize(hIn.value);
  if (n === null) return showError('Type a height in pixels, like 1080.');
  showError('');
  fromHeight(n);
  render();
});

rIn.addEventListener('input', () => {
  const r = parseRatio(rIn.value);
  if (!r) return showError('Type a ratio like 16:9, 4/3 or 1.91.');
  showError('');
  setRatio(r);
  render();
});
rIn.addEventListener('blur', () => {
  showError('');
  rIn.value = ratioText(ratio);
});

lockBtn.addEventListener('click', () => {
  locked = !locked;
  lockBtn.setAttribute('aria-pressed', String(locked));
  lockBtn.querySelector('.lock-i')!.textContent = locked ? '🔒' : '🔓';
  lockBtn.querySelector('.lock-t')!.textContent = locked ? 'Ratio locked' : 'Ratio free';
  say(locked ? 'Ratio locked: changing one side changes the other.' : 'Ratio free: the ratio follows your sizes.');
});

for (const b of presets) {
  b.addEventListener('click', () => {
    showError('');
    setRatio({ w: Number(b.dataset.w), h: Number(b.dataset.h) });
    render();
  });
}

for (const t of tabs) {
  t.addEventListener('click', () => {
    slot = t.dataset.slot as SlotId;
    mode = SLOTS[slot].mode;
    render();
  });
}

for (const b of segs) {
  b.addEventListener('click', () => {
    mode = b.dataset.mode as 'fit' | 'fill';
    render();
  });
}

table.addEventListener('click', (e) => {
  const row = (e.target as HTMLElement).closest('tr');
  if (!row?.dataset.w) return;
  const n = Number(row.dataset.w);
  wIn.value = String(n);
  w = n;
  setRatio(ratio);
  render();
  stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

big.addEventListener('click', () => copy(big.textContent || '', `Copied ${big.textContent}.`));

for (const b of document.querySelectorAll<HTMLButtonElement>('.copy')) {
  b.addEventListener('click', () => {
    const which = b.dataset.copy;
    const text = which === 'css' ? cssOut.textContent : which === 'tw' ? twOut.textContent : padOut.textContent;
    copy(text || '', which === 'css' ? 'Copied the CSS.' : which === 'tw' ? 'Copied the Tailwind class.' : 'Copied the padding-top CSS.');
  });
}

linkBtn.addEventListener('click', () => copy(location.href, 'Copied a link to these settings.'));

// Settings live in the address so a link opens the same view.
function saveUrl() {
  const q = new URLSearchParams();
  q.set('w', fmt(w));
  q.set('h', fmt(h));
  const s = simplify(ratio.w, ratio.h);
  if (!(s.w === simplify(w, h).w && s.h === simplify(w, h).h)) q.set('r', `${fmt(ratio.w)}:${fmt(ratio.h)}`);
  if (slot !== 'youtube') q.set('on', slot);
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

function loadUrl() {
  const q = new URLSearchParams(location.search);
  const qw = readSize(q.get('w') || '');
  const qh = readSize(q.get('h') || '');
  const qr = parseRatio(q.get('r') || '');
  const qs = q.get('on') as SlotId | null;
  if (qw && qh) {
    w = qw;
    h = qh;
    ratio = qr || simplify(w, h);
  } else if (qr) {
    ratio = qr;
    h = round(heightFor(w, ratio));
  }
  if (qs && qs in SLOTS) {
    slot = qs;
    mode = SLOTS[slot].mode;
  }
  wIn.value = fmt(w);
  hIn.value = fmt(h);
}

loadUrl();
render();
