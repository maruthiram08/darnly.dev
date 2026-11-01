// DESIGN.md generator: reads a page's HTML and stylesheets and pulls out its design system:
// colors (from colors.ts), fonts (from fonts.ts), plus the type scale, spacing steps, radius,
// shadows, content width, and how its buttons and cards look. Plain functions so they can be
// tested without a Worker. The browser turns the result into a DESIGN.md file.

import { findFonts, type Font } from './fonts';
import { findColors, parseRules, parseColor, toHex, resolveVars, type ColorsResult } from './colors';

type Fetch = (url: string) => Promise<string | null>;
type Rule = ReturnType<typeof parseRules>[number];

export type Size = { px: number; uses: number; role: string | null };
export type Heading = { tag: string; size: number | null; weight: string | null; lineHeight: string | null; letterSpacing: string | null };
export type Component = {
  background: string | null;
  color: string | null;
  border: string | null;
  radius: number | null;
  padding: string | null;
  shadow: string | null;
  fontSize: number | null;
  fontWeight: string | null;
  uses: number;
};
export type DesignResult = {
  colors: ColorsResult;
  fonts: Font[];
  body: { size: number | null; lineHeight: string | null };
  headings: Heading[];
  typeScale: Size[];
  radii: { px: number; uses: number }[];
  spacing: { base: number | null; steps: number[] };
  shadows: string[];
  maxWidth: number | null;
  buttons: Component[];
  card: Component | null;
  sheets: number;
  sheetsFailed: number;
};

const MAX_SHEETS = 12;
const MAX_IMPORTS = 6;
const MAX_ELEMENTS = 400;

export async function findDesign(html: string, base: string, fetchText: Fetch): Promise<DesignResult> {
  // The three readers ask for the same stylesheets; fetch each one once.
  const memo = new Map<string, Promise<string | null>>();
  const once: Fetch = (u) => {
    let p = memo.get(u);
    if (!p) memo.set(u, (p = fetchText(u)));
    return p;
  };
  const [colors, fonts, sheets] = await Promise.all([findColors(html, base, once), findFonts(html, base, once), readSheets(html, base, once)]);
  return { colors, fonts: fonts.fonts, ...analyse(sheets, html), sheets: colors.sheets, sheetsFailed: colors.sheetsFailed };
}

// The same stylesheets the color finder reads: linked, inline <style>, style="" and one level of @import.
async function readSheets(html: string, base: string, fetchText: Fetch): Promise<string[]> {
  const urls: string[] = [];
  const blocks: { css: string; base: string }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel').toLowerCase().split(/\s+/);
    const as = attr(tag, 'as').toLowerCase();
    const href = attr(tag, 'href');
    if (!href || !(rel.includes('stylesheet') || (rel.includes('preload') && as === 'style'))) continue;
    const abs = resolve(href, base);
    if (abs && !/fonts\.(googleapis|bunny)\.|use\.typekit/i.test(abs) && !urls.includes(abs)) urls.push(abs);
  }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) blocks.push({ css: m[1], base });
  const wanted = urls.slice(0, MAX_SHEETS);
  (await Promise.all(wanted.map((u) => fetchText(u)))).forEach((t, i) => t !== null && blocks.push({ css: t, base: wanted[i] }));
  const imports: string[] = [];
  for (const b of blocks) {
    for (const m of stripComments(b.css).matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?[^;]*;/gi)) {
      const abs = resolve(m[1], b.base);
      if (abs && !/fonts\.(googleapis|bunny)\./i.test(abs) && !urls.includes(abs) && !imports.includes(abs)) imports.push(abs);
    }
  }
  const more = imports.slice(0, MAX_IMPORTS);
  (await Promise.all(more.map((u) => fetchText(u)))).forEach((t, i) => t !== null && blocks.push({ css: t, base: more[i] }));
  return blocks.map((b) => b.css);
}

type El = { tag: string; classes: string[]; style: string };

export function analyse(sheets: string[], html: string): Omit<DesignResult, 'colors' | 'fonts' | 'sheets' | 'sheetsFailed'> {
  const rules = sheets.flatMap((css) => parseRules(stripComments(css))).filter((r) => !r.dark);

  // Custom properties, so var(--x) can be read.
  const vars = new Map<string, string>();

  // Elements in the page, for usage counts and for working out how buttons, headings and cards look.
  const els: El[] = [];
  const classCount = new Map<string, number>();
  const tagCount = new Map<string, number>();
  const body = html.replace(/<(script|style|svg|template)\b[\s\S]*?<\/\1>/gi, '');
  for (const m of body.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const tag = m[1].toLowerCase();
    tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
    const classes = attr(m[0], 'class').split(/\s+/).filter(Boolean);
    for (const c of classes) classCount.set(c, (classCount.get(c) ?? 0) + 1);
    if (els.length < MAX_ELEMENTS * 4) els.push({ tag, classes, style: attr(m[0], 'style') });
  }

  // Custom properties set for the whole page (on :root, html, body or their classes), so var(--x) can
  // be read. Ones set by utility classes (.leading-8 { --tw-leading: … }) only count on that element.
  // "initial" means "not set", so var(--x, fallback) uses the fallback (Tailwind v4 relies on this).
  const rootClasses = els.filter((e) => e.tag === 'html' || e.tag === 'body').flatMap((e) => e.classes);
  const isRoot = (sel: string) =>
    splitTop(sel).some((p) => {
      const t = p.trim();
      return /^(:root|html|body|:host|\*|\[data-[\w-]+(=[^\]]*)?\])/i.test(t) || rootClasses.some((c) => t === `.${c}` || t.startsWith(`.${c} `));
    });
  for (const r of rules) {
    if (!isRoot(r.selector)) continue;
    for (const [k, v] of r.decls) if (k.startsWith('--') && v.length < 300 && v !== 'initial' && !vars.has(k)) vars.set(k, v);
  }

  // Rules whose target is one simple element (".btn", "button", ".px-4", "a.cta", ".hero h1"), in
  // source order. Rules with ancestors (".hero h1") only count when those ancestors are on the page.
  type Simple = { tag: string | null; classes: string[]; decls: [string, string][]; order: number; spec: number; deep: boolean };
  const compound = (c: string) => {
    const m = c.match(/^([a-z][a-z0-9-]*)?((?:\.(?:\\.|[\w-])+)*)$/i);
    if (!m || (!m[1] && !m[2])) return null;
    return { tag: m[1]?.toLowerCase() ?? null, classes: [...m[2].matchAll(/\.((?:\\.|[\w-])+)/g)].map((x) => x[1].replace(/\\(.)/g, '$1')) };
  };
  const simple: Simple[] = [];
  rules.forEach((r, order) => {
    for (const part of splitTop(r.selector)) {
      const parts = part.trim().replace(/^:where\((.+)\)$/, '$1').split(/\s*[\s>]\s*/).filter(Boolean);
      const subject = compound(parts.pop() ?? '');
      if (!subject) continue;
      let spec = subject.classes.length * 10 + (subject.tag ? 1 : 0);
      let ok = true;
      for (const a of parts) {
        if (/^(:root|html|body)$/i.test(a)) continue;
        const c = compound(a);
        if (!c || !c.classes.every((x) => classCount.has(x)) || (c.tag && !tagCount.has(c.tag))) {
          ok = false;
          break;
        }
        spec += c.classes.length * 10 + (c.tag ? 1 : 0);
      }
      if (ok) simple.push({ ...subject, decls: r.decls, order, spec, deep: parts.length > 0 });
    }
  });
  const byClass = new Map<string, Simple[]>();
  const byTag = new Map<string, Simple[]>();
  for (const s of simple) {
    const key = s.classes[0];
    const map = key ? byClass : byTag;
    const k = key ?? s.tag!;
    map.set(k, [...(map.get(k) ?? []), s]);
  }

  // The declarations that apply to one element, in cascade order (close enough for a style guide).
  // deep also counts rules with ancestors, which is right for headings but too loose for buttons.
  const styleOf = (e: El, deep = false): Map<string, string> => {
    const hits = [...(byTag.get(e.tag) ?? [])];
    for (const c of e.classes) for (const s of byClass.get(c) ?? []) if (!hits.includes(s)) hits.push(s);
    const ok = hits.filter((s) => (deep || !s.deep) && (!s.tag || s.tag === e.tag) && s.classes.every((c) => e.classes.includes(c)));
    ok.sort((a, b) => a.spec - b.spec || a.order - b.order);
    const out = new Map<string, string>();
    for (const s of ok) for (const [k, v] of s.decls) out.set(k, v);
    if (e.style) for (const d of e.style.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out.set(d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).replace(/!important/i, '').trim());
    }
    // Resolve variables with the element's own ones on top (Tailwind sets --tw-* per class).
    const local = new Map(vars);
    for (const [k, v] of out) if (k.startsWith('--') && v !== 'initial') local.set(k, v);
    for (const [k, v] of out) if (!k.startsWith('--')) out.set(k, resolveVars(v, local).trim());
    expandFont(out);
    return out;
  };

  // The root font size, for rem values (some sites set html { font-size: 62.5% }).
  const htmlEl = els.find((e) => e.tag === 'html') ?? { tag: 'html', classes: [], style: '' };
  const rootSize = styleOf(htmlEl).get('font-size') ?? '';
  const rem = /%$/.test(rootSize) ? (16 * parseFloat(rootSize)) / 100 : /px$/.test(rootSize) ? parseFloat(rootSize) : 16;
  const px = (v: string | undefined | null) => (v ? toPx(v, rem) : null);

  const weightOf = (selector: string): number => {
    let w = 0;
    for (const part of splitTop(selector)) {
      const compounds = part.trim().split(/\s*[\s>+~]\s*/).filter(Boolean);
      const subject = compounds[compounds.length - 1];
      if (!subject) continue;
      if (/^(:root|html|body)\b/i.test(subject)) {
        w += 25;
        continue;
      }
      if (/:(hover|focus|active|visited|focus-visible|focus-within|disabled)/.test(subject)) continue;
      let n = Infinity;
      for (const c of compounds) {
        if (/^(:root|html|body)\b/i.test(c) || c === '*') continue;
        const classes = [...c.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
        const tag = c.match(/^([a-z][a-z0-9-]*)/i)?.[1].toLowerCase();
        if (classes.length) n = Math.min(n, ...classes.map((x) => classCount.get(x) ?? 0));
        else if (tag) n = Math.min(n, tagCount.get(tag) ?? 0);
      }
      w += n === Infinity ? 0.5 : Math.max(0.2, Math.min(n, 40));
    }
    return Math.min(w, 200);
  };

  // 1. Body text and headings, from the real elements.
  const bodyEl = els.find((e) => e.tag === 'body') ?? { tag: 'body', classes: [], style: '' };
  const bodyStyle = new Map([...styleOf(htmlEl), ...styleOf(bodyEl, true)]);
  // Without a size anywhere, browsers use 16px (times the root size change, if any).
  const bodySize = px(bodyStyle.get('font-size')) ?? rem;
  const bodyLh = lineHeight(bodyStyle.get('line-height'), bodySize, rem);

  const headings: Heading[] = [];
  for (const tag of ['h1', 'h2', 'h3']) {
    const e = els.find((x) => x.tag === tag);
    if (!e) continue;
    const s = styleOf(e, true);
    const size = px(s.get('font-size'));
    const weight = fontWeight(s.get('font-weight'));
    if (size === null && weight === null) continue;
    const ls = s.get('letter-spacing');
    headings.push({
      tag,
      size: size !== null && size >= 8 && size <= 160 ? round(size) : null,
      weight,
      lineHeight: lineHeight(s.get('line-height'), size, rem),
      letterSpacing: ls && /^-?[\d.]+(em|px|rem)$/.test(ls) && parseFloat(ls) !== 0 ? ls.replace(/^(-?)\./, '$10.') : null,
    });
  }

  // 2. Counts across every rule: font sizes, radius, spacing, shadows, content width.
  const sizes = new Map<number, number>();
  const radii = new Map<number, number>();
  const space = new Map<number, number>();
  const shadows = new Map<string, number>();
  const widths = new Map<number, number>();
  const add = <K>(m: Map<K, number>, k: K, w: number) => m.set(k, (m.get(k) ?? 0) + w);

  for (const r of rules) {
    const w = weightOf(r.selector);
    if (!w) continue;
    const own = r.decls.filter(([k, v]) => k.startsWith('--') && v !== 'initial');
    const local = own.length ? new Map([...vars, ...own]) : vars;
    const d = new Map(r.decls.map(([k, v]) => [k, k.startsWith('--') ? v : resolveVars(v, local).trim()]));
    expandFont(d);
    for (const [prop, v] of d) {
      if (prop === 'font-size') {
        const n = px(v);
        if (n !== null && n >= 10 && n <= 120) add(sizes, round(n), w);
      } else if (prop === 'border-radius') {
        const n = px(v.split(/\s+/)[0]);
        if (n !== null && n > 0 && !/%/.test(v)) add(radii, n >= 500 ? 9999 : round(n), w);
      } else if (/^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/.test(prop)) {
        for (const t of splitSpace(v)) {
          const n = px(t);
          if (n !== null && Math.abs(n) >= 2 && Math.abs(n) <= 160) add(space, round(Math.abs(n)), w * (prop.startsWith('margin') ? 0.6 : 1));
        }
      } else if (prop === 'box-shadow') {
        const s = cleanShadow(v);
        if (s) add(shadows, s, w);
      } else if (prop === 'max-width') {
        const n = px(v);
        if (n !== null && n >= 560 && n <= 2400) add(widths, Math.round(n), w * (/container|wrap|content|main|page|max-w/i.test(r.selector) ? 3 : 1));
      }
    }
  }

  const ranked = <K>(m: Map<K, number>) => [...m].sort((a, b) => b[1] - a[1]);

  // Type scale: the most used sizes, merged when within half a pixel, biggest first.
  const scale: Size[] = [];
  for (const [n, uses] of ranked(sizes)) {
    const near = scale.find((s) => Math.abs(s.px - n) < 0.75);
    if (near) near.uses += uses;
    else scale.push({ px: n, uses, role: null });
    if (scale.length >= 8) break;
  }
  scale.sort((a, b) => b.px - a.px);
  for (const h of headings) {
    const s = scale.find((x) => h.size !== null && Math.abs(x.px - h.size) < 0.75);
    if (s && !s.role) s.role = h.tag;
    else if (h.size !== null && !s) scale.push({ px: h.size, uses: 1, role: h.tag });
  }
  if (bodySize !== null) {
    const s = scale.find((x) => Math.abs(x.px - bodySize) < 0.75);
    if (s) s.role = s.role ? `body, ${s.role}` : 'body';
    else scale.push({ px: round(bodySize), uses: 1, role: 'body' });
  }
  scale.sort((a, b) => b.px - a.px);

  // Radius: the few values that matter, smallest first.
  const radiusList = ranked(radii).slice(0, 5).map(([n, uses]) => ({ px: n, uses: Math.max(1, Math.round(uses)) })).sort((a, b) => a.px - b.px);

  // Spacing: which grid most values sit on, and the common steps.
  let total = 0;
  let on4 = 0;
  let on8 = 0;
  for (const [n, w] of space) {
    total += w;
    if (n % 4 === 0) on4 += w;
    if (n % 8 === 0) on8 += w;
  }
  const top = ranked(space)
    .slice(0, 10)
    .map(([n]) => n);
  const allOn = (k: number) => top.every((n) => n % k === 0);
  const baseUnit = total < 3 || !top.length ? null : allOn(8) ? 8 : allOn(4) || on4 / total >= 0.7 ? 4 : null;
  // With a grid, list only the steps on it: a style guide should say what to use, not every one-off.
  const steps = (baseUnit ? ranked(space).map(([n]) => n).filter((n) => n % baseUnit === 0).slice(0, 9) : top).sort((a, b) => a - b);

  const shadowList = ranked(shadows)
    .slice(0, 3)
    .map(([s]) => s);
  const maxWidth = ranked(widths)[0]?.[0] ?? null;

  // 3. Buttons and cards, from the elements that use them.
  const comp = (s: Map<string, string>, uses = 1): Component => {
    const bg = colorOf(s.get('background-color') ?? s.get('background'));
    const pad = padding(s, px);
    const border = s.get('border') ?? (s.get('border-width') ? `${s.get('border-width')} ${s.get('border-style') ?? 'solid'} ${s.get('border-color') ?? 'currentColor'}` : null);
    const borderColor = border ? colorOf(border) : null;
    const bw = border ? px(border.split(/\s+/)[0]) : null;
    return {
      background: bg,
      color: colorOf(s.get('color')),
      border: border && bw && bw > 0 && !/none/.test(border) ? `${round(bw)}px solid ${borderColor ?? 'currentColor'}` : null,
      radius: (() => {
        const v = s.get('border-radius');
        if (!v) return null;
        if (/%/.test(v)) return null;
        const n = px(v.split(/\s+/)[0]);
        return n === null ? null : n >= 500 ? 9999 : round(n);
      })(),
      padding: pad,
      shadow: s.get('box-shadow') ? cleanShadow(s.get('box-shadow')!) : null,
      fontSize: (() => {
        const n = px(s.get('font-size'));
        return n !== null && n >= 8 && n <= 60 ? round(n) : null;
      })(),
      fontWeight: fontWeight(s.get('font-weight')),
      uses,
    };
  };
  const sig = (c: Component) => [c.background, c.color, c.border, c.radius, c.padding].join('|');
  const tally = (list: Component[]) => {
    const m = new Map<string, Component>();
    for (const c of list) {
      const k = sig(c);
      const had = m.get(k);
      if (had) had.uses++;
      else m.set(k, { ...c });
    }
    return [...m.values()].sort((a, b) => b.uses - a.uses);
  };

  const buttonEls = els
    .filter(
      (e) =>
        e.tag === 'button' ||
        (e.tag === 'a' && e.classes.some((c) => /btn|button|cta/i.test(c))) ||
        (e.tag === 'a' && e.classes.some((c) => /^(bg-|rounded|px-|py-|p-)/.test(c))),
    )
    .slice(0, MAX_ELEMENTS);
  const buttonList = tally(
    buttonEls
      .map((e) => comp(styleOf(e)))
      .filter((c) => (c.background && c.background !== 'transparent') || c.border)
      .filter((c) => c.padding || c.radius !== null),
  );
  const isAccentBg = (c: Component) => !!c.background && isSaturated(c.background);
  const primary = buttonList.find(isAccentBg) ?? buttonList.find((c) => c.background && c.background !== 'transparent') ?? buttonList[0];
  const secondary = buttonList.find((c) => c !== primary && c.background !== primary?.background);
  const buttons = [primary, secondary].filter(Boolean) as Component[];

  const cardEls = els
    .filter((e) => ['div', 'article', 'section', 'li', 'a', 'aside'].includes(e.tag) && e.classes.length)
    .slice(0, MAX_ELEMENTS * 2);
  const cardList = tally(
    cardEls
      .map((e) => ({ e, c: comp(styleOf(e)) }))
      .filter(({ e, c }) => (c.border || c.shadow || /card|panel|tile/i.test(e.classes.join(' '))) && (c.radius ?? 0) > 0 && c.radius !== 9999 && !!c.padding)
      .map(({ c }) => c),
  );
  const card = cardList[0] ?? null;

  return {
    body: { size: bodySize !== null ? round(bodySize) : null, lineHeight: bodyLh },
    headings,
    typeScale: scale.map((s) => ({ ...s, uses: Math.max(1, Math.round(s.uses)) })),
    radii: radiusList,
    spacing: { base: baseUnit, steps },
    shadows: shadowList,
    maxWidth,
    buttons,
    card,
  };
}

// "font: 600 16px/1.5 Inter" fills in font-size, line-height and font-weight when they're missing.
function expandFont(d: Map<string, string>) {
  const f = d.get('font');
  if (!f) return;
  const m = f.match(/(?:^|\s)((?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|pt))(?:\s*\/\s*([\d.a-z%]+))?\s+\S/i);
  if (!m) return;
  if (!d.has('font-size')) d.set('font-size', m[1]);
  if (m[2] && !d.has('line-height')) d.set('line-height', m[2]);
  const w = f.match(/(?:^|\s)(bold|bolder|lighter|[1-9]00)(?=\s)/i);
  if (w && !d.has('font-weight')) d.set('font-weight', w[1]);
}

// Lengths in pixels: 12px, 0.75rem, calc(0.25rem * 4), clamp(2rem, 5vw, 3rem) (the largest), min(1200px, 100%).
export function toPx(raw: string, rem = 16): number | null {
  const v = raw.trim().toLowerCase();
  const fn = v.match(/^(clamp|min|max)\((.*)\)$/);
  if (fn) {
    const args = splitTop(fn[2]).map((a) => toPx(a, rem));
    const nums = args.filter((x): x is number => x !== null);
    if (!nums.length) return null;
    return fn[1] === 'clamp' ? (args[2] ?? Math.max(...nums)) : fn[1] === 'min' ? Math.min(...nums) : Math.max(...nums);
  }
  const calc = v.match(/^calc\(\s*(.+?)\s*([*/])\s*(.+?)\s*\)$/);
  if (calc) {
    const a = toPx(calc[1], rem) ?? (isNum(calc[1]) ? null : NaN);
    const b = toPx(calc[3], rem) ?? (isNum(calc[3]) ? null : NaN);
    const an = a ?? parseFloat(calc[1]);
    const bn = b ?? parseFloat(calc[3]);
    if (Number.isNaN(an) || Number.isNaN(bn)) return null;
    if (a === null && b === null) return null; // a plain number, not a length
    if (calc[2] === '*') return an * bn;
    return b === null && bn !== 0 ? an / bn : null;
  }
  const m = v.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rem|em|pt)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!m[2]) return n === 0 ? 0 : null;
  return m[2] === 'px' ? n : m[2] === 'pt' ? (n * 4) / 3 : n * rem;
}

const isNum = (s: string) => /^-?(\d+(\.\d+)?|\.\d+)$/.test(s.trim());
const round = (n: number) => Math.round(n * 2) / 2;

// Line height as written for a style guide: 1.5, or 24px.
function lineHeight(v: string | undefined, size: number | null, rem: number): string | null {
  if (!v) return null;
  const t = v.trim();
  const calc = t.match(/^calc\(\s*([\d.]+)\s*\/\s*([\d.]+)\s*\)$/);
  if (calc) return String(Math.round((parseFloat(calc[1]) / parseFloat(calc[2])) * 100) / 100);
  if (isNum(t)) return String(Math.round(parseFloat(t) * 100) / 100);
  if (/^[\d.]+%$/.test(t)) return String(Math.round(parseFloat(t)) / 100);
  if (t === 'normal') return null;
  const n = toPx(t, rem);
  if (n === null) return null;
  return size ? String(Math.round((n / size) * 100) / 100) : `${round(n)}px`;
}

function fontWeight(v: string | undefined): string | null {
  if (!v) return null;
  const named: Record<string, string> = { normal: '400', bold: '700' };
  const w = named[v.trim().toLowerCase()] ?? v.trim();
  return /^[1-9]00$/.test(w) ? w : null;
}

function padding(s: Map<string, string>, px: (v: string | undefined) => number | null): string | null {
  const one = (v: string | undefined) => {
    const n = px(v);
    return n === null ? null : round(n);
  };
  let top: number | null = null;
  let right: number | null = null;
  const p = s.get('padding');
  if (p) {
    const parts = splitSpace(p).map((x) => one(x));
    top = parts[0] ?? null;
    right = parts[1] ?? parts[0] ?? null;
  }
  const block = s.get('padding-block') ?? s.get('padding-top');
  const inline = s.get('padding-inline') ?? s.get('padding-left') ?? s.get('padding-right');
  if (block) top = one(splitSpace(block)[0]);
  if (inline) right = one(splitSpace(inline)[0]);
  if (top === null && right === null) return null;
  if (!top && !right) return null;
  return top === right || right === null ? `${top ?? 0}px` : `${top ?? 0}px ${right}px`;
}

function colorOf(v: string | undefined | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (/^(none|transparent|inherit|currentcolor)$/i.test(t)) return t.toLowerCase() === 'currentcolor' ? null : 'transparent';
  for (const m of t.matchAll(/(?:rgba?|hsla?|oklch|oklab|color)\([^()]*\)|#[0-9a-f]{3,8}\b|\b[a-z]{3,20}\b/gi)) {
    const c = parseColor(m[0]);
    if (!c) continue;
    if (c[3] < 0.35) return 'transparent';
    return toHex(c);
  }
  return null;
}

function isSaturated(hex: string): boolean {
  const c = parseColor(hex);
  if (!c) return false;
  const [r, g, b] = c;
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return s >= 0.35 && l >= 0.18 && l <= 0.85;
}

// Drops Tailwind's empty ring layers ("0 0 #0000") and anything left unresolved.
function cleanShadow(v: string): string | null {
  const parts = splitTop(v)
    .map((p) => p.trim())
    .filter((p) => p && !/^none$/i.test(p) && !/var\(/.test(p) && !/^(0(px)?\s+){1,3}(#0000|transparent|rgba?\(0,? ?0,? ?0,? ?0\))$/i.test(p) && !/^0 0 (#0000|transparent)$/i.test(p))
    .filter((p) => /\d/.test(p));
  if (!parts.length) return null;
  const out = parts.join(', ').replace(/\s+/g, ' ');
  return out.length > 200 ? null : out;
}

// Splits on top-level commas: "a, rgb(1,2,3), b" -> three parts.
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// Splits on top-level spaces: "calc(1rem * 2) 8px" -> two parts.
function splitSpace(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&') : '';
}

function resolve(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
