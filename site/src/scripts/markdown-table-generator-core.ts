// Markdown table generator: pure functions shared by the page script. No DOM here.

export type Align = 'none' | 'left' | 'center' | 'right';
export type Table = { rows: string[][]; align: Align[] };

export const SAMPLE: Table = {
  rows: [
    ['Feature', 'Free', 'Pro', 'Team'],
    ['Price', '$0', '**$12**/mo', '$29/mo'],
    ['Projects', '3', 'Unlimited', 'Unlimited'],
    ['Custom domain', '❌', '✅', '✅'],
    ['Team members', '1', '1', 'Up to 10'],
    ['Priority support', '❌', '❌', '✅'],
  ],
  align: ['left', 'center', 'center', 'center'],
};

export const blank = (cols = 3, rows = 3): Table => ({
  rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')),
  align: Array.from({ length: cols }, () => 'none' as Align),
});

/** Every row gets the same number of cells, and align matches the column count. */
export function normalize(t: Table): Table {
  const cols = Math.max(1, ...t.rows.map((r) => r.length), t.align.length ? 1 : 0);
  const rows = (t.rows.length ? t.rows : [[]]).map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ''));
  const align = Array.from({ length: cols }, (_, i) => t.align[i] ?? 'none');
  return { rows, align };
}

/** Drops empty rows and columns at the end (keeps at least the header row and one column). */
export function trim(t: Table): Table {
  const n = normalize(t);
  let rows = n.rows;
  while (rows.length > 1 && rows[rows.length - 1].every((c) => !c.trim())) rows = rows.slice(0, -1);
  let cols = rows[0].length;
  while (cols > 1 && rows.every((r) => !r[cols - 1].trim())) cols--;
  return { rows: rows.map((r) => r.slice(0, cols)), align: n.align.slice(0, cols) };
}

const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u;

/** Roughly how many monospace columns a string takes (CJK and emoji take two). */
export function width(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (/[‍️̀-ͯ]/.test(ch)) continue;
    w += WIDE.test(ch) ? 2 : 1;
  }
  return w;
}

/** A cell as it must appear inside a Markdown table: pipes escaped, line breaks as <br>. */
export function mdCell(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .trim()
    .replace(/(^|[^\\])\|/g, '$1\\|')
    .replace(/(^|[^\\])\|/g, '$1\\|')
    .replace(/\n/g, '<br>');
}

function pad(s: string, w: number, a: Align): string {
  const gap = Math.max(0, w - width(s));
  if (a === 'right') return ' '.repeat(gap) + s;
  if (a === 'center') return ' '.repeat(Math.floor(gap / 2)) + s + ' '.repeat(Math.ceil(gap / 2));
  return s + ' '.repeat(gap);
}

function rule(w: number, a: Align): string {
  if (a === 'left') return ':' + '-'.repeat(Math.max(1, w - 1));
  if (a === 'right') return '-'.repeat(Math.max(1, w - 1)) + ':';
  if (a === 'center') return ':' + '-'.repeat(Math.max(1, w - 2)) + ':';
  return '-'.repeat(Math.max(3, w));
}

export function toMarkdown(input: Table, opts: { pretty?: boolean } = {}): string {
  const t = trim(input);
  const cells = t.rows.map((r) => r.map(mdCell));
  const pretty = opts.pretty !== false;
  const widths = t.align.map((a, i) => {
    const min = a === 'center' ? 5 : a === 'none' ? 3 : 4;
    return pretty ? Math.max(min, ...cells.map((r) => width(r[i]))) : min;
  });
  const line = (r: string[]) => '| ' + r.map((c, i) => (pretty ? pad(c, widths[i], t.align[i]) : c)).join(' | ') + ' |';
  const sep = '| ' + t.align.map((a, i) => rule(pretty ? widths[i] : a === 'none' ? 3 : a === 'center' ? 5 : 4, a)).join(' | ') + ' |';
  return [line(cells[0]), sep, ...cells.slice(1).map(line)].join('\n');
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The small bit of Markdown people use inside table cells: bold, italic, code, strikethrough, links, <br>. */
export function inline(src: string): string {
  const codes: string[] = [];
  let s = escapeHtml(src.replace(/\r\n?/g, '\n').trim().replace(/\\\|/g, '|'));
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*|#[^\s)]*|mailto:[^\s)]+)\)/g, (_, text, url) => `<a href="${url}">${text}</a>`);
  s = s.replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(?=\S)(.+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?=\S)([^*]+?)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_(?=\S)([^_]+?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)(.+?)~~/g, '<del>$1</del>');
  s = s.replace(/&lt;br\s*\/?&gt;|\n/gi, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

export function toHtml(input: Table): string {
  const t = trim(input);
  const attr = (i: number) => (t.align[i] === 'none' ? '' : ` style="text-align: ${t.align[i]}"`);
  const row = (r: string[], tag: 'th' | 'td') =>
    '    <tr>\n' + r.map((c, i) => `      <${tag}${attr(i)}>${inline(c)}</${tag}>`).join('\n') + '\n    </tr>';
  return [
    '<table>',
    '  <thead>',
    row(t.rows[0], 'th'),
    '  </thead>',
    '  <tbody>',
    ...t.rows.slice(1).map((r) => row(r, 'td')),
    '  </tbody>',
    '</table>',
  ].join('\n');
}

export function toCsv(input: Table): string {
  const t = trim(input);
  const q = (c: string) => (/[",\n\r]/.test(c) || /^\s|\s$/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return t.rows.map((r) => r.map(q).join(',')).join('\n');
}

/** CSV or TSV, with quoted cells that may hold the delimiter, quotes or line breaks (what Excel and Sheets copy). */
export function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let atStart = true;
  const s = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && atStart) { quoted = true; atStart = false; continue; }
    if (ch === delim) { row.push(cell); cell = ''; atStart = true; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; atStart = true; continue; }
    cell += ch;
    atStart = false;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const SEP_CELL = /^\s*:?-+:?\s*$/;

/** Splits one Markdown table line on pipes that are not escaped and not inside `code`. */
export function splitMdRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out: string[] = [];
  let cell = '';
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cell += '|'; i++; continue; }
    if (ch === '`') code = !code;
    if (ch === '|' && !code) { out.push(cell.trim()); cell = ''; continue; }
    cell += ch;
  }
  out.push(cell.trim());
  return out;
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  const l = c.startsWith(':');
  const r = c.endsWith(':');
  return l && r ? 'center' : l ? 'left' : r ? 'right' : 'none';
}

export type Parsed = { table: Table; kind: 'markdown' | 'tsv' | 'csv' | 'html' };

/** Reads a pasted Markdown table, HTML table, TSV (spreadsheets) or CSV. Returns null for plain text. */
export function parse(text: string): Parsed | null {
  const src = text.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
  if (!src) return null;
  const lines = src.split('\n');

  // Markdown: a line of dashes with pipes, right under the header.
  const sepAt = lines.findIndex((l, i) => i > 0 && l.includes('-') && l.includes('|') && splitMdRow(l).every((c) => SEP_CELL.test(c)));
  if (sepAt > 0 && lines[sepAt - 1].includes('|')) {
    const start = sepAt - 1;
    const body: string[] = [];
    for (const l of lines.slice(sepAt + 1)) {
      if (!l.trim() || !l.includes('|')) break;
      body.push(l);
    }
    const rows = [splitMdRow(lines[start]), ...body.map(splitMdRow)].map((r) => r.map((c) => c.replace(/<br\s*\/?>/gi, '\n')));
    const align = splitMdRow(lines[sepAt]).map(alignOf);
    return { table: trim(normalize({ rows, align })), kind: 'markdown' };
  }

  if (src.includes('\t')) return { table: trim(normalize({ rows: parseDelimited(src, '\t'), align: [] })), kind: 'tsv' };

  const first = lines[0];
  const commas = (first.match(/,/g) || []).length;
  const semis = (first.match(/;/g) || []).length;
  if (commas || semis) {
    const delim = semis > commas ? ';' : ',';
    return { table: trim(normalize({ rows: parseDelimited(src, delim), align: [] })), kind: 'csv' };
  }
  if (lines.length > 1) return { table: trim(normalize({ rows: lines.map((l) => [l]), align: [] })), kind: 'tsv' };
  return null;
}

/** Turns an HTML <table> (what Excel, Sheets, Notion and web pages put on the clipboard) into rows. */
export function parseHtmlTable(doc: Document): Table | null {
  const table = doc.querySelector('table');
  if (!table) return null;
  const rows: string[][] = [];
  const align: Align[] = [];
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const r: string[] = [];
    for (const cell of Array.from(tr.querySelectorAll('th, td'))) {
      const el = cell as HTMLElement;
      const a = (el.style?.textAlign || el.getAttribute('align') || '').toLowerCase();
      if (rows.length === 0 && (a === 'left' || a === 'center' || a === 'right')) align[r.length] = a;
      r.push((el.innerText ?? el.textContent ?? '').replace(/ /g, ' ').trim());
      const span = Math.min(20, Number(el.getAttribute('colspan')) || 1);
      for (let k = 1; k < span; k++) r.push('');
    }
    if (r.length) rows.push(r);
  }
  if (!rows.length) return null;
  return trim(normalize({ rows, align: Array.from({ length: rows[0].length }, (_, i) => align[i] ?? 'none') }));
}
