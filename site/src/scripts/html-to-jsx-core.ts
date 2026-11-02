// HTML to JSX: turns pasted HTML into JSX that React accepts. Runs in the browser with DOMParser, no dependencies.

export type Options = {
  /** Wrap the result in `export default function Name()`. Empty means plain JSX. */
  component: string;
  /** Move inline styles that have an exact Tailwind class into className. */
  tailwind: boolean;
};

export type ChangeKey =
  | 'className'
  | 'htmlFor'
  | 'style'
  | 'selfClose'
  | 'comment'
  | 'svg'
  | 'attr'
  | 'event'
  | 'form'
  | 'escape'
  | 'tailwind';

export type Result = {
  jsx: string;
  changes: Record<ChangeKey, number>;
  warnings: string[];
  /** Number of top-level nodes; 0 means there was nothing to convert. */
  roots: number;
};

export const CHANGE_LABELS: Record<ChangeKey, (n: number) => string> = {
  className: (n) => `${n} class → className`,
  htmlFor: (n) => `${n} for → htmlFor`,
  style: (n) => `${n} style${n === 1 ? '' : 's'} → object${n === 1 ? '' : 's'}`,
  selfClose: (n) => `${n} tag${n === 1 ? '' : 's'} self-closed`,
  comment: (n) => `${n} comment${n === 1 ? '' : 's'} → {/* */}`,
  svg: (n) => `${n} SVG attribute${n === 1 ? '' : 's'} camelCased`,
  attr: (n) => `${n} attribute${n === 1 ? '' : 's'} renamed`,
  event: (n) => `${n} event handler${n === 1 ? '' : 's'}`,
  form: (n) => `${n} form value${n === 1 ? '' : 's'} → default${n === 1 ? '' : 's'}`,
  escape: (n) => `${n} character${n === 1 ? '' : 's'} escaped`,
  tailwind: (n) => `${n} style${n === 1 ? '' : 's'} → Tailwind`,
};

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

// Whitespace between two of these shows up as a space on the page, so it has to be kept.
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'button', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'img', 'input', 'ins',
  'kbd', 'label', 'mark', 'q', 's', 'samp', 'select', 'small', 'span', 'strong', 'sub', 'sup', 'svg', 'textarea', 'time',
  'u', 'var', 'wbr', 'output', 'meter', 'progress', 'picture',
]);

const BOOLEAN = new Set([
  'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls', 'default', 'defer', 'disabled',
  'formnovalidate', 'hidden', 'inert', 'ismap', 'itemscope', 'loop', 'multiple', 'muted', 'nomodule', 'novalidate',
  'open', 'playsinline', 'readonly', 'required', 'reversed', 'selected',
]);

const HTML_ATTRS: Record<string, string> = {
  accesskey: 'accessKey', 'accept-charset': 'acceptCharset', allowfullscreen: 'allowFullScreen', autocapitalize: 'autoCapitalize',
  autocomplete: 'autoComplete', autofocus: 'autoFocus', autoplay: 'autoPlay', cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing', charset: 'charSet', colspan: 'colSpan', contenteditable: 'contentEditable',
  controlslist: 'controlsList', crossorigin: 'crossOrigin', datetime: 'dateTime', enctype: 'encType',
  enterkeyhint: 'enterKeyHint', fetchpriority: 'fetchPriority', formaction: 'formAction', formenctype: 'formEncType',
  formmethod: 'formMethod', formnovalidate: 'formNoValidate', formtarget: 'formTarget', frameborder: 'frameBorder',
  hreflang: 'hrefLang', 'http-equiv': 'httpEquiv', inputmode: 'inputMode', itemid: 'itemID', itemprop: 'itemProp',
  itemref: 'itemRef', itemscope: 'itemScope', itemtype: 'itemType', marginheight: 'marginHeight',
  marginwidth: 'marginWidth', maxlength: 'maxLength', minlength: 'minLength', nomodule: 'noModule',
  novalidate: 'noValidate', playsinline: 'playsInline', readonly: 'readOnly', referrerpolicy: 'referrerPolicy',
  rowspan: 'rowSpan', spellcheck: 'spellCheck', srcdoc: 'srcDoc', srclang: 'srcLang', srcset: 'srcSet',
  tabindex: 'tabIndex', usemap: 'useMap', popovertarget: 'popoverTarget', popovertargetaction: 'popoverTargetAction',
};

const EVENTS: Record<string, string> = {};
for (const e of [
  'Abort', 'AnimationEnd', 'AnimationIteration', 'AnimationStart', 'AuxClick', 'BeforeInput', 'Blur', 'CanPlay',
  'CanPlayThrough', 'Change', 'Click', 'ContextMenu', 'Copy', 'Cut', 'DoubleClick', 'Drag', 'DragEnd', 'DragEnter',
  'DragLeave', 'DragOver', 'DragStart', 'Drop', 'DurationChange', 'Ended', 'Error', 'Focus', 'Input', 'Invalid',
  'KeyDown', 'KeyPress', 'KeyUp', 'Load', 'LoadedData', 'LoadedMetadata', 'LoadStart', 'MouseDown', 'MouseEnter',
  'MouseLeave', 'MouseMove', 'MouseOut', 'MouseOver', 'MouseUp', 'Paste', 'Pause', 'Play', 'Playing', 'PointerDown',
  'PointerEnter', 'PointerLeave', 'PointerMove', 'PointerOut', 'PointerOver', 'PointerUp', 'Progress', 'RateChange',
  'Reset', 'Resize', 'Scroll', 'Seeked', 'Seeking', 'Select', 'Stalled', 'Submit', 'Suspend', 'TimeUpdate', 'Toggle',
  'TouchCancel', 'TouchEnd', 'TouchMove', 'TouchStart', 'TransitionEnd', 'VolumeChange', 'Waiting', 'Wheel',
]) EVENTS['on' + e.toLowerCase()] = 'on' + e;
EVENTS.ondblclick = 'onDoubleClick';

// Inputs where React is fine with a fixed value attribute.
const FIXED_VALUE_TYPES = new Set(['button', 'checkbox', 'hidden', 'image', 'radio', 'reset', 'submit']);

const camel = (s: string) => s.replace(/[-:]([a-z0-9])/gi, (_, c: string) => c.toUpperCase());

export function componentName(raw: string): string {
  const words = raw.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  let name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  if (name && !/^[A-Z]/.test(name)) name = 'C' + name;
  return name;
}

// ---------- style="" → style={{}} (and optional Tailwind) ----------

type Decl = { prop: string; value: string; important: boolean };

export function parseStyle(text: string): Decl[] {
  const out: Decl[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  const push = (part: string) => {
    const i = part.indexOf(':');
    if (i < 0) return;
    const prop = part.slice(0, i).trim();
    let value = part.slice(i + 1).trim();
    if (!prop || !value) return;
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/\s*!\s*important\s*$/i, '');
    out.push({ prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value, important });
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) {
      push(text.slice(start, i));
      start = i + 1;
    }
  }
  push(text.slice(start));
  return out;
}

function styleKey(prop: string): string {
  if (prop.startsWith('--')) return `'${prop.replace(/'/g, "\\'")}'`;
  if (prop.startsWith('-ms-')) return camel(prop.slice(1));
  if (prop.startsWith('-')) {
    const c = camel(prop.slice(1));
    return c[0].toUpperCase() + c.slice(1);
  }
  return camel(prop);
}

function styleValue(value: string): string {
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(value)) return String(Number(value));
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ')}'`;
}

function styleObject(decls: Decl[]): string {
  return `{{ ${decls.map((d) => `${styleKey(d.prop)}: ${styleValue(d.value)}`).join(', ')} }}`;
}

// Tailwind: only classes that mean exactly the same as the CSS (default theme).
const SCALE = new Set([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96]);

function px(value: string): number | undefined {
  const m = /^(-?\d*\.?\d+)(px|rem)?$/.exec(value.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!m[2]) return n === 0 ? 0 : undefined;
  return m[2] === 'rem' ? n * 16 : n;
}

function space(prefix: string, value: string, allowNegative = true): string | undefined {
  const v = value.trim();
  if (v === 'auto') return `${prefix}-auto`;
  const p = px(v);
  if (p === undefined) return undefined;
  const neg = p < 0;
  if (neg && !allowNegative) return undefined;
  const a = Math.abs(p);
  let step: string | undefined;
  if (a === 1) step = 'px';
  else if (SCALE.has(a / 4)) step = String(a / 4);
  if (!step) return undefined;
  return `${neg ? '-' : ''}${prefix}-${step}`;
}

function sides(prefix: string, value: string): string[] | undefined {
  const parts = value.trim().split(/\s+/);
  if (parts.length > 4) return undefined;
  const [t, r = t, b = t, l = r] = parts;
  const one = (p: string, v: string) => space(p, v);
  let out: (string | undefined)[];
  if (t === r && r === b && b === l) out = [one(prefix, t)];
  else if (t === b && r === l) out = [one(prefix + 'y', t), one(prefix + 'x', r)];
  else out = [one(prefix + 't', t), one(prefix + 'r', r), one(prefix + 'b', b), one(prefix + 'l', l)];
  return out.every(Boolean) ? (out as string[]) : undefined;
}

const KEYWORDS: Record<string, Record<string, string>> = {
  display: { block: 'block', 'inline-block': 'inline-block', inline: 'inline', flex: 'flex', 'inline-flex': 'inline-flex', grid: 'grid', 'inline-grid': 'inline-grid', none: 'hidden', contents: 'contents', table: 'table' },
  position: { static: 'static', fixed: 'fixed', absolute: 'absolute', relative: 'relative', sticky: 'sticky' },
  'text-align': { left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify', start: 'text-start', end: 'text-end' },
  'font-weight': { '100': 'font-thin', '200': 'font-extralight', '300': 'font-light', '400': 'font-normal', normal: 'font-normal', '500': 'font-medium', '600': 'font-semibold', '700': 'font-bold', bold: 'font-bold', '800': 'font-extrabold', '900': 'font-black' },
  'font-style': { italic: 'italic', normal: 'not-italic' },
  'text-decoration': { underline: 'underline', 'line-through': 'line-through', none: 'no-underline' },
  'text-transform': { uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case' },
  'flex-direction': { row: 'flex-row', column: 'flex-col', 'row-reverse': 'flex-row-reverse', 'column-reverse': 'flex-col-reverse' },
  'flex-wrap': { wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' },
  'justify-content': { 'flex-start': 'justify-start', start: 'justify-start', center: 'justify-center', 'flex-end': 'justify-end', end: 'justify-end', 'space-between': 'justify-between', 'space-around': 'justify-around', 'space-evenly': 'justify-evenly' },
  'align-items': { 'flex-start': 'items-start', start: 'items-start', center: 'items-center', 'flex-end': 'items-end', end: 'items-end', baseline: 'items-baseline', stretch: 'items-stretch' },
  flex: { '1': 'flex-1', '1 1 0%': 'flex-1', none: 'flex-none', auto: 'flex-auto', '1 1 auto': 'flex-auto' },
  'flex-shrink': { '0': 'shrink-0', '1': 'shrink' },
  'flex-grow': { '0': 'grow-0', '1': 'grow' },
  cursor: { pointer: 'cursor-pointer', default: 'cursor-default', 'not-allowed': 'cursor-not-allowed', text: 'cursor-text', move: 'cursor-move', wait: 'cursor-wait', grab: 'cursor-grab', auto: 'cursor-auto' },
  overflow: { hidden: 'overflow-hidden', auto: 'overflow-auto', scroll: 'overflow-scroll', visible: 'overflow-visible' },
  'overflow-x': { hidden: 'overflow-x-hidden', auto: 'overflow-x-auto', scroll: 'overflow-x-scroll', visible: 'overflow-x-visible' },
  'overflow-y': { hidden: 'overflow-y-hidden', auto: 'overflow-y-auto', scroll: 'overflow-y-scroll', visible: 'overflow-y-visible' },
  'white-space': { nowrap: 'whitespace-nowrap', normal: 'whitespace-normal', pre: 'whitespace-pre', 'pre-wrap': 'whitespace-pre-wrap', 'pre-line': 'whitespace-pre-line' },
  'box-sizing': { 'border-box': 'box-border', 'content-box': 'box-content' },
  'object-fit': { cover: 'object-cover', contain: 'object-contain', fill: 'object-fill', none: 'object-none', 'scale-down': 'object-scale-down' },
  'list-style': { none: 'list-none' },
  'list-style-type': { none: 'list-none', disc: 'list-disc', decimal: 'list-decimal' },
  'line-height': { '1': 'leading-none', '1.25': 'leading-tight', '1.375': 'leading-snug', '1.5': 'leading-normal', '1.625': 'leading-relaxed', '2': 'leading-loose' },
  'z-index': { '0': 'z-0', '10': 'z-10', '20': 'z-20', '30': 'z-30', '40': 'z-40', '50': 'z-50', auto: 'z-auto' },
  'border-radius': { '0': 'rounded-none', '2px': 'rounded-sm', '0.125rem': 'rounded-sm', '4px': 'rounded', '0.25rem': 'rounded', '6px': 'rounded-md', '0.375rem': 'rounded-md', '8px': 'rounded-lg', '0.5rem': 'rounded-lg', '12px': 'rounded-xl', '0.75rem': 'rounded-xl', '16px': 'rounded-2xl', '1rem': 'rounded-2xl', '24px': 'rounded-3xl', '1.5rem': 'rounded-3xl', '9999px': 'rounded-full', '999px': 'rounded-full' },
  'border-width': { '0': 'border-0', '1px': 'border', '2px': 'border-2', '4px': 'border-4', '8px': 'border-8' },
  border: { none: 'border-0', '0': 'border-0' },
  'border-style': { solid: 'border-solid', dashed: 'border-dashed', dotted: 'border-dotted', none: 'border-none' },
  'pointer-events': { none: 'pointer-events-none', auto: 'pointer-events-auto' },
  'user-select': { none: 'select-none', all: 'select-all', text: 'select-text', auto: 'select-auto' },
  visibility: { hidden: 'invisible', visible: 'visible' },
};

const FONT_SIZE: Record<number, string> = { 12: 'xs', 14: 'sm', 16: 'base', 18: 'lg', 20: 'xl', 24: '2xl', 30: '3xl', 36: '4xl', 48: '5xl', 60: '6xl', 72: '7xl', 96: '8xl', 128: '9xl' };
const COLOR_PREFIX: Record<string, string> = { color: 'text', 'background-color': 'bg', background: 'bg', 'border-color': 'border' };
const SPACE_PREFIX: Record<string, string> = {
  'padding-top': 'pt', 'padding-right': 'pr', 'padding-bottom': 'pb', 'padding-left': 'pl',
  'margin-top': 'mt', 'margin-right': 'mr', 'margin-bottom': 'mb', 'margin-left': 'ml',
  gap: 'gap', 'row-gap': 'gap-y', 'column-gap': 'gap-x', top: 'top', right: 'right', bottom: 'bottom', left: 'left',
  width: 'w', height: 'h', 'min-width': 'min-w', 'min-height': 'min-h', 'max-width': 'max-w', 'max-height': 'max-h',
};
const SIZE_WORDS: Record<string, string> = { '100%': 'full', auto: 'auto', 'fit-content': 'fit', 'min-content': 'min', 'max-content': 'max' };

function tailwindFor(d: Decl): string[] | undefined {
  if (d.important || d.prop.startsWith('--')) return undefined;
  const v = d.value.trim().toLowerCase().replace(/\s+/g, ' ');
  const kw = KEYWORDS[d.prop]?.[v];
  if (kw) return [kw];
  if (d.prop === 'padding') return sides('p', v);
  if (d.prop === 'margin') return sides('m', v);
  if (d.prop === 'opacity') {
    const n = Math.round(Number(v) * 100);
    return v !== '' && !Number.isNaN(n) && n % 5 === 0 && n >= 0 && n <= 100 && Math.abs(Number(v) * 100 - n) < 1e-9 ? [`opacity-${n}`] : undefined;
  }
  if (d.prop === 'font-size') {
    const p = px(v);
    return p !== undefined && FONT_SIZE[p] ? [`text-${FONT_SIZE[p]}`] : undefined;
  }
  const colorPrefix = COLOR_PREFIX[d.prop];
  if (colorPrefix) {
    if (v === '#fff' || v === '#ffffff' || v === 'white') return [`${colorPrefix}-white`];
    if (v === '#000' || v === '#000000' || v === 'black') return [`${colorPrefix}-black`];
    if (v === 'transparent') return [`${colorPrefix}-transparent`];
    if (v === 'currentcolor') return [`${colorPrefix}-current`];
    if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v)) return [`${colorPrefix}-[${v}]`];
    return undefined;
  }
  const sp = SPACE_PREFIX[d.prop];
  if (sp) {
    const sizing = /^(w|h|min-w|min-h|max-w|max-h)$/.test(sp);
    if (sizing) {
      if (SIZE_WORDS[v] && !(sp.startsWith('max') && v === 'auto') && !(sp.startsWith('min') && v === 'auto')) return [`${sp}-${SIZE_WORDS[v]}`];
      if (v === '100vw' && sp === 'w') return ['w-screen'];
      if (v === '100vh' && (sp === 'h' || sp === 'min-h')) return [`${sp}-screen`];
      if (sp.startsWith('max') || sp.startsWith('min')) return v === '0' || v === '0px' ? [`${sp}-0`] : undefined;
    }
    const c = space(sp, v, !sizing && sp !== 'gap' && sp !== 'gap-x' && sp !== 'gap-y');
    return c ? [c] : undefined;
  }
  return undefined;
}

// ---------- Printing ----------

type Ctx = { svg: boolean; pre: boolean };
type Item = { kind: 'text'; text: string } | { kind: 'el'; el: Element } | { kind: 'comment'; text: string };

const LINE = 100;

class Printer {
  changes: Record<ChangeKey, number> = { className: 0, htmlFor: 0, style: 0, selfClose: 0, comment: 0, svg: 0, attr: 0, event: 0, form: 0, escape: 0, tailwind: 0 };
  warnings = new Set<string>();

  constructor(private opts: Options) {}

  text(s: string): string {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '{' || c === '}') {
        out += `{'${c}'}`;
        this.changes.escape++;
      } else if (c === '<') {
        out += '&lt;';
        this.changes.escape++;
      } else if (c === '>') {
        out += '&gt;';
        this.changes.escape++;
      } else if (c === ' ') out += '&nbsp;';
      else if (c === '&' && /^&[a-z0-9#]+;/i.test(s.slice(i))) out += '&amp;';
      else out += c;
    }
    return out;
  }

  rawText(s: string): string {
    if (!s.includes('\n')) return `{${JSON.stringify(s)}}`;
    return '{`' + s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`}';
  }

  comment(s: string): string {
    this.changes.comment++;
    return `{/* ${s.trim().replace(/\*\//g, '* /')} */}`;
  }

  /** Turns a node's children into printable items, dropping whitespace HTML would not show. */
  items(nodes: ArrayLike<ChildNode>, ctx: Ctx): Item[] {
    const raw: Item[] = [];
    for (const n of Array.from(nodes)) {
      if (n.nodeType === 3) raw.push({ kind: 'text', text: ctx.pre ? n.nodeValue ?? '' : (n.nodeValue ?? '').replace(/[\t\n\f\r ]+/g, ' ') });
      else if (n.nodeType === 1) raw.push({ kind: 'el', el: n as Element });
      else if (n.nodeType === 8) raw.push({ kind: 'comment', text: n.nodeValue ?? '' });
    }
    if (ctx.pre) return raw.filter((i) => i.kind !== 'text' || i.text !== '');
    const inline = (i: Item | undefined) => i !== undefined && (i.kind === 'text' || (i.kind === 'el' && INLINE.has(i.el.localName)));
    const out: Item[] = [];
    raw.forEach((item, k) => {
      if (item.kind !== 'text') return out.push(item);
      let t = item.text;
      if (t.startsWith(' ') && !inline(raw[k - 1])) t = t.trimStart();
      if (t.endsWith(' ') && !inline(raw[k + 1])) t = t.trimEnd();
      if (t) out.push({ kind: 'text', text: t });
    });
    return out;
  }

  attrs(el: Element, parentCtx: Ctx): string[] {
    const out: string[] = [];
    const tag = el.localName;
    const ctx: Ctx = { ...parentCtx, svg: parentCtx.svg || tag === 'svg' };
    let className = '';
    const twClasses: string[] = [];
    let styleDecls: Decl[] | undefined;
    const rest: [string, string][] = [];

    for (const a of Array.from(el.attributes)) {
      const name = a.name;
      const lower = name.toLowerCase();
      const value = a.value;
      if (lower === 'class') {
        className = value.trim().replace(/\s+/g, ' ');
        this.changes.className++;
        rest.push(['\0class', '']);
        continue;
      }
      if (lower === 'style') {
        styleDecls = parseStyle(value);
        rest.push(['\0style', '']);
        continue;
      }
      if (EVENTS[lower]) {
        this.changes.event++;
        this.warnings.add('Inline event code like onclick="…" became arrow functions. Check that the functions they call exist in your component.');
        const body = value.trim().replace(/;\s*$/, '');
        rest.push(['\0raw', `${EVENTS[lower]}={() => { ${body} }}`]);
        continue;
      }
      let jsxName = name;
      if (lower.startsWith('data-') || lower.startsWith('aria-')) jsxName = lower;
      else if (lower === 'for' && !ctx.svg) {
        jsxName = 'htmlFor';
        this.changes.htmlFor++;
      } else if (ctx.svg) {
        if (lower === 'xmlns:xlink') jsxName = 'xmlnsXlink';
        else if (/[-:]/.test(name)) jsxName = camel(name);
        if (jsxName !== name) this.changes.svg++;
      } else if (HTML_ATTRS[lower]) {
        jsxName = HTML_ATTRS[lower];
        this.changes.attr++;
      }
      rest.push([jsxName, value]);
    }

    // Form fields: React wants defaultValue/defaultChecked unless you add onChange.
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    for (const pair of rest) {
      if (tag === 'input' && pair[0] === 'value' && !FIXED_VALUE_TYPES.has(type)) {
        pair[0] = 'defaultValue';
        this.changes.form++;
      } else if (tag === 'input' && pair[0] === 'checked') {
        pair[0] = 'defaultChecked';
        this.changes.form++;
      } else if (tag === 'option' && pair[0] === 'selected') {
        pair[0] = '';
      } else if (tag === 'select' && pair[0] === 'value') {
        pair[0] = 'defaultValue';
        this.changes.form++;
      }
    }
    if (tag === 'select' && !rest.some((p) => p[0] === 'defaultValue')) {
      const chosen = el.querySelector('option[selected]');
      if (chosen) {
        rest.push(['defaultValue', chosen.getAttribute('value') ?? chosen.textContent?.trim() ?? '']);
        this.changes.form++;
      }
    }
    if (tag === 'textarea' && el.textContent) {
      rest.push(['defaultValue', el.textContent.replace(/^\n/, '')]);
      this.changes.form++;
    }

    if (styleDecls) {
      if (styleDecls.some((d) => d.important)) this.warnings.add('React style objects can’t hold !important, so it was removed. Move those rules to a CSS class if you need them.');
      if (this.opts.tailwind) {
        const left: Decl[] = [];
        for (const d of styleDecls) {
          const tw = tailwindFor(d);
          if (tw) {
            twClasses.push(...tw);
            this.changes.tailwind++;
          } else left.push(d);
        }
        styleDecls = left;
      }
    }

    const cls = [className, ...twClasses].filter(Boolean).join(' ');
    let clsDone = false;
    for (const [name, value] of rest) {
      if (!name) continue;
      if (name === '\0raw') out.push(value);
      else if (name === '\0class' || (name === '\0style' && !className)) {
        if (cls && !clsDone) out.push(`className=${this.attrValue(cls)}`);
        clsDone = true;
        if (name === '\0class') continue;
      }
      if (name === '\0style') {
        if (styleDecls && styleDecls.length) {
          out.push(`style=${styleObject(styleDecls)}`);
          this.changes.style++;
        }
        continue;
      }
      if (name.startsWith('\0')) continue;
      if (!ctx.svg && BOOLEAN.has(name.toLowerCase()) && (value === '' || value.toLowerCase() === name.toLowerCase())) out.push(name);
      else if (name === 'defaultChecked' && (value === '' || value.toLowerCase() === 'checked')) out.push(name);
      else if (name === 'tabIndex' && /^-?\d+$/.test(value.trim())) out.push(`tabIndex={${Number(value)}}`);
      else out.push(`${name}=${this.attrValue(value)}`);
    }
    return out;
  }

  attrValue(v: string): string {
    if (v.includes('"') || /&[a-z0-9#]+;/i.test(v)) return `{${JSON.stringify(v)}}`;
    return `"${v}"`;
  }

  openTag(tag: string, attrs: string[], indent: string, selfClose: boolean): string[] {
    const end = selfClose ? ' />' : '>';
    const one = `<${tag}${attrs.map((a) => ' ' + a).join('')}${end}`;
    if (indent.length + one.length <= LINE || attrs.length <= 1) return [one];
    return [`<${tag}`, ...attrs.map((a) => '  ' + a), selfClose ? '/>' : '>'];
  }

  /** One line for this element when it fits, otherwise undefined. */
  inlineEl(el: Element, ctx: Ctx, budget: number): string | undefined {
    const tag = el.localName;
    const c = this.childCtx(el, ctx);
    if (tag === 'style' || tag === 'script') return undefined;
    const attrs = this.attrsCached(el, ctx);
    const kids = tag === 'textarea' || tag === 'template' ? [] : this.items(el.childNodes, c);
    const start = `<${tag}${attrs.map((a) => ' ' + a).join('')}`;
    if (kids.length === 0) {
      const s = start + ' />';
      return s.length <= budget ? s : undefined;
    }
    let inner = '';
    for (const k of kids) {
      if (k.kind === 'comment') return undefined;
      if (k.kind === 'text') {
        if (c.pre && k.text.includes('\n')) return undefined;
        inner += c.pre ? this.rawText(k.text) : this.textCount(k.text);
      } else {
        const s = this.inlineEl(k.el, c, budget - start.length - inner.length);
        if (s === undefined) return undefined;
        inner += s;
      }
      if (start.length + inner.length > budget) return undefined;
    }
    const s = `${start}>${inner}</${tag}>`;
    return s.length <= budget ? s : undefined;
  }

  // Counting changes while trying the one-line layout would double count, so those passes use a scratch printer.
  private cache = new Map<Element, string[]>();
  attrsCached(el: Element, ctx: Ctx): string[] {
    let a = this.cache.get(el);
    if (!a) {
      a = this.attrs(el, ctx);
      this.cache.set(el, a);
    }
    return a;
  }
  // Escaping without counting, for one-line attempts; countInline adds the counts once the line is used.
  textCount(s: string): string {
    return new Printer(this.opts).text(s);
  }

  childCtx(el: Element, ctx: Ctx): Ctx {
    const tag = el.localName;
    return {
      svg: (ctx.svg || tag === 'svg') && tag !== 'foreignObject',
      pre: ctx.pre || tag === 'pre' || tag === 'textarea' || tag === 'listing',
    };
  }

  element(el: Element, indent: string, ctx: Ctx): string[] {
    const tag = el.localName;
    if (tag === 'script') this.warnings.add('Scripts don’t run when React renders them. Move that code into your component, for example in a useEffect.');
    const one = this.inlineEl(el, ctx, LINE - indent.length);
    if (one !== undefined) {
      this.countInline(el, ctx);
      if (VOID.has(tag)) this.changes.selfClose++;
      return [indent + one];
    }
    const attrs = this.attrsCached(el, ctx);
    const c = this.childCtx(el, ctx);
    if (tag === 'style' || tag === 'script') {
      const body = el.textContent ?? '';
      const open = this.openTag(tag, attrs, indent, false).map((l) => indent + l);
      if (!body.trim()) return [indent + `<${tag}${attrs.map((a) => ' ' + a).join('')} />`];
      const lines = dedent(body).split('\n').map((l) => (l ? indent + '  ' + l : ''));
      const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
      return [...open, indent + '  {`', ...lines.map(esc), indent + '  `}', indent + `</${tag}>`];
    }
    const kids = tag === 'textarea' || tag === 'template' ? [] : this.items(el.childNodes, c);
    if (kids.length === 0) {
      if (VOID.has(tag)) this.changes.selfClose++;
      return this.openTag(tag, attrs, indent, true).map((l) => indent + l);
    }
    const lines = this.openTag(tag, attrs, indent, false).map((l) => indent + l);
    lines.push(...this.children(kids, indent + '  ', c));
    lines.push(`${indent}</${tag}>`);
    return lines;
  }

  /** Adds the change counts for an element printed on one line. */
  countInline(el: Element, ctx: Ctx) {
    const c = this.childCtx(el, ctx);
    if (el.localName === 'textarea' || el.localName === 'template') return;
    for (const k of this.items(el.childNodes, c)) {
      if (k.kind === 'text' && !c.pre) this.text(k.text);
      else if (k.kind === 'el') {
        this.attrsCached(k.el, c);
        if (VOID.has(k.el.localName)) this.changes.selfClose++;
        this.countInline(k.el, c);
      }
    }
  }

  children(kids: Item[], indent: string, ctx: Ctx): string[] {
    const lines: string[] = [];
    for (const k of kids) {
      if (k.kind === 'comment') lines.push(indent + this.comment(k.text));
      else if (k.kind === 'el') lines.push(...this.element(k.el, indent, ctx));
      else if (ctx.pre) lines.push(indent + this.rawText(k.text));
      else {
        const lead = k.text.startsWith(' ');
        const trail = k.text.endsWith(' ') && k.text.length > 1;
        const body = k.text.trim();
        lines.push(indent + (lead ? "{' '}" : '') + this.text(body) + (trail ? "{' '}" : ''));
      }
    }
    return lines;
  }
}

function dedent(s: string): string {
  const lines = s.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length));
  return lines.map((l) => l.slice(Number.isFinite(pad) ? pad : 0)).join('\n');
}

// ---------- Parsing ----------

export function parse(html: string): { nodes: ChildNode[]; doc: Document; warnings: string[] } {
  const warnings: string[] = [];
  const parser = new DOMParser();
  if (/<(html|head|body)[\s>]/i.test(html)) {
    const doc = parser.parseFromString(html, 'text/html');
    const styles = Array.from(doc.head.querySelectorAll('style'));
    if (doc.head.querySelector(':not(style)')) warnings.push('The <head> part (title, meta tags, links) was left out. Those belong in your layout or page settings, not in a component.');
    if (doc.body.attributes.length) warnings.push('Attributes on <body> were left out. Put them on your layout’s body instead.');
    return { nodes: [...styles, ...Array.from(doc.body.childNodes)], doc, warnings };
  }
  const doc = parser.parseFromString('<!doctype html><title></title>', 'text/html');
  const t = doc.createElement('template');
  t.innerHTML = html;
  return { nodes: Array.from(t.content.childNodes), doc, warnings };
}

export function convert(html: string, opts: Options): Result {
  const { nodes, warnings } = parse(html);
  const p = new Printer(opts);
  for (const w of warnings) p.warnings.add(w);
  const ctx: Ctx = { svg: false, pre: false };
  const kids = p.items(nodes, ctx).filter((k) => k.kind !== 'text' || k.text.trim());
  const name = componentName(opts.component);
  const base = name ? '    ' : '';
  let body: string[];
  if (kids.length === 0) body = [];
  else if (kids.length === 1 && kids[0].kind === 'el') body = p.element(kids[0].el, base, ctx);
  else body = [base + '<>', ...p.children(kids, base + '  ', ctx), base + '</>'];

  let jsx = body.join('\n');
  if (name && body.length) jsx = `export default function ${name}() {\n  return (\n${jsx}\n  );\n}`;
  return { jsx: body.length ? jsx + '\n' : '', changes: p.changes, warnings: [...p.warnings], roots: kids.length };
}

// ---------- Preview ----------

const UNSAFE = 'script, iframe, frame, frameset, object, embed, link, meta, base, noscript, portal';

/** A copy of the HTML that's safe to show on this page: no scripts, frames or event handlers. */
export function previewFragment(html: string, into: Document): DocumentFragment {
  const { nodes } = parse(html);
  const frag = into.createDocumentFragment();
  for (const n of nodes) frag.append(into.importNode(n, true));
  frag.querySelectorAll(UNSAFE).forEach((e) => e.remove());
  frag.querySelectorAll('*').forEach((e) => {
    for (const a of Array.from(e.attributes)) {
      const n = a.name.toLowerCase();
      const v = a.value.replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
      if (n.startsWith('on') || n === 'srcdoc' || n === 'formaction' || n === 'action' || n === 'autofocus') e.removeAttribute(a.name);
      else if (/^(href|src|xlink:href|action|poster|background)$/.test(n) && /^(javascript|vbscript|data:text\/html)/.test(v)) e.removeAttribute(a.name);
    }
  });
  return frag;
}
