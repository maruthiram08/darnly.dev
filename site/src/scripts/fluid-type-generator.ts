// Fluid type scale generator: everything runs in the visitor's browser. Nothing is uploaded.
import {
  DEFAULTS,
  RATIOS,
  type Format,
  type Settings,
  type Size,
  agentPrompt,
  check,
  fmt,
  fromQuery,
  output,
  readNumber,
  scale,
  sizeAt,
  toQuery,
} from './fluid-type-generator-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SVG = 'http://www.w3.org/2000/svg';

const slider = $<HTMLInputElement>('ft-slider');
const wNow = $('ft-w');
const wLabel = $('ft-w-label');
const chromeW = $('ft-chrome-w');
const tickMin = $('ft-tick-min');
const tickMax = $('ft-tick-max');
const viewport = $<HTMLDivElement>('ft-viewport');
const screen = $<HTMLDivElement>('ft-screen');
const scaledNote = $('ft-scaled');
const previews = document.querySelectorAll<HTMLElement>('#ft-page .pv');
const devButtons = document.querySelectorAll<HTMLButtonElement>('.dev');
const playBtn = $<HTMLButtonElement>('ft-play');
const ladder = $<HTMLOListElement>('ft-ladder');
const chart = $('ft-chart') as unknown as SVGSVGElement;
const verdict = $('ft-verdict');
const err = $('ft-error');
const code = $<HTMLPreElement>('ft-code');
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
const status = $('ft-status');

const inputs = {
  minVw: $<HTMLInputElement>('ft-minvw'),
  maxVw: $<HTMLInputElement>('ft-maxvw'),
  minBase: $<HTMLInputElement>('ft-minbase'),
  maxBase: $<HTMLInputElement>('ft-maxbase'),
};
const ratioPickers = {
  minRatio: { select: $<HTMLSelectElement>('ft-minratio'), box: $('ft-minratio-custom-box'), input: $<HTMLInputElement>('ft-minratio-custom') },
  maxRatio: { select: $<HTMLSelectElement>('ft-maxratio'), box: $('ft-maxratio-custom-box'), input: $<HTMLInputElement>('ft-maxratio-custom') },
};

let s: Settings = { ...DEFAULTS };
let sizes: Size[] = scale(s);
let width = 768;
let format: Format = 'css';

function say(msg: string) {
  status.textContent = msg;
}

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
  } catch {
    say('Your browser blocked copying. Select the text instead.');
  }
}

function deviceName(w: number): string {
  if (w < 600) return 'Phone';
  if (w < 1024) return 'Tablet';
  if (w < 1440) return 'Laptop';
  return 'Desktop';
}

// Slider range always covers both screen widths with some room on each side.
function sliderRange(): [number, number] {
  return [Math.min(320, Math.floor(s.minVw - 40)), Math.max(1600, Math.ceil(s.maxVw + 200))];
}

function pct(w: number): number {
  const [lo, hi] = sliderRange();
  return ((w - lo) / (hi - lo)) * 100;
}

// The sample page, drawn at the chosen width and shrunk to fit when it is wider than the box.
function renderPreview() {
  const [lo, hi] = sliderRange();
  slider.min = String(lo);
  slider.max = String(hi);
  slider.value = String(Math.round(width));
  wNow.textContent = `${Math.round(width)}px`;
  chromeW.textContent = `${Math.round(width)}px wide`;
  const below = width < s.minVw;
  const above = width > s.maxVw;
  wLabel.textContent = `${deviceName(width)}${below ? ' · smallest sizes' : above ? ' · largest sizes' : ''}`;
  devButtons.forEach((b) => b.classList.toggle('on', Number(b.dataset.w) === Math.round(width)));
  tickMin.style.left = `${pct(s.minVw)}%`;
  tickMax.style.left = `${pct(s.maxVw)}%`;
  tickMin.textContent = `${fmt(s.minVw)} small`;
  tickMax.textContent = `${fmt(s.maxVw)} large`;

  const byStep = new Map(sizes.map((z) => [z.step, z]));
  previews.forEach((el) => {
    const z = byStep.get(Number(el.dataset.step));
    if (z) el.style.fontSize = `${sizeAt(z, width)}px`;
  });

  screen.style.width = `${width}px`;
  const room = viewport.clientWidth;
  const k = Math.min(1, room / width);
  screen.style.transform = k < 1 ? `scale(${k})` : '';
  viewport.style.height = `${screen.offsetHeight * k}px`;
  scaledNote.hidden = k >= 1;
  scaledNote.textContent = `Shrunk to ${Math.round(k * 100)}% to fit your screen. The text is drawn as it would look on a ${Math.round(width)}px wide screen.`;
}

function renderLadder() {
  const top = Math.max(...sizes.map((z) => Math.max(z.min, z.max)));
  ladder.replaceChildren(
    ...[...sizes].reverse().map((z) => {
      const li = document.createElement('li');
      const role = document.createElement('span');
      role.className = 'role';
      role.innerHTML = `${z.role}<b>text-${z.name}</b>`;
      const track = document.createElement('span');
      track.className = 'track';
      const range = document.createElement('span');
      range.className = 'range';
      const a = Math.min(z.min, z.max);
      const b = Math.max(z.min, z.max);
      range.style.left = `${(a / top) * 100}%`;
      range.style.width = `${Math.max(1, ((b - a) / top) * 100)}%`;
      const now = document.createElement('span');
      now.className = 'now';
      now.style.left = `${(sizeAt(z, width) / top) * 100}%`;
      track.append(range, now);
      const px = document.createElement('span');
      px.className = 'px';
      px.innerHTML = `${fmt(sizeAt(z, width), 1)}px<small>${fmt(z.min, 1)} → ${fmt(z.max, 1)}${z.zoomOk ? '' : ' <span class="zoom" title="May not reach 200% when zoomed">⚠ zoom</span>'}</small>`;
      li.append(role, track, px);
      return li;
    }),
  );
  const bad = sizes.filter((z) => !z.zoomOk);
  verdict.className = `verdict ${bad.length ? 'warn' : 'ok'}`;
  verdict.textContent = bad.length
    ? `⚠ ${bad.map((z) => `text-${z.name}`).join(', ')} ${bad.length === 1 ? 'grows' : 'grow'} more than 2.5×, so zooming to 200% may not work. Use a closer ratio.`
    : '✓ Zoom check passed: every size still grows when people zoom in.';
}

function el(name: string, attrs: Record<string, string | number>, text?: string) {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

// Size against screen width: each line is flat, then slopes, then flat again.
function renderChart() {
  const W = 360;
  const H = 240;
  const L = 34;
  const R = 40;
  const T = 10;
  const B = 24;
  const [lo, hi] = sliderRange();
  const top = Math.max(...sizes.map((z) => Math.max(z.min, z.max))) * 1.08;
  const x = (w: number) => L + ((w - lo) / (hi - lo)) * (W - L - R);
  const y = (px: number) => T + (1 - px / top) * (H - T - B);
  const kids: SVGElement[] = [];
  // Grid: the two screen widths and a few size lines.
  const stepPx = top > 120 ? 40 : top > 60 ? 20 : 10;
  for (let v = 0; v <= top; v += stepPx) {
    kids.push(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: '#D7E9F0', 'stroke-width': 1 }));
    kids.push(el('text', { x: L - 6, y: y(v) + 3, 'text-anchor': 'end', 'font-size': 9, fill: '#4A6472', 'font-family': 'JetBrains Mono, monospace' }, String(v)));
  }
  for (const [w, label] of [[s.minVw, 'small'], [s.maxVw, 'large']] as const) {
    kids.push(el('line', { x1: x(w), x2: x(w), y1: T, y2: H - B, stroke: '#9DB7C3', 'stroke-dasharray': '3 3' }));
    kids.push(el('text', { x: x(w), y: H - 8, 'text-anchor': 'middle', 'font-size': 9, fill: '#4A6472', 'font-family': 'JetBrains Mono, monospace' }, `${fmt(w)} ${label}`));
  }
  sizes.forEach((z, i) => {
    const pts = [lo, s.minVw, s.maxVw, hi].map((w) => `${x(w).toFixed(1)},${y(sizeAt(z, w)).toFixed(1)}`).join(' ');
    const t = i / (sizes.length - 1);
    const color = t > 0.8 ? '#D83995' : '#0593C6';
    const opacity = 0.45 + t * 0.55;
    kids.push(el('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-opacity': opacity, 'stroke-linejoin': 'round' }));
    kids.push(el('text', { x: W - R + 4, y: y(sizeAt(z, hi)) + 3, 'font-size': 9, fill: '#0B2230', 'font-family': 'JetBrains Mono, monospace' }, z.name));
  });
  // Where the slider is now.
  kids.push(el('line', { x1: x(width), x2: x(width), y1: T, y2: H - B, stroke: '#D83995', 'stroke-width': 1.5 }));
  sizes.forEach((z) => kids.push(el('circle', { cx: x(width), cy: y(sizeAt(z, width)), r: 3, fill: '#D83995' })));
  chart.replaceChildren(...kids);
}

function renderCode() {
  code.textContent = output(sizes, format);
}

function renderWidth() {
  renderPreview();
  renderLadder();
  renderChart();
}

function renderAll() {
  sizes = scale(s);
  renderWidth();
  renderCode();
}

function saveUrl() {
  const url = new URL(location.href);
  url.search = toQuery(s).toString();
  history.replaceState(null, '', url);
}

// Settings
function readRatio(key: 'minRatio' | 'maxRatio'): number | null {
  const p = ratioPickers[key];
  if (p.select.value === 'custom') return readNumber(p.input.value);
  return Number(p.select.value);
}

function readAll() {
  const next: Settings = { ...s };
  for (const [k, input] of Object.entries(inputs) as [keyof typeof inputs, HTMLInputElement][]) {
    const v = readNumber(input.value);
    if (v === null) {
      err.textContent = 'Type a number, like 16 or 1280.';
      err.hidden = false;
      return;
    }
    next[k] = v;
  }
  for (const k of ['minRatio', 'maxRatio'] as const) {
    const v = readRatio(k);
    if (v === null) {
      err.textContent = 'Type a ratio, like 1.25.';
      err.hidden = false;
      return;
    }
    next[k] = v;
  }
  const problem = check(next);
  err.hidden = !problem;
  err.textContent = problem || '';
  if (problem) return;
  s = next;
  renderAll();
  saveUrl();
}

function fillInputs() {
  inputs.minVw.value = fmt(s.minVw);
  inputs.maxVw.value = fmt(s.maxVw);
  inputs.minBase.value = fmt(s.minBase);
  inputs.maxBase.value = fmt(s.maxBase);
  for (const k of ['minRatio', 'maxRatio'] as const) {
    const p = ratioPickers[k];
    const named = RATIOS.find((r) => Math.abs(r.value - s[k]) < 0.0005);
    p.select.value = named ? String(named.value) : 'custom';
    p.input.value = fmt(s[k]);
    p.box.hidden = !!named;
  }
  err.hidden = true;
}

Object.values(inputs).forEach((i) => i.addEventListener('input', readAll));
for (const k of ['minRatio', 'maxRatio'] as const) {
  const p = ratioPickers[k];
  p.select.addEventListener('change', () => {
    const custom = p.select.value === 'custom';
    p.box.hidden = !custom;
    if (custom) {
      p.input.value = fmt(s[k]);
      p.input.focus();
    }
    readAll();
  });
  p.input.addEventListener('input', readAll);
}

// Screen width
let playing = 0;
function stopPlay() {
  if (!playing) return;
  cancelAnimationFrame(playing);
  playing = 0;
  playBtn.setAttribute('aria-pressed', 'false');
  playBtn.textContent = '▶ Play';
}

function setWidth(w: number) {
  width = w;
  renderWidth();
}

slider.addEventListener('input', () => {
  stopPlay();
  setWidth(Number(slider.value));
});
devButtons.forEach((b) =>
  b.addEventListener('click', () => {
    stopPlay();
    setWidth(Number(b.dataset.w));
  }),
);

// Play sweeps phone → desktop → phone, so you watch the text grow and shrink.
playBtn.addEventListener('click', () => {
  if (playing) return stopPlay();
  playBtn.setAttribute('aria-pressed', 'true');
  playBtn.textContent = '■ Stop';
  const from = Math.max(320, s.minVw - 20);
  const to = s.maxVw + 160;
  const period = 5000;
  const start = performance.now();
  const tick = (now: number) => {
    const t = ((now - start) % period) / period;
    const e = (1 - Math.cos(t * 2 * Math.PI)) / 2;
    setWidth(from + (to - from) * e);
    playing = requestAnimationFrame(tick);
  };
  playing = requestAnimationFrame(tick);
});

// Output
tabs.forEach((t) =>
  t.addEventListener('click', () => {
    format = t.dataset.format as Format;
    tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    renderCode();
  }),
);

const formatName: Record<Format, string> = { css: 'CSS variables', tw4: 'Tailwind v4 @theme block', tw3: 'Tailwind v3 config' };
$('ft-copy').addEventListener('click', () => copy(output(sizes, format), `Copied the ${formatName[format]}.`));
$('ft-prompt').addEventListener('click', () => copy(agentPrompt(sizes, s, format), 'Copied. Paste it into Claude Code, Cursor or Codex.'));
$('ft-link').addEventListener('click', () => copy(location.href, 'Link copied.'));
$('ft-reset').addEventListener('click', () => {
  s = { ...DEFAULTS };
  fillInputs();
  renderAll();
  saveUrl();
  say('Back to the defaults.');
});

window.addEventListener('resize', renderPreview);

s = fromQuery(new URLSearchParams(location.search));
// On a phone, start at phone width so the preview is not shrunk to a thumbnail.
if (viewport.clientWidth < 700) width = 375;
fillInputs();
renderAll();
