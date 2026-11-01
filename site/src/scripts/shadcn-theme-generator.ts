// shadcn/ui theme generator page. Everything runs in the visitor's browser.

import { parseHex, rgbToHex, type RGB } from './oklch';
import {
  buildTheme, v4Css, v3Css, agentPrompt, previewCss, oklchCss, contrast, toneRgb, flatten,
  randomOptions, hueName, RADII, VARS,
  type BaseName, type AccentStyle, type ChartStyle, type Mode, type Theme, type Options,
} from './shadcn-theme-core';

if (typeof document !== 'undefined' && document.getElementById('st-preview')) init();

function init() {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const picker = $<HTMLInputElement>('st-picker');
  const hexInput = $<HTMLInputElement>('st-hex');
  const presets = $<HTMLElement>('st-presets');
  const baseGroup = $<HTMLElement>('st-base');
  const radiusGroup = $<HTMLElement>('st-radius');
  const modeGroup = $<HTMLElement>('st-mode');
  const accentSel = $<HTMLSelectElement>('st-accent');
  const chartSel = $<HTMLSelectElement>('st-chart');
  const randomBtn = $<HTMLButtonElement>('st-random');
  const error = $<HTMLParagraphElement>('st-error');
  const preview = $<HTMLElement>('st-preview');
  const checks = $<HTMLElement>('st-checks');
  const tokens = $<HTMLUListElement>('st-tokens');
  const status = $<HTMLParagraphElement>('st-status');
  const code = $<HTMLElement>('st-code');
  const tabs = $<HTMLElement>('st-tabs');
  const copyCode = $<HTMLButtonElement>('st-copy-code');
  const copyMain = $<HTMLButtonElement>('st-copy-main');
  const promptBtn = $<HTMLButtonElement>('st-prompt');
  const tintDot = $<HTMLElement>('st-tint-dot');

  const BASES: BaseName[] = ['neutral', 'zinc', 'slate', 'stone', 'gray', 'tinted'];
  const state: Options & { mode: Mode; tab: 'v4' | 'v3' | 'prompt' } = {
    primary: parseHex(hexInput.value) ?? [0.02, 0.58, 0.78],
    base: 'zinc',
    radius: 0.625,
    accent: 'gray',
    chart: 'shades',
    mode: 'light',
    tab: 'v4',
  };
  let theme: Theme;

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
  function flash(btn: HTMLButtonElement, ok: boolean, label: string) {
    btn.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => (btn.textContent = label), 1500);
  }

  // Radio-style chip groups.
  function setChecked(group: HTMLElement, value: string) {
    for (const b of group.querySelectorAll<HTMLButtonElement>('[data-v]')) {
      const on = b.dataset.v === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }
  function onChips(group: HTMLElement, fn: (v: string) => void) {
    group.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-v]');
      if (b) fn(b.dataset.v!);
    });
    group.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      const items = [...group.querySelectorAll<HTMLButtonElement>('[data-v]')];
      const i = items.findIndex((b) => b.getAttribute('aria-checked') === 'true');
      const next = items[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
      e.preventDefault();
      fn(next.dataset.v!);
      next.focus();
    });
  }

  function codeFor(tab: typeof state.tab) {
    if (tab === 'v3') return v3Css(theme);
    if (tab === 'prompt') return agentPrompt(theme, rgbToHex(state.primary));
    return v4Css(theme);
  }

  function renderChecks() {
    const p = theme[state.mode];
    const bg = p.background;
    const rows: [string, number, number, string][] = [
      // label, ratio, pass threshold, what it's for
      ['Button text', contrast(toneRgb(p.primary), toneRgb(p['primary-foreground'])), 4.5, 'text on primary buttons'],
      ['Gray text', contrast(toneRgb(p['muted-foreground']), toneRgb(bg)), 4.5, 'muted text on the page'],
      ['Brand on page', contrast(toneRgb(p.primary), toneRgb(bg)), 3, 'buttons, links and focus rings against the background'],
      ['Borders', contrast(flatten(p.border, bg), toneRgb(bg)), 1.15, 'card and input borders'],
    ];
    checks.replaceChildren(
      ...rows.map(([label, ratio, need, what]) => {
        const s = document.createElement('span');
        const level = ratio >= need ? 'ok' : ratio >= need * 0.75 ? 'warn' : 'bad';
        s.className = `chk ${level}`;
        s.title = `${label}: ${ratio.toFixed(2)}:1 for ${what}. Aim for ${need}:1 or more.`;
        s.textContent = `${level === 'ok' ? '✓' : level === 'warn' ? '!' : '✕'} ${label} `;
        const b = document.createElement('b');
        b.textContent = `${ratio.toFixed(1)}:1`;
        s.append(b);
        return s;
      }),
    );
  }

  function renderTokens() {
    const p = theme[state.mode];
    const show = ['background', 'foreground', 'primary', 'primary-foreground', 'secondary', 'muted', 'muted-foreground', 'accent', 'border', 'ring', 'destructive', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'];
    tokens.replaceChildren(
      ...show.map((v) => {
        const li = document.createElement('li');
        const i = document.createElement('i');
        i.style.background = p[v].a === undefined ? previewCss(p[v]) : rgbToHex(flatten(p[v], p.background));
        const span = document.createElement('span');
        span.textContent = v;
        li.title = `--${v}: ${oklchCss(p[v])} (click to copy)`;
        li.tabIndex = 0;
        li.setAttribute('role', 'button');
        li.append(i, span);
        const copy = () => copyText(oklchCss(p[v]), (ok) => say(ok ? `Copied --${v}: ${oklchCss(p[v])}` : 'Your browser blocked copying.'));
        li.addEventListener('click', copy);
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            copy();
          }
        });
        return li;
      }),
    );
  }

  function render() {
    theme = buildTheme(state);
    const p = theme[state.mode];
    for (const v of VARS) preview.style.setProperty(`--${v}`, previewCss(p[v]));
    preview.style.setProperty('--radius', `${state.radius}rem`);
    tintDot.style.background = previewCss(buildTheme({ ...state, base: 'tinted' }).light['muted-foreground']);

    setChecked(baseGroup, state.base);
    setChecked(radiusGroup, String(state.radius));
    setChecked(modeGroup, state.mode);
    accentSel.value = state.accent;
    chartSel.value = state.chart;
    const hex = rgbToHex(state.primary);
    for (const b of presets.querySelectorAll<HTMLButtonElement>('[data-hex]')) b.setAttribute('aria-pressed', String(b.dataset.hex === hex));

    renderChecks();
    renderTokens();
    code.textContent = codeFor(state.tab);

    // Keep the link shareable: ?c=0593c6&base=zinc&r=0.625&accent=tint&chart=mix&mode=dark
    try {
      const u = new URL(location.href);
      u.search = '';
      u.searchParams.set('c', hex.slice(1));
      u.searchParams.set('base', state.base);
      u.searchParams.set('r', String(state.radius));
      if (state.accent !== 'gray') u.searchParams.set('accent', state.accent);
      if (state.chart !== 'shades') u.searchParams.set('chart', state.chart);
      if (state.mode !== 'light') u.searchParams.set('mode', state.mode);
      history.replaceState(null, '', u);
    } catch {}
  }

  function setColor(rgb: RGB, from: 'picker' | 'hex' | 'other') {
    state.primary = rgb;
    const hex = rgbToHex(rgb);
    if (from !== 'picker') picker.value = hex;
    if (from !== 'hex') hexInput.value = hex.toUpperCase();
    error.hidden = true;
    hexInput.removeAttribute('aria-invalid');
    render();
  }

  // Start from the link's settings if it has any.
  const q = new URLSearchParams(location.search);
  const fromLink = parseHex(q.get('c') ?? '');
  if (BASES.includes(q.get('base') as BaseName)) state.base = q.get('base') as BaseName;
  const r = Number(q.get('r'));
  if (q.has('r') && RADII.includes(r)) state.radius = r;
  if (q.get('accent') === 'tint') state.accent = 'tint';
  if (q.get('chart') === 'mix') state.chart = 'mix';
  if (q.get('mode') === 'dark') state.mode = 'dark';
  setColor(fromLink ?? state.primary, 'other');

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
      hexInput.value = rgbToHex(state.primary).toUpperCase();
      error.hidden = true;
      hexInput.removeAttribute('aria-invalid');
    }
  });
  presets.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-hex]');
    const rgb = b && parseHex(b.dataset.hex!);
    if (rgb) setColor(rgb, 'other');
  });
  onChips(baseGroup, (v) => {
    state.base = v as BaseName;
    render();
  });
  onChips(radiusGroup, (v) => {
    state.radius = Number(v);
    render();
  });
  onChips(modeGroup, (v) => {
    state.mode = v as Mode;
    render();
  });
  accentSel.addEventListener('input', () => {
    state.accent = accentSel.value as AccentStyle;
    render();
  });
  chartSel.addEventListener('input', () => {
    state.chart = chartSel.value as ChartStyle;
    render();
  });

  randomBtn.addEventListener('click', () => {
    const o = randomOptions();
    Object.assign(state, { base: o.base, radius: o.radius, accent: o.accent, chart: o.chart });
    setColor(o.primary, 'other');
    say(`Randomized: ${hueName(o.primary)} on ${o.base === 'tinted' ? 'tinted' : o.base} grays, ${o.radius}rem corners. Press again for another.`);
  });

  // Little bits of life in the preview: the tabs switch.
  preview.querySelector('.sp-tabs')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    for (const t of preview.querySelectorAll('.sp-tabs button')) t.classList.toggle('on', t === b);
  });

  tabs.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-v]');
    if (!b) return;
    state.tab = b.dataset.v as typeof state.tab;
    for (const t of tabs.querySelectorAll<HTMLButtonElement>('[data-v]')) t.setAttribute('aria-selected', String(t === b));
    code.textContent = codeFor(state.tab);
  });
  copyCode.addEventListener('click', () => copyText(code.textContent ?? '', (ok) => flash(copyCode, ok, 'Copy')));
  copyMain.addEventListener('click', () =>
    copyText(v4Css(theme), (ok) => {
      flash(copyMain, ok, 'Copy globals.css');
      say(ok ? 'Copied the Tailwind v4 globals.css. Replace the :root and .dark blocks in yours with it.' : 'Your browser blocked copying. Select the text below instead.');
    }),
  );
  promptBtn.addEventListener('click', () =>
    copyText(agentPrompt(theme, rgbToHex(state.primary)), (ok) => {
      flash(promptBtn, ok, 'Copy prompt for your AI agent');
      say(ok ? 'Copied. Paste it into Claude Code, Codex or Cursor.' : 'Your browser blocked copying.');
    }),
  );
}
