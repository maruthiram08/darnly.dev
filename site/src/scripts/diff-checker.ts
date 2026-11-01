// Diff checker: everything runs in the visitor's browser. Nothing is uploaded.
import { diffTexts, formatJson, toPatch, type Result, type Row, type Seg } from './diff-checker-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const left = $<HTMLTextAreaElement>('dc-left');
const right = $<HTMLTextAreaElement>('dc-right');
const view = $<HTMLDivElement>('dc-view');
const verdict = $<HTMLElement>('dc-verdict');
const plus = $<HTMLElement>('dc-plus');
const minus = $<HTMLElement>('dc-minus');
const modeSplit = $<HTMLButtonElement>('dc-mode-split');
const modeUnified = $<HTMLButtonElement>('dc-mode-unified');
const ignoreWs = $<HTMLInputElement>('dc-ws');
const ignoreCase = $<HTMLInputElement>('dc-case');
const json = $<HTMLInputElement>('dc-json');
const jsonNote = $<HTMLParagraphElement>('dc-json-note');
const swapBtn = $<HTMLButtonElement>('dc-swap');
const clearBtn = $<HTMLButtonElement>('dc-clear');
const patchBtn = $<HTMLButtonElement>('dc-copy-patch');
const promptBtn = $<HTMLButtonElement>('dc-prompt');
const patchOut = $<HTMLPreElement>('dc-patch');
const status = $<HTMLParagraphElement>('dc-status');

const CONTEXT = 3; // unchanged lines kept around each change
let split = !window.matchMedia('(max-width: 640px)').matches;
let result: Result | null = null;
let opened = new Set<number>(); // folded runs the visitor expanded, by first row
let timer = 0;

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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function segs(cell: HTMLElement, parts: Seg[], mark: 'del' | 'ins') {
  for (const p of parts) {
    if (p.changed) cell.append(el('mark', mark, p.text));
    else cell.append(document.createTextNode(p.text));
  }
}

// Text for both sides, JSON formatted first when asked.
function sources(): [string, string] {
  const a = left.value;
  const b = right.value;
  jsonNote.hidden = true;
  if (!json.checked) return [a, b];
  const bad: string[] = [];
  let fa = a;
  let fb = b;
  try {
    if (a.trim()) fa = formatJson(a);
  } catch {
    bad.push('Before');
  }
  try {
    if (b.trim()) fb = formatJson(b);
  } catch {
    bad.push('After');
  }
  if (bad.length) {
    jsonNote.textContent = `${bad.join(' and ')} ${bad.length > 1 ? 'are' : 'is'} not valid JSON, so ${bad.length > 1 ? 'they are' : 'it is'} compared as plain text.`;
    jsonNote.hidden = false;
  }
  return [fa, fb];
}

function run() {
  const [a, b] = sources();
  result = diffTexts(a, b, { ignoreWs: ignoreWs.checked, ignoreCase: ignoreCase.checked });
  opened = new Set();
  render();
}

function schedule() {
  clearTimeout(timer);
  timer = window.setTimeout(run, 120);
}

// Which rows to show: changes plus a little context; long unchanged runs fold into one row.
type Item = { row: Row } | { fold: number; count: number };

function items(rows: Row[]): Item[] {
  const out: Item[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== 'eq') {
      out.push({ row: rows[i++] });
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].kind === 'eq') j++;
    const head = i === 0 ? 0 : CONTEXT;
    const tail = j === rows.length ? 0 : CONTEXT;
    if (j - i > head + tail + 1 && !opened.has(i)) {
      for (let k = i; k < i + head; k++) out.push({ row: rows[k] });
      out.push({ fold: i, count: j - i - head - tail });
      for (let k = j - tail; k < j; k++) out.push({ row: rows[k] });
    } else for (let k = i; k < j; k++) out.push({ row: rows[k] });
    i = j;
  }
  return out;
}

function foldRow(item: { fold: number; count: number }, cols: number) {
  const tr = el('tr', 'fold-row');
  const td = el('td');
  td.colSpan = cols;
  const btn = el('button', 'unfold', `⋯ Show ${item.count} unchanged line${item.count === 1 ? '' : 's'}`);
  btn.type = 'button';
  btn.addEventListener('click', () => {
    opened.add(item.fold);
    render();
  });
  td.append(btn);
  tr.append(td);
  return tr;
}

function renderSplit(r: Result, body: HTMLTableSectionElement) {
  const num = (n: number) => el('td', 'num', n >= 0 ? String(n + 1) : '');
  for (const it of items(r.rows)) {
    if ('fold' in it) {
      body.append(foldRow(it, 4));
      continue;
    }
    const row = it.row;
    const tr = el('tr');
    if (row.kind === 'eq') {
      tr.append(num(row.a), el('td', 'code', r.a[row.a]), num(row.b), el('td', 'code', r.b[row.b]));
    } else if (row.kind === 'mod') {
      const l = el('td', 'code del');
      const rr = el('td', 'code ins');
      segs(l, row.left, 'del');
      segs(rr, row.right, 'ins');
      tr.append(num(row.a), l, num(row.b), rr);
    } else if (row.kind === 'del') {
      tr.append(num(row.a), el('td', 'code del', r.a[row.a]), num(-1), el('td', 'code empty'));
    } else {
      tr.append(num(-1), el('td', 'code empty'), num(row.b), el('td', 'code ins', r.b[row.b]));
    }
    body.append(tr);
  }
}

function renderUnified(r: Result, body: HTMLTableSectionElement) {
  const line = (an: number, bn: number, sign: string, cls: string, fill: (td: HTMLElement) => void) => {
    const tr = el('tr', cls);
    const td = el('td', `code ${cls}`);
    td.append(el('span', 'sign', sign));
    fill(td);
    tr.append(el('td', 'num', an >= 0 ? String(an + 1) : ''), el('td', 'num', bn >= 0 ? String(bn + 1) : ''), td);
    body.append(tr);
  };
  for (const it of items(r.rows)) {
    if ('fold' in it) {
      body.append(foldRow(it, 3));
      continue;
    }
    const row = it.row;
    if (row.kind === 'eq') line(row.a, row.b, ' ', '', (td) => td.append(r.a[row.a]));
    else if (row.kind === 'mod') {
      line(row.a, -1, '−', 'del', (td) => segs(td, row.left, 'del'));
      line(-1, row.b, '+', 'ins', (td) => segs(td, row.right, 'ins'));
    } else if (row.kind === 'del') line(row.a, -1, '−', 'del', (td) => td.append(r.a[row.a]));
    else line(-1, row.b, '+', 'ins', (td) => td.append(r.b[row.b]));
  }
}

function render() {
  const r = result;
  if (!r) return;
  modeSplit.setAttribute('aria-pressed', String(split));
  modeUnified.setAttribute('aria-pressed', String(!split));

  const empty = !r.a.length && !r.b.length;
  const same = !r.added && !r.removed;
  verdict.className = 'verdict ' + (empty ? '' : same ? 'ok' : 'diff');
  verdict.textContent = empty
    ? 'Paste two texts below to compare them'
    : same
      ? ignoreWs.checked || ignoreCase.checked || json.checked
        ? 'No differences (with your options)'
        : 'The two texts are identical'
      : `${r.blocks} change${r.blocks === 1 ? '' : 's'} found`;
  plus.textContent = `+${r.added}`;
  minus.textContent = `−${r.removed}`;
  plus.hidden = minus.hidden = empty || same;

  view.replaceChildren();
  if (!empty && !same) {
    const table = el('table', split ? 'split' : 'unified');
    const cols = el('colgroup');
    const widths = split ? ['num', 'code', 'num', 'code'] : ['num', 'num', 'code'];
    for (const w of widths) cols.append(el('col', `c-${w}`));
    const head = el('thead');
    const htr = el('tr');
    if (split) {
      const th1 = el('th', '', 'Before');
      const th2 = el('th', '', 'After');
      th1.colSpan = th2.colSpan = 2;
      htr.append(th1, th2);
    } else {
      const th = el('th', '', 'Before → After');
      th.colSpan = 3;
      htr.append(th);
    }
    head.append(htr);
    const body = el('tbody');
    if (split) renderSplit(r, body);
    else renderUnified(r, body);
    table.append(cols, head, body);
    view.append(table);
  } else if (!empty) {
    view.append(el('p', 'same', same ? '✓ Nothing to show. Every line matches.' : ''));
  }

  const patch = toPatch(r);
  patchOut.textContent = patch || 'No differences, so there is no patch.';
  patchBtn.disabled = promptBtn.disabled = !patch;
}

// Drop a file onto either box to load it.
for (const box of [left, right]) {
  box.addEventListener('input', schedule);
  box.addEventListener('dragover', (e) => {
    e.preventDefault();
    box.classList.add('drop');
  });
  box.addEventListener('dragleave', () => box.classList.remove('drop'));
  box.addEventListener('drop', async (e) => {
    box.classList.remove('drop');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    if (file.size > 5_000_000) return say('That file is over 5 MB. Try a smaller one.');
    box.value = await file.text();
    say(`Loaded ${file.name}.`);
    run();
  });
}

for (const box of [ignoreWs, ignoreCase, json]) box.addEventListener('change', run);

modeSplit.addEventListener('click', () => {
  split = true;
  render();
});
modeUnified.addEventListener('click', () => {
  split = false;
  render();
});

swapBtn.addEventListener('click', () => {
  [left.value, right.value] = [right.value, left.value];
  run();
  say('Swapped Before and After.');
});

clearBtn.addEventListener('click', () => {
  left.value = right.value = '';
  run();
  left.focus();
  say('');
});

patchBtn.addEventListener('click', () => result && copy(toPatch(result), 'Patch copied.'));

promptBtn.addEventListener('click', () => {
  if (!result) return;
  const prompt = `Here is a diff of a file before and after a change (unified diff format, "-" lines were removed and "+" lines were added).

Explain in plain words what changed, and point out anything that could break or that looks like a mistake.

\`\`\`diff
${toPatch(result)}\`\`\``;
  copy(prompt, 'Prompt copied. Paste it into your AI agent.');
});

run();
