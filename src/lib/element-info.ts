/** What we save about the element the user clicked. */
export interface ElementInfo {
  selector: string;
  tag: string;
  text: string;
  html: string;
  styles: Record<string, string>;
  /** Box on screen in CSS pixels, relative to the viewport. */
  rect: { x: number; y: number; width: number; height: number };
  component?: string;
}

/** The ~20 computed styles that explain most visual bugs. */
export const KEY_STYLES = [
  'display', 'position', 'visibility', 'opacity', 'pointer-events', 'z-index',
  'width', 'height', 'margin', 'padding', 'overflow',
  'color', 'background-color', 'border', 'font-family', 'font-size', 'font-weight',
  'line-height', 'text-align', 'cursor', 'transform',
] as const;

const TEST_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-test-id'];
const MAX_HTML = 2000;
const MAX_ATTR = 80;
const MAX_TEXT = 200;

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function isUnique(doc: Document, selector: string): boolean {
  try {
    return doc.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

/** Generated class names (CSS modules, styled-components, hashes) change between builds, so skip them. */
function stableClasses(el: Element): string[] {
  return Array.from(el.classList).filter(
    (c) => c.length < 30 && !/\d{3,}|^[a-z]{1,3}-[a-zA-Z0-9]{5,}$|__[a-zA-Z0-9]{5,}$|^css-/.test(c),
  );
}

function part(el: Element): string {
  const tag = el.tagName.toLowerCase();
  for (const a of TEST_ATTRS) {
    const v = el.getAttribute(a);
    if (v) return `${tag}[${a}="${v}"]`;
  }
  const classes = stableClasses(el).slice(0, 2);
  return classes.length ? `${tag}.${classes.map(cssEscape).join('.')}` : tag;
}

/**
 * A selector the agent can search for: prefers id, then test ids, then a short path.
 */
export function selectorFor(el: Element): string {
  const doc = el.ownerDocument;
  if (el.id && !/\d{4,}/.test(el.id)) {
    const s = `#${cssEscape(el.id)}`;
    if (isUnique(doc, s)) return s;
  }
  for (const a of TEST_ATTRS) {
    const v = el.getAttribute(a);
    if (v) {
      const s = `${el.tagName.toLowerCase()}[${a}="${v}"]`;
      if (isUnique(doc, s)) return s;
    }
  }
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== doc.documentElement && parts.length < 5) {
    let p = part(node);
    const parent: Element | null = node.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => part(c) === p);
      if (same.length > 1) p += `:nth-of-type(${Array.from(parent.children).filter((c) => c.tagName === node!.tagName).indexOf(node) + 1})`;
    }
    parts.unshift(p);
    const s = parts.join(' > ');
    if (isUnique(doc, s)) return s;
    if (node.id && !/\d{4,}/.test(node.id) && node !== el) {
      const withId = `#${cssEscape(node.id)} ${parts.slice(1).join(' > ')}`.trim();
      if (isUnique(doc, withId)) return withId;
    }
    node = parent;
  }
  return parts.join(' > ');
}

/** Visible text, whitespace squashed and cut short. */
export function visibleText(el: Element): string {
  const raw = (el as HTMLElement).innerText ?? el.textContent ?? '';
  const t = raw.replace(/\s+/g, ' ').trim();
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + '…' : t;
}

/**
 * The element's HTML, two levels deep, long attributes cut, about 2 KB at most.
 * Password and card fields lose their values.
 */
export function trimmedHtml(el: Element, depth = 2): string {
  const clone = el.cloneNode(true) as Element;
  const prune = (node: Element, level: number) => {
    for (const child of Array.from(node.children)) {
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(child.tagName)) {
        child.remove();
      } else if (level >= depth) {
        child.replaceChildren(child.ownerDocument.createTextNode('…'));
        trimAttrs(child);
      } else {
        prune(child, level + 1);
      }
    }
    trimAttrs(node);
  };
  const trimAttrs = (node: Element) => {
    for (const attr of Array.from(node.attributes)) {
      if (attr.name === 'style' || attr.name.startsWith('on')) node.removeAttribute(attr.name);
      else if (attr.name === 'value' && isSensitiveField(node)) node.setAttribute('value', '[hidden]');
      else if (attr.value.length > MAX_ATTR) node.setAttribute(attr.name, attr.value.slice(0, MAX_ATTR) + '…');
    }
    if (node.tagName === 'svg') node.replaceChildren();
  };
  prune(clone, 1);
  const html = clone.outerHTML.replace(/\n\s*\n/g, '\n');
  return html.length > MAX_HTML ? html.slice(0, MAX_HTML) + '…' : html;
}

export function isSensitiveField(el: Element): boolean {
  if (el.tagName !== 'INPUT') return false;
  const type = (el.getAttribute('type') || '').toLowerCase();
  const hint = `${el.getAttribute('name') || ''} ${el.getAttribute('autocomplete') || ''} ${el.id}`.toLowerCase();
  return type === 'password' || /cc-|card|cvc|cvv|password/.test(hint);
}

export function keyStyles(el: Element): Record<string, string> {
  const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const name of KEY_STYLES) {
    const v = cs.getPropertyValue(name);
    if (v) out[name] = v;
  }
  return out;
}

export function describeElement(el: Element): ElementInfo {
  const r = el.getBoundingClientRect();
  return {
    selector: selectorFor(el),
    tag: el.tagName.toLowerCase(),
    text: visibleText(el),
    html: trimmedHtml(el),
    styles: keyStyles(el),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
  };
}

/**
 * The deepest element under a point, including ones the browser skips because of
 * `pointer-events: none` (often exactly the broken button the user wants to pick).
 */
export function deepestElementAt(doc: Document, x: number, y: number, skip?: Element): Element | null {
  let el = doc.elementFromPoint(x, y);
  if (!el || el === skip) return null;
  for (let guard = 0; guard < 50; guard++) {
    let next: Element | null = null;
    for (const child of Array.from(el.children)) {
      if (child === skip) continue;
      const r = child.getBoundingClientRect();
      if (r.width && r.height && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) next = child;
    }
    if (!next) break;
    el = next;
  }
  return el;
}
