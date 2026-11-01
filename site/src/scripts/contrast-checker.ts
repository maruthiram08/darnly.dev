// Color contrast checker: everything runs in the visitor's browser. Nothing is uploaded.

type RGBA = [number, number, number, number]; // r, g, b in 0..255, a in 0..1
type RGB = [number, number, number];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fgText = $<HTMLInputElement>('cc-fg-text');
const fgSwatch = $<HTMLInputElement>('cc-fg-swatch');
const fgError = $<HTMLParagraphElement>('cc-fg-error');
const bgText = $<HTMLInputElement>('cc-bg-text');
const bgSwatch = $<HTMLInputElement>('cc-bg-swatch');
const bgError = $<HTMLParagraphElement>('cc-bg-error');
const swap = $<HTMLButtonElement>('cc-swap');
const ratioEl = $<HTMLElement>('cc-ratio');
const verdict = $<HTMLElement>('cc-verdict');
const checks = $<HTMLUListElement>('cc-checks');
const sample = $<HTMLDivElement>('cc-sample');
const fix = $<HTMLDivElement>('cc-fix');
const suggestList = $<HTMLUListElement>('cc-suggest');
const promptBtn = $<HTMLButtonElement>('cc-prompt');
const linkBtn = $<HTMLButtonElement>('cc-link');
const status = $<HTMLParagraphElement>('cc-status');

// ---------- Reading colors ----------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function num(s: string, scale: number): number {
  const t = s.trim();
  return t.endsWith('%') ? (parseFloat(t) / 100) * scale : parseFloat(t);
}

function hslToRgb(h: number, s: number, l: number): RGB {
  // h in degrees, s and l in 0..1
  h = ((h % 360) + 360) % 360;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

// Hex, rgb() and hsl() are read exactly; anything else the browser understands (names, oklch…) goes through a 1px canvas.
function parse(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  let m = s.match(/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const v = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [v(0), v(2), v(4), h.length === 8 ? v(6) / 255 : 1];
  }

  m = s.match(/^(rgba?|hsla?)\((.*)\)$/);
  if (m) {
    const parts = m[2].replace(/\s*\/\s*/, ',').split(/\s*,\s*|\s+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    if (parts.some((p) => !/^[-+]?(\d+\.?\d*|\.\d+)(%|deg)?$/.test(p))) return null;
    const a = parts[3] !== undefined ? clamp(num(parts[3], 1), 0, 1) : 1;
    if (m[1].startsWith('rgb')) {
      const [r, g, b] = parts.slice(0, 3).map((p) => clamp(num(p, 255), 0, 255));
      return [r, g, b, a];
    }
    const h = parseFloat(parts[0]);
    const sat = clamp(num(parts[1], 1) / (parts[1].endsWith('%') ? 1 : 100), 0, 1);
    const lig = clamp(num(parts[2], 1) / (parts[2].endsWith('%') ? 1 : 100), 0, 1);
    return [...hslToRgb(h, sat, lig), a];
  }

  if (typeof CSS !== 'undefined' && CSS.supports('color', s)) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return null;
    x.fillStyle = s;
    x.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = x.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  }
  return null;
}

const blend = ([r, g, b, a]: RGBA, [br, bg, bb]: RGB): RGB => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];

const hex = (rgb: RGB) => '#' + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();

// ---------- WCAG 2 contrast ----------

function luminance([r, g, b]: RGB): number {
  const l = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
}

function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Shown rounded down, so 4.499 never reads as a passing 4.50.
const show = (r: number) => (Math.floor(r * 100) / 100).toFixed(2).replace(/\.?0+$/, '') + ':1';

// Nearest color with the same hue and saturation that reaches `min` against bg, moving lightness only.
function nearest(fg: RGB, bg: RGB, min: number): { rgb: RGB; dir: 'darker' | 'lighter'; ratio: number } | null {
  const [h, s, l0] = rgbToHsl(fg);
  const found: { rgb: RGB; dir: 'darker' | 'lighter'; ratio: number; dl: number }[] = [];
  for (const dir of ['darker', 'lighter'] as const) {
    const end = dir === 'darker' ? 0 : 1;
    if (contrast(hslToRgb(h, s, end), bg) < min) continue;
    // Contrast changes steadily along lightness on each side, so a binary search finds the edge.
    let near = l0;
    let far = end;
    for (let i = 0; i < 30; i++) {
      const mid = (near + far) / 2;
      if (contrast(hslToRgb(h, s, mid), bg) >= min) far = mid;
      else near = mid;
    }
    // Hex codes round each channel; step on until the rounded color still passes.
    let l = far;
    let rgb = hslToRgb(h, s, l).map(Math.round) as RGB;
    for (let i = 0; i < 200 && contrast(rgb, bg) < min; i++) {
      l = clamp(l + (dir === 'darker' ? -0.002 : 0.002), 0, 1);
      rgb = hslToRgb(h, s, l).map(Math.round) as RGB;
    }
    if (contrast(rgb, bg) >= min) found.push({ rgb, dir, ratio: contrast(rgb, bg), dl: Math.abs(l - l0) });
  }
  found.sort((a, b) => a.dl - b.dl);
  return found[0] ?? null;
}

// ---------- Page ----------

let fgRaw = parse(fgText.value)!;
let bgRaw = parse(bgText.value)!;
let fg: RGB = [0, 0, 0];
let bg: RGB = [255, 255, 255];
let ratio = 1;
let touched = false; // the address only changes once the visitor edits a color
let picks: { level: string; rgb: RGB; dir: string; ratio: number }[] = [];

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

function render() {
  bg = blend(bgRaw, [255, 255, 255]);
  fg = blend(fgRaw, bg);
  ratio = contrast(fg, bg);

  ratioEl.textContent = show(ratio);
  for (const li of checks.querySelectorAll<HTMLLIElement>('li')) {
    const ok = ratio >= Number(li.dataset.min);
    li.classList.toggle('pass', ok);
    li.classList.toggle('fail', !ok);
  }
  verdict.textContent =
    ratio >= 7 ? 'Passes everything, even AAA'
    : ratio >= 4.5 ? 'Passes AA for all text'
    : ratio >= 3 ? 'Only passes for large text'
    : 'Fails for all text';

  sample.style.color = hex(fg);
  sample.style.background = hex(bg);

  picks = [];
  for (const [level, min] of [['AA', 4.5], ['AAA', 7]] as const) {
    if (ratio >= min) continue;
    const n = nearest(fg, bg, min);
    if (n) picks.push({ level, ...n });
  }
  suggestList.replaceChildren(
    ...picks.map((p) => {
      const li = document.createElement('li');
      const demo = document.createElement('div');
      demo.className = 'demo';
      demo.textContent = 'Sample text';
      demo.style.color = hex(p.rgb);
      demo.style.background = hex(bg);
      const meta = document.createElement('div');
      meta.className = 'meta';
      const code = document.createElement('strong');
      code.textContent = hex(p.rgb);
      const r = document.createElement('span');
      r.textContent = show(p.ratio);
      meta.append(code, r);
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = `Passes ${p.level} for all text. ${p.dir === "darker" ? "Darker" : "Lighter"} than yours.`;
      const use = document.createElement('button');
      use.type = 'button';
      use.textContent = 'Use this';
      use.addEventListener('click', () => {
        setColor('fg', hex(p.rgb));
        say(`Text color changed to ${hex(p.rgb)}`);
      });
      li.append(demo, meta, label, use);
      return li;
    }),
  );
  const noFix = ratio < 4.5 && picks.length === 0;
  fix.hidden = picks.length === 0 && !noFix;
  promptBtn.hidden = picks.length === 0;
  if (noFix) {
    const li = document.createElement('li');
    li.textContent = 'No lighter or darker version of this text color passes on this background. Try changing the background instead.';
    suggestList.replaceChildren(li);
  }

  if (!touched) return;
  const url = new URL(location.href);
  url.searchParams.set('fg', fgText.value.trim());
  url.searchParams.set('bg', bgText.value.trim());
  history.replaceState(null, '', url);
}

function setColor(which: 'fg' | 'bg', value: string) {
  const text = which === 'fg' ? fgText : bgText;
  text.value = value;
  read(which);
}

function read(which: 'fg' | 'bg') {
  const text = which === 'fg' ? fgText : bgText;
  const swatch = which === 'fg' ? fgSwatch : bgSwatch;
  const err = which === 'fg' ? fgError : bgError;
  const c = parse(text.value);
  err.hidden = !!c || !text.value.trim();
  if (!c) return;
  touched = true;
  if (which === 'fg') fgRaw = c;
  else bgRaw = c;
  swatch.value = hex([c[0], c[1], c[2]]).toLowerCase();
  render();
}

for (const which of ['fg', 'bg'] as const) {
  const text = which === 'fg' ? fgText : bgText;
  const swatch = which === 'fg' ? fgSwatch : bgSwatch;
  text.addEventListener('input', () => read(which));
  text.addEventListener('blur', () => {
    if (!text.value.trim()) setColor(which, hex(which === 'fg' ? fg : bg));
  });
  swatch.addEventListener('input', () => setColor(which, swatch.value.toUpperCase()));
}

swap.addEventListener('click', () => {
  const f = fgText.value;
  fgText.value = bgText.value;
  bgText.value = f;
  read('fg');
  read('bg');
  say('Swapped text and background');
});

linkBtn.addEventListener('click', () => {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('fg', fgText.value.trim());
  url.searchParams.set('bg', bgText.value.trim());
  copy(url.toString(), 'Link copied');
});

promptBtn.addEventListener('click', () => {
  const p = picks[0];
  if (!p) return;
  const lines = [
    `The text color ${fgText.value.trim()} on the background ${bgText.value.trim()} has a contrast ratio of ${show(ratio)}, which fails WCAG ${p.level} (it needs ${p.level === 'AA' ? '4.5' : '7'}:1 for normal text).`,
    `Change that text color to ${hex(p.rgb)} (contrast ${show(p.ratio)}) everywhere it is used on that background.`,
    'If the color comes from a theme, CSS variable or Tailwind config, change it there rather than in each component, and tell me which other places use the same pair.',
  ];
  copy(lines.join('\n'), 'Prompt copied. Paste it into Claude Code, Codex or Cursor.');
});

// Shared links: ?fg=…&bg=…
const params = new URLSearchParams(location.search);
for (const which of ['fg', 'bg'] as const) {
  const v = params.get(which);
  if (v && parse(v)) (which === 'fg' ? fgText : bgText).value = v;
}
fgRaw = parse(fgText.value)!;
bgRaw = parse(bgText.value)!;
fgSwatch.value = hex([fgRaw[0], fgRaw[1], fgRaw[2]]).toLowerCase();
bgSwatch.value = hex([bgRaw[0], bgRaw[1], bgRaw[2]]).toLowerCase();
render();
