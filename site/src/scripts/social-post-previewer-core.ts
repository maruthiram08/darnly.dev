// Social post previewer: counting, thread splitting and unicode bold. No DOM here, so it can be tested on its own.

export const X_LIMIT = 280;
export const X_LONG_LIMIT = 25000;
export const LI_LIMIT = 3000;
// X counts every link as 23 characters, whatever its real length.
export const X_URL_WEIGHT = 23;

// Links as X and LinkedIn spot them: with http(s):// or www., or a bare domain with a common ending.
const URL_RE =
  /(?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,!?;:)\]]|(?<![@\w.-])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|dev|io|ai|app|co|org|net|so|sh|xyz|me|in|uk|gg|tv|ly|to|fm|site|tech|tools|page)(?![a-z0-9-])(?:\/[^\s<>"']*[^\s<>"'.,!?;:)\]])?(?![\w.-]*@)/gi;
const MENTION_RE = /(^|[^\w@])(@[A-Za-z0-9_]{1,30})/g;
const TAG_RE = /(^|[^\w#&])(#[\p{L}\p{N}_]+)/gu;

const PICTO = /\p{Extended_Pictographic}/u;
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

export function graphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

// X's own weighting (twitter-text v3): Latin, punctuation and common symbols count 1; CJK, most
// other scripts and every emoji count 2.
function charWeight(cp: number): number {
  if (cp <= 4351) return 1;
  if (cp >= 8192 && cp <= 8205) return 1;
  if (cp >= 8208 && cp <= 8223) return 1;
  if (cp >= 8242 && cp <= 8247) return 1;
  return 2;
}

function graphemeWeight(g: string): number {
  if (PICTO.test(g)) return 2;
  let w = 0;
  for (const ch of g) w += charWeight(ch.codePointAt(0)!);
  return w;
}

// A piece of text that is never split: a link, or one visible character.
export type Unit = { text: string; w: number };

export function units(text: string): Unit[] {
  const out: Unit[] = [];
  let last = 0;
  const pushText = (s: string) => {
    for (const g of graphemes(s)) out.push({ text: g, w: graphemeWeight(g) });
  };
  for (const m of text.matchAll(URL_RE)) {
    pushText(text.slice(last, m.index));
    out.push({ text: m[0], w: X_URL_WEIGHT });
    last = m.index! + m[0].length;
  }
  pushText(text.slice(last));
  return out;
}

export function xLength(text: string): number {
  let n = 0;
  for (const u of units(text.normalize('NFC'))) n += u.w;
  return n;
}

// LinkedIn counts characters as most people expect: one per letter or emoji part.
export function liLength(text: string): number {
  return Array.from(text).length;
}

// ---------- Thread splitting ----------

export type SplitOptions = { numbers: boolean };

// Where a split would read best. Higher is better.
function breakScore(before: string, after: string): number {
  if (before === '\n' && after === '\n') return 0; // inside a blank line run; wait for the end
  if (before === '\n') return 4;
  if (/[.!?…]/.test(before) && /\s/.test(after)) return 3;
  if (/[,;:—–)]/.test(before) && /\s/.test(after)) return 2;
  if (/\s/.test(after) || /\s/.test(before)) return 1;
  return 0;
}

function suffix(i: number, n: number): string {
  return ` ${i}/${n}`;
}

function splitOnce(text: string, opts: SplitOptions, total: number): string[] {
  // A line with only --- is the writer's own split.
  const manual = text.split(/\n[ \t]*-{3,}[ \t]*\n/);
  const parts: string[] = [];
  for (const block of manual) {
    const us = units(block.trim());
    let start = 0;
    while (start < us.length) {
      const index = parts.length + 1;
      const room = X_LIMIT - (opts.numbers && total > 1 ? suffix(index, total).length : 0);
      let w = 0;
      let end = start;
      while (end < us.length && w + us[end].w <= room) w += us[end++].w;
      if (end >= us.length) {
        parts.push(join(us, start, us.length));
        break;
      }
      // Look back for the best break in the last 60% of the post.
      let best = -1;
      let bestScore = 0;
      const floor = start + Math.floor((end - start) * 0.4);
      for (let i = end; i > floor; i--) {
        const s = breakScore(us[i - 1].text, us[i]?.text ?? ' ');
        if (s > bestScore || (s === bestScore && s > 0 && best === -1)) {
          bestScore = s;
          best = i;
          if (s === 4) break;
        }
      }
      // A paragraph or sentence end anywhere beats a mid-sentence word break near the end.
      const cut = best > start ? best : end;
      parts.push(join(us, start, cut));
      start = cut;
      while (start < us.length && /\s/.test(us[start].text)) start++;
    }
  }
  return parts.filter((p) => p.length > 0);
}

function join(us: Unit[], a: number, b: number): string {
  let s = '';
  for (let i = a; i < b; i++) s += us[i].text;
  return s.trim();
}

export function splitThread(text: string, opts: SplitOptions): string[] {
  const clean = text.normalize('NFC').trim();
  if (!clean) return [];
  let parts = splitOnce(clean, opts, 1);
  if (opts.numbers && parts.length > 1) {
    // Numbers take room, which can change the count; settle it in a few passes.
    for (let i = 0; i < 3; i++) {
      const next = splitOnce(clean, opts, parts.length);
      const same = next.length === parts.length;
      parts = next;
      if (same) break;
    }
    return parts.map((p, i) => p + suffix(i + 1, parts.length));
  }
  return parts;
}

// Cut text for X's "Show more" on a long post: X shows the first 280 counted characters.
export function xCut(text: string, limit = X_LIMIT): { shown: string; cut: boolean } {
  const us = units(text);
  let w = 0;
  let i = 0;
  while (i < us.length && w + us[i].w <= limit) w += us[i++].w;
  if (i >= us.length) return { shown: text, cut: false };
  // Back up to a word end so the cut doesn't split a word.
  let j = i;
  while (j > i - 30 && j > 0 && !/\s/.test(us[j].text)) j--;
  if (j <= i - 30 || j <= 0) j = i;
  return { shown: join(us, 0, j), cut: true };
}

// ---------- Bold ----------

const BOLD_UPPER = 0x1d5d4; // Mathematical sans-serif bold A
const BOLD_LOWER = 0x1d5ee; // ... a
const BOLD_DIGIT = 0x1d7ec; // ... 0

export function toBold(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 65 && c <= 90) out += String.fromCodePoint(BOLD_UPPER + c - 65);
    else if (c >= 97 && c <= 122) out += String.fromCodePoint(BOLD_LOWER + c - 97);
    else if (c >= 48 && c <= 57) out += String.fromCodePoint(BOLD_DIGIT + c - 48);
    else out += ch;
  }
  return out;
}

export function fromBold(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= BOLD_UPPER && c < BOLD_UPPER + 26) out += String.fromCharCode(65 + c - BOLD_UPPER);
    else if (c >= BOLD_LOWER && c < BOLD_LOWER + 26) out += String.fromCharCode(97 + c - BOLD_LOWER);
    else if (c >= BOLD_DIGIT && c < BOLD_DIGIT + 10) out += String.fromCharCode(48 + c - BOLD_DIGIT);
    else out += ch;
  }
  return out;
}

const STARS_RE = /\*\*([^*\n]+?)\*\*/g;

// Plain text for X: **markers** dropped, the words kept.
export function plain(text: string): string {
  return text.replace(STARS_RE, '$1');
}

export type LiOptions = { stars: boolean; boldHook: boolean };

// LinkedIn text: **words** and, if asked, the first line in unicode bold.
export function forLinkedIn(text: string, opts: LiOptions): string {
  let t = opts.stars ? text.replace(STARS_RE, (_, w: string) => toBold(w)) : text;
  if (opts.boldHook) {
    const nl = t.indexOf('\n');
    const first = nl === -1 ? t : t.slice(0, nl);
    t = toBold(first) + (nl === -1 ? '' : t.slice(nl));
  }
  return t;
}

export function firstLine(text: string): string {
  const t = text.replace(/^\s+/, '');
  const nl = t.indexOf('\n');
  return (nl === -1 ? t : t.slice(0, nl)).trim();
}

// ---------- Rich pieces for the previews ----------

export type Piece = { kind: 'text' | 'link' | 'mention' | 'tag'; text: string; href?: string };

// How X shows a link: no https://, and long ones cut with an ellipsis.
export function xLinkText(url: string): string {
  const bare = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return bare.length > 26 ? bare.slice(0, 25) + '…' : bare;
}

export function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  const pushPlain = (s: string) => {
    if (!s) return;
    // Mentions and hashtags inside plain text.
    const marks: { i: number; len: number; kind: 'mention' | 'tag' }[] = [];
    for (const m of s.matchAll(MENTION_RE)) marks.push({ i: m.index! + m[1].length, len: m[2].length, kind: 'mention' });
    for (const m of s.matchAll(TAG_RE)) marks.push({ i: m.index! + m[1].length, len: m[2].length, kind: 'tag' });
    marks.sort((a, b) => a.i - b.i);
    let at = 0;
    for (const mk of marks) {
      if (mk.i < at) continue;
      if (mk.i > at) out.push({ kind: 'text', text: s.slice(at, mk.i) });
      out.push({ kind: mk.kind, text: s.slice(mk.i, mk.i + mk.len) });
      at = mk.i + mk.len;
    }
    if (at < s.length) out.push({ kind: 'text', text: s.slice(at) });
  };
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    pushPlain(text.slice(last, m.index));
    const href = /^https?:\/\//i.test(m[0]) ? m[0] : `https://${m[0]}`;
    out.push({ kind: 'link', text: m[0], href });
    last = m.index! + m[0].length;
  }
  pushPlain(text.slice(last));
  return out;
}

// ---------- Picture layouts ----------

// A cell is a box inside the media area, in fractions of the area's width and height.
export type Cell = { x: number; y: number; w: number; h: number };
export type Layout = { aspect: number; cells: Cell[] };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// X: one picture keeps its shape between 3:4 and 2:1; 2–4 pictures share a 16:9 grid.
export function xLayout(aspects: number[]): Layout {
  const n = Math.min(aspects.length, 4);
  if (n === 1) return { aspect: clamp(aspects[0], 0.75, 2), cells: [{ x: 0, y: 0, w: 1, h: 1 }] };
  if (n === 2) return { aspect: 16 / 9, cells: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] };
  if (n === 3)
    return {
      aspect: 16 / 9,
      cells: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }],
    };
  return {
    aspect: 16 / 9,
    cells: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  };
}

// LinkedIn: one picture keeps its shape between 3:4 and 1.91:1; two sit side by side as squares;
// three or more get one big picture on top and the rest in a row below.
export function liLayout(aspects: number[]): Layout {
  const n = Math.min(aspects.length, 4);
  if (n === 1) return { aspect: clamp(aspects[0], 0.75, 1.91), cells: [{ x: 0, y: 0, w: 1, h: 1 }] };
  if (n === 2) return { aspect: 2, cells: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] };
  const below = n - 1;
  const topH = 1 / 1.5; // in widths
  const rowH = 1 / below; // square cells
  const total = topH + rowH;
  const cells: Cell[] = [{ x: 0, y: 0, w: 1, h: topH / total }];
  for (let i = 0; i < below; i++) cells.push({ x: i / below, y: topH / total, w: 1 / below, h: rowH / total });
  return { aspect: 1 / total, cells };
}

// How much of a picture a cell hides, from 0 to 1.
export function cropShare(imageAspect: number, cellAspect: number): number {
  if (!imageAspect || !cellAspect) return 0;
  return imageAspect > cellAspect ? 1 - cellAspect / imageAspect : 1 - imageAspect / cellAspect;
}
