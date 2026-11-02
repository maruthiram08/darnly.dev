// Diff checker core: a small Myers diff for lines and words, plus unified patch output.
// Pure functions, no DOM, so it can be tested on its own.

export type Op = { t: 'eq' | 'del' | 'ins'; a: number; b: number }; // a/b are indexes, -1 when absent

export type Options = { ignoreWs: boolean; ignoreCase: boolean };

// Past this many edits, give up on the shortest diff and mark the middle as replaced.
const MAX_EDITS = 2000;

function myers(a: string[], b: string[], offA: number, offB: number, out: Op[]) {
  const n = a.length;
  const m = b.length;
  if (!n) {
    for (let j = 0; j < m; j++) out.push({ t: 'ins', a: -1, b: offB + j });
    return;
  }
  if (!m) {
    for (let i = 0; i < n; i++) out.push({ t: 'del', a: offA + i, b: -1 });
    return;
  }
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max; d++) {
    if (d > MAX_EDITS) break;
    trace.push(v.slice(off - d - 1, off + d + 2)); // k from -d-1 to d+1
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }

  if (found < 0) {
    // Too different to diff cheaply: everything in the middle is replaced.
    for (let i = 0; i < n; i++) out.push({ t: 'del', a: offA + i, b: -1 });
    for (let j = 0; j < m; j++) out.push({ t: 'ins', a: -1, b: offB + j });
    return;
  }

  const rev: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const t = trace[d];
    const at = (k: number) => t[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      rev.push({ t: 'eq', a: offA + x, b: offB + y });
    }
    if (x === prevX) {
      y--;
      rev.push({ t: 'ins', a: -1, b: offB + y });
    } else {
      x--;
      rev.push({ t: 'del', a: offA + x, b: -1 });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    rev.push({ t: 'eq', a: offA + x, b: offB + y });
  }
  for (let i = rev.length - 1; i >= 0; i--) out.push(rev[i]);
}

// Diff two lists of keys. Common start and end are trimmed first, so typical edits are fast.
export function diffSeq(a: string[], b: string[]): Op[] {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const out: Op[] = [];
  for (let i = 0; i < s; i++) out.push({ t: 'eq', a: i, b: i });
  myers(a.slice(s, ea), b.slice(s, eb), s, s, out);
  for (let i = 0; ea + i < a.length; i++) out.push({ t: 'eq', a: ea + i, b: eb + i });
  return out;
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop(); // a final newline is not an extra empty line
  return lines;
}

export function lineKey(line: string, o: Options): string {
  let k = line;
  if (o.ignoreWs) k = k.replace(/\s+/g, ' ').trim();
  if (o.ignoreCase) k = k.toLowerCase();
  return k;
}

// Format JSON the same way on both sides, with keys sorted, so only real changes show.
export function formatJson(text: string): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const key of Object.keys(v as object).sort()) o[key] = sort((v as Record<string, unknown>)[key]);
      return o;
    }
    return v;
  };
  return JSON.stringify(sort(JSON.parse(text)), null, 2);
}

// ---- Rows for the side-by-side and unified views ----

export type Seg = { text: string; changed: boolean };
export type Row =
  | { kind: 'eq'; a: number; b: number }
  | { kind: 'del'; a: number }
  | { kind: 'ins'; b: number }
  | { kind: 'mod'; a: number; b: number; left: Seg[]; right: Seg[] };

const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

// Word-level diff of two lines. Returns null when they share too little to be worth showing inline.
export function wordDiff(l: string, r: string, o: Options): { left: Seg[]; right: Seg[] } | null {
  const ta = l.match(TOKEN) || [];
  const tb = r.match(TOKEN) || [];
  const key = (t: string) => (o.ignoreWs && /^\s+$/.test(t) ? ' ' : o.ignoreCase ? t.toLowerCase() : t);
  const ops = diffSeq(ta.map(key), tb.map(key));
  const left: Seg[] = [];
  const right: Seg[] = [];
  let same = 0;
  const push = (arr: Seg[], text: string, changed: boolean) => {
    const last = arr[arr.length - 1];
    if (last && last.changed === changed) last.text += text;
    else arr.push({ text, changed });
  };
  for (const op of ops) {
    if (op.t === 'eq') {
      const t = tb[op.b];
      if (/\S/.test(t)) same += t.length;
      push(left, ta[op.a], false);
      push(right, t, false);
    } else if (op.t === 'del') push(left, ta[op.a], !(o.ignoreWs && /^\s+$/.test(ta[op.a])));
    else push(right, tb[op.b], !(o.ignoreWs && /^\s+$/.test(tb[op.b])));
  }
  const longest = Math.max(l.replace(/\s/g, '').length, r.replace(/\s/g, '').length);
  if (longest > 0 && same / longest < 0.4) return null;
  return { left, right };
}

export type Result = {
  a: string[];
  b: string[];
  ops: Op[];
  rows: Row[];
  added: number;
  removed: number;
  blocks: number;
};

export function diffTexts(left: string, right: string, o: Options): Result {
  const a = splitLines(left);
  const b = splitLines(right);
  const ops = diffSeq(a.map((l) => lineKey(l, o)), b.map((l) => lineKey(l, o)));
  const rows: Row[] = [];
  let added = 0;
  let removed = 0;
  let blocks = 0;
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.t === 'eq') {
      rows.push({ kind: 'eq', a: op.a, b: op.b });
      i++;
      continue;
    }
    // A run of removed and added lines: pair them up so changed words can be shown.
    const dels: number[] = [];
    const ins: number[] = [];
    while (i < ops.length && ops[i].t !== 'eq') {
      if (ops[i].t === 'del') dels.push(ops[i].a);
      else ins.push(ops[i].b);
      i++;
    }
    blocks++;
    removed += dels.length;
    added += ins.length;
    const n = Math.max(dels.length, ins.length);
    const pending: Row[] = [];
    for (let j = 0; j < n; j++) {
      const da = dels[j];
      const ib = ins[j];
      if (da !== undefined && ib !== undefined) {
        // Lines that share too little keep the same row, without word highlights.
        const w = wordDiff(a[da], b[ib], o) || { left: [{ text: a[da], changed: false }], right: [{ text: b[ib], changed: false }] };
        pending.push({ kind: 'mod', a: da, b: ib, left: w.left, right: w.right });
      } else if (da !== undefined) pending.push({ kind: 'del', a: da });
      else pending.push({ kind: 'ins', b: ib });
    }
    rows.push(...pending);
  }
  return { a, b, ops, rows, added, removed, blocks };
}

// ---- Unified patch, like `diff -u` ----

export function toPatch(r: Result, nameA = 'before', nameB = 'after', context = 3): string {
  const { ops, a, b } = r;
  const changes: number[] = [];
  ops.forEach((op, i) => op.t !== 'eq' && changes.push(i));
  if (!changes.length) return '';
  const out = [`--- ${nameA}`, `+++ ${nameB}`];
  let h = 0;
  while (h < changes.length) {
    const start = Math.max(0, changes[h] - context);
    let end = changes[h];
    while (h + 1 < changes.length && changes[h + 1] - end <= context * 2 + 1) end = changes[++h];
    h++;
    const stop = Math.min(ops.length - 1, end + context);
    const body: string[] = [];
    let aStart = -1;
    let bStart = -1;
    let aCount = 0;
    let bCount = 0;
    // Where this hunk begins in each file, even if it starts with an add or a remove.
    let aBefore = 0;
    let bBefore = 0;
    for (let i = 0; i < start; i++) {
      if (ops[i].t !== 'ins') aBefore++;
      if (ops[i].t !== 'del') bBefore++;
    }
    for (let i = start; i <= stop; i++) {
      const op = ops[i];
      if (op.t === 'eq') {
        body.push(' ' + a[op.a]);
        aCount++;
        bCount++;
      } else if (op.t === 'del') {
        body.push('-' + a[op.a]);
        aCount++;
      } else {
        body.push('+' + b[op.b]);
        bCount++;
      }
    }
    aStart = aCount ? aBefore + 1 : aBefore;
    bStart = bCount ? bBefore + 1 : bBefore;
    const range = (s: number, c: number) => (c === 1 ? `${s}` : `${s},${c}`);
    out.push(`@@ -${range(aStart, aCount)} +${range(bStart, bCount)} @@`, ...body);
  }
  return out.join('\n') + '\n';
}
