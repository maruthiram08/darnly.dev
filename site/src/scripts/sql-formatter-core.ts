// SQL formatter helpers that need no browser: a small tokenizer used for colors and for the
// plain-English outline of what each statement does. Formatting itself is done by sql-formatter.

export type Dialect = 'postgresql' | 'mysql' | 'sqlite';

export type TokType = 'kw' | 'fn' | 'id' | 'qid' | 'str' | 'num' | 'cmt' | 'op' | 'punc' | 'param' | 'ws';
export type Tok = { t: TokType; v: string; depth: number };

// Words colored as keywords. Not every reserved word, just the ones people read SQL by.
const KEYWORDS = new Set(
  (
    'select from where and or not in is null like ilike between exists join inner left right full outer cross natural on using ' +
    'group by order having limit offset fetch first next rows row only distinct all any as asc desc nulls last union intersect except ' +
    'insert into values default returning update set delete truncate drop create alter table view index unique primary key foreign ' +
    'references constraint check column add rename to if replace temporary temp materialized schema database cascade restrict ' +
    'with recursive case when then else end cast true false conflict do nothing begin commit rollback transaction grant revoke ' +
    'policy enable disable security level trigger function returns language for each execute procedure lateral window over partition ' +
    'filter collate interval auto_increment autoincrement serial bigserial engine charset ignore duplicate lock share mode explain analyze ' +
    'vacuum pragma without rowid strict generated always stored virtual identity owner public authenticated anon'
  ).split(' '),
);

const FUNCS = new Set(
  'count sum avg min max coalesce nullif now lower upper length trim concat substring round floor ceil abs date_trunc extract to_char json_agg jsonb_agg array_agg string_agg row_number rank dense_rank lag lead gen_random_uuid uuid_generate_v4 current_timestamp current_date ifnull group_concat strftime datetime julianday random greatest least'.split(' '),
);

export function tokenize(sql: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let depth = 0;
  const n = sql.length;
  const push = (t: TokType, v: string) => out.push({ t, v, depth });
  while (i < n) {
    const c = sql[i];
    const rest = sql.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\s+/))) {
      push('ws', m[0]);
    } else if (rest.startsWith('--') || (c === '#' && !/^#\w*\s*\(/.test(rest))) {
      const end = sql.indexOf('\n', i);
      push('cmt', end === -1 ? rest : sql.slice(i, end));
    } else if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      push('cmt', end === -1 ? rest : sql.slice(i, end + 2));
    } else if ((m = rest.match(/^\$([A-Za-z_]\w*)?\$/))) {
      // Postgres dollar-quoted string: $$ ... $$ or $tag$ ... $tag$
      const tag = m[0];
      const end = sql.indexOf(tag, i + tag.length);
      push('str', end === -1 ? rest : sql.slice(i, end + tag.length));
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '\\' && c !== '"') j += 2;
        else if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) break;
        else j++;
      }
      push(c === "'" ? 'str' : 'qid', sql.slice(i, Math.min(j + 1, n)));
      i = Math.min(j + 1, n);
      continue;
    } else if (c === '[' && (m = rest.match(/^\[[^\]\n]*\]/)) && /[A-Za-z_]/.test(m[0][1] ?? '')) {
      push('qid', m[0]);
    } else if ((m = rest.match(/^(\d+\.?\d*(e[+-]?\d+)?|\.\d+)/i))) {
      push('num', m[0]);
    } else if ((m = rest.match(/^(\$\d+|\?|:[A-Za-z_]\w*|@[A-Za-z_]\w*)/))) {
      push('param', m[0]);
    } else if ((m = rest.match(/^[A-Za-z_][\w$]*/))) {
      const w = m[0].toLowerCase();
      const after = sql.slice(i + m[0].length);
      // Known functions may have a space before "(", other words only count as calls when the "(" touches them.
      const call = (FUNCS.has(w) && /^\s*\(/.test(after)) || (!KEYWORDS.has(w) && after.startsWith('('));
      push(call ? 'fn' : KEYWORDS.has(w) ? 'kw' : 'id', m[0]);
    } else if (c === '(') {
      push('punc', c);
      depth++;
      i++;
      continue;
    } else if (c === ')') {
      depth = Math.max(0, depth - 1);
      push('punc', c);
      i++;
      continue;
    } else if (c === ',' || c === ';' || c === '.') {
      push('punc', c);
    } else if ((m = rest.match(/^(<>|<=|>=|!=|::|\|\||->>|->|#>>|#>|@>|<@|[=<>+\-*/%!~^&|])/))) {
      push('op', m[0]);
    } else {
      push('op', c);
    }
    i += out[out.length - 1].v.length;
  }
  return out;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ESC[ch]);

// Colored HTML for already formatted SQL. Every token is escaped.
export function highlight(sql: string): string {
  return tokenize(sql).map(tokHtml).join('');
}

// ---------- Plain-English outline ----------

export type Level = 'read' | 'write' | 'danger' | 'schema' | 'other';
export type Line = { label: string; text: string; danger?: boolean };
export type Statement = {
  verb: string; // SELECT, UPDATE...
  level: Level;
  headline: string; // one sentence
  lines: Line[];
  tables: string[];
  writes: string[];
};

type W = Tok & { lw: string };

const lower = (k: Tok): W => ({ ...k, lw: k.t === 'kw' || k.t === 'id' || k.t === 'fn' ? k.v.toLowerCase() : '' });

export type Chunk = { lead: string; html: string; toks: W[] };

const tokHtml = (k: Tok) => (k.t === 'ws' || k.t === 'punc' ? esc(k.v) : `<span class="s-${k.t}">${esc(k.v)}</span>`);

// Splits SQL into statements on top-level semicolons. Each chunk keeps its colored HTML
// (lead = whitespace and comments before it) so the code view and the outline line up.
export function splitStatements(sql: string): Chunk[] {
  const out: Chunk[] = [];
  let cur: Chunk = { lead: '', html: '', toks: [] };
  let inBody = 0; // inside CREATE TRIGGER/FUNCTION ... BEGIN ... END
  for (const raw of tokenize(sql)) {
    const k = lower(raw);
    const code = k.t !== 'ws' && k.t !== 'cmt';
    if (!cur.toks.length && !code) {
      cur.lead += tokHtml(k);
      continue;
    }
    if (k.lw === 'begin' && cur.toks.some((c) => c.lw === 'trigger' || c.lw === 'procedure' || c.lw === 'function')) inBody++;
    if (k.lw === 'end' && inBody > 0) inBody--;
    cur.html += tokHtml(k);
    if (k.v === ';' && k.depth === 0 && inBody === 0) {
      if (cur.toks.length) {
        out.push(cur);
        cur = { lead: '', html: '', toks: [] };
      } else {
        cur.lead += cur.html;
        cur.html = '';
      }
    } else if (code) cur.toks.push(k);
  }
  if (cur.toks.length) out.push(cur);
  else if (out.length) out[out.length - 1].html += cur.lead + cur.html;
  return out;
}

const text = (toks: W[]) => {
  let s = '';
  toks.forEach((k, i) => {
    const prev = toks[i - 1];
    const tight = !prev || k.v === ',' || k.v === ')' || k.v === '.' || prev.v === '.' || prev.v === '(' || (k.v === '(' && (prev.t === 'fn' || prev.t === 'id')) || k.v === '::' || prev.v === '::';
    s += (tight ? '' : ' ') + k.v;
  });
  return s.length > 140 ? s.slice(0, 137) + '…' : s;
};

const unquote = (v: string) => (/^["`[]/.test(v) ? v.slice(1, -1) : v);

// Reads a table name like schema.table or "My Table" starting at i. Returns the name and next index.
function tableAt(toks: W[], i: number): [string, number] | null {
  const k = toks[i];
  if (!k || (k.t !== 'id' && k.t !== 'qid' && k.t !== 'fn' && !(k.t === 'kw' && !['select', 'with', 'lateral', 'only', 'if', 'not', 'exists', 'ignore'].includes(k.lw)))) return null;
  let name = unquote(k.v);
  let j = i + 1;
  while (toks[j]?.v === '.' && toks[j + 1] && (toks[j + 1].t === 'id' || toks[j + 1].t === 'qid' || toks[j + 1].t === 'kw')) {
    name += '.' + unquote(toks[j + 1].v);
    j += 2;
  }
  return [name, j];
}

// Optional alias after a table: "AS u" or just "u".
function aliasAt(toks: W[], j: number): [string | undefined, number] {
  if (toks[j]?.lw === 'as' && toks[j + 1]) return [unquote(toks[j + 1].v), j + 2];
  if (toks[j] && (toks[j].t === 'id' || toks[j].t === 'qid')) return [unquote(toks[j].v), j + 1];
  return [undefined, j];
}

const CLAUSE_END = new Set(['where', 'group', 'order', 'having', 'limit', 'offset', 'returning', 'union', 'intersect', 'except', 'window', 'fetch', 'for', 'on', 'set', 'values', 'join', 'inner', 'left', 'right', 'full', 'cross', 'natural', 'using', 'select', 'from', 'lock']);

// Tokens of a top-level clause (same depth as start) until the next clause keyword.
function clause(toks: W[], start: number, depth: number, stops = CLAUSE_END): W[] {
  const out: W[] = [];
  for (let i = start; i < toks.length; i++) {
    const k = toks[i];
    if (k.depth < depth) break;
    if (k.depth === depth && stops.has(k.lw) && !(k.lw === 'by' || (k.lw === 'order' && toks[i - 1]?.lw === 'within'))) break;
    out.push(k);
  }
  return out;
}

// Find a keyword at a given depth, returning its index or -1.
function find(toks: W[], word: string, depth = 0, from = 0) {
  for (let i = from; i < toks.length; i++) if (toks[i].depth === depth && toks[i].lw === word) return i;
  return -1;
}

const ALWAYS_TRUE = /^(1\s*=\s*1|true|1|'1'\s*=\s*'1'|0\s*=\s*0)$/i;

function list(names: string[]) {
  const u = [...new Set(names)].map((n) => `<b>${esc(n)}</b>`);
  if (u.length <= 1) return u.join('');
  return u.slice(0, -1).join(', ') + ' and ' + u[u.length - 1];
}

// Tables read by FROM / JOIN anywhere in the statement (including subqueries), plus joins at depth.
function readSources(toks: W[], cteNames: Set<string>) {
  const tables: string[] = [];
  const joins: Line[] = [];
  let firstFrom: { name: string; alias?: string } | undefined;
  for (let i = 0; i < toks.length; i++) {
    const k = toks[i];
    if (k.lw === 'from' && toks[i - 1]?.lw !== 'distinct' && !(toks[i - 1]?.lw === 'delete')) {
      // FROM a, b, c
      let j = i + 1;
      while (j < toks.length) {
        const t = tableAt(toks, j);
        if (!t) break;
        const [alias, nj] = aliasAt(toks, t[1]);
        if (!CLAUSE_END.has(t[0].toLowerCase())) {
          tables.push(t[0]);
          if (!firstFrom && k.depth === 0) firstFrom = { name: t[0], alias };
        }
        j = nj;
        if (toks[j]?.v !== ',') break;
        j++;
      }
    }
    if (k.lw === 'join') {
      const t = tableAt(toks, i + 1);
      if (!t) continue;
      tables.push(t[0]);
      // Join kind from the words before JOIN.
      const before: string[] = [];
      for (let b = i - 1; b >= 0 && ['left', 'right', 'full', 'inner', 'outer', 'cross', 'natural'].includes(toks[b].lw); b--) before.unshift(toks[b].lw);
      const kind = before.filter((w) => w !== 'outer')[0] ?? 'inner';
      const [, nj] = aliasAt(toks, t[1]);
      let cond = '';
      if (toks[nj]?.lw === 'on') cond = text(clause(toks, nj + 1, k.depth, new Set([...CLAUSE_END].filter((w) => w !== 'on'))));
      else if (toks[nj]?.lw === 'using') cond = 'same ' + text(clause(toks, nj + 1, k.depth));
      const base = firstFrom ? `<b>${esc(firstFrom.name)}</b>` : 'the rows';
      const n = `<b>${esc(t[0])}</b>`;
      const meaning: Record<string, string> = {
        inner: `keeps only rows that have a match in ${n}`,
        left: `keeps every row of ${base}, even with no match in ${n}`,
        right: `keeps every row of ${n}, even with no match in ${base}`,
        full: `keeps all rows from both sides, matched where possible`,
        cross: `pairs every row with every row of ${n} (can get huge)`,
        natural: `matches on columns with the same name`,
      };
      if (k.depth === 0) joins.push({ label: 'Join', text: `${n}${cond ? ` where <code>${esc(cond)}</code>` : ''}: ${meaning[kind] ?? meaning.inner}.` });
    }
  }
  return { tables: tables.filter((t) => !cteNames.has(t.toLowerCase())), joins, firstFrom, all: tables };
}

function whereLine(toks: W[], verbPhrase: string): { line?: Line; missing: boolean; alwaysTrue: boolean } {
  const w = find(toks, 'where');
  if (w === -1) return { missing: true, alwaysTrue: false };
  const cond = clause(toks, w + 1, 0);
  const t = text(cond);
  const alwaysTrue = ALWAYS_TRUE.test(t.trim());
  return {
    missing: false,
    alwaysTrue,
    line: { label: 'Filter', text: alwaysTrue ? `<code>${esc(t)}</code> is always true, so this ${verbPhrase} <b>every row</b>.` : `only rows where <code>${esc(t)}</code>.`, danger: alwaysTrue },
  };
}

function selectLines(toks: W[], lines: Line[]) {
  const s = find(toks, 'select');
  if (s === -1) return;
  const cols = clause(toks, s + 1, 0);
  const distinct = cols[0]?.lw === 'distinct';
  const body = distinct ? cols.slice(cols[1]?.lw === 'on' ? 2 : 1) : cols;
  let count = body.length ? 1 : 0;
  body.forEach((k) => k.v === ',' && k.depth === 0 && count++);
  const star = body.length === 1 && body[0].v === '*';
  const hasAgg = body.some((k) => k.t === 'fn' && ['count', 'sum', 'avg', 'min', 'max', 'json_agg', 'jsonb_agg', 'array_agg', 'string_agg', 'group_concat'].includes(k.lw));
  lines.push({
    label: 'Returns',
    text: star ? 'every column (<code>*</code>).' : `${count} column${count === 1 ? '' : 's'}: <code>${esc(text(body))}</code>${hasAgg ? ' (includes totals or counts)' : ''}${distinct ? ', with duplicates removed' : ''}.`,
  });
}

function tailLines(toks: W[], lines: Line[]) {
  const g = find(toks, 'group');
  if (g !== -1 && toks[g + 1]?.lw === 'by') lines.push({ label: 'Group', text: `one row per <code>${esc(text(clause(toks, g + 2, 0)))}</code>.` });
  const h = find(toks, 'having');
  if (h !== -1) lines.push({ label: 'Then keep', text: `groups where <code>${esc(text(clause(toks, h + 1, 0)))}</code>.` });
  const o = find(toks, 'order');
  if (o !== -1 && toks[o + 1]?.lw === 'by') {
    const ord = clause(toks, o + 2, 0);
    const t = text(ord);
    lines.push({ label: 'Sort', text: `by <code>${esc(t)}</code>${/\bdesc\b/i.test(t) ? ' (biggest or newest first where it says DESC)' : ''}.` });
  }
  const l = find(toks, 'limit');
  if (l !== -1) {
    const v = text(clause(toks, l + 1, 0));
    const m = v.match(/^(\d+)\s*,\s*(\d+)$/); // MySQL LIMIT offset, count
    lines.push({ label: 'Limit', text: m ? `skips ${m[1]} rows, then returns up to ${m[2]}.` : `returns up to <b>${esc(v)}</b> row${v === '1' ? '' : 's'}.` });
  }
  const off = find(toks, 'offset');
  if (off !== -1) lines.push({ label: 'Skip', text: `the first ${esc(text(clause(toks, off + 1, 0)))} rows.` });
  const f = find(toks, 'fetch');
  if (f !== -1) lines.push({ label: 'Limit', text: esc(text(clause(toks, f, 0))) + '.' });
  const r = find(toks, 'returning');
  if (r !== -1) lines.push({ label: 'Gives back', text: `<code>${esc(text(clause(toks, r + 1, 0)))}</code> for the changed rows.` });
}

function describe(all: W[]): Statement {
  let toks = all;
  const lines: Line[] = [];
  const cteNames = new Set<string>();
  // WITH a AS (...), b AS (...) <main statement>
  if (toks[0]?.lw === 'with') {
    let i = toks[1]?.lw === 'recursive' ? 2 : 1;
    const names: string[] = [];
    while (i < toks.length) {
      const name = unquote(toks[i]?.v ?? '');
      let j = i + 1;
      if (toks[j]?.v === '(') {
        // column list: name (a, b) AS (...)
        while (j < toks.length && !(toks[j].v === ')' && toks[j].depth === 0)) j++;
        j++;
      }
      if (toks[j]?.lw !== 'as') break;
      j++;
      if (toks[j]?.lw === 'not') j++;
      if (toks[j]?.lw === 'materialized') j++;
      if (toks[j]?.v !== '(') break;
      names.push(name);
      cteNames.add(name.toLowerCase());
      j++;
      while (j < toks.length && !(toks[j].v === ')' && toks[j].depth === 0)) j++;
      j++;
      i = j;
      if (toks[i]?.v === ',') i++;
      else break;
    }
    if (names.length) lines.push({ label: 'First', text: `builds a temporary result called ${list(names)} to use below.` });
    toks = toks.slice(i);
  }

  const v = toks[0]?.lw ?? '';
  const verb = (toks[0]?.v ?? '').toUpperCase();
  const src = readSources(all, cteNames);
  const readNames = src.tables;
  const st = (level: Level, headline: string, writes: string[] = []): Statement => ({ verb, level, headline, lines, tables: [...new Set(readNames.concat(writes))], writes });

  if (v === 'select' || v === 'values' || v === 'table' || (v === '(' && toks.some((k) => k.lw === 'select'))) {
    if (readNames.length) lines.push({ label: 'Reads', text: `from ${list(readNames)}.` });
    lines.push(...src.joins);
    selectLines(toks, lines);
    const w = whereLine(toks, 'returns');
    if (w.line) lines.push(w.line);
    tailLines(toks, lines);
    if (find(toks, 'union') !== -1) lines.push({ label: 'Combine', text: 'stacks the results of more than one SELECT (UNION).' });
    const into = find(toks, 'into');
    if (into !== -1 && tableAt(toks, into + 1)) {
      const t = tableAt(toks, into + 1)![0];
      return st('write', `Copies rows into ${list([t])}.`, [t]);
    }
    return st('read', readNames.length ? `Only reads data from ${list(readNames)}. Nothing is changed.` : 'Only reads data. Nothing is changed.');
  }

  if (v === 'insert' || v === 'replace' || v === 'upsert') {
    const into = find(toks, 'into');
    const t = tableAt(toks, into === -1 ? 1 : into + 1);
    const name = t ? t[0] : 'a table';
    const valuesAt = find(toks, 'values');
    if (valuesAt !== -1) {
      let rows = 0;
      for (let i = valuesAt + 1; i < toks.length; i++) {
        if (toks[i].depth === 0 && toks[i].v === '(') rows++;
        if (toks[i].depth === 0 && CLAUSE_END.has(toks[i].lw)) break;
        if (toks[i].depth === 0 && (toks[i].lw === 'on' || toks[i].lw === 'returning')) break;
      }
      // depth of "(" is recorded before increment, so a row opener sits at depth 0
      lines.push({ label: 'Adds', text: `${rows || 1} new row${rows === 1 ? '' : 's'} to <b>${esc(name)}</b>.` });
    } else if (find(toks, 'select') !== -1) {
      const others = readNames.filter((n) => n !== name);
      lines.push({ label: 'Adds', text: `rows to <b>${esc(name)}</b> copied from ${others.length ? list(others) : 'a query'}.` });
    }
    const cols = t && toks[t[1]]?.v === '(' ? text(clause(toks, t[1] + 1, 1)) : '';
    if (cols) lines.push({ label: 'Columns', text: `<code>${esc(cols)}</code>.` });
    const conflict = find(toks, 'conflict');
    const dup = find(toks, 'duplicate');
    if (conflict !== -1) lines.push({ label: 'If it exists', text: find(toks, 'nothing') !== -1 ? 'skips that row instead of failing (ON CONFLICT DO NOTHING).' : 'updates the existing row instead (upsert).' });
    else if (dup !== -1 || v === 'replace') lines.push({ label: 'If it exists', text: v === 'replace' ? 'deletes the old row and puts this one in its place.' : 'updates the existing row instead (upsert).' });
    tailLines(toks, lines);
    return st('write', `Adds data to ${list([name])}.`, [name]);
  }

  if (v === 'update') {
    let i = 1;
    while (['only', 'low_priority', 'ignore', 'or'].includes(toks[i]?.lw ?? '') || ['rollback', 'abort', 'replace', 'fail'].includes(toks[i]?.lw ?? '')) i++;
    const t = tableAt(toks, i);
    const name = t ? t[0] : 'a table';
    const set = find(toks, 'set');
    if (set !== -1) {
      const cols: string[] = [];
      const body = clause(toks, set + 1, 0, new Set(['where', 'from', 'returning', 'order', 'limit']));
      let expectCol = true;
      body.forEach((k, idx) => {
        if (k.depth !== 0) return;
        if (expectCol && (k.t === 'id' || k.t === 'qid' || k.t === 'kw') && body[idx + 1]?.v !== '.') {
          cols.push(unquote(k.v));
          expectCol = false;
        }
        if (k.v === ',') expectCol = true;
      });
      lines.push({ label: 'Changes', text: `${cols.length ? `<code>${esc(cols.join(', '))}</code>` : 'columns'} in <b>${esc(name)}</b>.` });
    }
    const w = whereLine(toks, 'changes');
    if (w.line) lines.push(w.line);
    tailLines(toks, lines);
    if (w.missing) {
      lines.push({ label: 'No WHERE', text: `there is no filter, so <b>every row in ${esc(name)}</b> gets changed.`, danger: true });
      return st('danger', `Changes every row in ${list([name])}. There is no WHERE.`, [name]);
    }
    if (w.alwaysTrue) return st('danger', `Changes every row in ${list([name])}. The filter is always true.`, [name]);
    return st('write', `Changes rows in ${list([name])}.`, [name]);
  }

  if (v === 'delete') {
    const from = find(toks, 'from');
    const t = tableAt(toks, from === -1 ? 1 : from + 1);
    const name = t ? t[0] : 'a table';
    const w = whereLine(toks, 'deletes');
    if (w.line) lines.push(w.line);
    tailLines(toks, lines);
    if (w.missing) {
      lines.push({ label: 'No WHERE', text: `there is no filter, so <b>every row in ${esc(name)}</b> is deleted. This can’t be undone without a backup.`, danger: true });
      return st('danger', `Deletes every row in ${list([name])}. There is no WHERE.`, [name]);
    }
    if (w.alwaysTrue) return st('danger', `Deletes every row in ${list([name])}. The filter is always true.`, [name]);
    lines.unshift({ label: 'Deletes', text: `rows from <b>${esc(name)}</b>.` });
    return st('write', `Deletes rows from ${list([name])}.`, [name]);
  }

  if (v === 'truncate') {
    const i = toks[1]?.lw === 'table' ? 2 : 1;
    const t = tableAt(toks, i);
    const name = t ? t[0] : 'a table';
    lines.push({ label: 'Empties', text: `<b>${esc(name)}</b> completely. Every row is gone.`, danger: true });
    return st('danger', `Deletes every row in ${list([name])} (TRUNCATE).`, [name]);
  }

  if (v === 'drop') {
    const what = toks[1]?.lw ?? 'object';
    let i = 2;
    if (toks[i]?.lw === 'if' && toks[i + 1]?.lw === 'exists') i += 2;
    const t = tableAt(toks, i);
    const name = t ? t[0] : '';
    const thing = what === 'table' ? 'table' : what;
    lines.push({ label: 'Removes', text: `the ${esc(thing)} <b>${esc(name)}</b>${what === 'table' ? ' and all its data' : ''}.`, danger: what === 'table' || what === 'database' || what === 'schema' || what === 'column' });
    if (find(toks, 'cascade') !== -1) lines.push({ label: 'Cascade', text: 'also removes everything that depends on it.', danger: true });
    return st(what === 'table' || what === 'database' || what === 'schema' ? 'danger' : 'schema', `Deletes the ${esc(thing)} ${name ? list([name]) : ''}${what === 'table' ? ' and all its data' : ''}.`, name ? [name] : []);
  }

  if (v === 'alter') {
    const what = toks[1]?.lw ?? '';
    let i = 2;
    if (toks[i]?.lw === 'if' && toks[i + 1]?.lw === 'exists') i += 2;
    if (toks[i]?.lw === 'only') i++;
    const t = tableAt(toks, i);
    const name = t ? t[0] : '';
    const body = t ? toks.slice(t[1]) : [];
    const dropCol = body.findIndex((k) => k.lw === 'drop') !== -1 && !body.some((k) => k.lw === 'constraint' || k.lw === 'default' || k.lw === 'policy');
    if (body.some((k) => k.lw === 'add')) lines.push({ label: 'Adds', text: `<code>${esc(text(body.slice(body.findIndex((k) => k.lw === 'add') + 1)))}</code>.` });
    if (body.some((k) => k.lw === 'rename')) lines.push({ label: 'Renames', text: `<code>${esc(text(body.slice(body.findIndex((k) => k.lw === 'rename') + 1)))}</code>. Code that uses the old name will break.` });
    if (dropCol) lines.push({ label: 'Removes', text: `<code>${esc(text(body.slice(body.findIndex((k) => k.lw === 'drop') + 1)))}</code> and the data in it.`, danger: true });
    if (body.some((k) => k.lw === 'enable') && body.some((k) => k.lw === 'security')) lines.push({ label: 'Security', text: 'turns on row level security. Without policies, nobody can read the table through the API.' });
    if (body.some((k) => k.lw === 'disable') && body.some((k) => k.lw === 'security')) lines.push({ label: 'Security', text: 'turns off row level security. Anyone with your public key can read and change this table.', danger: true });
    const danger = lines.some((l) => l.danger);
    return st(danger ? 'danger' : 'schema', `Changes the structure of the ${esc(what)} ${name ? list([name]) : ''}.`, name ? [name] : []);
  }

  if (v === 'create') {
    let i = 1;
    while (['or', 'replace', 'temporary', 'temp', 'unique', 'materialized', 'global', 'local', 'unlogged', 'virtual'].includes(toks[i]?.lw ?? '')) i++;
    const what = toks[i]?.lw ?? '';
    i++;
    if (what === 'index' && toks[i]?.lw === 'concurrently') i++;
    if (toks[i]?.lw === 'if' && toks[i + 1]?.lw === 'not' && toks[i + 2]?.lw === 'exists') i += 3;
    const t = tableAt(toks, i);
    const name = t && toks[i]?.lw !== 'on' ? t[0] : '';
    if (what === 'table') {
      const asSelect = find(toks, 'select') !== -1;
      let cols = 0;
      if (t && toks[t[1]]?.v === '(') {
        cols = 1;
        for (let j = t[1] + 1; j < toks.length && toks[j].depth >= 1; j++) if (toks[j].depth === 1 && toks[j].v === ',') cols++;
      }
      lines.push({ label: 'Creates', text: `a new table <b>${esc(name)}</b>${asSelect ? ' filled from a query' : cols ? ` with ${cols} column${cols === 1 ? '' : 's'} or rules` : ''}.` });
    } else if (what === 'index') {
      const on = find(toks, 'on');
      const target = on !== -1 ? tableAt(toks, on + 1 + (toks[on + 1]?.lw === 'only' ? 1 : 0)) : null;
      lines.push({ label: 'Creates', text: `an index${name ? ` <b>${esc(name)}</b>` : ''}${target ? ` on <b>${esc(target[0])}</b>` : ''}. Lookups get faster; no data changes.` });
    } else if (what === 'policy') {
      const on = find(toks, 'on');
      const target = on !== -1 ? tableAt(toks, on + 1) : null;
      const using = find(toks, 'using');
      lines.push({ label: 'Creates', text: `an access rule${name ? ` <b>${esc(name)}</b>` : ''}${target ? ` on <b>${esc(target[0])}</b>` : ''}.` });
      if (using !== -1) lines.push({ label: 'Allows', text: `rows where <code>${esc(text(clause(toks, using + 1, 0)))}</code>.` });
      return st('schema', `Adds an access rule to ${target ? list([target[0]]) : 'a table'}.`, target ? [target[0]] : []);
    } else {
      lines.push({ label: 'Creates', text: `a ${esc(what)}${name ? ` <b>${esc(name)}</b>` : ''}.` });
    }
    return st('schema', `Creates the ${esc(what)} ${name ? list([name]) : ''}.`, name ? [name] : []);
  }

  if (['begin', 'commit', 'rollback', 'start'].includes(v)) {
    const what = v === 'commit' ? 'Saves the changes made since BEGIN.' : v === 'rollback' ? 'Throws away the changes made since BEGIN.' : 'Starts a transaction: the changes after it count only once COMMIT runs.';
    return st('other', what);
  }

  if (v === 'grant' || v === 'revoke') return st('schema', v === 'grant' ? 'Gives a role permission to do something.' : 'Takes a permission away from a role.');

  return st('other', `Runs a ${esc(verb)} statement.`);
}

export function analyze(sql: string): (Statement & Chunk)[] {
  return splitStatements(sql).map((c) => ({ ...c, ...describe(c.toks) }));
}

// Pulls "line X column Y" out of sql-formatter's long parse error.
export function friendlyError(msg: string): { text: string; line?: number; column?: number } {
  const m = msg.match(/line (\d+) column (\d+)/i);
  const tok = msg.match(/at token: «([^»]*)»/);
  const what = tok ? (tok[1] === 'EOF' ? 'the query ends too early (a bracket or quote may be missing)' : `“${tok[1]}” isn’t expected there`) : 'it couldn’t be read';
  return m ? { text: `Line ${m[1]}, column ${m[2]}: ${what}.`, line: +m[1], column: +m[2] } : { text: `This SQL couldn’t be formatted: ${what}.` };
}
