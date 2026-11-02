// CSS button generator page: live preview on a light and a dark page, contrast badges, and code to copy.
import {
  PRESETS, PRESET_LOOK, OWN_MOTION, FONTS, TASTEFUL,
  type Btn, type Preset, type FontKey, type Hover, type Press, type ShadowKey,
  css, tailwind, cssExport, reactExport, shadcnExport, agentPrompt, googleFontUrl, arrowSvg,
  labelBackgrounds, contrast, parseHex, textColor, gradientEnd, toQuery, fromQuery,
} from './button-generator-core';

type Format = 'css' | 'tailwind' | 'react' | 'shadcn';

function init() {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const root = $('bg');
  const style = $('bg-style');
  const status = $('bg-status');

  let b: Btn = fromQuery(location.search);
  let format: Format = 'css';
  let pages = { light: '#f6f8f9', dark: '#0e161c' };

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
  function flash(btn: HTMLButtonElement, ok: boolean, label: string, msg?: string) {
    const was = btn.dataset.label ?? btn.textContent ?? '';
    btn.dataset.label = was;
    btn.textContent = ok ? label : 'Copy failed';
    if (msg) status.textContent = ok ? msg : 'Your browser blocked copying.';
    setTimeout(() => (btn.textContent = was), 1600);
  }

  // ---- Fonts load only when picked ----
  const loaded = new Set<string>();
  function loadFont(f: FontKey) {
    const url = googleFontUrl(f);
    if (!url || loaded.has(url)) return;
    loaded.add(url);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.append(link);
  }

  // ---- Build the controls ----
  const fontSel = $<HTMLSelectElement>('bg-font');
  fontSel.innerHTML = (Object.keys(FONTS) as FontKey[]).map((k) => `<option value="${k}">${FONTS[k].name}</option>`).join('');

  const presetBox = $('bg-presets');
  presetBox.innerHTML = PRESETS.map(
    (p) => `<button type="button" role="radio" class="pre${p.key === 'glass' ? ' glass-chip' : ''}" data-v="${p.key}" aria-checked="false"><span class="bgp-${p.key}">Button</span><span>${p.name}</span></button>`,
  ).join('');

  function seg(id: string, onPick: (v: string) => void) {
    const box = $(id);
    box.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
      if (!btn) return;
      onPick(btn.dataset.v!);
    });
  }
  function setSeg(id: string, v: string) {
    for (const btn of $(id).querySelectorAll<HTMLButtonElement>('button[data-v]')) btn.setAttribute('aria-checked', String(btn.dataset.v === v));
  }

  const colorPicker = $<HTMLInputElement>('bg-color');
  const colorHex = $<HTMLInputElement>('bg-color-hex');
  const textPicker = $<HTMLInputElement>('bg-text');
  const textAuto = $<HTMLInputElement>('bg-text-auto');
  const labelIn = $<HTMLInputElement>('bg-label');
  const ranges = {
    radius: $<HTMLInputElement>('bg-radius'),
    padX: $<HTMLInputElement>('bg-padx'),
    padY: $<HTMLInputElement>('bg-pady'),
    size: $<HTMLInputElement>('bg-size'),
  };
  const outs = { radius: $('bg-radius-out'), padX: $('bg-padx-out'), padY: $('bg-pady-out'), size: $('bg-size-out') };
  const weightSel = $<HTMLSelectElement>('bg-weight');
  const hoverSel = $<HTMLSelectElement>('bg-hover');
  const pressSel = $<HTMLSelectElement>('bg-press');
  const iconBox = $<HTMLInputElement>('bg-icon');

  // Push the state into every control.
  function syncControls() {
    colorPicker.value = b.color;
    if (document.activeElement !== colorHex) {
      colorHex.value = b.color.toUpperCase();
      colorHex.removeAttribute('aria-invalid');
    }
    textAuto.checked = b.text === 'auto';
    textPicker.disabled = b.text === 'auto';
    textPicker.value = textColor(b);
    if (document.activeElement !== labelIn) labelIn.value = b.label;
    ranges.radius.value = String(b.radius >= 999 ? 33 : b.radius);
    ranges.padX.value = String(b.padX);
    ranges.padY.value = String(b.padY);
    ranges.size.value = String(b.size);
    fontSel.value = b.font;
    weightSel.value = String(b.weight);
    hoverSel.value = b.hover;
    pressSel.value = b.press;
    iconBox.checked = b.icon;
    setSeg('bg-shadow', b.shadow);
    for (const btn of presetBox.querySelectorAll<HTMLButtonElement>('.pre')) btn.setAttribute('aria-checked', String(btn.dataset.v === b.preset));
    const own = OWN_MOTION.includes(b.preset);
    $('bg-hover-field').hidden = own;
    $('bg-press-field').hidden = own;
    $('bg-shadow-field').hidden = own;
    $('bg-own').hidden = !own;
  }

  // ---- Contrast badges ----
  const large = () => b.size >= 24 || (b.size >= 19 && b.weight >= 700);
  function rate(surface: string) {
    const text = textColor(b);
    const bgs = labelBackgrounds(b, surface);
    let worst = Infinity;
    let worstBg = bgs[0];
    for (const g of bgs) {
      const r = contrast(text, g);
      if (r < worst) [worst, worstBg] = [r, g];
    }
    const need = large() ? 3 : 4.5;
    const level = worst >= need ? 'ok' : worst >= 3 ? 'warn' : 'bad';
    return { ratio: worst, level, text, bg: worstBg };
  }
  function badge(el: HTMLElement, r: ReturnType<typeof rate>) {
    el.className = 'badge' + (r.level === 'ok' ? '' : ' ' + r.level);
    const n = r.ratio.toFixed(1) + ':1';
    el.textContent = r.level === 'ok' ? `✓ Easy to read · ${n}` : r.level === 'warn' ? `Hard to read · ${n}` : `Very hard to read · ${n}`;
    el.title = 'Contrast between the label and the color behind it (WCAG).';
  }

  // ---- Render ----
  function render() {
    loadFont(b.font);
    const chips = PRESETS.map((p) => css({ ...b, ...PRESET_LOOK[p.key], preset: p.key, padX: 14, padY: 8, size: 13, weight: Math.max(600, b.weight) }, `.bgp-${p.key}`)).join('\n');
    style.textContent = css(b, '.bg-live', true) + '\n' + chips;
    root.style.setProperty('--c', b.color);
    root.style.setProperty('--c2', gradientEnd(b.color));
    root.style.setProperty('--page-light', pages.light);
    root.style.setProperty('--page-dark', pages.dark);
    root.classList.toggle('glass', b.preset === 'glass');

    const html = esc(b.label.trim() || 'Button') + (b.icon ? arrowSvg : '');
    for (const el of root.querySelectorAll<HTMLButtonElement>('.bg-live')) el.innerHTML = html;

    outs.radius.textContent = b.radius >= 999 ? 'pill' : `${b.radius}px`;
    outs.padX.textContent = `${b.padX}px`;
    outs.padY.textContent = `${b.padY}px`;
    outs.size.textContent = `${b.size}px`;

    const light = rate(pages.light);
    const dark = rate(pages.dark);
    badge($('bg-badge-light'), light);
    badge($('bg-badge-dark'), dark);
    const glass = b.preset === 'glass' ? ' Glass needs something colorful behind it, like the shapes here.' : '';
    const check = (r: typeof light) => ` <a href="/tools/contrast-checker/?fg=${r.text.slice(1)}&bg=${r.bg.slice(1)}">Try other colors in the contrast checker</a>.`;
    if (light.level === 'ok' && dark.level === 'ok') status.textContent = 'The label is easy to read on both pages.' + glass;
    else {
      const bad = light.level !== 'ok' && dark.level !== 'ok' ? 'both pages' : light.level !== 'ok' ? 'the light page' : 'the dark page';
      const r = light.level !== 'ok' ? light : dark;
      const fix = b.preset === 'outline' ? 'An outline button’s label sits on the page, so use a color that stands out from it, or switch to Solid.' : 'Try another label color or a darker or lighter button.';
      status.innerHTML = `On ${bad} the label is hard to read (${r.ratio.toFixed(1)}:1). ${fix}${check(r)}`;
    }

    renderCode();
    syncControls();
    const q = toQuery(b);
    history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
  }

  const NOTES: Record<Format, string> = {
    css: 'Give your button <code>class="btn"</code>. Works in any site, with or without a framework.',
    tailwind: 'Paste into <code>className</code> (React) or <code>class</code> (HTML). Works in Tailwind v3 and v4.',
    react: 'Save as <code>components/PrimaryButton.tsx</code>. Uses Tailwind classes.',
    shadcn: 'Open <code>components/ui/button.tsx</code> and add the two <code>brand</code> lines inside <code>buttonVariants</code>.',
  };
  function code(): string {
    if (format === 'tailwind') return tailwind(b);
    if (format === 'react') return reactExport(b);
    if (format === 'shadcn') return shadcnExport(b);
    return cssExport(b);
  }
  function renderCode() {
    $('bg-code').textContent = code();
    $('bg-code-note').innerHTML = NOTES[format];
  }

  // ---- Events ----
  const update = (patch: Partial<Btn>) => {
    b = { ...b, ...patch };
    render();
  };

  presetBox.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.pre');
    if (btn) update({ ...PRESET_LOOK[btn.dataset.v as Preset], preset: btn.dataset.v as Preset });
  });

  colorPicker.addEventListener('input', () => update({ color: colorPicker.value }));
  colorHex.addEventListener('input', () => {
    const v = parseHex(colorHex.value);
    colorHex.setAttribute('aria-invalid', String(!v));
    if (v) update({ color: v });
  });
  colorHex.addEventListener('blur', () => syncControls());
  textAuto.addEventListener('change', () => update({ text: textAuto.checked ? 'auto' : textColor(b) }));
  textPicker.addEventListener('input', () => update({ text: textPicker.value }));
  labelIn.addEventListener('input', () => update({ label: labelIn.value.slice(0, 40) }));
  ranges.radius.addEventListener('input', () => {
    const v = Number(ranges.radius.value);
    update({ radius: v >= 33 ? 999 : v });
  });
  ranges.padX.addEventListener('input', () => update({ padX: Number(ranges.padX.value) }));
  ranges.padY.addEventListener('input', () => update({ padY: Number(ranges.padY.value) }));
  ranges.size.addEventListener('input', () => update({ size: Number(ranges.size.value) }));
  fontSel.addEventListener('change', () => update({ font: fontSel.value as FontKey }));
  weightSel.addEventListener('change', () => update({ weight: Number(weightSel.value) }));
  hoverSel.addEventListener('change', () => update({ hover: hoverSel.value as Hover }));
  pressSel.addEventListener('change', () => update({ press: pressSel.value as Press }));
  iconBox.addEventListener('change', () => update({ icon: iconBox.checked }));
  seg('bg-shadow', (v) => update({ shadow: v as ShadowKey }));

  seg('bg-state', (v) => {
    setSeg('bg-state', v);
    for (const el of root.querySelectorAll<HTMLButtonElement>('.bg-live')) {
      el.classList.remove('is-hover', 'is-active');
      if (v) el.classList.add(v);
    }
  });
  seg('bg-zoom', (v) => {
    setSeg('bg-zoom', v);
    for (const el of root.querySelectorAll<HTMLElement>('.zoom')) el.style.setProperty('zoom', v);
  });

  $<HTMLInputElement>('bg-page-light').addEventListener('input', (e) => {
    pages.light = (e.target as HTMLInputElement).value;
    render();
  });
  $<HTMLInputElement>('bg-page-dark').addEventListener('input', (e) => {
    pages.dark = (e.target as HTMLInputElement).value;
    render();
  });

  const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
  $('bg-random').addEventListener('click', () => {
    const preset = pick(PRESETS).key;
    const next: Btn = {
      ...b,
      ...PRESET_LOOK[preset],
      preset,
      color: pick(TASTEFUL.filter((c) => c !== b.color)),
      text: 'auto',
      font: pick(['system', 'inter', 'figtree', 'dm-sans', 'space-grotesk', 'poppins'] as FontKey[]),
      weight: pick([600, 600, 700]),
      padX: pick([20, 24, 28]),
      padY: pick([10, 12, 14]),
    };
    if (!OWN_MOTION.includes(preset)) {
      next.radius = pick([6, 8, 12, 999]);
      next.hover = pick(['darken', 'lift', 'glow', 'grow'] as Hover[]);
      next.press = pick(['sink', 'shrink'] as Press[]);
    }
    b = next;
    render();
  });

  $('bg-share').addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    copyText(location.href, (ok) => flash(btn, ok, 'Link copied', 'Link copied. Anyone who opens it sees this button.'));
  });
  $('bg-prompt').addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    copyText(agentPrompt(b), (ok) => flash(btn, ok, 'Copied prompt', 'Copied. Paste it into Claude Code, Codex or Cursor.'));
  });

  const formatTabs = [...$('bg-formats').querySelectorAll<HTMLButtonElement>('button[data-v]')];
  function showFormat(i: number, focus = false) {
    formatTabs.forEach((t, j) => {
      t.setAttribute('aria-selected', String(i === j));
      t.tabIndex = i === j ? 0 : -1;
    });
    format = formatTabs[i].dataset.v as Format;
    if (focus) formatTabs[i].focus();
    renderCode();
  }
  formatTabs.forEach((t, i) => {
    t.addEventListener('click', () => showFormat(i));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') showFormat((i + 1) % formatTabs.length, true);
      if (e.key === 'ArrowLeft') showFormat((i + formatTabs.length - 1) % formatTabs.length, true);
    });
  });
  $('bg-copy').addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    copyText(code(), (ok) => flash(btn, ok, 'Copied'));
  });

  render();
}

if (typeof document !== 'undefined') init();
