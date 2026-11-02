// A small SVG optimizer that runs in the browser with DOMParser.
// svgo's browser build is ~195 KB gzipped, so this covers the safe wins that matter for icons and logos:
// editor junk, comments, metadata, default values, unused ids, empty groups, number rounding and compact paths.

export type Options = {
  precision: number; // decimals kept in numbers
  responsive: boolean; // drop width/height, keep viewBox
  currentColor: boolean; // fills and strokes follow the text color
};

const SVG_NS = 'http://www.w3.org/2000/svg';

// Namespaces that design tools add and browsers ignore.
const EDITOR_NS = [
  'http://www.inkscape.org/namespaces/inkscape',
  'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd',
  'http://inkscape.sourceforge.net/DTD/sodipodi-0.dtd',
  'http://ns.adobe.com/AdobeIllustrator/10.0/',
  'http://ns.adobe.com/Graphs/1.0/',
  'http://ns.adobe.com/AdobeSVGViewerExtensions/3.0/',
  'http://ns.adobe.com/Variables/1.0/',
  'http://ns.adobe.com/SaveForWeb/1.0/',
  'http://ns.adobe.com/Extensibility/1.0/',
  'http://ns.adobe.com/Flows/1.0/',
  'http://ns.adobe.com/ImageReplacement/1.0/',
  'http://ns.adobe.com/GenericCustomNamespace/1.0/',
  'http://ns.adobe.com/XPath/1.0/',
  'http://schemas.microsoft.com/visio/2003/SVGExtensions/',
  'http://taptrix.com/vectorillustrator/svg_extensions',
  'http://www.figma.com/figma/ns',
  'http://purl.org/dc/elements/1.1/',
  'http://creativecommons.org/ns#',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  'http://www.serif.com/',
  'http://www.vector.evaxdesign.sk',
  'http://www.bohemiancoding.com/sketch/ns',
];

// Presentation attributes and their default values. Removed only when no ancestor sets them (they inherit).
const DEFAULTS: Record<string, string[]> = {
  'fill-opacity': ['1'],
  'stroke-opacity': ['1'],
  opacity: ['1'],
  'stroke-width': ['1'],
  'stroke-miterlimit': ['4'],
  'stroke-dasharray': ['none'],
  'stroke-dashoffset': ['0'],
  'stroke-linecap': ['butt'],
  'stroke-linejoin': ['miter'],
  'fill-rule': ['nonzero'],
  'clip-rule': ['nonzero'],
  stroke: ['none'],
  fill: ['#000', '#000000', 'black'],
  visibility: ['visible'],
  display: ['inline'],
  'font-style': ['normal'],
  'font-weight': ['normal', '400'],
};
const NOT_INHERITED = new Set(['opacity', 'display']);

const NUMERIC_ATTRS = new Set([
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height',
  'stroke-width', 'stroke-dashoffset', 'offset', 'font-size', 'dx', 'dy', 'refX', 'refY',
  'markerWidth', 'markerHeight', 'opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity',
]);
const LIST_ATTRS = new Set(['viewBox', 'points', 'stroke-dasharray']);
const COLOR_ATTRS = new Set(['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color']);
const KEEP_TEXT = new Set(['text', 'tspan', 'textPath', 'style', 'title', 'desc', 'script']);

const NUM_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

export function fmt(n: number, precision: number): string {
  if (!Number.isFinite(n)) return '0';
  const k = 10 ** precision;
  let r = Math.round(n * k) / k;
  if (Object.is(r, -0)) r = 0;
  let s = String(r);
  if (s.includes('e')) s = r.toFixed(precision).replace(/\.?0+$/, '');
  return s.replace(/^(-?)0\./, '$1.');
}

// Join numbers with the fewest separators: "-" and a second "." start a new number by themselves.
function joinNums(nums: string[]): string {
  let out = '';
  let prev = '';
  for (const n of nums) {
    if (prev && !(n.startsWith('-') || (n.startsWith('.') && /[.eE]/.test(prev)))) out += ' ';
    out += n;
    prev = n;
  }
  return out;
}

const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

// Rewrites a path's d with rounded numbers, no extra spaces and no repeated command letters.
export function compactPath(d: string, precision: number): string {
  const segs: { cmd: string; args: number[] }[] = [];
  let i = 0;
  const len = d.length;
  const skip = () => {
    while (i < len && /[\s,]/.test(d[i])) i++;
  };
  const readNum = (): number | null => {
    skip();
    NUM_RE.lastIndex = i;
    const m = NUM_RE.exec(d);
    if (!m || m.index !== i) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const readFlag = (): number | null => {
    skip();
    if (d[i] === '0' || d[i] === '1') return Number(d[i++]);
    return null;
  };
  let cmd = '';
  while (true) {
    skip();
    if (i >= len) break;
    const c = d[i];
    if (/[a-zA-Z]/.test(c)) {
      if (!(c.toLowerCase() in ARITY)) throw new Error('bad path');
      cmd = c;
      i++;
      if (cmd.toLowerCase() === 'z') {
        segs.push({ cmd, args: [] });
        continue;
      }
    } else if (!cmd || cmd.toLowerCase() === 'z') {
      throw new Error('bad path');
    }
    const n = ARITY[cmd.toLowerCase()];
    // read one or more groups of arguments for this command
    let first = true;
    while (true) {
      const args: number[] = [];
      for (let k = 0; k < n; k++) {
        const v = cmd.toLowerCase() === 'a' && (k === 3 || k === 4) ? readFlag() : readNum();
        if (v === null) {
          if (k === 0 && !first) break;
          throw new Error('bad path');
        }
        args.push(v);
      }
      if (args.length < n) break;
      segs.push({ cmd: first ? cmd : cmd === 'M' ? 'L' : cmd === 'm' ? 'l' : cmd, args });
      first = false;
      skip();
      if (i >= len || /[a-zA-Z]/.test(d[i])) break;
    }
  }
  let out = '';
  let prevCmd = '';
  let prevTail = '';
  for (const s of segs) {
    const implicit =
      s.cmd !== 'M' && s.cmd !== 'm' && s.cmd.toLowerCase() !== 'z' &&
      (s.cmd === prevCmd || (prevCmd === 'M' && s.cmd === 'L') || (prevCmd === 'm' && s.cmd === 'l'));
    const nums = s.args.map((v, k) =>
      s.cmd.toLowerCase() === 'a' && (k === 3 || k === 4) ? String(v) : fmt(v, precision),
    );
    if (implicit) {
      const body = joinNums([prevTail, ...nums]).slice(prevTail.length);
      out += body;
    } else {
      out += s.cmd + joinNums(nums);
    }
    prevCmd = s.cmd;
    prevTail = nums.length ? nums[nums.length - 1] : '';
  }
  return out;
}

function roundList(v: string, precision: number): string {
  const nums = v.match(NUM_RE);
  if (!nums || v.replace(NUM_RE, '').replace(/[\s,]/g, '') !== '') return v.trim();
  return nums.map((n) => fmt(Number(n), precision)).join(' ');
}

function roundNumber(v: string, precision: number): string {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(px)?\s*$/.exec(v);
  return m ? fmt(Number(m[1]), precision) : v.trim();
}

function roundTransform(v: string, precision: number): string {
  return v
    .replace(NUM_RE, (n) => fmt(Number(n), Math.max(precision, 3)))
    .replace(/\s*,\s*|\s+/g, ' ')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)\s*/g, ')')
    .trim();
}

const NAMED: Record<string, string> = { white: '#fff', black: '#000', red: 'red', none: 'none' };

export function shortColor(v: string): string {
  let s = v.trim();
  const low = s.toLowerCase();
  if (low in NAMED) return NAMED[low];
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(s);
  if (rgb) s = '#' + rgb.slice(1, 4).map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('');
  if (/^#[0-9a-f]{6}$/i.test(s)) {
    s = s.toLowerCase();
    if (s[1] === s[2] && s[3] === s[4] && s[5] === s[6]) s = `#${s[1]}${s[3]}${s[5]}`;
    return s;
  }
  if (/^#[0-9a-f]{3}$/i.test(s)) return s.toLowerCase();
  return s;
}

function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

function parseStyle(style: string): [string, string][] {
  return style
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const k = d.indexOf(':');
      return k < 0 ? null : ([d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()] as [string, string]);
    })
    .filter((x): x is [string, string] => !!x && !!x[0] && !!x[1]);
}

function isColorValue(v: string): boolean {
  const low = v.trim().toLowerCase();
  return low !== 'none' && low !== 'currentcolor' && low !== 'transparent' && low !== 'inherit' && !low.startsWith('url(');
}

function ancestorSets(el: Element, name: string): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.hasAttribute(name)) return true;
    const st = p.getAttribute('style');
    if (st && parseStyle(st).some(([k]) => k === name)) return true;
  }
  return false;
}

export type Result = { svg: string; root: Element };

export function parse(text: string): Document {
  const doc = new DOMParser().parseFromString(text.trim().replace(/^\uFEFF/, ''), 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('That doesn’t look like a valid SVG. Check that it starts with <svg and that every tag is closed.');
  if (doc.documentElement.localName !== 'svg') throw new Error('That isn’t an SVG. It should start with <svg.');
  return doc;
}

export function optimize(text: string, opts: Options): Result {
  const doc = parse(text);
  const root = doc.documentElement;
  const hasStyleSheet = root.getElementsByTagName('style').length > 0;

  // 1. Remove comments and editor-only elements.
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_PROCESSING_INSTRUCTION);
  const dead: Node[] = [];
  while (walker.nextNode()) dead.push(walker.currentNode);
  for (const el of root.querySelectorAll('*')) {
    const ns = el.namespaceURI ?? '';
    if (EDITOR_NS.includes(ns) || el.localName === 'metadata') dead.push(el);
    else if (ns === SVG_NS && el.localName === 'desc' && !el.textContent?.trim()) dead.push(el);
    else if (ns === SVG_NS && el.localName === 'title' && !el.textContent?.trim()) dead.push(el);
  }
  for (const n of dead) n.parentNode?.removeChild(n);

  // 2. Which ids are used (url(#id), href="#id", or #id in a <style>)?
  const used = new Set<string>();
  const styleText = [...root.getElementsByTagName('style')].map((s) => s.textContent ?? '').join('\n');
  const all = [root, ...root.querySelectorAll('*')];
  for (const el of all) {
    for (const a of [...el.attributes]) {
      for (const m of a.value.matchAll(/url\(\s*['"]?#([^'")\s]+)/g)) used.add(decodeURIComponent(m[1]));
      if ((a.localName === 'href') && a.value.startsWith('#')) used.add(decodeURIComponent(a.value.slice(1)));
      if (a.localName === 'begin' || a.localName === 'end') for (const m of a.value.matchAll(/([\w-]+)\./g)) used.add(m[1]);
    }
  }
  for (const m of styleText.matchAll(/#([\w-]+)/g)) used.add(m[1]);
  for (const m of styleText.matchAll(/url\(\s*['"]?#([^'")\s]+)/g)) used.add(m[1]);

  // 3. Clean attributes on every element.
  for (const el of all) {
    const isRoot = el === root;
    for (const a of [...el.attributes]) {
      const ns = a.namespaceURI ?? '';
      const name = a.name;
      if (EDITOR_NS.includes(ns)) { el.removeAttributeNode(a); continue; }
      if (name.startsWith('xmlns:')) {
        if (EDITOR_NS.includes(a.value)) el.removeAttributeNode(a);
        continue;
      }
      if (name === 'xmlns') continue;
      if (name === 'id' && !used.has(a.value) && el.localName !== 'symbol') { el.removeAttribute('id'); continue; }
      if (['version', 'xml:space', 'enable-background', 'baseProfile', 'data-name'].includes(name) ||
          (isRoot && ['x', 'y'].includes(name) && /^0(px)?$/.test(a.value.trim()))) {
        el.removeAttributeNode(a);
        continue;
      }
      if (name === 'style') {
        const decl = parseStyle(a.value);
        const keep: string[] = [];
        for (const [k, v] of decl) {
          // Move simple presentation properties to attributes; they are shorter and easier to read in JSX.
          if (!hasStyleSheet && (k in DEFAULTS || COLOR_ATTRS.has(k) || NUMERIC_ATTRS.has(k)) && !el.hasAttribute(k) && !v.includes('!important') && /^[\w#.%(),\s-]+$/.test(v)) {
            el.setAttribute(k, v);
          } else keep.push(`${k}:${v.replace(/\s+/g, ' ')}`);
        }
        if (keep.length) el.setAttribute('style', keep.join(';'));
        else el.removeAttribute('style');
        continue;
      }
      if (name === 'class') {
        const v = a.value.trim().replace(/\s+/g, ' ');
        if (v) el.setAttribute('class', v); else el.removeAttribute('class');
        continue;
      }
    }
    // second pass on the now-final attribute set
    for (const a of [...el.attributes]) {
      const name = a.name;
      let v = a.value;
      if (name === 'd' && el.localName === 'path') {
        try { v = compactPath(v, opts.precision); } catch { v = v.trim(); }
      } else if (name === 'transform' || name === 'gradientTransform' || name === 'patternTransform') {
        v = roundTransform(v, opts.precision);
      } else if (LIST_ATTRS.has(name)) {
        v = roundList(v, opts.precision);
      } else if (NUMERIC_ATTRS.has(name)) {
        v = roundNumber(v, opts.precision);
      } else if (COLOR_ATTRS.has(name)) {
        v = shortColor(v);
      }
      if (v !== a.value) el.setAttribute(name, v);
      if (name in DEFAULTS && !hasStyleSheet && DEFAULTS[name].includes(v.toLowerCase()) &&
          (NOT_INHERITED.has(name) || !ancestorSets(el, name)) &&
          !(name === 'fill' && opts.currentColor)) {
        el.removeAttribute(name);
      }
    }
  }

  // 4. Fills and strokes follow the text color.
  if (opts.currentColor) {
    for (const el of all) {
      for (const name of ['fill', 'stroke']) {
        const v = el.getAttribute(name);
        if (v && isColorValue(v)) el.setAttribute(name, 'currentColor');
      }
    }
    // Shapes with no fill anywhere draw black by default; make the root fill follow the text color too.
    const shapes = root.querySelectorAll('path,circle,rect,ellipse,polygon,line,polyline,text');
    const needsRootFill = [...shapes].some((s) => !s.closest('[fill]'));
    if (needsRootFill && !root.hasAttribute('fill')) root.setAttribute('fill', 'currentColor');
  }

  // 5. Responsive: drop width/height but make sure a viewBox exists first.
  const w = root.getAttribute('width');
  const h = root.getAttribute('height');
  if (!root.hasAttribute('viewBox') && w && h && /^[\d.]+(px)?$/.test(w) && /^[\d.]+(px)?$/.test(h)) {
    root.setAttribute('viewBox', `0 0 ${fmt(parseFloat(w), opts.precision)} ${fmt(parseFloat(h), opts.precision)}`);
  }
  if (opts.responsive && root.hasAttribute('viewBox')) {
    root.removeAttribute('width');
    root.removeAttribute('height');
  }

  // 6. Empty groups and defs go; plain groups pass their children up.
  let changed = true;
  while (changed) {
    changed = false;
    for (const el of [...root.querySelectorAll('g,defs')]) {
      if (!el.isConnected) continue;
      const hasKids = [...el.childNodes].some((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent!.trim()));
      if (!hasKids && !(el.id && used.has(el.id))) { el.remove(); changed = true; continue; }
      if (el.localName === 'g' && el.attributes.length === 0) {
        el.replaceWith(...el.childNodes);
        changed = true;
      }
    }
  }

  // 7. Drop namespace declarations (xmlns:xlink, xmlns:svg, …) that nothing uses any more.
  const prefixes = new Set<string>();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (el.prefix) prefixes.add(el.prefix);
    for (const a of el.attributes) if (a.prefix && a.prefix !== 'xmlns') prefixes.add(a.prefix);
  }
  for (const el of [root, ...root.querySelectorAll('*')])
    for (const a of [...el.attributes]) if (a.prefix === 'xmlns' && !prefixes.has(a.localName)) el.removeAttributeNode(a);
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', SVG_NS);

  return { svg: serialize(root), root };
}

function escAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escText(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Compact XML output: no whitespace between tags (except inside text), empty elements self-close.
export function serialize(el: Element, keepSpace = false): string {
  const name = el.tagName;
  let out = `<${name}`;
  for (const a of el.attributes) out += ` ${a.name}="${escAttr(a.value)}"`;
  const keep = keepSpace || KEEP_TEXT.has(el.localName);
  let inner = '';
  for (const n of el.childNodes) {
    if (n.nodeType === 1) inner += serialize(n as Element, keep);
    else if (n.nodeType === 3 || n.nodeType === 4) {
      let t = n.textContent ?? '';
      if (el.localName === 'style') { inner += escText(minifyCss(t)); continue; }
      if (!keep) { if (!t.trim()) continue; t = t.trim(); } else if (!keepSpace) t = t.replace(/\s+/g, ' ');
      inner += escText(t);
    }
  }
  return inner ? `${out}>${inner}</${name}>` : `${out}/>`;
}

// ---------- Output formats ----------

const JSX_SPECIAL: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  'xlink:href': 'xlinkHref',
  'xlink:title': 'xlinkTitle',
  'xlink:show': 'xlinkShow',
  'xlink:actuate': 'xlinkActuate',
  'xlink:arcrole': 'xlinkArcrole',
  'xlink:role': 'xlinkRole',
  'xlink:type': 'xlinkType',
  'xml:space': 'xmlSpace',
  'xml:lang': 'xmlLang',
  'xmlns:xlink': 'xmlnsXlink',
};

export function jsxAttr(name: string): string {
  if (name in JSX_SPECIAL) return JSX_SPECIAL[name];
  if (name.startsWith('data-') || name.startsWith('aria-')) return name;
  return name.replace(/[-:]([a-z])/g, (_, c: string) => c.toUpperCase());
}

function jsxStyle(style: string): string {
  const parts = parseStyle(style).map(([k, v]) => {
    const key = k.startsWith('--') ? `'${k}'` : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const num = /^-?\d*\.?\d+$/.test(v) ? v : `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    return `${key}: ${num}`;
  });
  return `{{ ${parts.join(', ')} }}`;
}

function jsxText(t: string): string {
  return t.replace(/[{}<>]/g, (c) => `{'${c}'}`);
}

function toJsx(el: Element, depth: number, isRoot: boolean): string {
  const pad = '  '.repeat(depth);
  const attrs: string[] = [];
  for (const a of el.attributes) {
    if (a.name === 'xmlns:xlink' || a.name.startsWith('on')) continue;
    const key = jsxAttr(a.name);
    attrs.push(a.name === 'style' ? `${key}=${jsxStyle(a.value)}` : `${key}="${a.value.replace(/"/g, '&quot;')}"`);
  }
  if (isRoot) attrs.push('{...props}');
  const open = `${pad}<${el.tagName}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
  const kids: string[] = [];
  if (el.localName === 'style') {
    const css = el.textContent ?? '';
    kids.push(`${pad}  {\`${css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`}`);
  } else {
    for (const n of el.childNodes) {
      if (n.nodeType === 1) kids.push(toJsx(n as Element, depth + 1, false));
      else if (n.nodeType === 3 && n.textContent!.trim()) kids.push(`${pad}  ${jsxText(n.textContent!.trim())}`);
    }
  }
  return kids.length ? `${open}>\n${kids.join('\n')}\n${pad}</${el.tagName}>` : `${open} />`;
}

export function componentName(file: string): string {
  const base = file.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  let name = base.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  if (!name) name = 'Icon';
  if (/^\d/.test(name)) name = 'Svg' + name;
  return name;
}

export function jsx(svg: string, name: string, ts: boolean): string {
  const root = parse(svg).documentElement;
  const props = ts ? 'props: React.SVGProps<SVGSVGElement>' : 'props';
  const head = ts ? `import type * as React from 'react';\n\n` : '';
  return `${head}export default function ${name}(${props}) {\n  return (\n${toJsx(root, 2, true)}\n  );\n}\n`;
}

// URL-encoded data URI: smaller than base64 for SVG. Double quotes become single quotes so it fits inside url("…").
export function dataUri(svg: string): string {
  const body = svg.includes("'") ? svg : svg.replace(/"/g, "'");
  const enc = body
    .replace(/[\r\n]+/g, ' ')
    .replace(/[%#<>{}"\u0080-\uFFFF]/g, (c) => encodeURIComponent(c));
  return `data:image/svg+xml,${enc}`;
}

export function cssBackground(svg: string): string {
  return `background-image: url("${dataUri(svg)}");`;
}
