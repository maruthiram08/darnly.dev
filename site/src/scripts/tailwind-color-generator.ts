// Tailwind color shades: one color in, a 50–950 scale out, built in OKLCH so the steps look even.
// Everything runs in the visitor's browser.

import { rgbToOklch, oklchToRgbRaw, fitGamut, rgbToHex, parseHex, type RGB, type LCH } from './oklch';

export { rgbToOklch, fitGamut, rgbToHex, parseHex };

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

// Target lightness per step, close to Tailwind's own v4 palette.
const LIGHT = [0.975, 0.935, 0.885, 0.81, 0.71, 0.63, 0.555, 0.49, 0.43, 0.385, 0.27];
// How much of the scale's peak chroma each step gets. Pale and very dark shades are calmer, the middle is richest.
const CHROMA = [0.07, 0.15, 0.28, 0.5, 0.78, 0.95, 1, 0.94, 0.8, 0.64, 0.42];

// The step whose usual lightness is closest to the color's own.
export function closestStep(L: number): number {
  let best = 0;
  for (let i = 1; i < LIGHT.length; i++) if (Math.abs(LIGHT[i] - L) < Math.abs(LIGHT[best] - L)) best = i;
  return best;
}

export type Shade = { step: number; hex: string; lch: LCH; isInput: boolean };

// Build the scale. The entered color sits exactly at `anchor`; the other steps bend smoothly toward it.
export function buildScale(input: RGB, anchor: number): Shade[] {
  const [Lin, Cin, Hin] = rgbToOklch(input);
  // Pale or very dark anchors carry little chroma, so cap how far we scale it up to keep the middle believable.
  const peak = Math.min(Cin / CHROMA[anchor], Math.max(Cin, 0.37));
  const top = Math.max(LIGHT[0], Math.min(0.995, Lin + 0.01 * anchor));
  const bottom = Math.min(LIGHT[10], Math.max(0.1, Lin - 0.025 * (10 - anchor)));
  return STEPS.map((step, i) => {
    if (i === anchor) return { step, hex: rgbToHex(input), lch: [Lin, Cin, Hin], isInput: true };
    let L: number;
    if (i < anchor) {
      // Map the usual lightness between step 50 and the anchor onto the range between `top` and the input.
      const t = (LIGHT[i] - LIGHT[anchor]) / (LIGHT[0] - LIGHT[anchor] || 1);
      L = Lin + t * (top - Lin);
    } else {
      const t = (LIGHT[anchor] - LIGHT[i]) / (LIGHT[anchor] - LIGHT[10] || 1);
      L = Lin - t * (Lin - bottom);
    }
    // Steps next to the input lean toward its own chroma, so a vivid light color doesn't sit beside dull neighbours.
    const near = Math.max(0, 1 - Math.abs(i - anchor) / 3);
    const C = Math.max(0, peak * CHROMA[i] + (Cin - peak * CHROMA[anchor]) * near);
    const lch = fitGamut([L, C, Hin]);
    return { step, hex: rgbToHex(oklchToRgbRaw(lch)), lch, isInput: false };
  });
}

// ---- Page ----
if (typeof document !== 'undefined') init();

function init() {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const picker = $<HTMLInputElement>('tc-picker');
  const hexInput = $<HTMLInputElement>('tc-hex');
  const nameInput = $<HTMLInputElement>('tc-name');
  const anchorSel = $<HTMLSelectElement>('tc-anchor');
  const formatSel = $<HTMLSelectElement>('tc-format');
  const error = $<HTMLParagraphElement>('tc-error');
  const list = $<HTMLUListElement>('tc-swatches');
  const status = $<HTMLParagraphElement>('tc-status');
  const v4 = $<HTMLElement>('tc-v4');
  const v3 = $<HTMLElement>('tc-v3');
  const css = $<HTMLElement>('tc-css');
  const promptBtn = $<HTMLButtonElement>('tc-prompt');

  let shades: Shade[] = [];
  let current: RGB = parseHex(hexInput.value) ?? [0.02, 0.58, 0.78];

  const say = (msg: string) => (status.textContent = msg);

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

  // "Brand Blue!" -> "brand-blue"; Tailwind color names must be simple.
  const colorName = () =>
    nameInput.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'brand';

  const fmt = (s: Shade) => {
    if (formatSel.value !== 'oklch') return s.hex;
    const [L, C, H] = s.lch;
    return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${C < 0.0005 ? 0 : H.toFixed(1)})`;
  };

  const v4Snippet = (n: string) =>
    `@theme {\n${shades.map((s) => `  --color-${n}-${s.step}: ${fmt(s)};`).join('\n')}\n}`;
  const v3Snippet = (n: string) => {
    const key = /^[a-z_$][a-z0-9_$]*$/.test(n) ? n : `'${n}'`;
    return `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n        ${key}: {\n${shades
      .map((s) => `          ${s.step}: '${fmt(s)}',`)
      .join('\n')}\n        },\n      },\n    },\n  },\n};`;
  };
  const cssSnippet = (n: string) => `:root {\n${shades.map((s) => `  --${n}-${s.step}: ${fmt(s)};`).join('\n')}\n}`;

  function promptText(): string {
    const n = colorName();
    const input = shades.find((s) => s.isInput)!;
    return [
      `Add this "${n}" color scale to my Tailwind setup.`,
      `- If the project uses Tailwind v4 (a CSS file with @import "tailwindcss"), add it inside @theme in that CSS file:`,
      v4Snippet(n),
      `- If it uses Tailwind v3 (a tailwind.config.js or .ts file), add it under theme.extend.colors as "${n}" with the same values.`,
      `- If the project doesn't use Tailwind, add these as CSS variables instead:`,
      cssSnippet(n),
      ``,
      `My exact brand color is ${input.hex.toUpperCase()}, which is ${n}-${input.step}.`,
      `Use ${n}-600 for primary buttons, ${n}-700 for their hover state, and ${n}-50 or ${n}-100 for light backgrounds. Don't change other colors unless I ask.`,
    ].join('\n');
  }

  function textOn(L: number) {
    return L > 0.68 ? '#0B2230' : '#FFFFFF';
  }

  function render() {
    const [L] = rgbToOklch(current);
    const auto = closestStep(L);
    const anchor = anchorSel.value === 'auto' ? auto : STEPS.indexOf(Number(anchorSel.value) as (typeof STEPS)[number]);
    anchorSel.options[0].textContent = `Closest match (${STEPS[auto]})`;
    shades = buildScale(current, anchor);
    const n = colorName();
    list.replaceChildren(
      ...shades.map((s) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch' + (s.isInput ? ' mine' : '');
        b.style.background = s.hex;
        b.style.color = textOn(s.lch[0]);
        b.setAttribute('aria-label', `Copy ${n}-${s.step}, ${s.hex.toUpperCase()}${s.isInput ? ', your color' : ''}`);
        const step = document.createElement('strong');
        step.textContent = String(s.step);
        const hex = document.createElement('span');
        hex.textContent = s.hex.toUpperCase();
        const tip = document.createElement('em');
        const label = s.isInput ? 'Your color' : 'Copy';
        tip.textContent = label;
        b.append(step, hex, tip);
        b.addEventListener('click', () =>
          copyText(fmt(s), (ok) => {
            tip.textContent = ok ? 'Copied' : 'Copy failed';
            say(ok ? `Copied ${n}-${s.step} (${fmt(s)})` : 'Your browser blocked copying. Select the text instead.');
            setTimeout(() => (tip.textContent = label), 1400);
          }),
        );
        li.append(b);
        return li;
      }),
    );
    v4.textContent = v4Snippet(n);
    v3.textContent = v3Snippet(n);
    css.textContent = cssSnippet(n);
    // Keep the link shareable: ?hex=0593c6&name=brand
    try {
      const u = new URL(location.href);
      u.searchParams.set('hex', rgbToHex(current).slice(1));
      if (n !== 'brand') u.searchParams.set('name', n);
      else u.searchParams.delete('name');
      if (anchorSel.value !== 'auto') u.searchParams.set('at', anchorSel.value);
      else u.searchParams.delete('at');
      history.replaceState(null, '', u);
    } catch {}
  }

  function setColor(rgb: RGB, from: 'picker' | 'hex' | 'init') {
    current = rgb;
    const hex = rgbToHex(rgb);
    if (from !== 'picker') picker.value = hex;
    if (from !== 'hex') hexInput.value = hex.toUpperCase();
    error.hidden = true;
    hexInput.removeAttribute('aria-invalid');
    render();
  }

  // Start from the link's color if it has one.
  const params = new URLSearchParams(location.search);
  const fromLink = parseHex(params.get('hex') ?? '');
  if (params.get('name')) nameInput.value = params.get('name')!.slice(0, 40);
  const at = params.get('at');
  if (at && [...anchorSel.options].some((o) => o.value === at)) anchorSel.value = at;
  setColor(fromLink ?? current, 'init');

  picker.addEventListener('input', () => {
    const rgb = parseHex(picker.value);
    if (rgb) setColor(rgb, 'picker');
  });
  hexInput.addEventListener('input', () => {
    const rgb = parseHex(hexInput.value);
    if (rgb) setColor(rgb, 'hex');
    else if (hexInput.value.replace(/[#\s]/g, '').length >= 6) {
      error.textContent = 'That doesn’t look like a hex color. Try something like #0593C6.';
      error.hidden = false;
      hexInput.setAttribute('aria-invalid', 'true');
    }
  });
  hexInput.addEventListener('blur', () => {
    if (!parseHex(hexInput.value)) {
      hexInput.value = rgbToHex(current).toUpperCase();
      error.hidden = true;
      hexInput.removeAttribute('aria-invalid');
    }
  });
  nameInput.addEventListener('input', render);
  anchorSel.addEventListener('input', render);
  formatSel.addEventListener('input', render);

  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    btn.addEventListener('click', () => {
      copyText($(btn.dataset.copy!).textContent ?? '', (ok) => {
        btn.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(() => (btn.textContent = 'Copy'), 1400);
      });
    });
  }
  promptBtn.addEventListener('click', () =>
    copyText(promptText(), (ok) => {
      say(ok ? 'Copied. Paste it into Claude Code, Codex or Cursor.' : 'Your browser blocked copying.');
      promptBtn.textContent = ok ? 'Copied prompt' : 'Copy failed';
      setTimeout(() => (promptBtn.textContent = 'Copy prompt for your AI agent'), 1600);
    }),
  );
}
