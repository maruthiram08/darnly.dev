// Markdown table generator: everything runs in the visitor's browser. Nothing is uploaded.
import {
  SAMPLE, blank, normalize, trim, toMarkdown, toHtml, toCsv, inline, parse, parseHtmlTable,
  type Align, type Table,
} from './markdown-table-generator-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const KEY = 'darnly:markdown-table';
const MAX_ROWS = 500;
const MAX_COLS = 30;

const gridHead = $<HTMLTableSectionElement>('mt-grid-head');
const gridBody = $<HTMLTableSectionElement>('mt-grid-body');
const size = $<HTMLElement>('mt-size');
const preview = $<HTMLDivElement>('mt-preview');
const out = $<HTMLPreElement>('mt-out');
const prettyBox = $<HTMLInputElement>('mt-pretty');
const prettyWrap = $<HTMLElement>('mt-pretty-wrap');
const copyBtn = $<HTMLButtonElement>('mt-copy');
const downloadBtn = $<HTMLButtonElement>('mt-download');
const status = $<HTMLParagraphElement>('mt-status');
const importBox = $<HTMLTextAreaElement>('mt-import');
const importFold = $<HTMLDetailsElement>('mt-import-fold');
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#mt-tabs [data-format]'));

type Format = 'markdown' | 'html' | 'csv';
let format: Format = 'markdown';
let t: Table = clone(SAMPLE);
let undoStack: Table[] = [];

function clone(x: Table): Table {
  return { rows: x.rows.map((r) => [...r]), align: [...x.align] };
}

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved && Array.isArray(saved.rows) && saved.rows.length && Array.isArray(saved.align)) {
    t = normalize({ rows: saved.rows.map((r: unknown[]) => r.map(String)), align: saved.align });
  }
} catch { /* no storage: start from the sample */ }
try { if (localStorage.getItem(KEY + ':pretty') === '0') prettyBox.checked = false; } catch { /* ignore */ }

// ---- Status line, with an Undo button after anything that throws work away ----

let statusTimer = 0;
function say(msg: string, undo = false) {
  status.textContent = msg;
  if (undo && undoStack.length) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'undo';
    b.textContent = 'Undo';
    b.addEventListener('click', () => {
      const prev = undoStack.pop();
      if (prev) { t = prev; build(); update(); say('Put it back.'); }
    });
    status.append(' ', b);
  }
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (status.textContent = ''), undo ? 8000 : 2500);
}

function remember() {
  undoStack.push(clone(t));
  if (undoStack.length > 30) undoStack.shift();
}

// ---- The grid ----

const ALIGNS: { a: Align; label: string; svg: string }[] = [
  { a: 'left', label: 'Align left', svg: '<path d="M2 3h12M2 7h8M2 11h12M2 15h8"/>' },
  { a: 'center', label: 'Align center', svg: '<path d="M2 3h12M4 7h8M2 11h12M4 15h8"/>' },
  { a: 'right', label: 'Align right', svg: '<path d="M2 3h12M6 7h8M2 11h12M6 15h8"/>' },
];
const icon = (paths: string) =>
  `<svg viewBox="0 0 16 18" width="14" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${paths}</svg>`;

function cellInput(r: number, c: number): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = t.rows[r][c];
  inp.dataset.r = String(r);
  inp.dataset.c = String(c);
  inp.spellcheck = false;
  inp.autocomplete = 'off';
  inp.setAttribute('aria-label', r === 0 ? `Header, column ${c + 1}` : `Row ${r}, column ${c + 1}`);
  inp.placeholder = r === 0 ? `Column ${c + 1}` : '';
  inp.style.textAlign = t.align[c] === 'none' ? 'left' : t.align[c];
  return inp;
}

function build() {
  t = normalize(t);
  const cols = t.rows[0].length;

  // Top row: alignment and delete for each column.
  gridHead.replaceChildren();
  const tr = document.createElement('tr');
  tr.append(document.createElement('th'));
  for (let c = 0; c < cols; c++) {
    const th = document.createElement('th');
    const box = document.createElement('div');
    box.className = 'colctl';
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', `Column ${c + 1} alignment`);
    for (const { a, label, svg } of ALIGNS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = label;
      b.setAttribute('aria-label', `${label}, column ${c + 1}`);
      b.setAttribute('aria-pressed', String(t.align[c] === a));
      b.dataset.align = a;
      b.dataset.c = String(c);
      b.innerHTML = icon(svg);
      seg.append(b);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'x';
    del.title = 'Delete this column';
    del.setAttribute('aria-label', `Delete column ${c + 1}`);
    del.dataset.delCol = String(c);
    del.textContent = '×';
    del.disabled = cols <= 1;
    box.append(seg, del);
    th.append(box);
    tr.append(th);
  }
  gridHead.append(tr);

  gridBody.replaceChildren();
  t.rows.forEach((row, r) => {
    const tr = document.createElement('tr');
    if (r === 0) tr.className = 'hdr';
    const lab = document.createElement('th');
    lab.scope = 'row';
    if (r === 0) {
      lab.innerHTML = '<span class="rlabel">Header</span>';
    } else {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'x';
      del.title = 'Delete this row';
      del.setAttribute('aria-label', `Delete row ${r}`);
      del.dataset.delRow = String(r);
      del.textContent = '×';
      const n = document.createElement('span');
      n.className = 'rnum';
      n.textContent = String(r);
      lab.append(n, del);
    }
    tr.append(lab);
    row.forEach((_, c) => {
      const td = document.createElement('td');
      td.append(cellInput(r, c));
      tr.append(td);
    });
    gridBody.append(tr);
  });
}

function focusCell(r: number, c: number, select = false) {
  const inp = gridBody.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`);
  if (!inp) return;
  inp.focus();
  if (select) inp.select();
}

function addRow(at = t.rows.length) {
  if (t.rows.length >= MAX_ROWS) return say(`That’s the limit of ${MAX_ROWS} rows.`);
  t.rows.splice(at, 0, Array.from({ length: t.rows[0].length }, () => ''));
}

function addCol(at = t.rows[0].length) {
  if (t.rows[0].length >= MAX_COLS) return say(`That’s the limit of ${MAX_COLS} columns.`);
  for (const r of t.rows) r.splice(at, 0, '');
  t.align.splice(at, 0, 'none');
}

gridHead.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  if (b.dataset.delCol) {
    const c = Number(b.dataset.delCol);
    if (t.rows[0].length <= 1) return;
    remember();
    for (const r of t.rows) r.splice(c, 1);
    t.align.splice(c, 1);
    build(); update();
    say('Column deleted.', true);
    return;
  }
  const c = Number(b.dataset.c);
  const a = b.dataset.align as Align;
  t.align[c] = t.align[c] === a ? 'none' : a;
  build(); update();
});

gridBody.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-del-row]');
  if (!b) return;
  remember();
  t.rows.splice(Number(b.dataset.delRow), 1);
  if (t.rows.length < 2) addRow();
  build(); update();
  say('Row deleted.', true);
});

gridBody.addEventListener('input', (e) => {
  const inp = e.target as HTMLInputElement;
  if (!inp.dataset.r) return;
  t.rows[Number(inp.dataset.r)][Number(inp.dataset.c)] = inp.value;
  update();
});

gridBody.addEventListener('keydown', (e) => {
  const inp = e.target as HTMLInputElement;
  if (!inp.dataset.r) return;
  const r = Number(inp.dataset.r);
  const c = Number(inp.dataset.c);
  const rows = t.rows.length;
  const cols = t.rows[0].length;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) return focusCell(Math.max(0, r - 1), c);
    if (r === rows - 1) { addRow(); build(); update(); }
    focusCell(r + 1, c);
  } else if (e.key === 'Tab') {
    const next = e.shiftKey ? r * cols + c - 1 : r * cols + c + 1;
    if (next < 0) return; // let focus leave the grid
    if (next >= rows * cols) {
      if (e.shiftKey) return;
      e.preventDefault();
      addRow(); build(); update();
      return focusCell(r + 1, 0);
    }
    e.preventDefault();
    focusCell(Math.floor(next / cols), next % cols);
  } else if (e.key === 'ArrowDown' && r < rows - 1) {
    e.preventDefault(); focusCell(r + 1, c);
  } else if (e.key === 'ArrowUp' && r > 0) {
    e.preventDefault(); focusCell(r - 1, c);
  } else if (e.key === 'ArrowRight' && inp.selectionStart === inp.value.length && inp.selectionEnd === inp.value.length && c < cols - 1) {
    e.preventDefault(); focusCell(r, c + 1);
  } else if (e.key === 'ArrowLeft' && inp.selectionStart === 0 && inp.selectionEnd === 0 && c > 0) {
    e.preventDefault(); focusCell(r, c - 1);
  }
});

// Paste from Excel, Google Sheets, Notion, a CSV file or a Markdown table.
gridBody.addEventListener('paste', (e) => {
  const inp = e.target as HTMLInputElement;
  if (!inp.dataset.r || !e.clipboardData) return;
  const text = e.clipboardData.getData('text/plain');
  const html = e.clipboardData.getData('text/html');
  const looksLikeTable = /[\t\n]/.test(text.trim()) || /<table/i.test(html);
  if (!looksLikeTable) return; // ordinary text: let the browser paste it into the cell
  const parsed = parse(text);
  let incoming: Table | null = parsed?.table ?? null;
  if (/<table/i.test(html) && (!parsed || parsed.kind !== 'markdown')) {
    const fromHtml = parseHtmlTable(new DOMParser().parseFromString(html, 'text/html'));
    if (fromHtml && (!incoming || fromHtml.rows.length >= incoming.rows.length)) incoming = fromHtml;
  }
  if (!incoming) return;
  e.preventDefault();
  remember();

  // A whole Markdown table replaces the table, alignment and all.
  if (parsed?.kind === 'markdown') {
    t = clone(incoming);
    build(); update();
    return say(`Loaded your Markdown table: ${count()}.`, true);
  }

  // Anything else fills in from the cell you pasted into, growing the grid as needed.
  const r0 = Number(inp.dataset.r);
  const c0 = Number(inp.dataset.c);
  const rowsIn = incoming.rows.slice(0, MAX_ROWS - r0);
  const colsIn = Math.min(incoming.rows[0].length, MAX_COLS - c0);
  while (t.rows.length < r0 + rowsIn.length) addRow();
  while (t.rows[0].length < c0 + colsIn) addCol();
  rowsIn.forEach((row, i) => {
    for (let j = 0; j < colsIn; j++) t.rows[r0 + i][c0 + j] = row[j] ?? '';
  });
  build(); update();
  focusCell(r0, c0);
  say(`Pasted ${rowsIn.length} row${rowsIn.length === 1 ? '' : 's'} × ${colsIn} column${colsIn === 1 ? '' : 's'}.`, true);
});

// ---- Toolbar ----

$('mt-add-row').addEventListener('click', () => { addRow(); build(); update(); focusCell(t.rows.length - 1, 0); });
$('mt-add-col').addEventListener('click', () => { addCol(); build(); update(); focusCell(0, t.rows[0].length - 1, true); });
$('mt-sample').addEventListener('click', () => { remember(); t = clone(SAMPLE); build(); update(); say('Loaded the sample table.', true); });
$('mt-clear').addEventListener('click', () => {
  remember();
  const cols = Math.min(Math.max(t.rows[0].length, 3), 6);
  t = blank(cols, 3);
  build(); update();
  focusCell(0, 0);
  say('Started a blank table.', true);
});
$('mt-transpose').addEventListener('click', () => {
  remember();
  const n = normalize(t);
  const rows = n.rows[0].map((_, c) => n.rows.map((r) => r[c]));
  if (rows.length > MAX_ROWS || rows[0].length > MAX_COLS) return say('Too big to swap.');
  t = { rows, align: rows[0].map(() => 'none' as Align) };
  build(); update();
  say('Swapped rows and columns.', true);
});

$('mt-load').addEventListener('click', () => {
  const p = parse(importBox.value);
  if (!p) return say('Paste a Markdown table, CSV, or cells copied from a spreadsheet first.');
  remember();
  t = clone(p.table);
  build(); update();
  importFold.open = false;
  importBox.value = '';
  const kind = { markdown: 'Markdown table', tsv: 'spreadsheet cells', csv: 'CSV', html: 'table' }[p.kind];
  say(`Loaded your ${kind}: ${count()}.`, true);
  $('mt-grid-wrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

// ---- Outputs ----

function count() {
  const x = trim(t);
  const rows = x.rows.length - 1;
  const cols = x.rows[0].length;
  return `${cols} column${cols === 1 ? '' : 's'} × ${rows} row${rows === 1 ? '' : 's'}`;
}

function output(): string {
  if (format === 'html') return toHtml(t);
  if (format === 'csv') return toCsv(t);
  return toMarkdown(t, { pretty: prettyBox.checked });
}

function update() {
  const x = trim(t);
  size.textContent = count();

  const tbl = document.createElement('table');
  const head = document.createElement('thead');
  const body = document.createElement('tbody');
  x.rows.forEach((row, r) => {
    const tr = document.createElement('tr');
    row.forEach((cell, c) => {
      const el = document.createElement(r === 0 ? 'th' : 'td');
      if (x.align[c] !== 'none') el.style.textAlign = x.align[c];
      el.innerHTML = inline(cell);
      tr.append(el);
    });
    (r === 0 ? head : body).append(tr);
  });
  tbl.append(head, body);
  preview.replaceChildren(tbl);
  for (const a of preview.querySelectorAll('a')) { a.target = '_blank'; a.rel = 'noopener nofollow'; }

  out.textContent = output();
  try { localStorage.setItem(KEY, JSON.stringify(x)); } catch { /* ignore */ }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    format = tab.dataset.format as Format;
    for (const x of tabs) x.setAttribute('aria-selected', String(x === tab));
    prettyWrap.hidden = format !== 'markdown';
    copyBtn.textContent = `Copy ${tab.textContent}`;
    downloadBtn.textContent = `Download .${format === 'markdown' ? 'md' : format}`;
    out.textContent = output();
  });
}

prettyBox.addEventListener('change', () => {
  try { localStorage.setItem(KEY + ':pretty', prettyBox.checked ? '1' : '0'); } catch { /* ignore */ }
  out.textContent = output();
});

copyBtn.addEventListener('click', async () => {
  const label = copyBtn.textContent;
  try {
    await navigator.clipboard.writeText(output());
    copyBtn.textContent = 'Copied';
  } catch {
    copyBtn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (copyBtn.textContent = label), 1500);
});

downloadBtn.addEventListener('click', () => {
  const ext = format === 'markdown' ? 'md' : format;
  const type = { markdown: 'text/markdown', html: 'text/html', csv: 'text/csv' }[format];
  const url = URL.createObjectURL(new Blob([output() + '\n'], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `table.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

build();
update();
