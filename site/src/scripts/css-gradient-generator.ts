// CSS gradients and layered box shadows, with a live preview. Everything runs in the visitor's browser.

type RGB = [number, number, number]; // 0–255
export type Stop = { color: RGB; alpha: number; pos: number }; // alpha 0–1, pos 0–100
export type GradientType = 'linear' | 'radial' | 'conic';
export type Gradient = {
  type: GradientType;
  angle: number;
  shape: 'ellipse' | 'circle';
  at: string;
  smooth: boolean;
  stops: Stop[];
};
export type Shadow = {
  distance: number;
  blur: number;
  opacity: number; // 0–1
  spread: number;
  layers: number;
  direction: number; // degrees, 90 = straight down
  color: RGB;
};

// ---- Colors ----
export function parseHex(input: string): RGB | null {
  let s = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = [...s].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/.test(s)) return null;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
}
export const toHex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const round2 = (n: number) => Math.round(n * 100) / 100;

export function colorCss(c: RGB, alpha: number): string {
  if (alpha >= 1) return toHex(c);
  return `rgba(${c.map(Math.round).join(', ')}, ${round2(alpha)})`;
}
// Tailwind arbitrary values can't hold spaces; an 8-digit hex keeps it short.
function colorTw(c: RGB, alpha: number): string {
  if (alpha >= 1) return toHex(c);
  return toHex(c) + Math.round(alpha * 255).toString(16).padStart(2, '0');
}

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;

// The color the gradient shows at `pos`, used when a stop is added by clicking the bar.
export function colorAt(stops: Stop[], pos: number): { color: RGB; alpha: number } {
  const s = [...stops].sort((a, b) => a.pos - b.pos);
  if (pos <= s[0].pos) return { color: s[0].color, alpha: s[0].alpha };
  for (let i = 1; i < s.length; i++) {
    if (pos <= s[i].pos) {
      const t = (pos - s[i - 1].pos) / (s[i].pos - s[i - 1].pos || 1);
      return { color: mix(s[i - 1].color, s[i].color, t), alpha: s[i - 1].alpha + (s[i].alpha - s[i - 1].alpha) * t };
    }
  }
  const last = s[s.length - 1];
  return { color: last.color, alpha: last.alpha };
}

// Relative luminance, to pick readable text on top of a color.
function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// ---- Gradient output ----
const sorted = (g: Gradient) => [...g.stops].sort((a, b) => a.pos - b.pos);

function head(g: Gradient, sep: string): string {
  const interp = g.smooth ? `${sep}in${sep}oklch` : '';
  if (g.type === 'linear') return `${g.angle}deg${interp}`;
  if (g.type === 'radial') return `${g.shape}${sep}at${sep}${g.at.replace(/ /g, sep)}${interp}`;
  return `from${sep}${g.angle}deg${sep}at${sep}${g.at.replace(/ /g, sep)}${interp}`;
}

export function gradientCss(g: Gradient): string {
  const stops = sorted(g).map((s) => `${colorCss(s.color, s.alpha)} ${Math.round(s.pos)}%`);
  return `${g.type}-gradient(${head(g, ' ')}, ${stops.join(', ')})`;
}

export function gradientTailwind(g: Gradient): string {
  const stops = sorted(g).map((s) => `${colorTw(s.color, s.alpha)}_${Math.round(s.pos)}%`);
  return `bg-[${g.type}-gradient(${head(g, '_')},${stops.join(',')})]`;
}

// Tailwind v4's own gradient utilities: at most three stops (from, via, to). Null when they can't express it.
export function gradientTailwind4(g: Gradient): string | null {
  const s = sorted(g);
  if (s.length > 3) return null;
  const mode = g.smooth ? '/oklch' : '/srgb';
  let base: string;
  if (g.type === 'linear') base = `bg-linear-${g.angle}${mode}`;
  else if (g.type === 'radial') {
    if (g.at === 'center' && g.shape === 'ellipse') base = `bg-radial${mode}`;
    else return null;
  } else {
    if (g.at !== 'center') return null;
    base = `bg-conic-${g.angle}${mode}`;
  }
  const parts = [base];
  const names = s.length === 2 ? ['from', 'to'] : ['from', 'via', 'to'];
  const defaults: Record<string, number> = { from: 0, via: 50, to: 100 };
  s.forEach((stop, i) => {
    const n = names[i];
    parts.push(`${n}-[${colorTw(stop.color, stop.alpha)}]`);
    const p = Math.round(stop.pos);
    if (p !== defaults[n]) parts.push(`${n}-${p}%`);
  });
  return parts.join(' ');
}

// ---- Shadow output ----
// Several layers, each bigger, softer and fainter than the last, which reads as a real soft shadow.
export function shadowLayers(sh: Shadow): string[] {
  const n = Math.max(1, Math.round(sh.layers));
  const rad = (sh.direction * Math.PI) / 180;
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const r = n === 1 ? 1 : 2 ** (i - 1) / 2 ** (n - 1);
    const t = n === 1 ? 0 : (i - 1) / (n - 1);
    const d = sh.distance * r;
    const x = Math.round(Math.cos(rad) * d);
    const y = Math.round(Math.sin(rad) * d);
    const blur = Math.round(sh.blur * r);
    const spread = Math.round(sh.spread * r);
    const a = Math.max(0.01, round2(n === 1 ? sh.opacity : (sh.opacity * 1.4 * (1 - 0.4 * t)) / Math.sqrt(n)));
    const c = `rgba(${sh.color.join(', ')}, ${Math.min(1, a)})`;
    out.push(`${x}px ${y}px ${blur}px${spread ? ` ${spread}px` : ''} ${c}`.replace(/(^|\s)-?0px/g, (_m, sp) => `${sp}0`));
  }
  return out;
}
export const shadowCss = (sh: Shadow) => shadowLayers(sh).join(', ');
export const shadowTailwind = (sh: Shadow) =>
  `shadow-[${shadowLayers(sh).map((l) => l.replace(/, /g, ',').replace(/ /g, '_')).join(',')}]`;

// ---- Presets ----
const st = (hex: string, pos: number, alpha = 1): Stop => ({ color: parseHex(hex)!, alpha, pos });
const lin = (angle: number, ...stops: Stop[]): Gradient => ({ type: 'linear', angle, shape: 'ellipse', at: 'center', smooth: false, stops });

// No purple-to-blue: that's the most common "made by AI" tell.
export const GRADIENT_PRESETS: { name: string; g: Gradient }[] = [
  { name: 'Peach', g: lin(135, st('#f6d365', 0), st('#fda085', 100)) },
  { name: 'Mint', g: lin(120, st('#d4fc79', 0), st('#96e6a1', 100)) },
  { name: 'Lagoon', g: lin(160, st('#13547a', 0), st('#80d0c7', 100)) },
  { name: 'Ember', g: lin(45, st('#f83600', 0), st('#f9d423', 100)) },
  { name: 'Dusk', g: lin(180, st('#2c3e50', 0), st('#fd746c', 100)) },
  { name: 'Sand', g: lin(135, st('#fdfcfb', 0), st('#e2d1c3', 100)) },
  { name: 'Forest', g: lin(135, st('#0b3d2e', 0), st('#3fa34d', 60), st('#c9e265', 100)) },
  { name: 'Sky', g: lin(135, st('#0593c6', 0), st('#7fd3ee', 100)) },
  { name: 'Glow', g: { type: 'radial', angle: 0, shape: 'circle', at: 'top left', smooth: true, stops: [st('#ffb88c', 0), st('#de6262', 55), st('#2b1a2f', 100)] } },
  { name: 'Wheel', g: { type: 'conic', angle: 0, shape: 'ellipse', at: 'center', smooth: true, stops: [st('#ff6b6b', 0), st('#ffd93d', 33), st('#6bcb77', 66), st('#ff6b6b', 100)] } },
  { name: 'Fade', g: lin(180, st('#0b2230', 0, 0), st('#0b2230', 100, 0.85)) },
];

const ink: RGB = [11, 34, 48];
export const SHADOW_PRESETS: { name: string; s: Shadow }[] = [
  { name: 'Subtle', s: { distance: 4, blur: 8, opacity: 0.12, spread: 0, layers: 3, direction: 90, color: ink } },
  { name: 'Soft', s: { distance: 16, blur: 32, opacity: 0.16, spread: 0, layers: 5, direction: 90, color: ink } },
  { name: 'Lifted', s: { distance: 32, blur: 64, opacity: 0.2, spread: -4, layers: 6, direction: 90, color: ink } },
  { name: 'Floating', s: { distance: 64, blur: 96, opacity: 0.22, spread: -12, layers: 6, direction: 90, color: ink } },
  { name: 'Crisp', s: { distance: 2, blur: 4, opacity: 0.22, spread: 0, layers: 2, direction: 90, color: ink } },
  { name: 'Bold', s: { distance: 8, blur: 0, opacity: 1, spread: 0, layers: 1, direction: 45, color: ink } },
  { name: 'Glow', s: { distance: 0, blur: 48, opacity: 0.5, spread: 0, layers: 3, direction: 90, color: [216, 57, 149] } },
];

const cloneG = (g: Gradient): Gradient => ({ ...g, stops: g.stops.map((s) => ({ ...s, color: [...s.color] as RGB })) });

// ---- Page ----
if (typeof document !== 'undefined') init();

function init() {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  function copyText(text: string, done: (ok: boolean) => void) {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(fallback(text)));
    else done(fallback(text));
  }
  function fallback(text: string): boolean {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.append(t);
    t.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    t.remove();
    return ok;
  }

  // ---- Tabs ----
  const tabs = [$<HTMLButtonElement>('cg-tab-gradient'), $<HTMLButtonElement>('cg-tab-shadow')];
  function showTab(i: number, focus = false) {
    tabs.forEach((t, j) => {
      const on = i === j;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')!).hidden = !on;
    });
    if (focus) tabs[i].focus();
    try {
      const u = new URL(location.href);
      if (i === 1) u.searchParams.set('tab', 'shadow');
      else u.searchParams.delete('tab');
      history.replaceState(null, '', u);
    } catch {}
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => showTab(i));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        showTab(1 - i, true);
      }
    });
  });
  if (new URLSearchParams(location.search).get('tab') === 'shadow') showTab(1);

  // ---- Gradient ----
  const gStage = $('cg-g-stage');
  const gArt = $('cg-g-art');
  const gBtn = $('cg-g-btn');
  const bar = $('cg-bar');
  const barFill = $('cg-bar-fill');
  const handles = $('cg-handles');
  const stopPicker = $<HTMLInputElement>('cg-stop-picker');
  const stopHex = $<HTMLInputElement>('cg-stop-hex');
  const stopRemove = $<HTMLButtonElement>('cg-stop-remove');
  const stopPos = $<HTMLInputElement>('cg-stop-pos');
  const stopPosOut = $('cg-stop-pos-out');
  const stopAlpha = $<HTMLInputElement>('cg-stop-alpha');
  const stopAlphaOut = $('cg-stop-alpha-out');
  const typeSeg = $('cg-type');
  const angle = $<HTMLInputElement>('cg-angle');
  const angleOut = $('cg-angle-out');
  const angleField = $('cg-angle-field');
  const shape = $<HTMLSelectElement>('cg-shape');
  const shapeField = $('cg-shape-field');
  const at = $<HTMLSelectElement>('cg-pos');
  const atField = $('cg-pos-field');
  const smooth = $<HTMLInputElement>('cg-smooth');
  const gPresets = $('cg-g-presets');
  const gCss = $('cg-g-css');
  const gTw = $('cg-g-tw');
  const gTw4 = $('cg-g-tw4');
  const gTw4Box = $('cg-g-tw4-box');
  const gTw4Note = $('cg-g-tw4-note');
  const gStatus = $('cg-g-status');

  let g = cloneG(GRADIENT_PRESETS[0].g);
  let sel = 0; // index into g.stops
  let presetIdx: number | null = 0;

  const presetButtons = GRADIENT_PRESETS.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.background = gradientCss(p.g);
    const label = document.createElement('span');
    label.textContent = p.name;
    b.append(chip, label);
    b.addEventListener('click', () => {
      g = cloneG(p.g);
      sel = 0;
      presetIdx = i;
      syncControls();
      renderG();
      gStatus.textContent = `${p.name} preset. Drag the circles to make it yours.`;
    });
    gPresets.append(b);
    return b;
  });

  function syncControls() {
    for (const b of typeSeg.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-checked', String(b.dataset.v === g.type));
    angle.value = String(g.angle);
    shape.value = g.shape;
    at.value = g.at;
    smooth.checked = g.smooth;
  }

  function renderStops() {
    handles.replaceChildren(
      ...g.stops.map((s, i) => {
        const h = document.createElement('button');
        h.type = 'button';
        h.className = 'handle' + (i === sel ? ' on' : '');
        h.style.left = `${s.pos}%`;
        h.style.background = colorCss(s.color, s.alpha);
        h.setAttribute('aria-label', `Color ${toHex(s.color).toUpperCase()} at ${Math.round(s.pos)}%. Arrow keys move it, Delete removes it.`);
        h.dataset.i = String(i);
        return h;
      }),
    );
    const s = g.stops[sel];
    const hex = toHex(s.color);
    stopPicker.value = hex;
    if (document.activeElement !== stopHex) stopHex.value = hex.toUpperCase();
    stopPos.value = String(Math.round(s.pos));
    stopPosOut.textContent = `${Math.round(s.pos)}%`;
    stopAlpha.value = String(Math.round(s.alpha * 100));
    stopAlphaOut.textContent = `${Math.round(s.alpha * 100)}%`;
    stopRemove.disabled = g.stops.length <= 2;
  }

  function renderG() {
    const css = gradientCss(g);
    gStage.style.background = css;
    gArt.style.background = css;
    gBtn.style.background = css;
    // Readable button text: dark on light gradients, white on dark ones.
    const avg = sorted(g).reduce((sum, s) => sum + luminance(mix([255, 255, 255], s.color, s.alpha)), 0) / g.stops.length;
    gBtn.style.color = avg > 0.45 ? '#0B2230' : '#FFFFFF';
    barFill.style.background = `linear-gradient(90deg, ${sorted(g).map((s) => `${colorCss(s.color, s.alpha)} ${Math.round(s.pos)}%`).join(', ')})`;
    angleOut.textContent = `${g.angle}°`;
    angleField.hidden = g.type === 'radial';
    shapeField.hidden = g.type !== 'radial';
    atField.hidden = g.type === 'linear';
    gCss.textContent = `background: ${css};`;
    gTw.textContent = gradientTailwind(g);
    const tw4 = gradientTailwind4(g);
    gTw4Box.hidden = !tw4;
    gTw4Note.hidden = !!tw4;
    gTw4Note.textContent =
      g.stops.length > 3
        ? 'Tailwind v4 utilities allow at most three colors. Use the class above for this gradient.'
        : 'Tailwind v4 utilities can’t place this center. Use the class above for this gradient.';
    gTw4.textContent = tw4 ?? '';
    presetButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === presetIdx)));
    renderStops();
  }

  const changed = () => {
    presetIdx = null;
    renderG();
  };

  for (const b of typeSeg.querySelectorAll<HTMLButtonElement>('button')) {
    b.addEventListener('click', () => {
      g.type = b.dataset.v as GradientType;
      syncControls();
      changed();
    });
  }
  angle.addEventListener('input', () => {
    g.angle = Number(angle.value);
    changed();
  });
  shape.addEventListener('input', () => {
    g.shape = shape.value as Gradient['shape'];
    changed();
  });
  at.addEventListener('input', () => {
    g.at = at.value;
    changed();
  });
  smooth.addEventListener('input', () => {
    g.smooth = smooth.checked;
    changed();
  });

  stopPicker.addEventListener('input', () => {
    const c = parseHex(stopPicker.value);
    if (!c) return;
    g.stops[sel].color = c;
    stopHex.value = stopPicker.value.toUpperCase();
    stopHex.removeAttribute('aria-invalid');
    changed();
  });
  stopHex.addEventListener('input', () => {
    const c = parseHex(stopHex.value);
    if (c) {
      g.stops[sel].color = c;
      stopHex.removeAttribute('aria-invalid');
      changed();
    } else if (stopHex.value.replace(/[#\s]/g, '').length >= 6) stopHex.setAttribute('aria-invalid', 'true');
  });
  stopHex.addEventListener('blur', () => {
    stopHex.value = toHex(g.stops[sel].color).toUpperCase();
    stopHex.removeAttribute('aria-invalid');
  });
  stopPos.addEventListener('input', () => {
    g.stops[sel].pos = Number(stopPos.value);
    changed();
  });
  stopAlpha.addEventListener('input', () => {
    g.stops[sel].alpha = Number(stopAlpha.value) / 100;
    changed();
  });
  function removeStop() {
    if (g.stops.length <= 2) return;
    g.stops.splice(sel, 1);
    sel = Math.min(sel, g.stops.length - 1);
    changed();
  }
  stopRemove.addEventListener('click', removeStop);

  // Dragging stops, and clicking the bar to add one.
  const posFromEvent = (e: PointerEvent) => {
    const r = bar.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
  };
  let dragging: number | null = null;
  bar.addEventListener('pointerdown', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.handle');
    if (target) {
      sel = Number(target.dataset.i);
      dragging = sel;
    } else {
      const pos = Math.round(posFromEvent(e));
      const { color, alpha } = colorAt(g.stops, pos);
      g.stops.push({ color, alpha, pos });
      sel = g.stops.length - 1;
      dragging = sel;
      gStatus.textContent = 'Added a color. Pick its color below, or drag it.';
    }
    bar.setPointerCapture(e.pointerId);
    e.preventDefault();
    changed();
    (handles.children[sel] as HTMLElement | undefined)?.focus();
  });
  bar.addEventListener('pointermove', (e) => {
    if (dragging === null) return;
    g.stops[dragging].pos = Math.round(posFromEvent(e));
    changed();
    (handles.children[sel] as HTMLElement | undefined)?.focus();
  });
  const stopDrag = () => (dragging = null);
  bar.addEventListener('pointerup', stopDrag);
  bar.addEventListener('pointercancel', stopDrag);
  handles.addEventListener('keydown', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.handle');
    if (!t) return;
    sel = Number(t.dataset.i);
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') g.stops[sel].pos = Math.max(0, g.stops[sel].pos - step);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') g.stops[sel].pos = Math.min(100, g.stops[sel].pos + step);
    else if (e.key === 'Delete' || e.key === 'Backspace') removeStop();
    else return;
    e.preventDefault();
    changed();
    (handles.children[sel] as HTMLElement | undefined)?.focus();
  });
  handles.addEventListener('focusin', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.handle');
    if (t && Number(t.dataset.i) !== sel) {
      sel = Number(t.dataset.i);
      renderStops();
      (handles.children[sel] as HTMLElement | undefined)?.focus();
    }
  });

  // Random but pleasant: two or three nearby hues, never purple-to-blue.
  $('cg-random').addEventListener('click', () => {
    const hsl = (h: number, s: number, l: number): RGB => {
      const k = (n: number) => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return [f(0) * 255, f(8) * 255, f(4) * 255].map(Math.round) as RGB;
    };
    const purpleBlue = (h: number) => h > 215 && h < 300;
    let h1 = 0;
    let h2 = 0;
    do {
      h1 = Math.floor(Math.random() * 360);
      h2 = (h1 + (Math.random() < 0.5 ? -1 : 1) * (25 + Math.random() * 60) + 360) % 360;
    } while (purpleBlue(h1) || purpleBlue(h2));
    const dark = Math.random() < 0.35;
    g = {
      ...g,
      type: 'linear',
      angle: [45, 90, 120, 135, 160, 180][Math.floor(Math.random() * 6)],
      stops: [
        { color: hsl(h1, 0.75, dark ? 0.22 : 0.7), alpha: 1, pos: 0 },
        { color: hsl(h2, 0.8, dark ? 0.5 : 0.6), alpha: 1, pos: 100 },
      ],
    };
    sel = 0;
    presetIdx = null;
    syncControls();
    renderG();
    gStatus.textContent = 'A fresh gradient. Press again for another.';
  });

  $('cg-g-prompt').addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const tw4 = gradientTailwind4(g);
    const text = [
      'Add this CSS gradient to my app:',
      `background: ${gradientCss(g)};`,
      '',
      `If the project uses Tailwind, use this class instead: ${gradientTailwind(g)}` + (tw4 ? ` (or on Tailwind v4: ${tw4})` : ''),
      'Put it where it fits best, like the hero section or the main call-to-action button. If it isn’t clear where I want it, ask me first.',
      'Make sure any text on top stays easy to read (at least 4.5:1 contrast), and don’t change other styles unless I ask.',
    ].join('\n');
    copyText(text, (ok) => {
      gStatus.textContent = ok ? 'Copied. Paste it into Claude Code, Codex or Cursor.' : 'Your browser blocked copying.';
      btn.textContent = ok ? 'Copied prompt' : 'Copy failed';
      setTimeout(() => (btn.textContent = 'Copy prompt for your AI agent'), 1600);
    });
  });

  // ---- Shadow ----
  const sStage = $('cg-s-stage');
  const sCard = $('cg-s-card');
  const sBtn = $('cg-s-btn');
  const sPresets = $('cg-s-presets');
  const sCss = $('cg-s-css');
  const sTw = $('cg-s-tw');
  const sStatus = $('cg-s-status');
  const sColor = $<HTMLInputElement>('cg-s-color');
  const sBg = $<HTMLInputElement>('cg-s-bg');
  const sliders = {
    distance: [$<HTMLInputElement>('cg-dist'), $('cg-dist-out'), (v: number) => `${v}px`],
    blur: [$<HTMLInputElement>('cg-blur'), $('cg-blur-out'), (v: number) => `${v}px`],
    opacity: [$<HTMLInputElement>('cg-op'), $('cg-op-out'), (v: number) => `${v}%`],
    spread: [$<HTMLInputElement>('cg-spread'), $('cg-spread-out'), (v: number) => `${v}px`],
    layers: [$<HTMLInputElement>('cg-layers'), $('cg-layers-out'), (v: number) => String(v)],
    direction: [$<HTMLInputElement>('cg-dir'), $('cg-dir-out'), (v: number) => `${v}°`],
  } as const;
  type Key = keyof typeof sliders;

  let sh: Shadow = { ...SHADOW_PRESETS[1].s };
  let sPreset: number | null = 1;

  const sButtons = SHADOW_PRESETS.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    const chip = document.createElement('span');
    chip.className = 'chip shadow';
    // Scaled down so big shadows still fit in a small chip.
    chip.style.boxShadow = shadowCss({ ...p.s, distance: p.s.distance / 3, blur: p.s.blur / 3, spread: p.s.spread / 3, opacity: Math.min(1, p.s.opacity * 1.5) });
    const label = document.createElement('span');
    label.textContent = p.name;
    b.append(chip, label);
    b.addEventListener('click', () => {
      sh = { ...p.s, color: [...p.s.color] as RGB };
      sPreset = i;
      syncShadow();
      renderS();
      sStatus.textContent = `${p.name} preset.`;
    });
    sPresets.append(b);
    return b;
  });

  function syncShadow() {
    for (const k of Object.keys(sliders) as Key[]) {
      const v = k === 'opacity' ? Math.round(sh.opacity * 100) : sh[k];
      sliders[k][0].value = String(v);
    }
    sColor.value = toHex(sh.color);
  }

  function renderS() {
    const css = shadowCss(sh);
    sCard.style.boxShadow = css;
    sBtn.style.boxShadow = css;
    for (const k of Object.keys(sliders) as Key[]) {
      const [input, out, f] = sliders[k];
      out.textContent = f(Number(input.value));
    }
    sCss.textContent = `box-shadow: ${shadowLayers(sh).join(',\n            ')};`;
    sTw.textContent = shadowTailwind(sh);
    sButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === sPreset)));
  }

  for (const k of Object.keys(sliders) as Key[]) {
    sliders[k][0].addEventListener('input', () => {
      const v = Number(sliders[k][0].value);
      if (k === 'opacity') sh.opacity = v / 100;
      else sh[k] = v;
      sPreset = null;
      renderS();
    });
  }
  sColor.addEventListener('input', () => {
    const c = parseHex(sColor.value);
    if (c) sh.color = c;
    sPreset = null;
    renderS();
  });
  sBg.addEventListener('input', () => (sStage.style.background = sBg.value));
  sStage.style.background = sBg.value;

  $('cg-s-prompt').addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const text = [
      'Use this soft, layered box shadow in my app:',
      `box-shadow: ${shadowCss(sh)};`,
      '',
      `If the project uses Tailwind, use this class instead: ${shadowTailwind(sh)}`,
      'Apply it to cards and raised panels (and buttons if it suits them). If the project has a shared card component or a theme file, add it there once instead of repeating it. Ask me if it isn’t clear which elements I mean, and don’t change other styles.',
    ].join('\n');
    copyText(text, (ok) => {
      sStatus.textContent = ok ? 'Copied. Paste it into Claude Code, Codex or Cursor.' : 'Your browser blocked copying.';
      btn.textContent = ok ? 'Copied prompt' : 'Copy failed';
      setTimeout(() => (btn.textContent = 'Copy prompt for your AI agent'), 1600);
    });
  });

  for (const btn of document.querySelectorAll<HTMLButtonElement>('.cg [data-copy]')) {
    btn.addEventListener('click', () => {
      copyText($(btn.dataset.copy!).textContent ?? '', (ok) => {
        btn.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(() => (btn.textContent = 'Copy'), 1400);
      });
    });
  }

  syncControls();
  renderG();
  syncShadow();
  renderS();
  gStatus.textContent = 'Pick a preset or drag the colors on the bar.';
  sStatus.textContent = 'Pick a preset or move the sliders.';
}
