// Loading spinner and skeleton generator page. Everything runs in the visitor's browser.
import {
  LOADERS,
  GROUPS,
  allLoadersCss,
  loaderCode,
  loaderHtml,
  skeletonCode,
  skeletonCss,
  skeletonHtml,
  SKELETON_PRESETS,
  SKELETON_THEMES,
  DEFAULT_SKELETON,
  type CodeBlock,
  type Format,
  type Group,
  type LoaderDef,
  type Options,
  type Skeleton,
} from './loader-generator-core';

const SPEEDS = [2.4, 1.8, 1.4, 1, 0.8, 0.65, 0.5, 0.4, 0.3]; // seconds per loop, slow to fast
const SWATCHES = ['#0B2230', '#0593C6', '#D83995', '#16A34A', '#F59E0B', '#7C3AED', '#E11D48', '#FFFFFF'];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function copyText(text: string, done: (ok: boolean) => void) {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(fallback()));
  else done(fallback());
}

function renderCodes(box: HTMLElement, blocks: CodeBlock[], status: HTMLElement) {
  box.replaceChildren(
    ...blocks.map((b) => {
      const wrap = document.createElement('div');
      wrap.className = 'code';
      const head = document.createElement('div');
      head.className = 'code-head';
      const label = document.createElement('span');
      label.textContent = b.label;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', `Copy ${b.label.split(' ·')[0]}`);
      const pre = document.createElement('pre');
      pre.textContent = b.code;
      btn.addEventListener('click', () =>
        copyText(b.code, (ok) => {
          btn.textContent = ok ? 'Copied' : 'Copy failed';
          status.textContent = ok ? `Copied the ${b.label.split(' ·')[0]}.` : 'Your browser blocked copying. Select the code and copy it by hand.';
          setTimeout(() => (btn.textContent = 'Copy'), 1600);
        }),
      );
      head.append(label, btn);
      wrap.append(head, pre);
      return wrap;
    }),
  );
}

function radioGroup(group: HTMLElement, onPick: (v: string) => void) {
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('button[data-v]')];
  const set = (v: string) => buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));
  for (const b of buttons) {
    b.addEventListener('click', () => {
      set(b.dataset.v!);
      onPick(b.dataset.v!);
    });
  }
  return set;
}

function initTabs() {
  const tabs = [$('lg-tab-loaders'), $('lg-tab-skeleton')];
  const show = (tab: HTMLElement) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')!).hidden = !on;
    }
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => show(t));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      show(next);
      next.focus();
    });
  });
  if (location.hash === '#skeleton') show(tabs[1]);
}

// ---- Loaders ----

function initLoaders() {
  const style = document.createElement('style');
  document.head.appendChild(style);

  const state: Options & { id: string; format: Format; filter: Group | 'all'; bg: 'light' | 'dark' } = {
    id: 'ring',
    color: '#0593c6',
    size: 64,
    speed: 1,
    label: 'Loading',
    format: 'html',
    filter: 'all',
    bg: 'light',
  };
  const def = () => LOADERS.find((d) => d.id === state.id)!;

  // A loader as live DOM, built from the same markup the code gives out.
  const build = (d: LoaderDef, size: number, color?: string) => {
    const holder = document.createElement('div');
    holder.innerHTML = loaderHtml(d, { ...state, label: state.label });
    const el = holder.firstElementChild as HTMLElement;
    el.style.setProperty('--loader-size', `${size}px`);
    if (color) el.style.setProperty('--loader-color', color);
    return el;
  };

  // Grid
  const grid = $('lg-grid');
  const tiles = new Map<string, HTMLButtonElement>();
  for (const d of LOADERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile';
    b.dataset.id = d.id;
    b.dataset.group = d.group;
    b.setAttribute('aria-pressed', String(d.id === state.id));
    const art = document.createElement('span');
    art.className = 'tile-art';
    art.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.textContent = d.name;
    b.append(art, name);
    b.addEventListener('click', () => pick(d.id, true));
    tiles.set(d.id, b);
    grid.appendChild(b);
  }
  const drawTiles = () => {
    for (const d of LOADERS) {
      const art = tiles.get(d.id)!.querySelector('.tile-art')!;
      const el = build(d, d.wide ? 30 : 52);
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
      art.replaceChildren(el);
    }
  };

  // Filters
  const filters = $('lg-filters');
  for (const g of GROUPS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = g.name;
    b.dataset.g = g.id;
    b.setAttribute('aria-pressed', String(g.id === 'all'));
    b.addEventListener('click', () => {
      state.filter = g.id;
      for (const x of filters.children) x.setAttribute('aria-pressed', String((x as HTMLElement).dataset.g === g.id));
      for (const [, t] of tiles) t.hidden = g.id !== 'all' && t.dataset.group !== g.id;
    });
    filters.appendChild(b);
  }

  // Swatches
  const swatches = $('lg-swatches');
  for (const c of SWATCHES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = c;
    b.dataset.c = c.toLowerCase();
    b.setAttribute('aria-label', `Use ${c}`);
    b.addEventListener('click', () => setColor(c));
    swatches.appendChild(b);
  }

  const colorIn = $<HTMLInputElement>('lg-color');
  const hexIn = $<HTMLInputElement>('lg-hex');
  const sizeIn = $<HTMLInputElement>('lg-size');
  const speedIn = $<HTMLInputElement>('lg-speed');
  const labelIn = $<HTMLInputElement>('lg-label');
  const status = $('lg-status');
  const stage = $('lg-stage');
  const main = $('lg-main');

  function setColor(c: string, fromHex = false) {
    state.color = c.toLowerCase();
    colorIn.value = state.color;
    if (!fromHex) hexIn.value = state.color.toUpperCase();
    hexIn.removeAttribute('aria-invalid');
    for (const b of swatches.children) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.c === state.color));
    // White on a light page is invisible, so flip the preview for it.
    if (state.color === '#ffffff' && state.bg === 'light') setBg('dark');
    update(true);
  }

  const setBgRadio = radioGroup($('lg-bg'), (v) => setBg(v as 'light' | 'dark'));
  function setBg(v: 'light' | 'dark') {
    state.bg = v;
    stage.dataset.bg = v;
    setBgRadio(v);
  }

  function drawStage() {
    const d = def();
    $('lg-name').textContent = d.name;
    const room = Math.max(120, main.parentElement!.clientWidth - 48);
    const fit = d.wide ? Math.min(state.size, Math.floor(room / 4.2)) : Math.min(state.size, room);
    $('lg-fit').hidden = fit >= state.size;
    main.replaceChildren(build(d, fit));
    main.style.minHeight = d.wide ? '120px' : '';
    // Inside a button and next to text, the loader takes the text color.
    (document.querySelector('.stage-uses') as HTMLElement).hidden = !!d.text;
    const small = d.wide ? 10 : 20;
    const btnColor = state.bg === 'dark' ? '#0B2230' : '#FFFFFF';
    const inBtn = build(d, small, btnColor);
    inBtn.removeAttribute('role');
    $('lg-use-btn-loader').replaceChildren(inBtn);
    const inCard = build(d, small);
    inCard.removeAttribute('role');
    $('lg-use-card-loader').replaceChildren(inCard);
  }

  function drawCode() {
    renderCodes($('lg-code'), loaderCode(def(), state, state.format), status);
  }

  function update(all = false) {
    style.textContent = allLoadersCss(state);
    if (all) drawTiles();
    drawStage();
    drawCode();
  }

  function pick(id: string, scroll = false) {
    state.id = id;
    for (const [k, t] of tiles) t.setAttribute('aria-pressed', String(k === id));
    update();
    status.textContent = `${def().name} picked. Change it below, then copy the code.`;
    if (scroll && stage.getBoundingClientRect().top > window.innerHeight * 0.6) {
      stage.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }
  }

  colorIn.addEventListener('input', () => setColor(colorIn.value));
  hexIn.addEventListener('input', () => {
    let v = hexIn.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + [...v.slice(1)].map((c) => c + c).join('');
    if (/^#[0-9a-f]{6}$/i.test(v)) setColor(v, true);
    else hexIn.setAttribute('aria-invalid', 'true');
  });
  hexIn.addEventListener('blur', () => {
    hexIn.value = state.color.toUpperCase();
    hexIn.removeAttribute('aria-invalid');
  });
  sizeIn.addEventListener('input', () => {
    state.size = Number(sizeIn.value);
    $('lg-size-out').textContent = `${state.size}px`;
    update();
  });
  const showSpeed = () => ($('lg-speed-out').textContent = `${state.speed}s per loop`);
  speedIn.addEventListener('input', () => {
    state.speed = SPEEDS[Number(speedIn.value)];
    showSpeed();
    update(true);
  });
  labelIn.addEventListener('input', () => {
    state.label = labelIn.value.trim() || 'Loading';
    update(def().text);
  });
  radioGroup($('lg-format'), (v) => {
    state.format = v as Format;
    drawCode();
  });
  window.addEventListener('resize', () => drawStage());

  $('lg-prompt').addEventListener('click', () => {
    const d = def();
    const css = loaderCode(d, state, 'html');
    const text = `Add this pure-CSS loading indicator (“${d.name}”, color ${state.color.toUpperCase()}) to my app and use it for our loading states: page and data loading, and inside buttons while they submit (at about 1em, in the button's text color).

Make it one reusable component that fits how this project is built (React component, Tailwind class or plain CSS), and keep role="status" and the label so screen readers announce it. Keep the prefers-reduced-motion rule. Don't add a library for this.

HTML:
${css[0].code}

CSS:
${css[1].code}`;
    copyText(text, (ok) => {
      status.textContent = ok ? 'Copied. Paste it into Claude Code, Codex or Cursor.' : 'Your browser blocked copying.';
    });
  });

  showSpeed();
  setColor(state.color);
  pick(state.id);
  status.textContent = 'Pick a loader in the grid to customize it.';
}

// ---- Skeleton ----

function initSkeleton() {
  const style = document.createElement('style');
  document.head.appendChild(style);
  const s: Skeleton = { ...DEFAULT_SKELETON };
  let format: Format = 'html';
  let theme: 'light' | 'dark' = 'light';
  const status = $('sk-status');
  const preview = $('sk-preview');
  const stage = $('sk-stage');

  const img = $<HTMLInputElement>('sk-image');
  const title = $<HTMLInputElement>('sk-title');
  const button = $<HTMLInputElement>('sk-button');
  const avatar = $<HTMLSelectElement>('sk-avatar');
  const lines = $<HTMLInputElement>('sk-lines');
  const rows = $<HTMLInputElement>('sk-rows');
  const base = $<HTMLInputElement>('sk-base');
  const radius = $<HTMLInputElement>('sk-radius');

  // Presets
  const presets = $('sk-presets');
  for (const p of SKELETON_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.name;
    b.dataset.id = p.id;
    b.addEventListener('click', () => {
      Object.assign(s, p.s);
      syncInputs();
      draw(p.id);
    });
    presets.appendChild(b);
  }

  function syncInputs() {
    img.checked = s.image;
    title.checked = s.title;
    button.checked = s.button;
    avatar.value = s.avatar;
    lines.value = String(s.lines);
    rows.value = String(s.rows);
    base.value = s.base;
    radius.value = String(s.radius);
  }

  function draw(preset?: string) {
    for (const b of presets.children) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.id === preset));
    $('sk-lines-out').textContent = String(s.lines);
    $('sk-rows-out').textContent = String(s.rows);
    $('sk-radius-out').textContent = `${s.radius}px`;
    style.textContent = skeletonCss(s).replaceAll('.skeleton', '#sk-preview .skeleton').replaceAll('\n.sk', '\n#sk-preview .sk');
    preview.innerHTML = skeletonHtml(s);
    stage.dataset.theme = theme;
    renderCodes($('sk-code'), skeletonCode(s, format), status);
  }

  const onChange = () => {
    s.image = img.checked;
    s.title = title.checked;
    s.button = button.checked;
    s.avatar = avatar.value as Skeleton['avatar'];
    s.lines = Number(lines.value);
    s.rows = Number(rows.value);
    s.radius = Number(radius.value);
    draw();
  };
  for (const el of [img, title, button, avatar, lines, rows, radius]) el.addEventListener('input', onChange);
  base.addEventListener('input', () => {
    s.base = base.value;
    s.border = base.value;
    draw();
  });
  radioGroup($('sk-anim'), (v) => {
    s.anim = v as Skeleton['anim'];
    draw();
  });
  radioGroup($('sk-theme'), (v) => {
    theme = v as 'light' | 'dark';
    Object.assign(s, SKELETON_THEMES[theme]);
    base.value = s.base;
    draw();
  });
  radioGroup($('sk-format'), (v) => {
    format = v as Format;
    draw();
  });

  $('sk-prompt').addEventListener('click', () => {
    const code = skeletonCode(s, 'html');
    const text = `Add a skeleton loading state to my app using the card below as the pattern. Show it while data is loading instead of a blank area or a spinner, shaped like the real content it replaces (match the real layout: picture, avatar, title and text lines), then swap in the real content when it arrives.

Make it a reusable component that fits how this project is built (React component, Tailwind classes or plain CSS). Keep role="status" and aria-label="Loading", and keep the prefers-reduced-motion rule.

HTML:
${code[0].code}

CSS:
${code[1].code}`;
    copyText(text, (ok) => {
      status.textContent = ok ? 'Copied. Paste it into Claude Code, Codex or Cursor.' : 'Your browser blocked copying.';
    });
  });

  syncInputs();
  draw('blog');
}

function init() {
  initTabs();
  initLoaders();
  initSkeleton();
}

init();
