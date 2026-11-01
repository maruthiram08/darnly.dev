// Nearest Tailwind color: everything runs in the visitor's browser. Nothing is uploaded.
import { STEPS, V3, V4 } from './tailwind-palettes';

type RGB = [number, number, number]; // 0..255
type Lab = [number, number, number]; // OKLab

type Swatch = { name: string; css: string; hex: string; lab: Lab; L: number };
type Match = Swatch & { d: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const textIn = $<HTMLInputElement>('ht-text');
const picker = $<HTMLInputElement>('ht-picker');
const dropBtn = $<HTMLButtonElement>('ht-drop');
const error = $<HTMLParagraphElement>('ht-error');
const youSwatch = $<HTMLDivElement>('ht-you');
const youHex = $<HTMLElement>('ht-you-hex');
const verdict = $<HTMLElement>('ht-verdict');
const list = $<HTMLOListElement>('ht-matches');
const none = $<HTMLDivElement>('ht-none');
const arbCode = $<HTMLElement>('ht-arb');
const arbBtn = $<HTMLButtonElement>('ht-arb-copy');
const scaleLink = $<HTMLAnchorElement>('ht-scale');
const table = $<HTMLTableSectionElement>('ht-table');
const linkBtn = $<HTMLButtonElement>('ht-link');
const status = $<HTMLParagraphElement>('ht-status');
const versionBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-version]')];
const prefixBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-prefix]')];

// ---------- Color math ----------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToLab([r0, g0, b0]: RGB): Lab {
  const r = toLinear(r0 / 255);
  const g = toLinear(g0 / 255);
  const b = toLinear(b0 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labToRgb([L, A, B]: Lab): RGB {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => clamp(toGamma(v), 0, 1) * 255) as RGB;
}

const hex = (rgb: RGB) => '#' + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
const hexToRgb = (h: string): RGB => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;

// OKLab distance x100: about 1 is the smallest difference most people can see side by side.
const dist = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;

function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const num = (s: string, scale: number) => (s.trim().endsWith('%') ? (parseFloat(s) / 100) * scale : parseFloat(s));

// Hex, rgb() and hsl() are read exactly; anything else the browser understands (names, oklch…) goes through a 1px canvas.
function parse(input: string): RGB | null {
  const s = input.trim().toLowerCase().replace(/;$/, '');
  if (!s) return null;
  let m = s.match(/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    return hexToRgb(h);
  }
  m = s.match(/^(rgba?|hsla?)\((.*)\)$/);
  if (m) {
    const parts = m[2].replace(/\s*\/\s*/, ',').split(/\s*,\s*|\s+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    if (parts.some((p) => !/^[-+]?(\d+\.?\d*|\.\d+)(%|deg)?$/.test(p))) return null;
    if (m[1].startsWith('rgb')) return parts.slice(0, 3).map((p) => clamp(num(p, 255), 0, 255)) as RGB;
    const sat = clamp(num(parts[1], 1) / (parts[1].endsWith('%') ? 1 : 100), 0, 1);
    const lig = clamp(num(parts[2], 1) / (parts[2].endsWith('%') ? 1 : 100), 0, 1);
    return hslToRgb(parseFloat(parts[0]), sat, lig);
  }
  if (typeof CSS !== 'undefined' && CSS.supports('color', s)) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return null;
    x.fillStyle = s;
    x.fillRect(0, 0, 1, 1);
    const [r, g, b] = x.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  }
  return null;
}

// ---------- Palettes ----------

function buildV3(): Swatch[] {
  const out: Swatch[] = [];
  for (const [fam, row] of Object.entries(V3)) {
    row.split(' ').forEach((h, i) => {
      const lab = rgbToLab(hexToRgb(h));
      out.push({ name: `${fam}-${STEPS[i]}`, css: '#' + h.toUpperCase(), hex: '#' + h.toUpperCase(), lab, L: lab[0] });
    });
  }
  return out;
}

function buildV4(): Swatch[] {
  const out: Swatch[] = [];
  for (const [fam, row] of Object.entries(V4)) {
    row.split(', ').forEach((t, i) => {
      const [L, C, H] = t.split(' ').map(Number);
      const h = (H * Math.PI) / 180;
      const lab: Lab = [L, C * Math.cos(h), C * Math.sin(h)];
      out.push({ name: `${fam}-${STEPS[i]}`, css: `oklch(${+(L * 100).toFixed(2)}% ${C} ${H})`, hex: hex(labToRgb(lab)), lab, L });
    });
  }
  return out;
}

const bw = (): Swatch[] => [
  { name: 'black', css: '#000000', hex: '#000000', lab: [0, 0, 0], L: 0 },
  { name: 'white', css: '#FFFFFF', hex: '#FFFFFF', lab: [1, 0, 0], L: 1 },
];

const PALETTES = { v4: [...buildV4(), ...bw()], v3: [...buildV3(), ...bw()] };

// ---------- State ----------

let version: 'v4' | 'v3' = 'v4';
let prefix = 'bg';
let current: RGB = [5, 147, 198];
let matches: Match[] = [];

const say = (msg: string) => (status.textContent = msg);

function closeness(d: number): { label: string; cls: string } {
  if (d < 1.5) return { label: 'Looks the same', cls: 'same' };
  if (d < 4) return { label: 'Very close', cls: 'very' };
  if (d < 8) return { label: 'Close', cls: 'close' };
  return { label: 'Noticeably different', cls: 'far' };
}

// 0 distance fills the bar; 16 or more leaves it empty.
const barWidth = (d: number) => `${Math.round(clamp(1 - d / 16, 0.03, 1) * 100)}%`;
const ink = (L: number) => (L > 0.66 ? '#0B2230' : '#FFFFFF');

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
  } catch {
    say('Your browser blocked copying. Select the text instead.');
  }
}

function render() {
  const lab = rgbToLab(current);
  const h = hex(current);
  youSwatch.style.background = h;
  youSwatch.style.color = ink(lab[0]);
  youHex.textContent = h;
  picker.value = h.toLowerCase();

  matches = PALETTES[version]
    .map((s) => ({ ...s, d: dist(lab, s.lab) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);

  const best = matches[0];
  const c = closeness(best.d);
  verdict.textContent =
    c.cls === 'far' ? 'No Tailwind color is close. Use the exact value below.' : `${c.label}. Use ${prefix}-${best.name}.`;
  verdict.classList.remove('same', 'very', 'close', 'far');
  verdict.classList.add(c.cls);

  list.replaceChildren(
    ...matches.map((m, i) => {
      const li = document.createElement('li');
      const k = closeness(m.d);
      li.className = k.cls;
      const sw = document.createElement('div');
      sw.className = 'sw';
      sw.style.background = m.css;
      sw.style.color = ink(m.L);
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = i === 0 ? 'Closest' : `#${i + 1}`;
      const nm = document.createElement('strong');
      nm.textContent = `${prefix}-${m.name}`;
      sw.append(rank, nm);

      const meter = document.createElement('div');
      meter.className = 'meter';
      const lab2 = document.createElement('span');
      lab2.className = 'mlabel';
      lab2.textContent = k.label;
      const track = document.createElement('div');
      track.className = 'track';
      const fill = document.createElement('div');
      fill.className = 'fill';
      fill.style.width = barWidth(m.d);
      track.append(fill);
      meter.append(lab2, track);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy';
      btn.textContent = 'Copy class';
      btn.addEventListener('click', () => copy(`${prefix}-${m.name}`, `Copied ${prefix}-${m.name}`));
      li.append(sw, meter, btn);
      return li;
    }),
  );

  const arb = `${prefix}-[${h}]`;
  arbCode.textContent = arb;
  none.classList.toggle('far', c.cls === 'far');
  arbBtn.onclick = () => copy(arb, `Copied ${arb}`);
  scaleLink.href = `/tools/tailwind-color-generator/?hex=${h.slice(1)}`;

  table.replaceChildren(
    ...matches.map((m) => {
      const tr = document.createElement('tr');
      [m.name, m.css, m.hex, m.d.toFixed(2)].forEach((v) => {
        const td = document.createElement('td');
        td.textContent = v;
        tr.append(td);
      });
      return tr;
    }),
  );

  const url = new URL(location.href);
  url.searchParams.set('c', h.slice(1));
  if (version === 'v3') url.searchParams.set('v', '3');
  else url.searchParams.delete('v');
  history.replaceState(null, '', url);
}

function setColor(rgb: RGB) {
  current = rgb.map((v) => Math.round(v)) as RGB;
  render();
}

textIn.addEventListener('input', () => {
  const rgb = parse(textIn.value);
  error.hidden = !!rgb || !textIn.value.trim();
  if (rgb) setColor(rgb);
});

picker.addEventListener('input', () => {
  textIn.value = picker.value.toUpperCase();
  error.hidden = true;
  setColor(hexToRgb(picker.value.slice(1)));
});

versionBtns.forEach((b) =>
  b.addEventListener('click', () => {
    version = b.dataset.version as 'v4' | 'v3';
    versionBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    render();
  }),
);

prefixBtns.forEach((b) =>
  b.addEventListener('click', () => {
    prefix = b.dataset.prefix!;
    prefixBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    render();
  }),
);

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const ED = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
if (ED) {
  dropBtn.hidden = false;
  dropBtn.addEventListener('click', async () => {
    try {
      const { sRGBHex } = await new ED().open();
      const rgb = parse(sRGBHex);
      if (rgb) {
        textIn.value = hex(rgb);
        error.hidden = true;
        setColor(rgb);
      }
    } catch {
      // Closed with Esc: nothing to do.
    }
  });
}

linkBtn.addEventListener('click', () => copy(location.href, 'Link copied'));

const params = new URLSearchParams(location.search);
if (params.get('v') === '3') {
  version = 'v3';
  versionBtns.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.version === 'v3')));
}
const fromLink = parse(params.get('c') ?? '');
if (fromLink) {
  current = fromLink;
  textIn.value = hex(fromLink);
}
render();
