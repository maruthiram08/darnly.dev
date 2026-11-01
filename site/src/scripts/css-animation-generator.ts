// CSS animations: pick a preset, tune timing and easing, watch it replay, copy CSS or Tailwind.
// Everything runs in the visitor's browser.

export type PresetId = 'fade' | 'slide' | 'bounce' | 'pulse' | 'shake' | 'spin' | 'pop' | 'shimmer' | 'typing';
export type Target = 'card' | 'button' | 'icon';
export type SlideFrom = 'below' | 'above' | 'left' | 'right';
export type Direction = 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
export type Bezier = [number, number, number, number];

export type Anim = {
  preset: PresetId;
  duration: number; // ms
  delay: number; // ms
  bezier: Bezier;
  iterations: number; // 0 = infinite
  direction: Direction;
  slideFrom: SlideFrom;
  target: Target;
  text: string; // typing preset only
};

type Preset = {
  id: PresetId;
  label: string;
  says: string; // what it is good for, in plain words
  duration: number;
  bezier: Bezier;
  iterations: number;
  direction: Direction;
  target: Target | 'skeleton' | 'text';
};

export const PRESETS: Preset[] = [
  { id: 'fade', label: 'Fade', says: 'Fades in. Good for anything that appears: cards, pages, modals.', duration: 600, bezier: [0.25, 0.1, 0.25, 1], iterations: 1, direction: 'normal', target: 'card' },
  { id: 'slide', label: 'Slide', says: 'Slides in while fading. Good for lists, toasts and sections as you scroll.', duration: 600, bezier: [0.2, 0.8, 0.2, 1], iterations: 1, direction: 'normal', target: 'card' },
  { id: 'bounce', label: 'Bounce', says: 'Hops up and settles. Good for a “scroll down” arrow or a new badge.', duration: 1200, bezier: [0.42, 0, 0.58, 1], iterations: 0, direction: 'normal', target: 'icon' },
  { id: 'pulse', label: 'Pulse', says: 'Grows a little and back. Good for a call-to-action button or a live dot.', duration: 1600, bezier: [0.42, 0, 0.58, 1], iterations: 0, direction: 'normal', target: 'button' },
  { id: 'shake', label: 'Shake', says: 'Shakes side to side. Good for a wrong password or a form error.', duration: 500, bezier: [0.36, 0.07, 0.19, 0.97], iterations: 1, direction: 'normal', target: 'card' },
  { id: 'spin', label: 'Spin', says: 'Turns round and round. Good for loading spinners and refresh icons.', duration: 1000, bezier: [0, 0, 1, 1], iterations: 0, direction: 'normal', target: 'icon' },
  { id: 'pop', label: 'Pop', says: 'Pops in with a little overshoot. Good for likes, badges and success ticks.', duration: 450, bezier: [0.34, 1.56, 0.64, 1], iterations: 1, direction: 'normal', target: 'button' },
  { id: 'shimmer', label: 'Shimmer', says: 'A light sweep over grey blocks. Good for “loading” placeholders.', duration: 1500, bezier: [0, 0, 1, 1], iterations: 0, direction: 'normal', target: 'skeleton' },
  { id: 'typing', label: 'Typing', says: 'Types the text letter by letter with a blinking cursor. Good for hero headlines.', duration: 2200, bezier: [0, 0, 1, 1], iterations: 1, direction: 'normal', target: 'text' },
];
export const presetOf = (id: PresetId) => PRESETS.find((p) => p.id === id)!;

export const EASINGS: { name: string; b: Bezier; keyword?: string; says: string }[] = [
  { name: 'Linear', b: [0, 0, 1, 1], keyword: 'linear', says: 'Same speed all the way. Right for spinners and shimmers, robotic for the rest.' },
  { name: 'Ease', b: [0.25, 0.1, 0.25, 1], keyword: 'ease', says: 'The browser default: quick start, gentle stop.' },
  { name: 'Ease in', b: [0.42, 0, 1, 1], keyword: 'ease-in', says: 'Starts slow, ends fast. Use it for things leaving the screen.' },
  { name: 'Ease out', b: [0, 0, 0.58, 1], keyword: 'ease-out', says: 'Starts fast, ends slow. Use it for things arriving.' },
  { name: 'Ease in-out', b: [0.42, 0, 0.58, 1], keyword: 'ease-in-out', says: 'Slow, fast, slow. Good for loops that go back and forth.' },
  { name: 'Snappy', b: [0.2, 0.8, 0.2, 1], says: 'Fast start and a long soft landing. Feels quick and polished.' },
  { name: 'Springy', b: [0.34, 1.56, 0.64, 1], says: 'Overshoots a little and settles, like a spring.' },
  { name: 'Anticipate', b: [0.68, -0.6, 0.32, 1.6], says: 'Pulls back first, then overshoots. Playful, use it sparingly.' },
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const sameB = (a: Bezier, b: Bezier) => a.every((v, i) => Math.abs(v - b[i]) < 0.005);
export const easingName = (b: Bezier) => EASINGS.find((e) => sameB(e.b, b))?.name ?? 'Custom';

export function typingSteps(a: Anim): number {
  return Math.max(1, [...a.text].length);
}

export function easingCss(a: Anim): string {
  if (a.preset === 'typing') return `steps(${typingSteps(a)})`;
  const k = EASINGS.find((e) => e.keyword && sameB(e.b, a.bezier));
  if (k) return k.keyword!;
  return `cubic-bezier(${a.bezier.map(r2).join(', ')})`;
}

export function keyframeName(a: Anim): string {
  switch (a.preset) {
    case 'fade': return 'fade-in';
    case 'slide': return `slide-in-from-${a.slideFrom}`;
    case 'bounce': return 'bounce-soft';
    case 'pulse': return 'pulse-soft';
    case 'shake': return 'shake-x';
    case 'spin': return 'spin-round';
    case 'pop': return 'pop-in';
    case 'shimmer': return 'shimmer';
    case 'typing': return 'typing';
  }
}

// Keyframe bodies, one rule per line, without the @keyframes wrapper.
function frames(a: Anim): string[] {
  switch (a.preset) {
    case 'fade':
      return ['from { opacity: 0; }', 'to { opacity: 1; }'];
    case 'slide': {
      const t = { below: 'translateY(24px)', above: 'translateY(-24px)', left: 'translateX(-32px)', right: 'translateX(32px)' }[a.slideFrom];
      return [`from { opacity: 0; transform: ${t}; }`, 'to { opacity: 1; transform: none; }'];
    }
    case 'bounce':
      return ['0%, 50%, 80%, 100% { transform: translateY(0); }', '30% { transform: translateY(-18px); }', '65% { transform: translateY(-6px); }'];
    case 'pulse':
      return ['0%, 100% { transform: scale(1); }', '50% { transform: scale(1.06); }'];
    case 'shake':
      return ['0%, 100% { transform: translateX(0); }', '10%, 30%, 50%, 70% { transform: translateX(-8px); }', '20%, 40%, 60% { transform: translateX(8px); }', '80% { transform: translateX(4px); }', '90% { transform: translateX(-2px); }'];
    case 'spin':
      return ['from { transform: rotate(0deg); }', 'to { transform: rotate(360deg); }'];
    case 'pop':
      return ['from { opacity: 0; transform: scale(0.6); }', 'to { opacity: 1; transform: scale(1); }'];
    case 'shimmer':
      return ['from { background-position: 150% 0; }', 'to { background-position: -50% 0; }'];
    case 'typing':
      return ['from { width: 0; }'];
  }
}

const CARET_FRAMES = ['50% { border-color: transparent; }'];

// Extra styles some presets need on the element itself.
function baseDecls(a: Anim): string[] {
  if (a.preset === 'shimmer') {
    return ['background: linear-gradient(90deg, #e3eaee 30%, #ffffff 50%, #e3eaee 70%);', 'background-size: 300% 100%;'];
  }
  if (a.preset === 'typing') {
    return [`width: ${typingSteps(a)}ch; /* one ch per letter */`, 'white-space: nowrap;', 'overflow: hidden;', 'border-right: 2px solid currentColor;', 'font-family: ui-monospace, monospace;'];
  }
  if (a.preset === 'spin') return ['transform-origin: center;'];
  return [];
}

const secs = (ms: number) => (ms % 1000 === 0 ? `${ms / 1000}s` : ms >= 1000 ? `${r2(ms / 1000)}s` : `${ms}ms`);

// The animation shorthand, leaving out the defaults so it stays short.
export function shorthand(a: Anim, sep = ' '): string {
  const parts = [keyframeName(a), secs(a.duration), easingCss(a)];
  if (a.delay > 0) parts.push(secs(a.delay));
  if (a.iterations !== 1) parts.push(a.iterations === 0 ? 'infinite' : String(a.iterations));
  if (a.direction !== 'normal') parts.push(a.direction);
  parts.push('both');
  let s = parts.join(sep);
  if (a.preset === 'typing') s += `,${sep === ' ' ? ' ' : ''}${['caret', '0.8s', 'step-end', 'infinite'].join(sep)}`;
  return sep === ' ' ? s : s.replace(/, /g, ',');
}

function keyframesBlock(name: string, body: string[], indent = ''): string {
  return `${indent}@keyframes ${name} {\n${body.map((l) => `${indent}  ${l}`).join('\n')}\n${indent}}`;
}

export function className(a: Anim): string {
  return `animate-${keyframeName(a)}`;
}

export function cssOutput(a: Anim, withReducedMotion = true): string {
  const name = keyframeName(a);
  const cls = className(a);
  const out = [keyframesBlock(name, frames(a))];
  if (a.preset === 'typing') out.push(keyframesBlock('caret', CARET_FRAMES));
  const decls = [...baseDecls(a), `animation: ${shorthand(a)};`];
  out.push(`.${cls} {\n${decls.map((d) => `  ${d}`).join('\n')}\n}`);
  if (withReducedMotion) out.push(
    `/* People who turn off animations in their system settings see the end state, with no movement. */\n@media (prefers-reduced-motion: reduce) {\n  .${cls} { animation: none; }\n}`,
  );
  return out.join('\n\n');
}

// Tailwind classes for the extra styles, so the @theme and arbitrary outputs work on their own.
function twBase(a: Anim): string {
  if (a.preset === 'shimmer') return 'bg-[linear-gradient(90deg,#e3eaee_30%,#ffffff_50%,#e3eaee_70%)] bg-[length:300%_100%]';
  if (a.preset === 'typing') return `w-[${typingSteps(a)}ch] whitespace-nowrap overflow-hidden border-r-2 border-current font-mono`;
  return '';
}

export function themeOutput(a: Anim): string {
  const name = keyframeName(a);
  const lines = ['/* In your main CSS file, after @import "tailwindcss"; */', '@theme {', `  --animate-${name}: ${shorthand(a)};`, '', keyframesBlock(name, frames(a), '  ')];
  if (a.preset === 'typing') lines.push('', keyframesBlock('caret', CARET_FRAMES, '  '));
  lines.push('}');
  const extra = twBase(a);
  lines.push('', '<!-- Then use it: -->', `<div class="${[extra, `animate-${name}`, 'motion-reduce:animate-none'].filter(Boolean).join(' ')}">…</div>`);
  return lines.join('\n');
}

export function arbitraryOutput(a: Anim): string {
  return [twBase(a), `animate-[${shorthand(a, '_')}]`, 'motion-reduce:animate-none'].filter(Boolean).join(' ');
}

export function arbitraryKeyframes(a: Anim): string {
  const out = [keyframesBlock(keyframeName(a), frames(a))];
  if (a.preset === 'typing') out.push(keyframesBlock('caret', CARET_FRAMES));
  return `/* The class needs these keyframes in your global CSS file: */\n${out.join('\n\n')}`;
}

const TARGET_WORDS: Record<string, string> = { card: 'a card', button: 'a button', icon: 'an icon', skeleton: 'a loading placeholder', text: 'a headline' };

export function promptOutput(a: Anim): string {
  const p = presetOf(a.preset);
  const iter = a.iterations === 0 ? 'loops forever' : a.iterations === 1 ? 'plays once' : `plays ${a.iterations} times`;
  return [
    `Add a "${p.label.toLowerCase()}" CSS animation to my site. Use it on [which element, e.g. ${TARGET_WORDS[p.target === 'card' || p.target === 'button' || p.target === 'icon' ? a.target : p.target]}].`,
    `It lasts ${secs(a.duration)}${a.delay ? ` after a ${secs(a.delay)} wait` : ''}, ${iter}, and uses the "${a.preset === 'typing' ? 'steps' : easingName(a.bezier)}" easing.`,
    'If the project uses Tailwind v4, add it to the @theme block in the main CSS file instead of a separate class. Keep the prefers-reduced-motion rule so people who turn off animations see no movement.',
    '',
    cssOutput(a),
  ].join('\n');
}

// ---- Cubic-bezier math, for the dot that runs along the curve ----
export function bezierY(b: Bezier, x: number): number {
  const [x1, y1, x2, y2] = b;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 30; i++) {
    t = (lo + hi) / 2;
    if (sx(t) < x) lo = t;
    else hi = t;
  }
  return ((ay * t + by) * t + cy) * t;
}

export function parseBezier(s: string): Bezier | null {
  const kw = EASINGS.find((e) => e.keyword && e.keyword === s.trim().toLowerCase());
  if (kw) return [...kw.b] as Bezier;
  const m = s.match(/^\s*(?:cubic-bezier\()?\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)\s*\)?\s*;?\s*$/i);
  if (!m) return null;
  const n = m.slice(1, 5).map(Number) as Bezier;
  if (n.some((v) => !Number.isFinite(v))) return null;
  if (n[0] < 0 || n[0] > 1 || n[2] < 0 || n[2] > 1) return null;
  return n;
}

// ---- Page ----
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

  const stage = $('ca-stage');
  const live = $('ca-live'); // <style> element holding the generated CSS
  const presetsBox = $('ca-presets');
  const says = $('ca-says');
  const replayBtn = $<HTMLButtonElement>('ca-replay');
  const reduced = $<HTMLInputElement>('ca-reduced');
  const targetField = $('ca-target-field');
  const targetSeg = $('ca-target');
  const slideField = $('ca-slide-field');
  const slideSel = $<HTMLSelectElement>('ca-slide');
  const textField = $('ca-text-field');
  const textIn = $<HTMLInputElement>('ca-text');
  const dur = $<HTMLInputElement>('ca-dur');
  const durOut = $('ca-dur-out');
  const delay = $<HTMLInputElement>('ca-delay');
  const delayOut = $('ca-delay-out');
  const iterSeg = $('ca-iter');
  const dirSeg = $('ca-dir');
  const dirHint = $('ca-dir-hint');
  const easeBox = $('ca-ease');
  const easeNote = $('ca-ease-note');
  const easePresets = $('ca-ease-presets');
  const easeIn = $<HTMLInputElement>('ca-ease-in');
  const easeSays = $('ca-ease-says');
  const curve = $('ca-curve') as unknown as SVGPathElement;
  const arm1 = $('ca-arm1') as unknown as SVGLineElement;
  const arm2 = $('ca-arm2') as unknown as SVGLineElement;
  const h1 = $('ca-h1') as unknown as SVGCircleElement;
  const h2 = $('ca-h2') as unknown as SVGCircleElement;
  const svg = $('ca-svg') as unknown as SVGSVGElement;
  const dot = $('ca-dot');
  const status = $('ca-status');
  const outCss = $('ca-css');
  const outTheme = $('ca-theme');
  const outArb = $('ca-arb');
  const outArbKf = $('ca-arb-kf');
  const promptBtn = $<HTMLButtonElement>('ca-prompt');

  const fromPreset = (p: Preset, keep?: Anim): Anim => ({
    preset: p.id,
    duration: p.duration,
    delay: 0,
    bezier: [...p.bezier] as Bezier,
    iterations: p.iterations,
    direction: p.direction,
    slideFrom: keep?.slideFrom ?? 'below',
    target: p.target === 'card' || p.target === 'button' || p.target === 'icon' ? p.target : keep?.target ?? 'card',
    text: keep?.text ?? 'Ship it before lunch.',
  });

  let a: Anim = fromPreset(PRESETS[0]);

  // Preset buttons, each with a tiny looping demo square.
  const presetButtons = PRESETS.map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    const demo = document.createElement('span');
    demo.className = `demo demo-${p.id}`;
    demo.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = p.label;
    b.append(demo, label);
    b.addEventListener('click', () => {
      a = fromPreset(p, a);
      syncControls();
      render();
    });
    presetsBox.append(b);
    return b;
  });

  // Easing chips, each with its curve drawn small.
  const easeButtons = EASINGS.map((e) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '-4 -14 48 68');
    s.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    const [x1, y1, x2, y2] = e.b;
    path.setAttribute('d', `M0 40 C ${x1 * 40} ${40 - y1 * 40} ${x2 * 40} ${40 - y2 * 40} 40 0`);
    s.append(path);
    const label = document.createElement('span');
    label.textContent = e.name;
    b.append(s, label);
    b.addEventListener('click', () => {
      a.bezier = [...e.b] as Bezier;
      render();
    });
    easePresets.append(b);
    return b;
  });

  // ---- Preview element ----
  function buildTarget(): HTMLElement {
    const p = presetOf(a.preset);
    const kind = p.target === 'skeleton' || p.target === 'text' ? p.target : a.target;
    const el = document.createElement('div');
    el.className = 'ca-target';
    if (kind === 'card') {
      el.classList.add('t-card');
      el.innerHTML = '<span class="t-avatar"></span><span class="t-lines"><strong>New sign-up</strong><span>Priya just joined your waitlist.</span></span>';
    } else if (kind === 'button') {
      el.classList.add('t-button');
      el.textContent = 'Get early access';
    } else if (kind === 'icon') {
      el.classList.add('t-icon');
      el.innerHTML =
        a.preset === 'spin'
          ? '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="18" fill="none" stroke="currentColor" stroke-opacity=".2" stroke-width="5"/><path d="M24 6a18 18 0 0 1 18 18" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>'
          : '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 10v26M13 26l11 11 11-11" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    } else if (kind === 'skeleton') {
      el.classList.add('t-skeleton');
      el.innerHTML = '<span class="sk-row"><span class="sk sk-circle"></span><span class="sk-col"><span class="sk sk-line w60"></span><span class="sk sk-line w40"></span></span></span><span class="sk sk-block"></span><span class="sk sk-line"></span><span class="sk sk-line w80"></span>';
    } else {
      el.classList.add('t-text');
      // A hidden full copy keeps the box the final size, so the text types from the left without the layout jumping.
      el.innerHTML = '<span class="t-ghost" aria-hidden="true"></span><span class="t-type"></span>';
      el.querySelector('.t-ghost')!.textContent = a.text || ' ';
      el.querySelector('.t-type')!.textContent = a.text || ' ';
    }
    return el;
  }

  // The class name is applied to the moving part: the text for typing, each grey block for shimmer.
  function animated(el: HTMLElement): HTMLElement[] {
    if (a.preset === 'typing') return [el.querySelector<HTMLElement>('.t-type')!];
    if (a.preset === 'shimmer') return [...el.querySelectorAll<HTMLElement>('.sk')];
    return [el];
  }

  let lastShape = '';
  function replay() {
    const shape = `${a.preset}|${a.target}|${a.text}`;
    let el = stage.querySelector<HTMLElement>('.ca-target');
    if (!el || shape !== lastShape) {
      el = buildTarget();
      stage.querySelector('.ca-target')?.remove();
      stage.append(el);
      lastShape = shape;
    }
    const cls = className(a);
    for (const node of animated(el)) {
      node.className = node.className.replace(/\banimate-[\w-]+/g, '').trim();
      void node.offsetWidth; // restart the animation
      if (!reduced.checked) node.classList.add(cls);
    }
    // The dot under the curve runs once with the same timing.
    dot.style.animation = 'none';
    void dot.offsetWidth;
    dot.style.animation = reduced.checked ? 'none' : `ca-dot ${a.duration}ms ${a.preset === 'typing' ? `steps(${typingSteps(a)})` : easingCss(a)} both`;
  }

  // ---- Easing editor (SVG, 220 × 300; x 0–1 → 10–210, y −0.5–1.5 → 300–0) ----
  const X = (t: number) => 10 + t * 200;
  const Y = (v: number) => 225 - v * 150;
  function drawCurve() {
    const [x1, y1, x2, y2] = a.bezier;
    curve.setAttribute('d', `M${X(0)} ${Y(0)} C ${X(x1)} ${Y(y1)} ${X(x2)} ${Y(y2)} ${X(1)} ${Y(1)}`);
    arm1.setAttribute('x2', String(X(x1)));
    arm1.setAttribute('y2', String(Y(y1)));
    arm2.setAttribute('x2', String(X(x2)));
    arm2.setAttribute('y2', String(Y(y2)));
    h1.setAttribute('cx', String(X(x1)));
    h1.setAttribute('cy', String(Y(y1)));
    h2.setAttribute('cx', String(X(x2)));
    h2.setAttribute('cy', String(Y(y2)));
    h1.setAttribute('aria-valuetext', `first handle at ${r2(x1)}, ${r2(y1)}`);
    h2.setAttribute('aria-valuetext', `second handle at ${r2(x2)}, ${r2(y2)}`);
  }

  let dragging: 0 | 1 | null = null;
  function pointFrom(e: PointerEvent): [number, number] {
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * 220;
    const sy = ((e.clientY - r.top) / r.height) * 300;
    const t = Math.min(1, Math.max(0, (sx - 10) / 200));
    const v = Math.min(1.5, Math.max(-0.5, (225 - sy) / 150));
    return [r2(t), r2(v)];
  }
  [h1, h2].forEach((h, i) => {
    h.addEventListener('pointerdown', (e) => {
      if (a.preset === 'typing') return;
      dragging = i as 0 | 1;
      (h as unknown as Element).setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    h.addEventListener('pointermove', (e) => {
      if (dragging !== i) return;
      const [t, v] = pointFrom(e);
      a.bezier[i * 2] = t;
      a.bezier[i * 2 + 1] = v;
      drawCurve();
      syncEaseText();
      renderOutputs();
    });
    const end = () => {
      if (dragging === i) {
        dragging = null;
        render();
      }
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
    h.addEventListener('keydown', (e) => {
      if (a.preset === 'typing') return;
      const step = e.shiftKey ? 0.1 : 0.01;
      const k = i * 2;
      if (e.key === 'ArrowLeft') a.bezier[k] = Math.max(0, r2(a.bezier[k] - step));
      else if (e.key === 'ArrowRight') a.bezier[k] = Math.min(1, r2(a.bezier[k] + step));
      else if (e.key === 'ArrowUp') a.bezier[k + 1] = Math.min(1.5, r2(a.bezier[k + 1] + step));
      else if (e.key === 'ArrowDown') a.bezier[k + 1] = Math.max(-0.5, r2(a.bezier[k + 1] - step));
      else return;
      e.preventDefault();
      render();
    });
  });

  function syncEaseText() {
    if (document.activeElement !== easeIn) easeIn.value = a.preset === 'typing' ? `steps(${typingSteps(a)})` : `cubic-bezier(${a.bezier.map(r2).join(', ')})`;
    easeIn.removeAttribute('aria-invalid');
    const name = easingName(a.bezier);
    easeButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(a.preset !== 'typing' && EASINGS[i].name === name)));
    easeSays.textContent = a.preset === 'typing' ? '' : name === 'Custom' ? 'Your own curve. Steeper means faster at that moment.' : EASINGS.find((e) => e.name === name)!.says;
  }
  easeIn.addEventListener('input', () => {
    const b = parseBezier(easeIn.value);
    if (!b) {
      easeIn.setAttribute('aria-invalid', 'true');
      return;
    }
    a.bezier = b;
    render();
  });
  easeIn.addEventListener('blur', syncEaseText);

  // ---- Controls ----
  function setSeg(seg: HTMLElement, v: string) {
    for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-checked', String(b.dataset.v === v));
  }
  function onSeg(seg: HTMLElement, f: (v: string) => void) {
    seg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
      if (!b) return;
      f(b.dataset.v!);
      render();
    });
  }
  onSeg(targetSeg, (v) => (a.target = v as Target));
  onSeg(iterSeg, (v) => (a.iterations = Number(v)));
  onSeg(dirSeg, (v) => (a.direction = v as Direction));
  slideSel.addEventListener('change', () => {
    a.slideFrom = slideSel.value as SlideFrom;
    render();
  });
  textIn.addEventListener('input', () => {
    a.text = textIn.value.slice(0, 40);
    render();
  });
  dur.addEventListener('input', () => {
    a.duration = Number(dur.value);
    render();
  });
  delay.addEventListener('input', () => {
    a.delay = Number(delay.value);
    render();
  });
  replayBtn.addEventListener('click', replay);
  stage.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('button, label, input')) replay();
  });
  reduced.addEventListener('change', () => {
    stage.classList.toggle('is-reduced', reduced.checked);
    render();
  });

  const DIR_WORDS: Record<Direction, string> = {
    normal: 'Plays start to end.',
    reverse: 'Plays end to start, so a fade in becomes a fade out.',
    alternate: 'Goes there and back. Needs more than one play to see it.',
    'alternate-reverse': 'Goes back and there. Needs more than one play to see it.',
  };

  function syncControls() {
    dur.value = String(a.duration);
    delay.value = String(a.delay);
    slideSel.value = a.slideFrom;
    textIn.value = a.text;
  }

  function renderOutputs() {
    outCss.textContent = cssOutput(a);
    outTheme.textContent = themeOutput(a);
    outArb.textContent = arbitraryOutput(a);
    outArbKf.textContent = arbitraryKeyframes(a);
    // The preview uses the exact CSS you copy. The reduced-motion rule is left out here so the
    // "turned off animations" box below the preview decides, even for visitors who have it on.
    live.textContent = cssOutput(a, false);
  }

  function render() {
    const p = presetOf(a.preset);
    presetButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(PRESETS[i].id === a.preset)));
    says.textContent = p.says;
    targetField.hidden = p.target === 'skeleton' || p.target === 'text';
    slideField.hidden = a.preset !== 'slide';
    textField.hidden = a.preset !== 'typing';
    setSeg(targetSeg, a.target);
    setSeg(iterSeg, String(a.iterations));
    setSeg(dirSeg, a.direction);
    dirHint.textContent = DIR_WORDS[a.direction];
    durOut.textContent = secs(a.duration);
    delayOut.textContent = a.delay ? secs(a.delay) : 'none';
    easeBox.classList.toggle('off', a.preset === 'typing');
    easeNote.hidden = a.preset !== 'typing';
    [h1, h2].forEach((h) => h.setAttribute('tabindex', a.preset === 'typing' ? '-1' : '0'));
    easeIn.disabled = a.preset === 'typing';
    drawCurve();
    syncEaseText();
    renderOutputs();
    const iter = a.iterations === 0 ? 'on a loop' : a.iterations === 1 ? 'once' : `${a.iterations} times`;
    status.textContent = reduced.checked
      ? 'This is what people who turn off animations see: the end state, with no movement.'
      : `${p.label}, ${secs(a.duration)}, ${iter}${a.delay ? `, after ${secs(a.delay)}` : ''}. Click the preview to replay.`;
    replay();
  }

  // ---- Copy ----
  document.querySelectorAll<HTMLButtonElement>('.ca [data-copy]').forEach((b) => {
    b.addEventListener('click', () => {
      const text = $(b.dataset.copy!).textContent ?? '';
      copyText(text, (ok) => {
        b.textContent = ok ? 'Copied' : 'Select and copy';
        setTimeout(() => (b.textContent = 'Copy'), 1600);
      });
    });
  });
  promptBtn.addEventListener('click', () => {
    copyText(promptOutput(a), (ok) => {
      promptBtn.textContent = ok ? 'Copied. Paste it into your agent' : 'Could not copy';
      setTimeout(() => (promptBtn.textContent = 'Copy prompt for your AI agent'), 2200);
    });
  });

  // Start with reduced motion ticked for people who asked their system for it.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    reduced.checked = true;
    stage.classList.add('is-reduced');
  }
  syncControls();
  render();
}

// Last, so every table above is defined before the page code runs.
if (typeof document !== 'undefined') init();
