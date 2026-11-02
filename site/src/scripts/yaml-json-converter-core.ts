// YAML ⇄ JSON converter core: parse, convert, and explain errors in plain words.
// Pure functions, no DOM, so it can be tested on its own.
import { parseAllDocuments, stringify, visit, isPair, type Document } from 'yaml';

export type Problem = { line: number; text: string }; // line is 1-based
export type Warning = { line: number; text: string };
export type Stats = { kind: string; top: number; values: number; depth: number };

export type Ok = { ok: true; value: unknown; docs: number; warnings: Warning[]; stats: Stats };
export type Bad = { ok: false; problem: Problem };
export type Parsed = Ok | Bad;

export type Format = { indent: 2 | 4; minify: boolean; sortKeys: boolean };

const lineOf = (text: string, pos: number) => text.slice(0, Math.max(0, pos)).split('\n').length;
const indentOf = (line: string) => line.length - line.trimStart().length;
const blank = (line: string) => !line.trim() || line.trimStart().startsWith('#');

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function stats(value: unknown): Stats {
  let values = 0;
  let depth = 0;
  const walk = (v: unknown, d: number) => {
    depth = Math.max(depth, d);
    if (Array.isArray(v)) v.forEach((x) => walk(x, d + 1));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, d + 1));
    else values++;
  };
  walk(value, 0);
  const kind = Array.isArray(value) ? 'list' : value && typeof value === 'object' ? 'object' : 'value';
  const top = Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 1;
  return { kind, top, values, depth };
}

// ---------- YAML ----------

// Indentation used by lines above `at` (0-based), nearest first. A "- key:" line also offers the column after the dash.
function indentsAbove(lines: string[], at: number) {
  const seen: number[] = [];
  for (let i = at - 1; i >= 0; i--) {
    const l = lines[i];
    if (blank(l)) continue;
    const ind = indentOf(l);
    const opts = [ind];
    const dash = /^(\s*)((?:-\s+)+)/.exec(l);
    if (dash) opts.push(dash[0].length);
    for (const o of opts) if (!seen.includes(o)) seen.push(o);
  }
  return seen;
}

const spaces = (n: number) => plural(n, 'space');
const more = (n: number) => `${n} more ${n === 1 ? 'space' : 'spaces'}`;

function indentAdvice(lines: string[], idx: number): string | null {
  const line = lines[idx];
  if (line === undefined || blank(line)) return null;
  const ind = indentOf(line);
  // Previous real line
  let p = idx - 1;
  while (p >= 0 && blank(lines[p])) p--;
  const prev = p >= 0 ? lines[p] : '';
  const prevDash = /^(\s*)-\s+(\S[^:]*):/.exec(prev);
  if (prevDash && ind === prevDash[1].length && !/^\s*-/.test(line)) {
    const want = prev.indexOf(prevDash[2]);
    return `line ${idx + 1} needs ${more(want - ind)} to line up with “${prevDash[2].trim()}” above, or start it with “- ” to make a new list item.`;
  }
  const cands = indentsAbove(lines, idx);
  if (!cands.length || cands.includes(ind)) return null;
  let best = cands[0];
  for (const c of cands) if (Math.abs(c - ind) < Math.abs(best - ind)) best = c;
  const diff = best - ind;
  return diff > 0
    ? `line ${idx + 1} needs ${more(diff)} at the start, so it lines up with the lines above.`
    : `line ${idx + 1} has ${spaces(-diff)} too many at the start, so it doesn’t line up with the lines above.`;
}

type YErr = { code: string; message: string; linePos?: [{ line: number; col: number }, ...{ line: number; col: number }[]] };

export function explainYaml(text: string, err: YErr): Problem {
  const lines = text.split('\n');
  let line = err.linePos?.[0]?.line ?? 1;
  const msg = err.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '');
  const idx = Math.min(line, lines.length) - 1;
  const src = lines[idx] ?? '';

  if (err.code === 'TAB_AS_INDENT' || /^\s*\t/.test(src)) {
    return { line, text: `Line ${line} starts with a tab. YAML only allows spaces at the start of a line, so replace the tab with spaces.` };
  }
  if (err.code === 'DUPLICATE_KEY') {
    const key = /^\s*(?:-\s+)?["']?([^:"']+)/.exec(src)?.[1]?.trim();
    return { line, text: `Line ${line}: the key “${key ?? '?'}” is used twice in the same block. Keep one of them, or rename it.` };
  }
  if (err.code === 'MISSING_CHAR' && /quote/i.test(msg)) {
    const q = /"/.test(msg) ? '"' : "'";
    for (let i = Math.min(idx, lines.length - 1); i >= 0; i--) {
      if ((lines[i].split(q).length - 1) % 2 === 1) {
        line = i + 1;
        break;
      }
    }
    return { line, text: `Line ${line} opens a quote (${q}) that is never closed. Add the closing ${q} at the end of the value.` };
  }
  if (/Flow sequence/i.test(msg)) {
    return { line: findOpen(lines, idx, '['), text: `Line ${findOpen(lines, idx, '[') } opens a list with [ but it is never closed. Add ] at the end of it.` };
  }
  if (/Flow mapping/i.test(msg)) {
    return { line: findOpen(lines, idx, '{'), text: `Line ${findOpen(lines, idx, '{')} opens a block with { but it is never closed. Add } at the end of it.` };
  }
  if (['BLOCK_AS_IMPLICIT_KEY', 'MULTILINE_IMPLICIT_KEY'].includes(err.code)) {
    // "key: value" followed by a deeper line: the deeper line is the mistake.
    let n = idx + 1;
    while (n < lines.length && blank(lines[n])) n++;
    if (n < lines.length && indentOf(lines[n]) > indentOf(src) && /:\s+[^\s|>#]/.test(src)) {
      const k = indentOf(lines[n]) - indentOf(src);
      return { line: n + 1, text: `Line ${n + 1} has ${spaces(k)} too many at the start. Line ${line} above already has a value, so nothing can go under it.` };
    }
  }
  if (['BAD_INDENT', 'BLOCK_AS_IMPLICIT_KEY', 'MULTILINE_IMPLICIT_KEY', 'UNEXPECTED_TOKEN'].includes(err.code)) {
    const advice = indentAdvice(lines, idx);
    if (advice) return { line, text: advice[0].toUpperCase() + advice.slice(1) };
    if (/:\s.*:\s/.test(src.replace(/(["']).*?\1/g, '""')) && !/^\s*-/.test(src) && err.code === 'BLOCK_AS_IMPLICIT_KEY') {
      return { line, text: `Line ${line} has two “key: value” pairs on one line. Put the value in quotes, or move the second pair to its own line.` };
    }
    if (err.code === 'UNEXPECTED_TOKEN') {
      return { line, text: `Line ${line} doesn’t fit with the lines above it. Check its spaces at the start, and whether it should be a list item (starting with “- ”) like its neighbours.` };
    }
  }
  return { line, text: `Line ${line}: ${msg.charAt(0).toLowerCase()}${msg.slice(1)}.` };
}

function findOpen(lines: string[], idx: number, ch: string) {
  for (let i = Math.min(idx, lines.length - 1); i >= 0; i--) if (lines[i].includes(ch)) return i + 1;
  return idx + 1;
}

// Values that YAML reads differently from how they look, a common source of quiet bugs.
function gotchas(doc: Document, text: string): Warning[] {
  const out: Warning[] = [];
  visit(doc, {
    Scalar(key, node, path) {
      if (node.type !== 'PLAIN' || !node.range || out.length >= 8) return;
      const src = node.source ?? '';
      const line = lineOf(text, node.range[0]);
      const parent = path[path.length - 1];
      const isKey = isPair(parent) && key === 'key';
      if (isKey) return;
      if (typeof node.value === 'number') {
        if (/^[+-]?\d*\.\d*0$/.test(src)) {
          out.push({ line, text: `Line ${line}: ${src} turns into the number ${node.value}. If it’s a version, write "${src}" in quotes.` });
        } else if (/^[+-]?0\d+$/.test(src)) {
          out.push({ line, text: `Line ${line}: ${src} turns into the number ${node.value} and loses its leading zero. Write "${src}" in quotes to keep it.` });
        }
      } else if (typeof node.value === 'string') {
        if (/^(yes|no|on|off|y|n)$/i.test(src)) {
          out.push({ line, text: `Line ${line}: some tools read ${src} as true or false. Write "${src}" in quotes if you mean the word, or use true/false.` });
        } else if (/^\d{1,2}(:[0-5]\d)+$/.test(src)) {
          out.push({ line, text: `Line ${line}: some tools (like older docker-compose) read ${src} as a number. Write "${src}" in quotes.` });
        }
      }
    },
  });
  return out;
}

export function parseYaml(text: string): Parsed {
  let docs: Document[];
  try {
    const all = parseAllDocuments(text, { prettyErrors: true, uniqueKeys: true });
    docs = Array.isArray(all) ? all : [all as unknown as Document];
  } catch (e) {
    return { ok: false, problem: { line: 1, text: `This couldn’t be read as YAML: ${(e as Error).message}` } };
  }
  docs = docs.filter((d, i) => i === 0 || d.contents !== null || d.errors.length);
  for (const d of docs) {
    const err = d.errors[0];
    if (err) return { ok: false, problem: explainYaml(text, err as unknown as YErr) };
  }
  try {
    const values = docs.map((d) => d.toJS({ maxAliasCount: 100 }));
    const value = values.length === 1 ? values[0] : values;
    const warnings = docs.flatMap((d) => gotchas(d, text));
    return { ok: true, value: value ?? null, docs: values.length, warnings, stats: stats(value) };
  } catch (e) {
    return { ok: false, problem: { line: 1, text: `This YAML uses too many aliases (*name) to be safe to expand: ${(e as Error).message}` } };
  }
}

// ---------- JSON ----------

function prevChar(text: string, pos: number) {
  let i = pos - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  return { ch: i >= 0 ? text[i] : '', at: i };
}

// Finds where JSON stops being valid. Browsers word (and sometimes leave out) the position differently,
// so we walk the text ourselves. Returns -1 when the text is valid.
export function jsonFailAt(t: string): number {
  let i = 0;
  const ws = () => {
    while (i < t.length && (t[i] === ' ' || t[i] === '\n' || t[i] === '\r' || t[i] === '\t')) i++;
  };
  const fail = () => {
    throw i;
  };
  const str = () => {
    i++;
    while (i < t.length && t[i] !== '"') {
      if (t[i] === '\\') {
        i++;
        if (t[i] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(t.slice(i + 1, i + 5))) fail();
          i += 4;
        } else if (!'"\\/bfnrt'.includes(t[i] ?? 'x')) fail();
      } else if (t.charCodeAt(i) < 0x20) fail();
      i++;
    }
    if (i >= t.length) fail();
    i++;
  };
  const value = (): void => {
    ws();
    const c = t[i];
    if (c === '{') {
      i++;
      ws();
      if (t[i] === '}') return void i++;
      for (;;) {
        ws();
        if (t[i] !== '"') fail();
        str();
        ws();
        if (t[i] !== ':') fail();
        i++;
        value();
        ws();
        if (t[i] === ',') { i++; continue; }
        if (t[i] === '}') return void i++;
        fail();
      }
    }
    if (c === '[') {
      i++;
      ws();
      if (t[i] === ']') return void i++;
      for (;;) {
        value();
        ws();
        if (t[i] === ',') { i++; continue; }
        if (t[i] === ']') return void i++;
        fail();
      }
    }
    if (c === '"') return str();
    const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(t.slice(i, i + 400));
    if (!m) fail();
    i += m![0].length;
    if (i < t.length && /[\w.]/.test(t[i])) fail();
  };
  try {
    value();
    ws();
    return i < t.length ? i : -1;
  } catch (at) {
    return at as number;
  }
}

// Turns the browser's JSON.parse error into a position, whatever the browser.
export function jsonErrorPos(text: string, message: string): number {
  const own = jsonFailAt(text);
  if (own >= 0) return own;
  const p = /position (\d+)/.exec(message);
  if (p) return Number(p[1]);
  const lc = /line (\d+) column (\d+)/.exec(message);
  if (lc) {
    const lines = text.split('\n');
    let pos = 0;
    for (let i = 0; i < Number(lc[1]) - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    return pos + Number(lc[2]) - 1;
  }
  return text.length;
}

export function explainJson(text: string, message: string): Problem {
  let pos = jsonErrorPos(text, message);
  // Some engines point past trailing spaces at the end; step back onto real text.
  if (pos >= text.length) {
    const last = prevChar(text, text.length);
    return { line: lineOf(text, last.at), text: `The JSON ends too early. A closing } or ] is probably missing at the end.` };
  }
  let ch = text[pos];
  const before = text.slice(0, pos).replace(/\\./g, '');
  if (text.charCodeAt(pos) < 0x20 && (before.split('"').length - 1) % 2 === 1) {
    const l = lineOf(text, pos);
    return { line: l, text: `Line ${l} has a tab or a line break inside a text value. JSON needs them written as \\t or \\n.` };
  }
  // Engines differ on whether they point at the bad character or just past spaces before it.
  while (pos < text.length && /\s/.test(ch)) ch = text[++pos];
  const prev = prevChar(text, pos);
  const line = lineOf(text, pos);
  if ((ch === '}' || ch === ']') && prev.ch === ',') {
    const l = lineOf(text, prev.at);
    return { line: l, text: `Line ${l} ends with a comma before the closing ${ch}. JSON doesn’t allow that, so remove the last comma.` };
  }
  if (ch === "'") return { line, text: `Line ${line} uses single quotes ('). JSON needs double quotes (") around text and keys.` };
  if (ch === '/' && (text[pos + 1] === '/' || text[pos + 1] === '*')) {
    return { line, text: `Line ${line} has a comment. JSON doesn’t allow comments, so remove it (or keep it as YAML, which does).` };
  }
  if (/[A-Za-z_$]/.test(ch) && (prev.ch === '{' || prev.ch === ',')) {
    const word = /^[A-Za-z_$][\w$-]*/.exec(text.slice(pos))?.[0] ?? ch;
    return { line, text: `Line ${line}: the key ${word} needs double quotes around it, like "${word}".` };
  }
  if (/\d/.test(ch) && prev.ch === '0' && prev.at === pos - 1) {
    return { line, text: `Line ${line}: numbers in JSON can’t start with 0. Remove the leading zero, or put the number in quotes.` };
  }
  if (/[A-Za-z]/.test(ch) && prev.ch === ':') {
    const word = /^[A-Za-z_$][\w$-]*/.exec(text.slice(pos))?.[0] ?? ch;
    if (!['true', 'false', 'null'].includes(word)) {
      return { line, text: `Line ${line}: ${word} needs double quotes around it, like "${word}". The only words JSON allows without quotes are true, false and null.` };
    }
  }
  if (/["{[\-\d tfn]/.test(ch) && /["}\]\deEl]/.test(prev.ch)) {
    const l = lineOf(text, prev.at);
    return { line: l, text: `A comma is missing at the end of line ${l}.` };
  }
  if (ch === '}' || ch === ']') {
    return { line, text: `Line ${line} closes with ${ch} but there’s nothing to close there. Check that every { has a } and every [ has a ].` };
  }
  const col = pos - text.lastIndexOf('\n', pos - 1);
  return { line, text: `Line ${line}, column ${col}: “${ch}” isn’t expected here.` };
}

export function parseJson(text: string): Parsed {
  try {
    const value = JSON.parse(text);
    return { ok: true, value, docs: 1, warnings: [], stats: stats(value) };
  } catch (e) {
    return { ok: false, problem: explainJson(text, (e as Error).message) };
  }
}

// ---------- Output ----------

function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]));
  }
  return v;
}

export function toJson(value: unknown, f: Format) {
  const v = f.sortKeys ? sorted(value) : value;
  return JSON.stringify(v, null, f.minify ? 0 : f.indent) ?? 'null';
}

export function toYaml(value: unknown, f: Format) {
  const v = f.sortKeys ? sorted(value) : value;
  // YAML 1.1 rules quote words like yes, on and 22:22, so older readers can't misread them either.
  return stringify(v, { version: '1.1', indent: f.indent, lineWidth: 0, aliasDuplicateObjects: false });
}

export function describe(s: Stats) {
  const parts: string[] = [];
  if (s.kind === 'object') parts.push(plural(s.top, 'top-level key'));
  else if (s.kind === 'list') parts.push(plural(s.top, 'item'));
  parts.push(plural(s.values, 'value'));
  if (s.depth > 1) parts.push(`${s.depth} levels deep`);
  return parts;
}

