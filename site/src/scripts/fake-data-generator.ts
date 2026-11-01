// Fake data generator page: everything runs in the visitor's browser. Nothing is sent anywhere.
import {
  KINDS, TEMPLATES, generate, uniqueFields, names, toJSON, toCSV, toSQL, toTS,
  type Field, type Kind, type Row, type Value,
} from './fake-data-generator-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const tplInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="fd-tpl"]')];
const viewInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="fd-view"]')];
const countInput = $<HTMLInputElement>('fd-count');
const countBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-count]')];
const shuffle = $<HTMLButtonElement>('fd-shuffle');
const preview = $<HTMLDivElement>('fd-preview');
const caption = $<HTMLParagraphElement>('fd-caption');
const fieldsDetails = $<HTMLDetailsElement>('fd-fields');
const fieldsCount = $<HTMLSpanElement>('fd-fields-count');
const fieldList = $<HTMLUListElement>('fd-field-list');
const addField = $<HTMLButtonElement>('fd-add');
const tableInput = $<HTMLInputElement>('fd-table');
const createTable = $<HTMLInputElement>('fd-create');
const formatTabs = [...document.querySelectorAll<HTMLButtonElement>('#fd-formats [role="tab"]')];
const download = $<HTMLButtonElement>('fd-download');
const copy = $<HTMLButtonElement>('fd-copy');
const prompt = $<HTMLButtonElement>('fd-prompt');
const code = $<HTMLElement>('fd-code');
const codeNote = $<HTMLParagraphElement>('fd-code-note');
const sizeNote = $<HTMLSpanElement>('fd-size');

type Format = 'json' | 'csv' | 'sql' | 'ts';
const EXT: Record<Format, string> = { json: 'json', csv: 'csv', sql: 'sql', ts: 'ts' };
const MIME: Record<Format, string> = { json: 'application/json', csv: 'text/csv', sql: 'application/sql', ts: 'text/plain' };
const LABEL: Record<Format, string> = { json: 'JSON', csv: 'CSV', sql: 'SQL', ts: 'TypeScript' };

let fields: Field[] = TEMPLATES.users.fields.map((f) => ({ ...f }));
let seed = 20261101;
let count = 25;
let view: 'cards' | 'table' = 'cards';
let format: Format = 'json';
let rows: Row[] = [];
let clean: Field[] = fields;
let output = '';

const CARD_LIMIT = 12;
const TABLE_LIMIT = 100;
const CODE_LINES = 200;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function show(v: Value) {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return String(v);
  return v;
}

const DATE_FMT = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
function niceDate(v: string) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : DATE_FMT.format(d);
}

function money(v: Value) {
  return typeof v === 'number' ? `$${v.toFixed(2)}` : String(v);
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

const HUES = [199, 326, 160, 32, 262, 12, 220, 90];
function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

/** A picture with a coloured fallback underneath, so a slow or blocked image never leaves a hole. */
function picture(url: string, label: string, round: boolean) {
  const box = el('div', round ? 'pic round' : 'pic');
  box.style.setProperty('--h', String(hue(label)));
  box.append(el('span', 'pic-fallback', round ? initials(label) : label));
  if (/^https:\/\//.test(url)) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.src = url;
    img.addEventListener('error', () => img.remove());
    box.append(img);
  }
  return box;
}

const TITLE_KINDS: Kind[] = ['title', 'productName', 'fullName', 'company', 'username', 'firstName', 'lastName', 'email'];
const SUB_KINDS: Kind[] = ['email', 'jobTitle', 'category', 'fullName', 'company', 'tag', 'city'];
const HIDE_IN_CARD: Kind[] = ['uuid', 'id', 'avatar', 'image', 'slug'];

function renderCards() {
  const media = clean.find((f) => f.kind === 'avatar' || f.kind === 'image');
  const title = TITLE_KINDS.map((k) => clean.find((f) => f.kind === k)).find(Boolean)
    ?? clean.find((f) => !HIDE_IN_CARD.includes(f.kind));
  const sub = SUB_KINDS.map((k) => clean.find((f) => f.kind === k && f !== title)).find(Boolean);
  const price = clean.find((f) => f.kind === 'price');
  const status = clean.find((f) => f.kind === 'status');
  const used = new Set([media, title, sub, price, status].filter(Boolean));
  const rest = clean.filter((f) => !used.has(f) && !HIDE_IN_CARD.includes(f.kind)).slice(0, 4);
  const avatar = media?.kind === 'avatar';

  const grid = el('div', 'cards');
  for (const row of rows.slice(0, CARD_LIMIT)) {
    const card = el('article', avatar ? 'card person' : 'card');
    const titleText = title ? show(row[title.name]) : '';
    if (media && !avatar) {
      const label = String(row[clean.find((f) => f.kind === 'category')?.name ?? ''] ?? '') || String(titleText).split(' ').slice(-1)[0];
      card.append(picture(String(row[media.name]), label, false));
    }
    const body = el('div', 'card-body');
    const head = el('div', 'card-head');
    if (avatar && media) head.append(picture(String(row[media.name]), String(titleText), true));
    const nameBox = el('div', 'card-names');
    if (title) nameBox.append(el('h3', 'card-title', String(titleText)));
    if (sub) nameBox.append(el('p', 'card-sub', String(show(row[sub.name]))));
    head.append(nameBox);
    body.append(head);
    if (price || status) {
      const line = el('div', 'card-line');
      if (price) line.append(el('span', 'price', money(row[price.name])));
      if (status) {
        const s = String(row[status.name]);
        line.append(el('span', `pill st-${s}`, s));
      }
      body.append(line);
    }
    if (rest.length) {
      const dl = el('dl', 'card-facts');
      for (const f of rest) {
        const v = row[f.name];
        const wrap = el('div');
        wrap.append(el('dt', '', f.name));
        const dd = el('dd', typeof v === 'boolean' ? (v ? 'yes' : 'no') : '', f.kind === 'rating' ? `★ ${v}` : f.kind === 'date' || f.kind === 'datetime' ? niceDate(String(v)) : String(show(v)));
        wrap.append(dd);
        dl.append(wrap);
      }
      body.append(dl);
    }
    card.append(body);
    grid.append(card);
  }
  return grid;
}

function renderTable() {
  const wrap = el('div', 'table-wrap');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', 'Data preview table');
  const table = el('table', 'data');
  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', 'num', '#'));
  for (const f of clean) hr.append(el('th', '', f.name));
  thead.append(hr);
  const tbody = el('tbody');
  rows.slice(0, TABLE_LIMIT).forEach((row, i) => {
    const tr = el('tr');
    tr.append(el('td', 'num', String(i + 1)));
    for (const f of clean) {
      const v = row[f.name];
      const td = el('td');
      if (f.kind === 'avatar') {
        td.className = 'cell-pic';
        td.append(picture(String(v), String(row[clean.find((x) => x.kind === 'fullName')?.name ?? ''] ?? '?'), true));
      } else if (typeof v === 'boolean') {
        td.append(el('span', v ? 'bool yes' : 'bool no', v ? 'true' : 'false'));
      } else if (f.kind === 'status') {
        td.append(el('span', `pill st-${v}`, String(v)));
      } else if (f.kind === 'color') {
        const sw = el('span', 'swatch');
        sw.style.background = String(v);
        td.append(sw, document.createTextNode(String(v)));
      } else {
        td.textContent = f.kind === 'price' ? money(v) : String(v);
        if (typeof v === 'number') td.className = 'n';
        else if (String(v).length > 40) { td.className = 'long'; td.title = String(v); }
      }
      tr.append(td);
    }
    tbody.append(tr);
  });
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

function makeOutput() {
  const n = names(tableInput.value || 'items');
  switch (format) {
    case 'json': return toJSON(rows);
    case 'csv': return toCSV(clean, rows);
    case 'sql': return toSQL(clean, rows, n.table, createTable.checked);
    case 'ts': return toTS(clean, rows, n.type, n.varName);
  }
}

function bytes(s: string) {
  const b = new Blob([s]).size;
  return b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function renderOutput() {
  output = makeOutput();
  const lines = output.split('\n');
  code.textContent = lines.length > CODE_LINES ? lines.slice(0, CODE_LINES).join('\n') + '\n…' : output;
  codeNote.hidden = lines.length <= CODE_LINES;
  codeNote.textContent = `Showing the first ${CODE_LINES} of ${lines.length.toLocaleString()} lines. Copy or download to get everything.`;
  sizeNote.textContent = `${count.toLocaleString()} rows · ${bytes(output)}`;
  download.textContent = `Download ${LABEL[format]}`;
}

function render() {
  clean = uniqueFields(fields);
  rows = generate(clean, count, seed);
  preview.replaceChildren(clean.length ? (view === 'cards' ? renderCards() : renderTable()) : el('p', 'empty', 'Add a field to see your data.'));
  const shown = Math.min(count, view === 'cards' ? CARD_LIMIT : TABLE_LIMIT);
  caption.textContent = `Showing ${shown} of ${count.toLocaleString()} rows${shown < count ? '. Your download has all of them.' : '.'}`;
  fieldsCount.textContent = String(fields.length);
  renderOutput();
}

// Field editor -------------------------------------------------------------

function kindSelect(current: Kind) {
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Kind of data');
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const k of KINDS) {
    let g = groups.get(k.group);
    if (!g) {
      g = document.createElement('optgroup');
      g.label = k.group;
      groups.set(k.group, g);
      sel.append(g);
    }
    const o = new Option(k.label, k.kind, false, k.kind === current);
    g.append(o);
  }
  return sel;
}

function renderFields() {
  fieldList.replaceChildren(
    ...fields.map((f, i) => {
      const li = el('li', 'field');
      const name = document.createElement('input');
      name.type = 'text';
      name.value = f.name;
      name.maxLength = 40;
      name.spellcheck = false;
      name.autocomplete = 'off';
      name.setAttribute('aria-label', 'Field name');
      name.addEventListener('input', () => { fields[i].name = name.value; customised(); render(); });
      const sel = kindSelect(f.kind);
      sel.addEventListener('change', () => { fields[i].kind = sel.value as Kind; customised(); render(); });
      const del = el('button', 'remove', '×');
      del.type = 'button';
      del.setAttribute('aria-label', `Remove ${f.name || 'field'}`);
      del.addEventListener('click', () => { fields.splice(i, 1); customised(); renderFields(); render(); });
      li.append(name, sel, del);
      return li;
    }),
  );
}

function customised() {
  // Once fields are edited the template radio no longer describes the data.
  for (const t of tplInputs) t.checked = false;
}

const NEW_KINDS: Kind[] = ['city', 'phone', 'company', 'country', 'date', 'integer', 'url', 'color'];
addField.addEventListener('click', () => {
  const kind = NEW_KINDS.find((k) => !fields.some((f) => f.kind === k)) ?? 'sentence';
  fields.push({ name: kind.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), kind });
  customised();
  renderFields();
  render();
  fieldList.querySelector<HTMLInputElement>('li:last-child input')?.focus();
});

// Controls -----------------------------------------------------------------

function setTemplate(key: string) {
  const t = TEMPLATES[key];
  if (!t) return;
  fields = t.fields.map((f) => ({ ...f }));
  tableInput.value = t.table;
  renderFields();
  render();
}

for (const t of tplInputs) t.addEventListener('change', () => t.checked && setTemplate(t.value));
for (const v of viewInputs) v.addEventListener('change', () => { if (v.checked) { view = v.value as typeof view; render(); } });

function setCount(n: number) {
  count = Math.max(1, Math.min(1000, Math.round(n) || 10));
  countInput.value = String(count);
  for (const b of countBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.count) === count));
  render();
}
for (const b of countBtns) b.addEventListener('click', () => setCount(Number(b.dataset.count)));
countInput.addEventListener('change', () => setCount(Number(countInput.value)));

shuffle.addEventListener('click', () => {
  seed = (Math.random() * 2 ** 31) >>> 0;
  render();
});

tableInput.addEventListener('input', renderOutput);
createTable.addEventListener('change', renderOutput);

function selectFormat(f: Format, focus = false) {
  format = f;
  for (const t of formatTabs) {
    const on = t.dataset.format === f;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  }
  renderOutput();
}
formatTabs.forEach((t, i) => {
  t.addEventListener('click', () => selectFormat(t.dataset.format as Format));
  t.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    selectFormat(formatTabs[(i + d + formatTabs.length) % formatTabs.length].dataset.format as Format, true);
  });
});

function flash(btn: HTMLButtonElement, text: string) {
  const old = btn.dataset.label ?? btn.textContent ?? '';
  btn.dataset.label = old;
  btn.textContent = text;
  window.setTimeout(() => { btn.textContent = btn.dataset.label ?? old; delete btn.dataset.label; }, 1600);
}

async function copyText(text: string, btn: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(text);
    flash(btn, 'Copied');
  } catch {
    flash(btn, 'Copy failed');
  }
}

copy.addEventListener('click', () => copyText(output, copy));

download.addEventListener('click', () => {
  const n = names(tableInput.value || 'items');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([output], { type: `${MIME[format]};charset=utf-8` }));
  a.download = format === 'ts' ? `seed-${n.table.replace(/_/g, '-')}.ts` : `${n.table}.${EXT[format]}`;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});

const HOW: Record<Format, string> = {
  json: 'Save it as a JSON file in my project (for example `data/{table}.json`) and use it as mock data where my app shows {table}, until the real API is ready.',
  csv: 'If I use Supabase, tell me how to import it with Table Editor → Import data from CSV. Otherwise load it into my database or mock data the simplest way for my stack.',
  sql: 'If I use Supabase, add it as a seed (`supabase/seed.sql`) or tell me to paste it into the SQL editor. Change the column types if my existing `{table}` table differs.',
  ts: 'Save it as a seed file in my project and use it wherever my app shows {table}, so I can see the screens working with realistic data.',
};

prompt.addEventListener('click', () => {
  const n = names(tableInput.value || 'items');
  const fence = format === 'ts' ? 'ts' : format;
  const text = [
    `Here is fake seed data for my app: ${count} ${n.table} as ${LABEL[format]}, with these fields: ${clean.map((f) => f.name).join(', ')}.`,
    '',
    HOW[format].replace(/\{table\}/g, n.table),
    'If my app already has a type or table for this, match its field names and tell me what you changed.',
    '',
    '```' + fence,
    output.trimEnd(),
    '```',
  ].join('\n');
  copyText(text, prompt);
});

fieldsDetails.addEventListener('toggle', () => {
  if (fieldsDetails.open && !fieldList.children.length) renderFields();
});

renderFields();
render();
