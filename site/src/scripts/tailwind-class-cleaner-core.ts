// Tailwind class cleaner: the logic, with no DOM. Everything runs in the visitor's browser.
// The order and the CSS come from Tailwind v4 itself (the same calls the official Prettier plugin makes).

export type DesignSystem = {
  getClassOrder(classes: string[]): [string, bigint | null][];
  candidatesToCss(classes: string[]): (string | null)[];
  canonicalizeCandidates?(classes: string[], opts?: object): string[];
};

export type Group = 'layout' | 'size' | 'spacing' | 'type' | 'color' | 'border' | 'effects' | 'other' | 'custom';

export const GROUPS: { id: Group; label: string }[] = [
  { id: 'layout', label: 'Layout' },
  { id: 'size', label: 'Size' },
  { id: 'spacing', label: 'Spacing' },
  { id: 'type', label: 'Typography' },
  { id: 'color', label: 'Color' },
  { id: 'border', label: 'Borders' },
  { id: 'effects', label: 'Effects' },
  { id: 'other', label: 'Other' },
  { id: 'custom', label: 'Not Tailwind' },
];

export type Info = {
  cls: string;
  order: bigint | null;
  group: Group;
  props: string[]; // CSS properties it sets
  key: string; // variants + properties: two classes with the same key fight over the same thing
  important: boolean;
};

export type Conflict = {
  key: string;
  classes: string[]; // in the order they appear in the result
  winner: string; // the one the browser uses today
  props: string[];
  variants: string;
};

export type Result = {
  input: string[];
  dupes: string[];
  infos: Map<string, Info>;
  conflicts: Conflict[];
  unknown: { cls: string; hint: string }[];
  renames: { from: string; to: string }[];
  output: string[];
};

// Splits "md:hover:bg-red-500" into its variants and the utility, ignoring colons inside [ ] and ( ).
export function splitVariants(cls: string): { variants: string[]; base: string } {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    if (c === '[' || c === '(') depth++;
    else if ((c === ']' || c === ')') && depth > 0) depth--;
    else if (c === ':' && depth === 0) {
      parts.push(cls.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(cls.slice(start));
  const base = parts.pop() || '';
  return { variants: parts, base };
}

export function isImportant(base: string) {
  return base.startsWith('!') || base.endsWith('!');
}

// The CSS properties a class sets, read from Tailwind's own CSS for it (the @property blocks are left out).
export function propsOf(css: string): string[] {
  const main = css.split(/\n@property\s/)[0];
  const set = new Set<string>();
  for (const m of main.matchAll(/^\s+(-{0,2}[a-zA-Z][\w-]*)\s*:/gm)) set.add(m[1]);
  return [...set].sort();
}

const COLOR_PROPS = new Set([
  'color', 'background-color', 'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color',
  'border-left-color', 'border-inline-color', 'border-block-color', 'border-inline-start-color',
  'border-inline-end-color', 'outline-color', 'fill', 'stroke', 'accent-color', 'caret-color',
  'text-decoration-color', '--tw-ring-color', '--tw-shadow-color', '--tw-inset-shadow-color',
  '--tw-ring-offset-color', '--tw-inset-ring-color', '--tw-gradient-from', '--tw-gradient-via', '--tw-gradient-to',
  '--tw-drop-shadow-color', '--tw-text-shadow-color', 'background-image',
]);

function groupOfProp(p: string): Group | null {
  if (COLOR_PROPS.has(p)) return 'color';
  if (/^(padding|margin)/.test(p) || p === 'gap' || p === 'column-gap' || p === 'row-gap' || p === 'scroll-margin' || p.startsWith('scroll-p') || p.startsWith('scroll-m')) return 'spacing';
  if (/^(width|height|min-|max-|inline-size|block-size|size$|aspect-ratio)/.test(p)) return 'size';
  if (/^(display|position|top|right|bottom|left|inset|z-index|flex|grid|order|justify|align|place|float|clear|overflow|box-sizing|visibility|object-|columns|isolation|container|break-|table-layout|border-collapse|border-spacing|caption-side)/.test(p)) return 'layout';
  if (/^(font|text-|line-height|letter-spacing|white-space|word-break|overflow-wrap|hyphens|list-style|vertical-align|-webkit-font|-moz-osx|tab-size|text$|font-variant|content$|-webkit-line-clamp|-webkit-box-orient)/.test(p)) return 'type';
  if (/^(border|outline|--tw-ring|--tw-inset-ring|--tw-outline|--tw-border)/.test(p)) return 'border';
  if (/^(box-shadow|--tw-shadow|--tw-inset-shadow|opacity|filter|backdrop-filter|mix-blend|background-blend|transform|translate|rotate|scale|--tw-translate|--tw-rotate|--tw-scale|--tw-skew|transition|animation|--tw-duration|--tw-ease|--tw-blur|--tw-brightness|--tw-contrast|--tw-grayscale|--tw-saturate|--tw-sepia|--tw-invert|--tw-hue|--tw-drop-shadow|--tw-backdrop|perspective|backface|mask)/.test(p)) return 'effects';
  if (/^(background|--tw-gradient)/.test(p)) return 'color';
  if (p === '--tw-leading' || p === '--tw-font-weight' || p === '--tw-tracking') return 'type';
  if (p === '--tw-space-x-reverse' || p === '--tw-space-y-reverse') return 'spacing';
  return null;
}

export function groupOf(props: string[]): Group {
  if (!props.length) return 'other';
  // Real CSS properties decide first; Tailwind's own --tw-* helpers only when there are no others.
  const real = props.filter((p) => !p.startsWith('--'));
  const order = real.length ? real : props;
  const found = order.map(groupOfProp).filter(Boolean) as Group[];
  if (!found.length) return 'other';
  // A class that sets any color is a color class (text-red-500, bg-sky-600, border-red-500).
  if (found.includes('color') && real.every((p) => COLOR_PROPS.has(p) || p.startsWith('--'))) return 'color';
  return found[0];
}

// Classes that are Tailwind but make no CSS on their own.
const MARKERS = /^(group|peer)(\/[\w-]+)?$|^(dark|light|not-prose|prose)$/;

// Tailwind v3 names that v4 dropped, with what to use now.
const REMOVED: [RegExp, string][] = [
  [/^(bg|text|border|divide|ring|placeholder)-opacity-/, 'Removed in Tailwind v4. Use a slash instead, like bg-black/50.'],
  [/^overflow-ellipsis$/, 'Removed in Tailwind v4. Use text-ellipsis.'],
  [/^decoration-(slice|clone)$/, 'Removed in Tailwind v4. Use box-decoration-slice or box-decoration-clone.'],
  [/^flex-(shrink|grow)(-0)?$/, 'Renamed in Tailwind v4: use shrink or grow.'],
];

export function lev(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// "Did you mean …?" for a class Tailwind doesn't know. `names` is Tailwind's own class list.
export function suggest(cls: string, names: string[]): string {
  const { variants, base } = splitVariants(cls);
  const bare = base.replace(/^!|!$/g, '').replace(/^-/, '');
  for (const [re, msg] of REMOVED) if (re.test(bare)) return msg;
  if (!bare || bare.startsWith('[')) return '';
  let best = '';
  let bestD = 99;
  const head = bare.slice(0, 2);
  for (const n of names) {
    if (!n.startsWith(head)) continue;
    let d = lev(bare, n, 2);
    if (d > 2 && bare.startsWith(n) && n.includes('-') && bare.length - n.length <= 4) d = 2.5; // flex-column → flex-col
    if (d < bestD || (d === bestD && n.length < best.length)) {
      bestD = d;
      best = n;
    }
  }
  if (bestD > 2.5 || !best) return '';
  return `Did you mean ${[...variants, best].join(':')}?`;
}

// Cleans one list of classes.
export function clean(
  classes: string[],
  ds: DesignSystem,
  opts: { dedupe: boolean; picks?: Map<string, string>; dropLosers: boolean; rename: boolean; names?: string[] },
): Result {
  const input = classes.filter(Boolean);
  const seen = new Set<string>();
  const dupes: string[] = [];
  let list: string[] = [];
  for (const c of input) {
    if (seen.has(c)) {
      dupes.push(c);
      if (!opts.dedupe) list.push(c);
      continue;
    }
    seen.add(c);
    list.push(c);
  }

  // Newer, shorter v4 names (bg-gradient-to-r → bg-linear-to-r, w-[100%] → w-full).
  const renames: { from: string; to: string }[] = [];
  if (ds.canonicalizeCandidates) {
    for (const c of new Set(list)) {
      let to = c;
      try {
        to = ds.canonicalizeCandidates([c])[0] || c;
      } catch {
        /* keep it */
      }
      if (to !== c && to.replace(/!/g, '') !== c.replace(/!/g, '')) renames.push({ from: c, to });
    }
    if (opts.rename && renames.length) {
      const map = new Map(renames.map((r) => [r.from, r.to]));
      const out: string[] = [];
      const s = new Set<string>();
      for (const c of list) {
        const n = map.get(c) || c;
        if (opts.dedupe && s.has(n)) {
          dupes.push(n);
          continue;
        }
        s.add(n);
        out.push(n);
      }
      list = out;
    }
  }

  const uniq = [...new Set(list)];
  const orders = new Map(ds.getClassOrder(uniq));
  const css = ds.candidatesToCss(uniq);
  const infos = new Map<string, Info>();
  uniq.forEach((cls, i) => {
    const order = orders.get(cls) ?? null;
    const { variants, base } = splitVariants(cls);
    const props = css[i] ? propsOf(css[i]!) : [];
    const known = order !== null || MARKERS.test(cls);
    const group: Group = !known ? 'custom' : order === null ? 'other' : groupOf(props);
    const key = props.length ? `${[...variants].sort().join(':')}|${props.join(',')}` : '';
    infos.set(cls, { cls, order, group, props, key, important: isImportant(base) });
  });

  // Prettier's order: classes Tailwind doesn't know first (kept as they were), then by Tailwind's order.
  const sorted = list
    .map((c, i) => ({ c, i, o: infos.get(c)!.order }))
    .sort((a, b) => {
      if (a.o === null && b.o === null) return a.i - b.i;
      if (a.o === null) return -1;
      if (b.o === null) return 1;
      return a.o < b.o ? -1 : a.o > b.o ? 1 : 0;
    })
    .map((x) => x.c);

  // Conflicts: same variants, same CSS properties. The later one in Tailwind's CSS wins, unless one is !important.
  const byKey = new Map<string, string[]>();
  for (const c of uniq) {
    const k = infos.get(c)!.key;
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) || []), c]);
  }
  const conflicts: Conflict[] = [];
  for (const [key, cs] of byKey) {
    if (cs.length < 2) continue;
    const ordered = cs.slice().sort((a, b) => sorted.indexOf(a) - sorted.indexOf(b));
    let winner = ordered[ordered.length - 1];
    const imp = ordered.filter((c) => infos.get(c)!.important);
    if (imp.length) winner = imp[imp.length - 1];
    const [variants, props] = key.split('|');
    conflicts.push({ key, classes: ordered, winner, props: props.split(','), variants });
  }

  let output = sorted;
  if (opts.dropLosers) {
    const drop = new Set<string>();
    for (const k of conflicts) {
      const keep = opts.picks?.get(k.key);
      const chosen = keep && k.classes.includes(keep) ? keep : k.winner;
      for (const c of k.classes) if (c !== chosen) drop.add(c);
    }
    output = sorted.filter((c) => !drop.has(c));
  }

  const unknown = uniq
    .filter((c) => infos.get(c)!.group === 'custom')
    .map((cls) => ({ cls, hint: opts.names ? suggest(cls, opts.names) : '' }));

  return { input, dupes, infos, conflicts, unknown, renames, output };
}

// One cn() argument per group, for long lists.
export function splitByGroup(output: string[], infos: Map<string, Info>): string[] {
  const buckets = new Map<Group, string[]>();
  for (const c of output) {
    const info = infos.get(c);
    // Classes Tailwind can't place (custom ones, group, peer) stay together at the front, like Prettier keeps them.
    const g = !info || info.order === null ? 'custom' : info.group;
    buckets.set(g, [...(buckets.get(g) || []), c]);
  }
  const order: Group[] = ['custom', 'layout', 'size', 'spacing', 'type', 'color', 'border', 'effects', 'other'];
  return order.filter((g) => buckets.has(g)).map((g) => buckets.get(g)!.join(' '));
}

export function formatCall(fn: string, parts: string[], quote = '"', indent = ''): string {
  if (parts.length <= 1) return `${quote}${parts[0] || ''}${quote}`;
  return `${fn}(\n${parts.map((p) => `${indent}  ${quote}${p}${quote},`).join('\n')}\n${indent})`;
}

// ---- Finding class lists inside a code snippet ----

export type Found = {
  start: number; // where the class text starts in the source
  end: number;
  text: string;
  kind: 'attr' | 'call';
  attrStart?: number; // the whole className="…" for the cn() split
  attrEnd?: number;
  attrName?: string;
  jsx?: boolean;
  quote?: string;
  label: string;
};

const FNS = /\b(cn|clsx|cx|classnames|classNames|twMerge|twJoin|cva|tv|tw)\s*\(/g;

function readString(src: string, i: number): { end: number; text: string } | null {
  const q = src[i];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  let j = i + 1;
  while (j < src.length && src[j] !== q) {
    if (src[j] === '\\') j++;
    j++;
  }
  if (j >= src.length) return null;
  return { end: j, text: src.slice(i + 1, j) };
}

// Is this pasted text code (with class="…" or cn(…)) or just a list of classes?
export function looksLikeCode(src: string): boolean {
  return /\b(class|className)\s*=/.test(src) || /\b(cn|clsx|cx|twMerge|twJoin|cva|tv)\s*\(/.test(src) || /<[a-zA-Z]/.test(src);
}

function tagBefore(src: string, at: number): string {
  const lt = src.lastIndexOf('<', at);
  const m = lt >= 0 ? /^<([A-Za-z][\w.-]*)/.exec(src.slice(lt)) : null;
  return m ? `<${m[1]}>` : 'class list';
}

export function findClassLists(src: string): Found[] {
  const found: Found[] = [];
  const taken: [number, number][] = [];
  const free = (a: number) => !taken.some(([s, e]) => a >= s && a < e);

  // className="…", class='…', className={"…"}, className={`…`} (without ${…})
  const attr = /\b(class|className)\s*=\s*(\{\s*)?(["'`])/g;
  for (const m of src.matchAll(attr)) {
    const qAt = m.index! + m[0].length - 1;
    const s = readString(src, qAt);
    if (!s) continue;
    if (src[qAt] === '`' && s.text.includes('${')) continue;
    let attrEnd = s.end + 1;
    if (m[2]) {
      const close = src.slice(attrEnd).match(/^\s*\}/);
      if (!close) continue;
      attrEnd += close[0].length;
    }
    found.push({
      start: qAt + 1,
      end: s.end,
      text: s.text,
      kind: 'attr',
      attrStart: m.index!,
      attrEnd,
      attrName: m[1],
      jsx: m[1] === 'className' || !!m[2],
      quote: src[qAt],
      label: tagBefore(src, m.index!),
    });
    taken.push([qAt, s.end + 1]);
  }

  // Strings inside cn(…), clsx(…), twMerge(…), cva(…)
  for (const m of src.matchAll(FNS)) {
    let i = m.index! + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === '"' || c === "'" || c === '`') {
        const s = readString(src, i);
        if (!s) break;
        if (free(i) && !(c === '`' && s.text.includes('${')) && /[a-z]/.test(s.text)) {
          found.push({ start: i + 1, end: s.end, text: s.text, kind: 'call', label: `${m[1]}(…) in ${tagBefore(src, m.index!)}` });
          taken.push([i, s.end + 1]);
        }
        i = s.end;
      }
      i++;
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

export function tokens(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}
