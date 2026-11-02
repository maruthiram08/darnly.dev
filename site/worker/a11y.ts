// Accessibility checker: reads the HTML of one page and runs the checks a machine can do
// reliably (language, headings, alt text, names for links, buttons and form fields, landmarks,
// tabindex, autoplay, zoom and low contrast in inline styles). Plain functions with a tiny HTML
// parser of its own, so they can be tested without a Worker.

export type Level = 'pass' | 'fail' | 'warn' | 'na';
export type Sample = { html: string; note?: string; img?: string; fg?: string; bg?: string; ratio?: string; text?: string };
export type A11yCheck = {
  id: string;
  label: string;
  level: Level;
  weight: number;
  passed: number; // elements that pass (for partial credit)
  total: number; // elements checked
  summary: string; // one plain line: what we found
  who: string; // who it hurts
  fix: string; // one-line fix
  samples: Sample[];
  more: number; // offending elements not shown
  tool?: { href: string; name: string };
};
export type A11yResult = { score: number | null; checks: A11yCheck[]; jsOnly: boolean; prompt: string; counted: number };

// ---------- a tiny HTML parser ----------

type Node = El | string;
export type El = { tag: string; attrs: Record<string, string>; kids: Node[]; parent: El | null; start: number; end: number; open: string };

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'template', 'noscript', 'textarea', 'title']);
// Tags that close an open <p> or <li> etc. when they start, roughly like a browser does.
const AUTO_CLOSE: Record<string, string[]> = {
  li: ['li'],
  p: ['p'],
  option: ['option'],
  tr: ['tr', 'td', 'th'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
};
const BLOCK_CLOSES_P = new Set(['div', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'nav', 'main', 'header', 'footer', 'form', 'table', 'article', 'aside', 'blockquote', 'pre', 'figure']);

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const k = m[1].toLowerCase();
    if (k in out) continue;
    out[k] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

export function parse(html: string): El {
  const root: El = { tag: '#root', attrs: {}, kids: [], parent: null, start: 0, end: html.length, open: '' };
  let cur = root;
  const re = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const text = (s: string) => {
    if (s) cur.kids.push(decode(s));
  };
  const close = (el: El, at: number) => {
    el.end = at;
    cur = el.parent ?? root;
  };
  while ((m = re.exec(html))) {
    text(html.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      // Close back to the matching open tag; stray end tags are ignored.
      let e: El | null = cur;
      while (e && e !== root && e.tag !== tag) e = e.parent;
      if (e && e !== root) {
        let c: El = cur;
        while (c !== e) {
          c.end = m.index;
          c = c.parent!;
        }
        close(e, re.lastIndex);
      }
      continue;
    }
    if (!m[2]) continue; // comment, doctype
    const tag = m[2].toLowerCase();
    const closers = AUTO_CLOSE[tag];
    if (closers && closers.includes(cur.tag)) close(cur, m.index);
    else if (cur.tag === 'p' && BLOCK_CLOSES_P.has(tag)) close(cur, m.index);
    const el: El = { tag, attrs: parseAttrs(m[3] ?? ''), kids: [], parent: cur, start: m.index, end: re.lastIndex, open: m[0] };
    cur.kids.push(el);
    const selfClosing = /\/\s*$/.test(m[3] ?? '') && (tag === 'svg' || cur.tag === 'svg' || inSvg(cur));
    if (VOID.has(tag) || selfClosing) continue;
    if (RAW.has(tag)) {
      const endRe = new RegExp(`</${tag}\\s*>`, 'ig');
      endRe.lastIndex = re.lastIndex;
      const em = endRe.exec(html);
      const stop = em ? em.index : html.length;
      const inner = html.slice(re.lastIndex, stop);
      // Text inside <title> and <textarea> counts as text; scripts and styles don't.
      if (tag === 'title' || tag === 'textarea') el.kids.push(decode(inner));
      else if (tag === 'template' || tag === 'noscript') el.kids.push(''); // skipped by checks
      el.end = em ? em.index + em[0].length : html.length;
      re.lastIndex = last = el.end;
      continue;
    }
    cur = el;
  }
  text(html.slice(last));
  return root;
}

function inSvg(el: El | null): boolean {
  for (let e = el; e; e = e.parent) if (e.tag === 'svg') return true;
  return false;
}

function* walk(el: El, skipHidden = true): Generator<El> {
  for (const k of el.kids) {
    if (typeof k === 'string') continue;
    if (k.tag === 'template' || k.tag === 'noscript' || k.tag === 'script' || k.tag === 'style') continue;
    if (skipHidden && isHidden(k)) continue;
    yield k;
    yield* walk(k, skipHidden);
  }
}

function isHidden(el: El): boolean {
  const a = el.attrs;
  if ('hidden' in a || a['aria-hidden'] === 'true') return true;
  if (el.tag === 'input' && (a.type ?? '').toLowerCase() === 'hidden') return true;
  const st = (a.style ?? '').replace(/\s+/g, '').toLowerCase();
  return st.includes('display:none') || st.includes('visibility:hidden');
}

const find = (root: El, test: (e: El) => boolean) => {
  const out: El[] = [];
  for (const e of walk(root)) if (test(e)) out.push(e);
  return out;
};
const first = (root: El, tag: string) => {
  for (const e of walk(root, false)) if (e.tag === tag) return e;
  return null;
};

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

// The visible text of an element, counting alt text of images and titles of SVG icons inside it.
function textOf(el: El): string {
  let s = '';
  for (const k of el.kids) {
    if (typeof k === 'string') s += k;
    else if (isHidden(k) || k.tag === 'script' || k.tag === 'style' || k.tag === 'template' || k.tag === 'noscript') continue;
    else if (k.tag === 'img' || (k.tag === 'input' && (k.attrs.type ?? '').toLowerCase() === 'image')) s += ' ' + (k.attrs['aria-label'] ?? k.attrs.alt ?? '') + ' ';
    else if (k.tag === 'svg' && k.attrs['aria-label']) s += ' ' + k.attrs['aria-label'] + ' ';
    else if (k.attrs['aria-label']) s += ' ' + k.attrs['aria-label'] + ' ';
    else s += ' ' + textOf(k) + ' ';
  }
  return squash(s);
}

// Accessible name, the simple version of what screen readers do.
function nameOf(el: El, ids: Map<string, El>): string {
  const a = el.attrs;
  if (a['aria-labelledby']) {
    const t = squash(
      a['aria-labelledby']
        .split(/\s+/)
        .map((id) => {
          const target = ids.get(id);
          return target ? (target.attrs['aria-label'] ?? textOf(target)) : '';
        })
        .join(' '),
    );
    if (t) return t;
  }
  if (squash(a['aria-label'] ?? '')) return squash(a['aria-label']);
  const t = textOf(el);
  if (t) return t;
  return squash(a.title ?? '');
}

// The element as it appears in the page source, shortened.
function snippet(el: El, html: string, max = 180): string {
  const full = html.slice(el.start, el.end).replace(/\s+/g, ' ').trim();
  if (full.length <= max) return full;
  const open = el.open.replace(/\s+/g, ' ').trim();
  if (VOID.has(el.tag)) return open.length <= max ? open : open.slice(0, max - 1) + '…';
  const inner = squash(textOf(el)).slice(0, 40);
  const short = `${open.length > max - 20 ? open.slice(0, max - 21) + '…>' : open}${inner ? inner + '…' : '…'}</${el.tag}>`;
  return short;
}

// ---------- colors (same WCAG 2 math as the contrast checker) ----------

type RGB = [number, number, number];
const NAMED: Record<string, RGB> = {
  black: [0, 0, 0], white: [255, 255, 255], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192],
  red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], yellow: [255, 255, 0], orange: [255, 165, 0],
  lightgray: [211, 211, 211], lightgrey: [211, 211, 211], darkgray: [169, 169, 169], darkgrey: [169, 169, 169],
  gainsboro: [220, 220, 220], whitesmoke: [245, 245, 245], navy: [0, 0, 128], purple: [128, 0, 128],
  pink: [255, 192, 203], lime: [0, 255, 0], aqua: [0, 255, 255], cyan: [0, 255, 255], teal: [0, 128, 128],
  maroon: [128, 0, 0], olive: [128, 128, 0], gold: [255, 215, 0], beige: [245, 245, 220], ivory: [255, 255, 240],
};

export function parseColor(raw: string): RGB | null {
  const s = raw.trim().toLowerCase().replace(/\s*!important$/, '');
  if (s in NAMED) return NAMED[s];
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    if (h.length === 8 && parseInt(h.slice(6, 8), 16) < 255) return null; // see-through: can't judge
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = s.match(/^rgba?\((.*)\)$/);
  if (m) {
    const p = m[1].replace(/\s*\/\s*/, ',').split(/\s*,\s*|\s+/).filter(Boolean);
    if (p.length < 3 || p.length > 4) return null;
    if (p[3] !== undefined && parseFloat(p[3]) * (p[3].endsWith('%') ? 0.01 : 1) < 1) return null;
    const v = p.slice(0, 3).map((x) => (x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x)));
    if (v.some((x) => !Number.isFinite(x))) return null;
    return v.map((x) => Math.max(0, Math.min(255, x))) as RGB;
  }
  return null;
}

function luminance([r, g, b]: RGB): number {
  const l = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
}
export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const hex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const showRatio = (r: number) => (Math.floor(r * 100) / 100).toFixed(2).replace(/\.?0+$/, '') + ':1';

function styleOf(el: El): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (el.attrs.style ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

function bgOf(el: El): RGB | null | undefined {
  const st = styleOf(el);
  const v = st['background-color'] ?? st.background;
  if (v === undefined) return undefined;
  if (/url\(|gradient/i.test(v)) return null; // a picture or gradient: can't judge
  const c = parseColor(v.split(/\s+(?![^(]*\))/)[0] ?? v);
  return c;
}

// ---------- the checks ----------

const BTN_INPUTS = new Set(['button', 'submit', 'reset', 'image']);
const NO_LABEL_INPUTS = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
const MAX_SAMPLES = 5;

export function checkA11y(html: string, pageUrl: string): A11yResult {
  const root = parse(html);
  const htmlEl = first(root, 'html');
  const body = first(root, 'body') ?? root;
  const ids = new Map<string, El>();
  for (const e of walk(root, false)) if (e.attrs.id && !ids.has(e.attrs.id)) ids.set(e.attrs.id, e);
  const abs = (u: string) => {
    try {
      const x = new URL(u, pageUrl);
      return x.protocol === 'https:' ? x.href : undefined;
    } catch {
      return undefined;
    }
  };
  const snip = (el: El) => snippet(el, html);
  const role = (e: El) => (e.attrs.role ?? '').toLowerCase();

  // A page that's built entirely by JavaScript has almost nothing in its HTML body.
  const bodyEls = [...walk(body)];
  const bodyText = textOf(body);
  const jsOnly = bodyText.length < 80 && bodyEls.filter((e) => !['div', 'span', 'script', 'link', 'meta'].includes(e.tag)).length < 4;

  const checks: A11yCheck[] = [];
  const add = (c: Omit<A11yCheck, 'more' | 'samples'> & { samples?: Sample[] }) => {
    const samples = c.samples ?? [];
    checks.push({ ...c, samples: samples.slice(0, MAX_SAMPLES), more: Math.max(0, samples.length - MAX_SAMPLES) });
  };

  // 1. Page language
  const lang = squash(htmlEl?.attrs.lang ?? '');
  add({
    id: 'lang',
    label: 'Page language',
    weight: 7,
    level: lang ? 'pass' : 'fail',
    passed: lang ? 1 : 0,
    total: 1,
    summary: lang ? `The page says it’s in “${lang}”.` : 'The page doesn’t say what language it’s in.',
    who: 'Screen readers use it to pick the right voice. Without it, they may read English with a French accent, or the other way round.',
    fix: 'Add lang="en" (or your language) to the <html> tag.',
    samples: lang || !htmlEl ? (htmlEl ? [] : [{ html: '<html>', note: 'No <html> tag at all.' }]) : [{ html: htmlEl.open.slice(0, 180) }],
  });

  // 2. Zoom
  const viewport = [...walk(root, false)].find((e) => e.tag === 'meta' && (e.attrs.name ?? '').toLowerCase() === 'viewport');
  const vp = viewport ? (viewport.attrs.content ?? '').toLowerCase().replace(/\s+/g, '') : '';
  const noScale = /user-scalable=(no|0)(,|;|$)/.test(vp);
  const maxScale = vp.match(/maximum-scale=([\d.]+)/);
  const lowMax = maxScale ? parseFloat(maxScale[1]) < 2 : false;
  const zoomBad = noScale || lowMax;
  add({
    id: 'zoom',
    label: 'Pinch to zoom',
    weight: 10,
    level: zoomBad ? 'fail' : 'pass',
    passed: zoomBad ? 0 : 1,
    total: 1,
    summary: zoomBad
      ? noScale
        ? 'The page stops people from zooming in on phones (user-scalable=no).'
        : `The page stops people from zooming past ${maxScale![1]}× on phones.`
      : 'People can pinch to zoom on phones.',
    who: 'People with low vision zoom in to read. Blocking zoom makes small text impossible for them to read.',
    fix: 'Remove user-scalable=no and maximum-scale from the viewport meta tag.',
    samples: zoomBad && viewport ? [{ html: snip(viewport) }] : [],
  });

  // 3. Images without alt text
  const imgs = find(body, (e) => (e.tag === 'img' && role(e) !== 'presentation' && role(e) !== 'none') || (e.tag === 'input' && (e.attrs.type ?? '').toLowerCase() === 'image'));
  const noAlt = imgs.filter((e) => !('alt' in e.attrs) && !squash(e.attrs['aria-label'] ?? '') && !e.attrs['aria-labelledby']);
  add({
    id: 'alt',
    label: 'Image descriptions (alt text)',
    weight: 10,
    level: imgs.length ? (noAlt.length ? 'fail' : 'pass') : 'na',
    passed: imgs.length - noAlt.length,
    total: imgs.length,
    summary: !imgs.length
      ? 'No images in the page’s HTML.'
      : noAlt.length
        ? `${noAlt.length} of ${imgs.length} image${imgs.length === 1 ? '' : 's'} ${noAlt.length === 1 ? 'has' : 'have'} no alt text.`
        : `All ${imgs.length} image${imgs.length === 1 ? ' has' : 's have'} alt text.`,
    who: 'Blind people hear the file name (“IMG_4521 dot jpg”) or nothing at all. Search engines also read alt text.',
    fix: 'Add alt="what the image shows" to each image, or alt="" if it’s only decoration.',
    samples: noAlt.map((e) => ({ html: snip(e), img: abs(e.attrs.src ?? '') })),
  });

  // 4. Links without a name
  const links = find(body, (e) => (e.tag === 'a' && 'href' in e.attrs) || role(e) === 'link');
  const badLinks = links.filter((e) => !nameOf(e, ids));
  add({
    id: 'link-name',
    label: 'Links people can understand',
    weight: 10,
    level: links.length ? (badLinks.length ? 'fail' : 'pass') : 'na',
    passed: links.length - badLinks.length,
    total: links.length,
    summary: !links.length
      ? 'No links in the page’s HTML.'
      : badLinks.length
        ? `${badLinks.length} of ${links.length} link${links.length === 1 ? '' : 's'} ${badLinks.length === 1 ? 'has' : 'have'} no text a screen reader can read out.`
        : `All ${links.length} links have readable text.`,
    who: 'A screen reader just says “link” for these. Icon links (social icons, logos, arrows) are the usual cause.',
    fix: 'Give icon links an aria-label, like aria-label="Darnly on X".',
    samples: badLinks.map((e) => ({ html: snip(e), note: e.attrs.href ? `Goes to ${e.attrs.href.slice(0, 80)}` : undefined })),
  });

  // 5. Buttons without a name
  const buttons = find(body, (e) => e.tag === 'button' || role(e) === 'button' || (e.tag === 'input' && BTN_INPUTS.has((e.attrs.type ?? '').toLowerCase())));
  const badButtons = buttons.filter((e) => {
    if (e.tag === 'input') {
      const t = (e.attrs.type ?? '').toLowerCase();
      if (t === 'submit' || t === 'reset') return false; // browsers read "Submit" / "Reset"
      if (t === 'image') return !squash(e.attrs.alt ?? '') && !nameOf(e, ids);
      return !squash(e.attrs.value ?? '') && !nameOf(e, ids);
    }
    return !nameOf(e, ids);
  });
  add({
    id: 'button-name',
    label: 'Buttons people can understand',
    weight: 10,
    level: buttons.length ? (badButtons.length ? 'fail' : 'pass') : 'na',
    passed: buttons.length - badButtons.length,
    total: buttons.length,
    summary: !buttons.length
      ? 'No buttons in the page’s HTML.'
      : badButtons.length
        ? `${badButtons.length} of ${buttons.length} button${buttons.length === 1 ? '' : 's'} ${badButtons.length === 1 ? 'has' : 'have'} no name.`
        : `All ${buttons.length} button${buttons.length === 1 ? ' has' : 's have'} a name.`,
    who: 'A screen reader just says “button”, so nobody knows what it does. Icon buttons (menu, close, search) are the usual cause.',
    fix: 'Give icon buttons an aria-label, like aria-label="Open menu".',
    samples: badButtons.map((e) => ({ html: snip(e) })),
  });

  // 6. Form fields without labels
  const fields = find(body, (e) => (e.tag === 'input' && !NO_LABEL_INPUTS.has((e.attrs.type ?? 'text').toLowerCase())) || e.tag === 'select' || e.tag === 'textarea');
  const labelFor = new Set(find(root, (e) => e.tag === 'label' && !!e.attrs.for && !!textOf(e)).map((e) => e.attrs.for));
  const badFields = fields.filter((e) => {
    if (e.attrs.id && labelFor.has(e.attrs.id)) return false;
    for (let p = e.parent; p; p = p.parent) if (p.tag === 'label' && textOf(p)) return false;
    if (squash(e.attrs['aria-label'] ?? '') || squash(e.attrs.title ?? '')) return false;
    if (e.attrs['aria-labelledby'] && nameOf(e, ids)) return false;
    return true;
  });
  add({
    id: 'label',
    label: 'Form fields with labels',
    weight: 10,
    level: fields.length ? (badFields.length ? 'fail' : 'pass') : 'na',
    passed: fields.length - badFields.length,
    total: fields.length,
    summary: !fields.length
      ? 'No form fields in the page’s HTML.'
      : badFields.length
        ? `${badFields.length} of ${fields.length} form field${fields.length === 1 ? '' : 's'} ${badFields.length === 1 ? 'has' : 'have'} no label.`
        : `All ${fields.length} form field${fields.length === 1 ? ' has' : 's have'} a label.`,
    who: 'A screen reader says “edit text, blank”. Placeholder text isn’t a label: it disappears as soon as someone types.',
    fix: 'Add a <label for="id"> to each field, or aria-label="Email" if there’s no room for a visible label.',
    samples: badFields.map((e) => ({ html: snip(e), note: e.attrs.placeholder ? `Only has a placeholder: “${e.attrs.placeholder.slice(0, 60)}”` : undefined })),
  });

  // 7. Headings
  const heads = find(body, (e) => /^h[1-6]$/.test(e.tag) || (role(e) === 'heading' && /^\d$/.test(e.attrs['aria-level'] ?? '')));
  const levelOf = (e: El) => (/^h[1-6]$/.test(e.tag) ? Number(e.tag[1]) : Number(e.attrs['aria-level']));
  const h1s = heads.filter((e) => levelOf(e) === 1);
  const skips: Sample[] = [];
  let prev = 0;
  for (const h of heads) {
    const l = levelOf(h);
    if (prev && l > prev + 1) skips.push({ html: snip(h), note: `Jumps from h${prev} to h${l}.` });
    if (!prev && l > 1 && !h1s.length) skips.push({ html: snip(h), note: `The first heading is an h${l}.` });
    prev = l;
  }
  const headSamples: Sample[] = [];
  if (!h1s.length) headSamples.push({ html: heads[0] ? snip(heads[0]) : '<h1>…</h1>', note: heads.length ? 'There is no h1 on the page.' : 'The page has no headings at all.' });
  if (h1s.length > 1) for (const h of h1s) headSamples.push({ html: snip(h), note: `One of ${h1s.length} h1s.` });
  headSamples.push(...skips.filter((s) => !headSamples.some((x) => x.html === s.html)));
  const headProblems = (h1s.length === 1 ? 0 : 1) + skips.length;
  const headUnknown = jsOnly && !heads.length;
  add({
    id: 'headings',
    label: 'Heading order',
    weight: 5,
    level: headUnknown ? 'na' : headProblems ? 'fail' : 'pass',
    passed: headUnknown ? 0 : Math.max(0, heads.length - skips.length) - (h1s.length === 1 ? 0 : 1),
    total: headUnknown ? 0 : Math.max(1, heads.length),
    summary: headUnknown
      ? 'The headings are added by JavaScript, so we couldn’t check them.'
      : !heads.length
        ? 'The page has no headings.'
        : [
            h1s.length === 1 ? 'One h1' : h1s.length ? `${h1s.length} h1s (there should be one)` : 'No h1',
            skips.length ? `${skips.length} skipped level${skips.length === 1 ? '' : 's'}` : 'no skipped levels',
          ].join(', ') + '.',
    who: 'Screen reader users jump between headings to skim a page, like sighted people skim big text. Skipped levels make it look like something is missing.',
    fix: 'Use exactly one h1 for the page title, then h2 for sections and h3 inside those, without skipping.',
    samples: headUnknown ? [] : headSamples,
  });

  // 8. Landmarks
  const hasMain = find(root, (e) => e.tag === 'main' || role(e) === 'main').length > 0;
  const hasNav = find(root, (e) => e.tag === 'nav' || role(e) === 'navigation').length > 0;
  const needNav = links.length >= 3;
  const landUnknown = jsOnly && !hasMain;
  const landBad = (!hasMain ? 1 : 0) + (needNav && !hasNav ? 1 : 0);
  add({
    id: 'landmarks',
    label: 'Page regions (main, nav)',
    weight: 5,
    level: landUnknown ? 'na' : landBad ? 'fail' : 'pass',
    passed: landUnknown ? 0 : (hasMain ? 1 : 0) + (needNav ? (hasNav ? 1 : 0) : 0),
    total: landUnknown ? 0 : needNav ? 2 : 1,
    summary: landUnknown
      ? 'The page regions are added by JavaScript, so we couldn’t check them.'
      : landBad
        ? `Missing ${[!hasMain && '<main>', needNav && !hasNav && '<nav>'].filter(Boolean).join(' and ')}.`
        : `Has <main>${needNav ? ' and <nav>' : ''}.`,
    who: 'Screen reader users jump straight to the main content or the menu using these. Without them, they have to listen through everything.',
    fix: 'Wrap the page’s main content in <main> and the menu links in <nav>.',
    samples: landUnknown ? [] : [
      ...(!hasMain ? [{ html: '<main>…</main>', note: 'No <main> region.' }] : []),
      ...(needNav && !hasNav ? [{ html: '<nav>…</nav>', note: `No <nav> region, but the page has ${links.length} links.` }] : []),
    ],
  });

  // 9. tabindex > 0
  const tabbed = find(body, (e) => 'tabindex' in e.attrs);
  const badTab = tabbed.filter((e) => parseInt(e.attrs.tabindex, 10) > 0);
  add({
    id: 'tabindex',
    label: 'Keyboard order (tabindex)',
    weight: 4,
    level: badTab.length ? 'fail' : 'pass',
    passed: badTab.length ? 0 : 1,
    total: 1,
    summary: badTab.length ? `${badTab.length} element${badTab.length === 1 ? ' has' : 's have'} a tabindex above 0.` : 'No tabindex above 0.',
    who: 'Keyboard users press Tab to move through a page. A tabindex above 0 makes the cursor jump around in a confusing order.',
    fix: 'Change tabindex to 0 (or remove it) and put elements in the right order in the HTML instead.',
    samples: badTab.map((e) => ({ html: snip(e), note: `tabindex="${e.attrs.tabindex}"` })),
  });

  // 10. Autoplaying media
  const media = find(body, (e) => e.tag === 'video' || e.tag === 'audio');
  const auto = media.filter((e) => 'autoplay' in e.attrs);
  const loud = auto.filter((e) => !('muted' in e.attrs));
  const noStop = auto.filter((e) => 'muted' in e.attrs && !('controls' in e.attrs) && 'loop' in e.attrs);
  add({
    id: 'autoplay',
    label: 'Autoplaying video and sound',
    weight: 4,
    level: !media.length ? 'na' : loud.length ? 'fail' : noStop.length ? 'warn' : 'pass',
    passed: !media.length ? 0 : loud.length ? 0 : noStop.length ? 0.5 : 1,
    total: media.length ? 1 : 0,
    summary: !media.length
      ? 'No video or audio in the page’s HTML.'
      : loud.length
        ? `${loud.length} video or sound clip${loud.length === 1 ? ' plays' : 's play'} with sound on its own.`
        : noStop.length
          ? `${noStop.length} muted video${noStop.length === 1 ? ' loops' : 's loop'} with no way to stop ${noStop.length === 1 ? 'it' : 'them'}.`
          : 'Nothing plays sound on its own.',
    who: 'Sound that starts on its own talks over screen readers. Moving video that can’t be paused distracts people with attention or vestibular conditions.',
    fix: 'Don’t autoplay with sound. For background videos, add muted and a pause button (or controls).',
    samples: [...loud, ...noStop].map((e) => ({ html: snip(e), note: loud.includes(e) ? 'Autoplays with sound.' : 'Muted, loops, no controls.' })),
  });

  // 11. Low contrast in inline styles
  const styled = find(body, (e) => /(^|;)\s*color\s*:/i.test(e.attrs.style ?? ''));
  const contrastBad: Sample[] = [];
  let contrastChecked = 0;
  for (const e of styled) {
    const fg = parseColor(styleOf(e).color ?? '');
    if (!fg) continue;
    const text = squash(textOf(e));
    if (!text) continue;
    let bg: RGB | null | undefined;
    for (let p: El | null = e; p && p.tag !== '#root'; p = p.parent) {
      bg = bgOf(p);
      if (bg !== undefined) break;
    }
    if (!bg) continue; // no inline background, or one we can't judge
    contrastChecked++;
    const st = styleOf(e);
    const px = parseFloat(st['font-size'] ?? '') * (/(r?em)$/.test(st['font-size'] ?? '') ? 16 : 1);
    const bold = /bold|[6-9]00/.test(st['font-weight'] ?? '') || ['b', 'strong', 'h1', 'h2', 'h3'].includes(e.tag);
    const large = px >= 24 || (bold && px >= 18.66) || ['h1', 'h2'].includes(e.tag);
    const ratio = contrast(fg, bg);
    const min = large ? 3 : 4.5;
    if (ratio < min) contrastBad.push({ html: snip(e), fg: hex(fg), bg: hex(bg), ratio: showRatio(ratio), text: text.slice(0, 60), note: `Needs ${min}:1${large ? ' for large text' : ''}.` });
  }
  add({
    id: 'contrast',
    label: 'Text contrast (inline styles)',
    weight: 7,
    level: contrastChecked ? (contrastBad.length ? 'fail' : 'pass') : 'na',
    passed: contrastChecked - contrastBad.length,
    total: contrastChecked,
    summary: !contrastChecked
      ? 'No text with both colors set in the HTML. Colors from stylesheets need the contrast checker.'
      : contrastBad.length
        ? `${contrastBad.length} of ${contrastChecked} text color${contrastChecked === 1 ? '' : 's'} ${contrastBad.length === 1 ? 'is' : 'are'} too faint on ${contrastBad.length === 1 ? 'its' : 'their'} background.`
        : `All ${contrastChecked} text color${contrastChecked === 1 ? '' : 's'} set in the HTML ${contrastChecked === 1 ? 'is' : 'are'} easy to read.`,
    who: 'Light gray text on white is hard to read for people with low vision, older eyes, or anyone on a phone in sunlight.',
    fix: 'Make the text darker (or the background darker for light text) until it reaches 4.5:1.',
    samples: contrastBad,
    tool: { href: '/tools/contrast-checker/', name: 'Contrast checker' },
  });

  // Score: every check that applies counts by its weight, with partial credit for how many
  // elements pass, so one missing alt out of 40 images doesn't sink the score.
  const counted = checks.filter((c) => c.level !== 'na' && c.total > 0);
  const totalW = counted.reduce((s, c) => s + c.weight, 0);
  const got = counted.reduce((s, c) => s + c.weight * Math.max(0, Math.min(1, c.passed / c.total)), 0);
  // A failing check never rounds up to full marks.
  let score = totalW ? Math.round((got / totalW) * 100) : 0;
  if (score === 100 && counted.some((c) => c.level === 'fail' || c.level === 'warn')) score = 99;

  // A page built by JavaScript would score well only because there's nothing to check, so no number.
  return { score: jsOnly ? null : score, checks, jsOnly, prompt: buildPrompt(checks, pageUrl), counted: counted.length };
}

export function buildPrompt(checks: A11yCheck[], pageUrl: string): string {
  const bad = checks.filter((c) => c.level === 'fail' || c.level === 'warn');
  if (!bad.length) return '';
  const lines = [
    `Fix these accessibility problems on ${pageUrl}. An automated check found them in the page's HTML. Find each element in the source code (it may come from a component or a layout, so fix it there once), make the fix, and keep the look the same.`,
    '',
  ];
  bad.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.label}: ${c.summary} Fix: ${c.fix}`);
    for (const s of c.samples) lines.push(`   - ${s.html}${s.note ? ` (${s.note})` : ''}${s.fg ? ` text ${s.fg} on ${s.bg} = ${s.ratio}` : ''}`);
    if (c.more) lines.push(`   - and ${c.more} more like these`);
  });
  lines.push(
    '',
    'For images, write alt text that says what the image shows in context; use alt="" only for pure decoration. For icon links and buttons, use a short aria-label that says what it does. Don\'t add ARIA roles where a plain HTML element (button, nav, main, label) does the job.',
  );
  return lines.join('\n');
}
