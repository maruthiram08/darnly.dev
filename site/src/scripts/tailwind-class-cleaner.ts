// Tailwind class cleaner: everything runs in the visitor's browser, including Tailwind itself. Nothing is uploaded.
import { __unstable__loadDesignSystem as loadDesignSystem, compile } from 'tailwindcss';
import themeCss from 'tailwindcss/theme.css?raw';
import {
  GROUPS,
  clean,
  findClassLists,
  formatCall,
  looksLikeCode,
  splitByGroup,
  tokens,
  type DesignSystem,
  type Found,
  type Result,
} from './tailwind-class-cleaner-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('tc-in');
const verdict = $<HTMLParagraphElement>('tc-verdict');
const cardsEl = $<HTMLDivElement>('tc-cards');
const outEl = $<HTMLPreElement>('tc-out');
const copyBtn = $<HTMLButtonElement>('tc-copy');
const legend = $<HTMLUListElement>('tc-legend');
const fights = $<HTMLDivElement>('tc-fights');
const conflictList = $<HTMLUListElement>('tc-conflicts');
const notes = $<HTMLDivElement>('tc-notes');
const noteList = $<HTMLUListElement>('tc-note-list');
const preview = $<HTMLDivElement>('tc-preview');
const pnote = $<HTMLParagraphElement>('tc-pnote');
const dedupeIn = $<HTMLInputElement>('tc-dedupe');
const losersIn = $<HTMLInputElement>('tc-losers');
const renameIn = $<HTMLInputElement>('tc-rename');
const fnIn = $<HTMLSelectElement>('tc-fn');
const table = $<HTMLTableSectionElement>('tc-table');
const themeIn = $<HTMLTextAreaElement>('tc-theme');
const themeApply = $<HTMLButtonElement>('tc-theme-apply');
const themeStatus = $<HTMLSpanElement>('tc-theme-status');
const status = $<HTMLParagraphElement>('tc-status');

const EXAMPLE_CLASSES =
  'flex items-center p-4 text-white bg-sky-600 hover:bg-sky-700 rounded-lg px-6 py-2 text-sm font-semibold shadow-md transition-colors p-2 text-lg flex-column text-white justify-between gap-2 w-full md:w-auto focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-50';

const EXAMPLE_CODE = `export function PricingCard({ popular }) {
  return (
    <div className="p-6 rounded-2xl border bg-white shadow-sm flex flex-col gap-4 p-8 border-gray-200 hover:shadow-lg transition-shadow">
      <h3 className="font-bold text-2xl text-gray-900 text-xl tracking-tight">Pro</h3>
      <p className="text-gray-500 mt-1 text-sm mt-2">For growing teams</p>
      <button className={cn("w-full py-3 rounded-lg font-semibold text-white bg-indigo-600 py-2", popular && "bg-indigo-700 ring-2 ring-indigo-300")}>
        Start free trial
      </button>
    </div>
  );
}`;

let ds: DesignSystem | null = null;
let names: string[] = [];
let buildCss: ((c: string[]) => string) | null = null;
let userTheme = '';
let view: 'before' | 'after' = 'after';
let split = false;
let selected = 0;
const picks = new Map<string, string>(); // "<list>|<conflict key>" → class to keep

type List = { found?: Found; res: Result; text: string };
let lists: List[] = [];
let codeMode = false;
let outText = '';

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

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const groupLabel = new Map(GROUPS.map((g) => [g.id, g.label]));

// ---- Loading Tailwind (the real one, so the order matches Prettier's) ----
async function loadTailwind() {
  const css = `@import "tailwindcss/theme.css";\n${userTheme}`;
  const loadStylesheet = async (id: string, base: string) => {
    if (id.includes('theme')) return { base, content: themeCss, path: id };
    if (id.includes('utilities')) return { base, content: '@tailwind utilities;', path: id };
    throw new Error(`Can’t load ${id}`);
  };
  const next = (await loadDesignSystem(css, { base: '/', loadStylesheet })) as unknown as DesignSystem & {
    getClassList(): [string, unknown][];
  };
  const compiler = await compile(`@import "tailwindcss/theme.css";\n@import "tailwindcss/utilities.css";\n${userTheme}`, {
    base: '/',
    loadStylesheet,
  });
  ds = next;
  buildCss = (c) => compiler.build(c);
  names = [];
  // Tailwind's full class list is only needed for "did you mean" hints, so it's read after the first paint.
  setTimeout(() => {
    try {
      names = next.getClassList().map((x) => x[0]);
      if (lists.some((l) => l.res.unknown.length)) run();
    } catch {
      /* hints are optional */
    }
  }, 50);
}

// ---- Cleaning ----
function cleanText(text: string, idx: number): Result {
  const local = new Map<string, string>();
  for (const [k, v] of picks) if (k.startsWith(`${idx}|`)) local.set(k.slice(String(idx).length + 1), v);
  return clean(tokens(text), ds!, {
    dedupe: dedupeIn.checked,
    dropLosers: losersIn.checked,
    rename: renameIn.checked,
    picks: local,
    names: names.length ? names : undefined,
  });
}

function indentAt(src: string, at: number) {
  const ls = src.lastIndexOf('\n', at - 1) + 1;
  return /^[ \t]*/.exec(src.slice(ls))![0];
}

function run() {
  if (!ds) return;
  const src = input.value;
  codeMode = looksLikeCode(src);
  lists = [];
  if (codeMode) {
    const found = findClassLists(src);
    found.forEach((f, i) => lists.push({ found: f, res: cleanText(f.text, i), text: f.text }));
    // Rebuild the code from the end so earlier positions stay right.
    let out = src;
    for (let i = found.length - 1; i >= 0; i--) {
      const f = found[i];
      const res = lists[i].res;
      const joined = res.output.join(' ');
      if (split && f.kind === 'attr' && f.jsx && res.output.length > 6 && f.attrStart !== undefined) {
        const parts = splitByGroup(res.output, res.infos);
        const call = formatCall(fnIn.value, parts, '"', indentAt(src, f.attrStart));
        out = out.slice(0, f.attrStart) + `${f.attrName}={${call}}` + out.slice(f.attrEnd);
      } else {
        out = out.slice(0, f.start) + joined + out.slice(f.end);
      }
    }
    outText = out;
  } else {
    const text = src.trim().replace(/^["'`]|["'`]$/g, '');
    const res = cleanText(text, 0);
    lists.push({ res, text });
    outText = split && res.output.length > 1 ? formatCall(fnIn.value, splitByGroup(res.output, res.infos)) : res.output.join(' ');
  }
  if (selected >= lists.length) selected = 0;
  render();
  saveUrl();
}

// ---- Drawing ----
function chip(cls: string, res: Result, mode: 'before' | 'after', seen?: Set<string>) {
  const info = res.infos.get(cls);
  const group = info?.group || 'custom';
  const k = info?.key ? res.conflicts.find((c) => c.key === info.key) : undefined;
  let extra = '';
  let badge = '';
  let title = groupLabel.get(group) || '';
  if (mode === 'before') {
    if (seen!.has(cls)) {
      extra = 'dupe';
      badge = 'twice';
      title = 'Duplicate';
    } else if (k && !keeps(res, k).includes(cls)) {
      extra = 'loser';
      title = `Does nothing: ${keeps(res, k)[0]} wins`;
    } else if (k) extra = 'fight';
    seen!.add(cls);
  } else if (k) {
    extra = 'fight';
    title = 'Kept from a fight';
  }
  if (group === 'custom' && !extra) title = 'Not a Tailwind class';
  return `<span class="chip g-${group} ${extra}" title="${esc(title)}">${esc(cls)}${badge ? `<span class="badge">${badge}</span>` : ''}</span>`;
}

function keeps(res: Result, k: Result['conflicts'][number]): string[] {
  const idx = lists.findIndex((l) => l.res === res);
  const pick = picks.get(`${idx}|${k.key}`);
  return [pick && k.classes.includes(pick) ? pick : k.winner];
}

// Did the visitor keep a class that doesn't win today? Then the look changes, on purpose.
function swapped() {
  return lists.some((l) => l.res.conflicts.some((k) => keeps(l.res, k)[0] !== k.winner));
}

function render() {
  // Cards: before and after, one per class list found.
  if (!lists.length || lists.every((l) => !l.res.input.length)) {
    cardsEl.innerHTML = `<p class="empty">${codeMode ? 'We couldn’t find any className="…", class="…" or cn(…) in this code.' : 'Paste some classes below to start.'}</p>`;
  } else {
    cardsEl.innerHTML = lists
      .map((l, i) => {
        const seen = new Set<string>();
        const before = l.res.input.map((c) => chip(c, l.res, 'before', seen)).join('');
        const after = l.res.output.map((c) => chip(c, l.res, 'after')).join('');
        const label = codeMode ? `<span class="clabel">${i + 1}. ${esc(l.found!.label)}</span>` : '';
        return `<div class="card${codeMode && lists.length > 1 ? ' pick' : ''}${codeMode && i === selected && lists.length > 1 ? ' sel' : ''}" data-i="${i}">${label}
          <div class="line"><span class="tag">Before</span><div class="chips">${before}</div></div>
          <div class="line"><span class="tag">After</span><div class="chips">${after || '<span class="empty">(empty)</span>'}</div></div></div>`;
      })
      .join('');
  }
  outEl.textContent = outText;
  copyBtn.textContent = codeMode ? 'Copy cleaned code' : 'Copy cleaned classes';

  // The verdict, on the preview.
  const total = lists.reduce((n, l) => n + l.res.input.length, 0);
  const after = lists.reduce((n, l) => n + l.res.output.length, 0);
  const dupes = lists.reduce((n, l) => n + l.res.dupes.length, 0);
  const nFights = lists.reduce((n, l) => n + l.res.conflicts.length, 0);
  const unknown = lists.reduce((n, l) => n + l.res.unknown.length, 0);
  const problems: string[] = [];
  if (nFights) problems.push(plural(nFights, 'fight'));
  if (dupes) problems.push(plural(dupes, 'duplicate'));
  if (unknown) problems.push(`${plural(unknown, 'class', 'classes')} Tailwind doesn’t know`);
  const where = codeMode ? ` in ${plural(lists.length, 'class list')}` : '';
  if (!total) verdict.innerHTML = 'Paste Tailwind classes or a component to clean them.';
  else if (!problems.length)
    verdict.innerHTML = `<span class="ok">All clean.</span> No duplicates or fights${where}. <small>Sorted the way the Prettier plugin sorts them.</small>`;
  else
    verdict.innerHTML = `<span class="${nFights ? 'bad' : ''}">Found ${problems.join(', ').replace(/, ([^,]*)$/, ' and $1')}${where}.</span>
      <small>${total} classes → ${after}, sorted the way the Prettier plugin sorts them.${nFights && losersIn.checked && !swapped() ? ' Your page looks the same: the classes we removed did nothing.' : ''}</small>`;

  renderFights();
  renderNotes();
  renderPreview();
  renderTable();
}

const WORDS: Record<string, string> = {
  padding: 'padding',
  'padding-inline': 'left and right padding',
  'padding-block': 'top and bottom padding',
  'padding-top': 'top padding',
  'padding-bottom': 'bottom padding',
  'padding-left': 'left padding',
  'padding-right': 'right padding',
  margin: 'margin',
  'margin-top': 'top margin',
  'margin-bottom': 'bottom margin',
  'margin-inline': 'left and right margin',
  'margin-block': 'top and bottom margin',
  'font-size,line-height': 'the text size',
  'font-size': 'the text size',
  '--tw-font-weight,font-weight': 'how bold the text is',
  color: 'the text color',
  'background-color': 'the background color',
  display: 'how it’s displayed',
  width: 'the width',
  height: 'the height',
  'border-radius': 'the corner rounding',
  '--tw-shadow,box-shadow': 'the shadow',
  gap: 'the gap',
  'justify-content': 'how items are spread out',
  'align-items': 'how items line up',
  'flex-direction': 'the direction',
  position: 'the position',
  'text-align': 'the text alignment',
  '--tw-leading,line-height': 'the line height',
  '--tw-tracking,letter-spacing': 'the letter spacing',
  opacity: 'the opacity',
  'z-index': 'the stacking order',
  'max-width': 'the max width',
  'border-color': 'the border color',
};

function renderFights() {
  const items: string[] = [];
  lists.forEach((l, i) => {
    for (const k of l.res.conflicts) {
      const keep = keeps(l.res, k)[0];
      const what = WORDS[k.props.join(',')] || k.props.filter((p) => !p.startsWith('--')).map((p) => `<code>${esc(p)}</code>`).join(' and ') || 'the same thing';
      const others = k.classes.filter((c) => c !== k.winner);
      const variant = k.variants ? ` for <code>${esc(k.variants)}:</code>` : '';
      const verb = k.classes.length === 2 ? 'both set' : 'all set';
      const why = `${k.classes.map((c) => `<code>${esc(c)}</code>`).join(' and ')} ${verb} ${what}${variant}. Only <code>${esc(k.winner)}</code> works, so ${others.map((c) => `<code>${esc(c)}</code>`).join(' and ')} ${others.length > 1 ? 'do' : 'does'} nothing.`;
      const btns = k.classes
        .map((c) => `<button type="button" data-list="${i}" data-key="${esc(k.key)}" data-keep="${esc(c)}" aria-pressed="${c === keep}">Keep ${esc(c)}</button>`)
        .join('');
      const where = codeMode ? `<span class="where">${i + 1}. ${esc(l.found!.label)}</span>` : '';
      items.push(`<li>${where}<p class="why">${why}</p><div class="picks">${losersIn.checked ? btns : ''}</div></li>`);
    }
  });
  fights.hidden = !items.length;
  conflictList.innerHTML = items.join('');
}

function renderNotes() {
  const items: string[] = [];
  const plainCustom = new Set<string>();
  lists.forEach((l) => {
    for (const u of l.res.unknown) {
      const fix = /^Did you mean (\S+)\?$/.exec(u.hint)?.[1];
      if (fix) items.push(`<li><code>${esc(u.cls)}</code> isn’t a Tailwind class. Did you mean <code>${esc(fix)}</code>? <button type="button" data-from="${esc(u.cls)}" data-to="${esc(fix)}">Use ${esc(fix)}</button></li>`);
      else if (u.hint) items.push(`<li><code>${esc(u.cls)}</code>: ${esc(u.hint)}</li>`);
      else plainCustom.add(u.cls);
    }
    if (!renameIn.checked) for (const r of l.res.renames) items.push(`<li><code>${esc(r.from)}</code> has a shorter v4 name: <code>${esc(r.to)}</code>. <button type="button" data-from="${esc(r.from)}" data-to="${esc(r.to)}">Use it</button></li>`);
  });
  if (plainCustom.size) {
    const list = [...plainCustom].map((c) => `<code>${esc(c)}</code>`).join(', ');
    items.push(`<li>${list} ${plainCustom.size === 1 ? 'isn’t a Tailwind class' : 'aren’t Tailwind classes'}. That’s fine if ${plainCustom.size === 1 ? 'it’s' : 'they’re'} your own CSS. We keep ${plainCustom.size === 1 ? 'it' : 'them'} first, like Prettier does. Your own theme colors? Add your theme below.</li>`);
  }
  notes.hidden = !items.length;
  noteList.innerHTML = [...new Set(items)].join('');
}

// "How it looks": the selected class list drawn with Tailwind's real CSS, inside a shadow root so it can't touch this page.
const shadow = preview.attachShadow({ mode: 'open' });
function renderPreview() {
  const l = lists[selected];
  if (!l || !buildCss) {
    shadow.innerHTML = '';
    return;
  }
  const classes = view === 'before' ? l.res.input : l.res.output;
  let css = '';
  try {
    css = buildCss([...new Set(classes)]);
  } catch {
    css = '';
  }
  const label = l.found?.label || '';
  const tag = /^<(button|a|span|p|h[1-6]|li|label)>$/.exec(label)?.[1] || 'div';
  const has = (re: RegExp) => classes.some((c) => re.test(c.split(':').pop()!));
  let inner = 'Your element';
  if (has(/^grid$/)) inner = '<span>1</span><span>2</span><span>3</span>';
  else if (has(/^(inline-)?flex$/)) inner = '<span>★</span><span>Your element</span>';
  shadow.innerHTML = `<style>
    :host { all: initial; display: block; width: 100%; font-family: ui-sans-serif, system-ui, sans-serif; color: #0B2230; font-size: 16px; line-height: 1.5; }
    *, ::before, ::after { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid; }
    button { font: inherit; color: inherit; background: none; cursor: pointer; }
    a { color: inherit; text-decoration: inherit; }
    .frame { display: flex; justify-content: center; align-items: center; width: 100%; min-height: 118px; }
  </style><style>${css.replace(/<\/style/gi, '')}</style><div class="frame"><${tag} class="${esc(classes.join(' '))}">${inner}</${tag}></div>`;
  const nFights = l.res.conflicts.length;
  pnote.textContent =
    view === 'before'
      ? 'Your classes as pasted. Hover it to see hover styles.'
      : nFights && losersIn.checked && !swapped()
        ? 'After cleaning. It looks the same, because the removed classes did nothing.'
        : 'After cleaning. Hover it to see hover styles.';
  if (codeMode && lists.length > 1) pnote.textContent += ` Showing list ${selected + 1}. Click another card to switch.`;
}

function renderTable() {
  const l = lists[selected];
  if (!l) {
    table.innerHTML = '';
    return;
  }
  table.innerHTML = l.res.output
    .map((c, i) => {
      const info = l.res.infos.get(c)!;
      const props = info.props.filter((p) => !p.startsWith('--tw-')).join(', ') || info.props.join(', ') || '(none)';
      return `<tr><td>${i + 1}</td><td>${esc(c)}</td><td>${esc(groupLabel.get(info.group) || '')}</td><td>${esc(props)}</td></tr>`;
    })
    .join('');
}

legend.innerHTML = GROUPS.map((g) => `<li><i class="lg-${g.id}"></i>${g.label}</li>`).join('') +
  '<li><i class="lg-loser"></i>Does nothing</li>';
const LEGEND: Record<string, string> = {
  layout: '#7DD3FC', size: '#C4B5FD', spacing: '#86EFAC', type: '#FCD34D', color: '#F9A8D4',
  border: '#A5B4FC', effects: '#5EEAD4', other: '#CBD5E1', custom: '#fff', loser: '#F4A3B8',
};
legend.querySelectorAll<HTMLElement>('i').forEach((i) => {
  const k = i.className.slice(3);
  i.style.background = LEGEND[k];
  if (k === 'custom') i.style.border = '1px dashed #94A3B8';
});

// ---- Share link ----
function saveUrl() {
  const url = new URL(location.href);
  if (input.value.length <= 1500 && input.value.trim()) url.searchParams.set('c', input.value);
  else url.searchParams.delete('c');
  history.replaceState(null, '', url);
}

// ---- Events ----
let timer = 0;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    picks.clear();
    run();
  }, 120);
});
[dedupeIn, losersIn, renameIn].forEach((el) => el.addEventListener('change', run));
fnIn.addEventListener('change', () => {
  if (!split) setSplit(true);
  else run();
});

function setSplit(on: boolean) {
  split = on;
  document.querySelectorAll<HTMLButtonElement>('[data-split]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.split === 'on') === on)));
  run();
}
document.querySelectorAll<HTMLButtonElement>('[data-split]').forEach((b) => b.addEventListener('click', () => setSplit(b.dataset.split === 'on')));

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    view = b.dataset.view as 'before' | 'after';
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderPreview();
  }),
);

conflictList.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-keep]');
  if (!b) return;
  picks.set(`${b.dataset.list}|${b.dataset.key}`, b.dataset.keep!);
  run();
  say(`Keeping ${b.dataset.keep}`);
});

noteList.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-from]');
  if (!b) return;
  const from = b.dataset.from!;
  const to = b.dataset.to!;
  const re = new RegExp(`(^|[\\s"'\`])${from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?=$|[\\s"'\`])`, 'g');
  input.value = input.value.replace(re, `$1${to}`);
  run();
  say(`Changed ${from} to ${to}`);
});

cardsEl.addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('.card.pick');
  if (!card) return;
  selected = Number(card.dataset.i);
  render();
});

copyBtn.addEventListener('click', () => copy(outText, codeMode ? 'Cleaned code copied' : 'Cleaned classes copied'));
$('tc-link').addEventListener('click', () => copy(location.href, 'Link copied'));

$('tc-prompt').addEventListener('click', () => {
  const lines: string[] = ['Please tidy up the Tailwind classes in my code.'];
  const fightsText = lists.flatMap((l) => l.res.conflicts.map((k) => `${k.classes.join(' vs ')} (only ${k.winner} works)`));
  if (fightsText.length) lines.push(`\nThese classes fight each other, so one of each does nothing. Keep the one I meant (ask me if it isn't clear) and delete the other:\n${fightsText.map((t) => `- ${t}`).join('\n')}`);
  const unk = lists.flatMap((l) => l.res.unknown.map((u) => `${u.cls}${u.hint ? `: ${u.hint}` : ''}`));
  if (unk.length) lines.push(`\nThese aren't Tailwind classes. Fix the typos, and leave my own CSS classes alone:\n${unk.map((t) => `- ${t}`).join('\n')}`);
  lines.push('\nRemove duplicate classes. Then install prettier-plugin-tailwindcss and add it to .prettierrc so classes stay sorted from now on.');
  lines.push(`\nHere is the cleaned version for reference:\n\n${outText}`);
  copy(lines.join('\n'), 'Prompt copied. Paste it into Claude Code, Cursor or Codex.');
});

function setInput(v: string) {
  input.value = v;
  picks.clear();
  selected = 0;
  run();
}
$('tc-ex-classes').addEventListener('click', () => setInput(EXAMPLE_CLASSES));
$('tc-ex-code').addEventListener('click', () => setInput(EXAMPLE_CODE));
$('tc-clear').addEventListener('click', () => {
  setInput('');
  input.focus();
});

themeApply.addEventListener('click', async () => {
  const prev = userTheme;
  userTheme = themeIn.value.trim();
  if (userTheme && !/@theme/.test(userTheme)) userTheme = `@theme {\n${userTheme}\n}`;
  themeStatus.textContent = 'Loading…';
  try {
    await loadTailwind();
    themeStatus.textContent = userTheme ? 'Using your theme.' : 'Using the default theme.';
    run();
  } catch (err) {
    userTheme = prev;
    await loadTailwind().catch(() => {});
    themeStatus.textContent = `We couldn’t read that: ${(err as Error).message}`;
  }
});

// ---- Start ----
const params = new URLSearchParams(location.search);
input.value = params.get('c') || EXAMPLE_CLASSES;
loadTailwind()
  .then(run)
  .catch((err) => {
    verdict.textContent = `Tailwind didn’t load in this browser (${(err as Error).message}). Try reloading the page.`;
  });
