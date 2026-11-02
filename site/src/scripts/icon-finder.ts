// Icon finder: searches Lucide, Heroicons, Tabler and Phosphor in the browser.
// The icon lists are JSON files in public/icons/ (built by site/bin/build-icon-index.mjs), loaded only when needed.

type SetId = 'lucide' | 'heroicons' | 'tabler' | 'phosphor';
type Style = 'outline' | 'filled';
type Raw = { set: SetId; style: Style; version: string; viewBox: string; stroke: number; icons: [string, string, string][] };
type Icon = { set: SetId; style: Style; name: string; tags: string; body: string; viewBox: string; stroke: number };

const SETS: SetId[] = ['lucide', 'heroicons', 'tabler', 'phosphor'];
const INFO: Record<SetId, { label: string; license: string }> = {
  lucide: { label: 'Lucide', license: 'ISC' },
  heroicons: { label: 'Heroicons', license: 'MIT' },
  tabler: { label: 'Tabler', license: 'MIT' },
  phosphor: { label: 'Phosphor', license: 'MIT' },
};
const PAGE = 160;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const qIn = $<HTMLInputElement>('if-q');
const sizeIn = $<HTMLInputElement>('if-size');
const strokeIn = $<HTMLInputElement>('if-stroke');
const colorIn = $<HTMLInputElement>('if-color');
const sizeOut = $<HTMLOutputElement>('if-size-out');
const strokeOut = $<HTMLOutputElement>('if-stroke-out');
const grid = $<HTMLDivElement>('if-grid');
const count = $<HTMLParagraphElement>('if-count');
const moreBtn = $<HTMLButtonElement>('if-more');
const empty = $<HTMLParagraphElement>('if-empty');
const big = $<HTMLDivElement>('if-big');
const nameEl = $<HTMLElement>('if-name');
const setEl = $<HTMLElement>('if-set');
const licEl = $<HTMLElement>('if-lic');
const note = $<HTMLParagraphElement>('if-note');
const code = $<HTMLPreElement>('if-code');
const status = $<HTMLParagraphElement>('if-status');
const linkBtn = $<HTMLButtonElement>('if-link');
const setBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-set]')];
const styleBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-style]')];
const copyBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-copy]')];

// ---------- State (mirrored in the page address so a search can be shared) ----------

const params = new URLSearchParams(location.search);
const state = {
  q: params.get('q') ?? 'home',
  set: (['all', ...SETS].includes(params.get('set') || '') ? params.get('set') : 'all') as SetId | 'all',
  style: (params.get('style') === 'filled' ? 'filled' : 'outline') as Style,
  size: clampNum(Number(params.get('size')), 16, 64, 32),
  stroke: clampNum(Number(params.get('stroke')), 0.5, 3, 2),
  color: /^#[0-9a-f]{6}$/i.test(params.get('color') || '') ? (params.get('color') as string).toLowerCase() : '#0b2230',
  pick: params.get('icon') || '',
};
let results: Icon[] = [];
let shown = 0;
let selected: Icon | null = null;

function clampNum(v: number, lo: number, hi: number, d: number) {
  return Number.isFinite(v) && v > 0 ? Math.min(hi, Math.max(lo, v)) : d;
}

// ---------- Loading ----------

const cache = new Map<string, Promise<Icon[]>>();
function load(set: SetId, style: Style): Promise<Icon[]> {
  if (set === 'lucide' && style === 'filled') return Promise.resolve([]); // Lucide is outline only.
  const key = `${set}-${style}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`/icons/${key}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<Raw>;
      })
      .then((raw) => raw.icons.map(([name, tags, body]) => ({ set, style, name, tags, body, viewBox: raw.viewBox, stroke: raw.stroke })));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

// ---------- Search ----------

function score(icon: Icon, words: string[]): number {
  let total = 0;
  const parts = icon.name.split('-');
  for (const w of words) {
    let s = 0;
    if (icon.name === w) s = 100;
    else if (parts.includes(w)) s = 70;
    else if (icon.name.startsWith(w)) s = 55;
    else if (icon.name.includes(w)) s = 40;
    else {
      // Tags are listed most relevant first, so an early tag counts more.
      const i = icon.tags.split(' ').indexOf(w);
      if (i >= 0) s = Math.max(15, 35 - i * 2);
      else if (icon.tags.includes(w)) s = 10;
    }
    if (!s) return 0;
    total += s;
  }
  return total - icon.name.length * 0.3;
}

// Mixes the sets so the first screen shows all of them, not 100 Lucide icons in a row.
function interleave(lists: Icon[][]): Icon[] {
  const out: Icon[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

let runId = 0;
async function search() {
  const id = ++runId;
  const sets = state.set === 'all' ? SETS : [state.set];
  count.textContent = 'Loading icons…';
  let lists: Icon[][];
  try {
    lists = await Promise.all(sets.map((s) => load(s, state.style)));
  } catch {
    if (id === runId) count.textContent = 'We couldn’t load the icons. Check your connection and refresh the page.';
    return;
  }
  if (id !== runId) return;
  const words = state.q.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s]+/).filter(Boolean);
  if (words.length) {
    // Best matches first, with each set's lower matches pushed down a little so one big set doesn't fill the first screen.
    const scored = lists.flatMap((l, si) =>
      l
        .map((icon) => ({ icon, s: Math.round(score(icon, words)), si, r: 0 }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.icon.name.localeCompare(b.icon.name))
        .map((x, r) => ({ ...x, r })),
    );
    scored.sort((a, b) => b.s - b.r * 10 - (a.s - a.r * 10) || a.r - b.r || a.si - b.si);
    results = scored.map((x) => x.icon);
  } else {
    results = interleave(lists);
  }
  shown = 0;
  grid.textContent = '';
  renderMore();

  const lucideNote = state.style === 'filled' && (state.set === 'all' || state.set === 'lucide') ? ' Lucide has outline icons only.' : '';
  const what = words.length ? ` for “${state.q.trim()}”` : '';
  count.textContent = results.length
    ? `${results.length.toLocaleString()} icon${results.length === 1 ? '' : 's'}${what}.${lucideNote}`
    : `No icons${what}.${lucideNote}`;
  empty.hidden = results.length > 0;

  const wanted = results.find((i) => `${i.set}:${i.name}` === state.pick);
  if (wanted) select(wanted);
  else if (results[0]) select(results[0]);
}

function svgFor(icon: Icon, cls = '') {
  const paint = icon.stroke
    ? `fill="none" stroke="currentColor" stroke-width="${icon.stroke}" stroke-linecap="round" stroke-linejoin="round"`
    : 'fill="currentColor"';
  return `<svg ${cls ? `class="${cls}" ` : ''}xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}" ${paint} aria-hidden="true">${icon.body}</svg>`;
}

function renderMore() {
  const frag = document.createDocumentFragment();
  for (const icon of results.slice(shown, shown + PAGE)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = `${icon.name} (${INFO[icon.set].label})`;
    b.setAttribute('aria-label', `${icon.name}, ${INFO[icon.set].label}`);
    b.setAttribute('aria-pressed', String(icon === selected));
    // Icon bodies come from our own JSON files built from the icon packages, not from visitors.
    b.innerHTML = `${svgFor(icon, icon.stroke ? 'st' : '')}<span></span><i>${INFO[icon.set].label}</i>`;
    (b.querySelector('span') as HTMLSpanElement).textContent = icon.name;
    (b as HTMLButtonElement & { icon?: Icon }).icon = icon;
    frag.append(b);
  }
  shown = Math.min(results.length, shown + PAGE);
  grid.append(frag);
  moreBtn.hidden = shown >= results.length;
  moreBtn.textContent = `Show more icons (${(results.length - shown).toLocaleString()} left)`;
}

// ---------- Selected icon and the copy formats ----------

function select(icon: Icon) {
  selected = icon;
  state.pick = `${icon.set}:${icon.name}`;
  for (const b of grid.querySelectorAll<HTMLButtonElement>('button')) {
    b.setAttribute('aria-pressed', String((b as HTMLButtonElement & { icon?: Icon }).icon === icon));
  }
  nameEl.textContent = icon.name;
  setEl.textContent = `${INFO[icon.set].label} · ${icon.style === 'filled' ? 'filled' : 'outline'}`;
  licEl.textContent = `Free for commercial use (${INFO[icon.set].license} license)`;
  updatePick();
  saveUrl();
}

function updatePick() {
  if (!selected) return;
  big.innerHTML = svgFor(selected, selected.stroke ? 'st' : '');
  big.style.color = state.color;
  big.style.setProperty('--sw', String(state.stroke));
  note.hidden = !!selected.stroke;
  note.textContent = 'This icon is a solid shape, so line thickness doesn’t change it.';
  code.textContent = `${exportSvg(selected)}\n\n${exportJsx(selected)}\n\n${exportImport(selected)}`;
}

function exportSvg(icon: Icon) {
  const s = state.size;
  const paint = icon.stroke
    ? `fill="none" stroke="${state.color}" stroke-width="${state.stroke}" stroke-linecap="round" stroke-linejoin="round"`
    : `fill="${state.color}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="${icon.viewBox}" ${paint}>${icon.body}</svg>`;
}

function exportJsx(icon: Icon) {
  return exportSvg(icon)
    .replace(/ xmlns="[^"]*"/, '')
    .replace(/\s([a-z]+(?:-[a-z]+)+)=/g, (m, a: string) => (a.startsWith('data-') || a.startsWith('aria-') ? m : ' ' + a.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) + '='))
    .replace(/\sclass=/g, ' className=')
    .replace(/\s*\/?>\s*<\/(path|circle|rect|line|polyline|polygon|ellipse)>/g, ' />');
}

const pascal = (n: string) =>
  n
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');

function exportImport(icon: Icon) {
  const c = state.color;
  const s = state.size;
  const sw = state.stroke;
  const strokeProp = icon.stroke && sw !== icon.stroke;
  switch (icon.set) {
    case 'lucide': {
      const n = pascal(icon.name);
      return `// npm i lucide-react\nimport { ${n} } from 'lucide-react';\n\n<${n} size={${s}} color="${c}"${sw !== 2 ? ` strokeWidth={${sw}}` : ''} />`;
    }
    case 'heroicons': {
      const n = pascal(icon.name) + 'Icon';
      const path = icon.style === 'filled' ? '24/solid' : '24/outline';
      return `// npm i @heroicons/react\nimport { ${n} } from '@heroicons/react/${path}';\n\n<${n} width={${s}} height={${s}} color="${c}"${strokeProp ? ` strokeWidth={${sw}}` : ''} />`;
    }
    case 'tabler': {
      const n = 'Icon' + pascal(icon.name) + (icon.style === 'filled' ? 'Filled' : '');
      return `// npm i @tabler/icons-react\nimport { ${n} } from '@tabler/icons-react';\n\n<${n} size={${s}} color="${c}"${strokeProp ? ` stroke={${sw}}` : ''} />`;
    }
    case 'phosphor': {
      const n = pascal(icon.name) + 'Icon';
      return `// npm i @phosphor-icons/react\nimport { ${n} } from '@phosphor-icons/react';\n\n<${n} size={${s}} color="${c}"${icon.style === 'filled' ? ' weight="fill"' : ''} />`;
    }
  }
}

const dataUri = (icon: Icon) =>
  'data:image/svg+xml,' +
  exportSvg(icon)
    .replace(/"/g, "'")
    .replace(/[\r\n%#()<>?[\\\]^`{|}]/g, encodeURIComponent);

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    flash(`Copied ${label}.`);
  } catch {
    flash('Your browser blocked copying. Open “See the code” and copy it from there.');
  }
}

let flashTimer = 0;
function flash(msg: string) {
  status.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => (status.textContent = ''), 2500);
}

for (const b of copyBtns) {
  b.addEventListener('click', () => {
    if (!selected) return;
    const kind = b.dataset.copy;
    if (kind === 'svg') copyText(exportSvg(selected), 'the SVG');
    else if (kind === 'jsx') copyText(exportJsx(selected), 'the JSX');
    else if (kind === 'import') copyText(exportImport(selected), 'the React import');
    else if (kind === 'uri') copyText(dataUri(selected), 'the data URI');
    else if (kind === 'download') {
      const url = URL.createObjectURL(new Blob([exportSvg(selected)], { type: 'image/svg+xml' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selected.name}.svg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash(`Downloaded ${selected.name}.svg.`);
    }
  });
}

// ---------- Controls ----------

function applyLook() {
  grid.style.setProperty('--s', state.size + 'px');
  grid.style.setProperty('--sw', String(state.stroke));
  grid.style.setProperty('--c', state.color);
  sizeOut.textContent = `${state.size} px`;
  strokeOut.textContent = String(state.stroke);
  updatePick();
}

let saveTimer = 0;
function saveUrl() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.set !== 'all') p.set('set', state.set);
    if (state.style !== 'outline') p.set('style', state.style);
    if (state.size !== 32) p.set('size', String(state.size));
    if (state.stroke !== 2) p.set('stroke', String(state.stroke));
    if (state.color !== '#0b2230') p.set('color', state.color);
    if (state.pick) p.set('icon', state.pick);
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }, 250);
}

function press(btns: HTMLButtonElement[], attr: 'set' | 'style', value: string) {
  for (const b of btns) b.setAttribute('aria-pressed', String(b.dataset[attr] === value));
}

let typeTimer = 0;
qIn.addEventListener('input', () => {
  clearTimeout(typeTimer);
  typeTimer = window.setTimeout(() => {
    state.q = qIn.value;
    state.pick = '';
    search();
    saveUrl();
  }, 120);
});
for (const b of setBtns) {
  b.addEventListener('click', () => {
    state.set = b.dataset.set as SetId | 'all';
    press(setBtns, 'set', state.set);
    search();
    saveUrl();
  });
}
for (const b of styleBtns) {
  b.addEventListener('click', () => {
    state.style = b.dataset.style as Style;
    press(styleBtns, 'style', state.style);
    search();
    saveUrl();
  });
}
sizeIn.addEventListener('input', () => {
  state.size = Number(sizeIn.value);
  applyLook();
  saveUrl();
});
strokeIn.addEventListener('input', () => {
  state.stroke = Number(strokeIn.value);
  applyLook();
  saveUrl();
});
colorIn.addEventListener('input', () => {
  state.color = colorIn.value.toLowerCase();
  applyLook();
  saveUrl();
});
grid.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button') as (HTMLButtonElement & { icon?: Icon }) | null;
  if (!b?.icon) return;
  select(b.icon);
  if (window.matchMedia('(max-width: 760px)').matches) big.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
moreBtn.addEventListener('click', renderMore);
linkBtn.addEventListener('click', () => copyText(location.href, 'the link'));

// ---------- Start ----------

qIn.value = state.q;
sizeIn.value = String(state.size);
strokeIn.value = String(state.stroke);
colorIn.value = state.color;
press(setBtns, 'set', state.set);
press(styleBtns, 'style', state.style);
applyLook();
search();
