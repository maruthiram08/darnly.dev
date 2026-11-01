// Color converter: everything runs in the visitor's browser. Nothing is uploaded.
import {
  type Color,
  type Vec,
  parse as parseCore,
  format,
  displayRgb,
  labToRgbRaw,
  inGamut,
  rgbToLab,
  labToLch,
  lchToLab,
  oklabToCie,
  cieToOklab,
  rgbToHsl,
  hslToRgb,
  rgbToHwb,
  hwbToRgb,
  hex,
  contrast,
  over,
  nearest,
  namesFor,
  NAMES,
  TAILWIND,
} from './color-converter-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const textIn = $<HTMLInputElement>('cv-text');
const picker = $<HTMLInputElement>('cv-picker');
const dropBtn = $<HTMLButtonElement>('cv-drop');
const randomBtn = $<HTMLButtonElement>('cv-random');
const error = $<HTMLParagraphElement>('cv-error');
const fill = $<HTMLDivElement>('cv-fill');
const big = $<HTMLDivElement>('cv-big');
const bigName = $<HTMLElement>('cv-name');
const bigHex = $<HTMLElement>('cv-hex');
const gamut = $<HTMLParagraphElement>('cv-gamut');
const formatsEl = $<HTMLUListElement>('cv-formats');
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-model]')];
const slidersEl = $<HTMLDivElement>('cv-sliders');
const alphaRange = $<HTMLInputElement>('cv-alpha');
const alphaNum = $<HTMLInputElement>('cv-alpha-n');
const alphaTrack = $<HTMLDivElement>('cv-alpha-track');
const allBtn = $<HTMLButtonElement>('cv-all');
const linkBtn = $<HTMLButtonElement>('cv-link');
const status = $<HTMLParagraphElement>('cv-status');
const toContrast = $<HTMLAnchorElement>('cv-to-contrast');
const toTailwind = $<HTMLAnchorElement>('cv-to-tailwind');
const toScale = $<HTMLAnchorElement>('cv-to-scale');

const WHITE: Vec = [1, 1, 1];
const BLACK: Vec = [0, 0, 0];

// ---------- Parsing (core first, then anything else the browser understands, like display-p3) ----------

function parse(input: string): Color | null {
  const c = parseCore(input);
  if (c) return c;
  const s = input.trim();
  if (!s || typeof CSS === 'undefined' || !CSS.supports('color', s)) return null;
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = s;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return { lab: rgbToLab([r / 255, g / 255, b / 255]), alpha: a / 255 };
}

// ---------- Slider models ----------

type Channel = { label: string; min: number; max: number; step: number; unit?: string };
type Model = { channels: Channel[]; from: (c: Color) => number[]; to: (v: number[]) => Vec };

const rgb255 = (c: Color) => displayRgb(c.lab).map((v) => Math.round(v * 255) / 255) as Vec;
const HUE: Channel = { label: 'Hue', min: 0, max: 360, step: 1, unit: '°' };
const PCT = (label: string): Channel => ({ label, min: 0, max: 100, step: 1, unit: '%' });

const MODELS: Record<string, Model> = {
  rgb: {
    channels: ['Red', 'Green', 'Blue'].map((label) => ({ label, min: 0, max: 255, step: 1 })),
    from: (c) => rgb255(c).map((v) => Math.round(v * 255)),
    to: (v) => rgbToLab(v.map((x) => x / 255) as Vec),
  },
  hsl: {
    channels: [HUE, PCT('Saturation'), PCT('Lightness')],
    from: (c) => {
      const [h, s, l] = rgbToHsl(rgb255(c));
      return [h, s * 100, l * 100];
    },
    to: (v) => rgbToLab(hslToRgb([v[0], v[1] / 100, v[2] / 100])),
  },
  hwb: {
    channels: [HUE, PCT('Whiteness'), PCT('Blackness')],
    from: (c) => {
      const [h, w, b] = rgbToHwb(rgb255(c));
      return [h, w * 100, b * 100];
    },
    to: (v) => rgbToLab(hwbToRgb([v[0], v[1] / 100, v[2] / 100])),
  },
  oklch: {
    channels: [
      { label: 'Lightness', min: 0, max: 100, step: 0.1, unit: '%' },
      { label: 'Chroma', min: 0, max: 0.37, step: 0.001 },
      { ...HUE, step: 0.1 },
    ],
    from: (c) => {
      const [L, C, H] = labToLch(c.lab);
      return [L * 100, C, H];
    },
    to: (v) => lchToLab([v[0] / 100, v[1], v[2]]),
  },
  lab: {
    channels: [
      { label: 'Lightness', min: 0, max: 100, step: 0.1, unit: '%' },
      { label: 'a (green to red)', min: -125, max: 125, step: 0.1 },
      { label: 'b (blue to yellow)', min: -125, max: 125, step: 0.1 },
    ],
    from: (c) => oklabToCie(c.lab) as number[],
    to: (v) => cieToOklab(v as Vec),
  },
};

// ---------- State ----------

let color: Color = { lab: rgbToLab([5 / 255, 147 / 255, 198 / 255]), alpha: 1 };
let model = 'rgb';
let vals: number[] = [];
const rows: { range: HTMLInputElement; num: HTMLInputElement; track: HTMLDivElement }[] = [];
let statusTimer = 0;

const say = (msg: string) => {
  status.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (status.textContent = ''), 2500);
};

async function copy(text: string, done: string, btn?: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
    if (btn) {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1200);
    }
  } catch {
    say('Your browser blocked copying. Select the text instead.');
  }
}

const cssOf = (c: Color) => {
  const rgb = displayRgb(c.lab).map((v) => Math.round(v * 255));
  return `rgba(${rgb.join(',')},${c.alpha})`;
};

// ---------- Contrast panels ----------

function grade(r: number): { label: string; cls: string } {
  if (r >= 7) return { label: 'Great for text', cls: 'good' };
  if (r >= 4.5) return { label: 'Good for text', cls: 'good' };
  if (r >= 3) return { label: 'Big text and icons only', cls: 'ok' };
  return { label: 'Too faint for text', cls: 'bad' };
}

function renderContrast(which: 'w' | 'k', rgb: Vec) {
  const bg = which === 'w' ? WHITE : BLACK;
  const seen = over(rgb, color.alpha, bg);
  const r = contrast(seen, bg);
  const g = grade(r);
  const css = cssOf(color);
  $(`cv-chip-${which}`).style.background = css;
  $(`cv-aa-${which}`).style.color = css;
  $(`cv-r-${which}`).textContent = `${(Math.floor(r * 100) / 100).toFixed(2)}:1`;
  const v = $(`cv-v-${which}`);
  v.textContent = g.label;
  const panel = $(`cv-on-${which}`);
  panel.classList.remove('good', 'ok', 'bad');
  panel.classList.add(g.cls);
}

// ---------- Format cards ----------

type Card = { label: string; value: string; copy: string; note?: string; swatch?: string };

function cards(f: ReturnType<typeof format>, rgb: Vec): Card[] {
  const h6 = hex(rgb).slice(1);
  const exact = color.alpha === 1 ? namesFor(h6) : [];
  const near = nearest(color.lab, NAMES);
  const tw = nearest(color.lab, TAILWIND);
  const twNote = tw.d < 1.5 ? 'Looks the same' : tw.d < 4 ? 'Very close' : tw.d < 8 ? 'Close' : 'Not close';
  return [
    { label: 'HEX', value: f.hex, copy: f.hex },
    { label: 'RGB', value: f.rgb, copy: f.rgb },
    { label: 'HSL', value: f.hsl, copy: f.hsl },
    { label: 'HWB', value: f.hwb, copy: f.hwb },
    { label: 'OKLCH', value: f.oklch, copy: f.oklch },
    { label: 'LAB', value: f.lab, copy: f.lab },
    exact.length
      ? { label: 'CSS name', value: exact.join(' or '), copy: exact[0], note: 'Exact match' }
      : { label: 'CSS name', value: near.name, copy: near.name, note: 'Closest name, not exact', swatch: '#' + near.hex },
    {
      label: 'Tailwind',
      value: `bg-${tw.name}`,
      copy: `bg-${tw.name}`,
      note: `Nearest v4 color · ${twNote}`,
      swatch: tw.css,
    },
  ];
}

function renderCards(list: Card[]) {
  formatsEl.replaceChildren(
    ...list.map((c) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fmt';
      b.title = `Copy ${c.copy}`;
      const top = document.createElement('span');
      top.className = 'flabel';
      top.textContent = c.label;
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.setAttribute('aria-hidden', 'true');
      top.append(hint);
      const val = document.createElement('code');
      if (c.swatch) {
        const dot = document.createElement('i');
        dot.style.background = c.swatch;
        val.append(dot);
      }
      val.append(c.value);
      b.append(top, val);
      if (c.note) {
        const note = document.createElement('span');
        note.className = 'note';
        note.textContent = c.note;
        b.append(note);
      }
      b.addEventListener('click', () => copy(c.copy, `Copied ${c.copy}`, b));
      li.append(b);
      return li;
    }),
  );
}

// ---------- Sliders ----------

function buildSliders() {
  const m = MODELS[model];
  rows.length = 0;
  slidersEl.replaceChildren(
    ...m.channels.map((ch, i) => {
      const row = document.createElement('div');
      row.className = 'srow';
      const id = `cv-s-${model}-${i}`;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = ch.label;
      const track = document.createElement('div');
      track.className = 'track';
      const range = document.createElement('input');
      range.type = 'range';
      range.id = id;
      range.min = String(ch.min);
      range.max = String(ch.max);
      range.step = String(ch.step);
      track.append(range);
      const numWrap = document.createElement('span');
      numWrap.className = 'num';
      const num = document.createElement('input');
      num.type = 'number';
      num.min = String(ch.min);
      num.max = String(ch.max);
      num.step = 'any';
      num.setAttribute('aria-label', `${ch.label} value`);
      numWrap.append(num);
      if (ch.unit) {
        const u = document.createElement('span');
        u.textContent = ch.unit;
        numWrap.append(u);
      }
      const onChange = (v: number) => {
        if (!Number.isFinite(v)) return;
        vals[i] = Math.min(ch.max, Math.max(ch.min, v));
        color = { lab: m.to(vals), alpha: color.alpha };
        render('slider');
      };
      range.addEventListener('input', () => onChange(parseFloat(range.value)));
      num.addEventListener('input', () => onChange(parseFloat(num.value)));
      row.append(label, track, numWrap);
      rows.push({ range, num, track });
      return row;
    }),
  );
}

const roundTo = (v: number, step: number) => +v.toFixed(step >= 1 ? 1 : step >= 0.1 ? 2 : 3);

function renderSliders(source: string) {
  const m = MODELS[model];
  if (source !== 'slider') vals = m.from(color);
  m.channels.forEach((ch, i) => {
    const r = rows[i];
    r.range.value = String(vals[i]);
    if (document.activeElement !== r.num) r.num.value = String(roundTo(vals[i], ch.step));
    // Paint each track with what the color would look like along that slider.
    const stops: string[] = [];
    const N = ch.label === 'Hue' ? 13 : 9;
    for (let k = 0; k < N; k++) {
      const v = [...vals];
      v[i] = ch.min + ((ch.max - ch.min) * k) / (N - 1);
      stops.push(hex(displayRgb(m.to(v))));
    }
    r.track.style.setProperty('--grad', `linear-gradient(90deg, ${stops.join(', ')})`);
  });
  const solid = hex(displayRgb(color.lab));
  alphaTrack.style.setProperty('--grad', `linear-gradient(90deg, ${solid}00, ${solid})`);
  alphaRange.value = String(Math.round(color.alpha * 100));
  if (document.activeElement !== alphaNum) alphaNum.value = String(Math.round(color.alpha * 100));
}

// ---------- Render ----------

function render(source: 'init' | 'text' | 'slider' | 'picker' | 'other') {
  const rgb = displayRgb(color.lab);
  const f = format(color);
  const outside = !inGamut(labToRgbRaw(color.lab));
  const solid = hex(rgb);

  fill.style.background = cssOf(color);
  // Pick the label color against what people see: the color laid over the white page.
  const seen = over(rgb, color.alpha, WHITE);
  big.classList.toggle('dark-ink', contrast(seen, BLACK) > contrast(seen, WHITE));
  bigHex.textContent = f.hex;
  const exact = color.alpha === 1 ? namesFor(solid.slice(1)) : [];
  bigName.textContent = exact.length ? exact[0] : 'Your color';
  gamut.hidden = !outside;

  renderContrast('w', rgb);
  renderContrast('k', rgb);
  renderCards(cards(f, rgb));
  renderSliders(source);

  if (source !== 'picker') picker.value = solid.toLowerCase();
  if (source !== 'text') {
    textIn.value = outside ? f.oklch : f.hex;
    error.hidden = true;
  }

  toContrast.href = `/tools/contrast-checker/?fg=${encodeURIComponent(solid)}&bg=${encodeURIComponent('#FFFFFF')}`;
  toTailwind.href = `/tools/hex-to-tailwind/?c=${solid.slice(1)}`;
  toScale.href = `/tools/tailwind-color-generator/?hex=${solid.slice(1)}`;

  const url = new URL(location.href);
  url.searchParams.set('c', outside ? f.oklch : f.hex.slice(1));
  history.replaceState(null, '', url);
}

// ---------- Events ----------

textIn.addEventListener('input', () => {
  const c = parse(textIn.value);
  error.hidden = !!c || !textIn.value.trim();
  if (c) {
    color = c;
    render('text');
  }
});

picker.addEventListener('input', () => {
  const c = parseCore(picker.value);
  if (!c) return;
  color = { lab: c.lab, alpha: color.alpha };
  render('picker');
});

tabs.forEach((t) =>
  t.addEventListener('click', () => {
    model = t.dataset.model!;
    tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    buildSliders();
    render('other');
  }),
);

const setAlpha = (v: number) => {
  if (!Number.isFinite(v)) return;
  color = { lab: color.lab, alpha: Math.min(100, Math.max(0, v)) / 100 };
  render('slider');
};
alphaRange.addEventListener('input', () => setAlpha(parseFloat(alphaRange.value)));
alphaNum.addEventListener('input', () => setAlpha(parseFloat(alphaNum.value)));

randomBtn.addEventListener('click', () => {
  // A pleasant random color: mid lightness, decent chroma, any hue, always on screen.
  const lab = lchToLab([0.45 + Math.random() * 0.4, 0.06 + Math.random() * 0.14, Math.random() * 360]);
  color = { lab: rgbToLab(displayRgb(lab)), alpha: 1 };
  render('other');
});

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const ED = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
if (ED) {
  dropBtn.hidden = false;
  dropBtn.addEventListener('click', async () => {
    try {
      const { sRGBHex } = await new ED().open();
      const c = parse(sRGBHex);
      if (c) {
        color = c;
        render('other');
      }
    } catch {
      // Closed with Esc: nothing to do.
    }
  });
}

allBtn.addEventListener('click', () => {
  const f = format(color);
  const text = [f.hex, f.rgb, f.hsl, f.hwb, f.oklch, f.lab].join('\n');
  copy(text, 'Copied all 6 formats', allBtn);
});

linkBtn.addEventListener('click', () => copy(location.href, 'Link copied', linkBtn));

// ---------- Start (keep at the end so every table above exists) ----------

const fromLink = parse(new URLSearchParams(location.search).get('c') ?? '');
if (fromLink) color = fromLink;
buildSliders();
render('init');
