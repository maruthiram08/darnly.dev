import { redactText, redactUrl } from './redact';

/**
 * The steps that led to a bug: what the user clicked, typed (never the words), chose and which pages they went to.
 *
 * Two ways they're collected:
 * - Automatically, by the page recorder (localhost and sites with recording on): the last few actions, kept in memory.
 * - "Record steps" in the side panel: every action until the capture, on any site, each with a small screenshot.
 */
export interface Step {
  t: number;
  kind: 'page' | 'click' | 'type' | 'choose' | 'check' | 'uncheck' | 'key' | 'file';
  /** What was acted on, in plain words: `button "Save changes"`, `field "Email"`. */
  target?: string;
  /** The key pressed, or the option chosen in a dropdown. */
  detail?: string;
  /** The page it happened on. */
  url?: string;
  /** Recorded steps only: a small JPEG of the screen just after the step (data URL). */
  shot?: string;
}

const KINDS: Step['kind'][] = ['page', 'click', 'type', 'choose', 'check', 'uncheck', 'key', 'file'];

/** Automatic steps: how many and how far back. */
export const AUTO_STEPS = 10;
export const AUTO_MAX_AGE = 5 * 60_000;
/** Recorded steps: at most this many (the rest are dropped from the start, the bug is at the end). */
export const MAX_RECORDED_STEPS = 40;

const INTERACTIVE =
  'a[href],button,summary,label,select,textarea,input,[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=checkbox],[role=radio],[role=switch],[role=combobox],[contenteditable=""],[contenteditable=true]';

const clean = (s: string | null | undefined, max = 50): string => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The words a person would use for a control: "Save changes", "Email". Never an input's value. */
function nameOf(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return clean(aria);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const t = labelledBy.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' ');
    if (clean(t)) return clean(t);
  }
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    const labels = (el as HTMLInputElement).labels;
    const fromLabel = labels?.length ? clean(labels[0]!.textContent) : '';
    if (fromLabel) return fromLabel;
    const type = (el.getAttribute('type') || '').toLowerCase();
    // A button-like input shows its value as its label; that's on screen, not something the user typed.
    if (['submit', 'button', 'reset'].includes(type)) return clean(el.getAttribute('value')) || type;
    return clean(el.getAttribute('placeholder')) || clean(el.getAttribute('name')) || clean(el.id);
  }
  const text = clean((el as HTMLElement).innerText ?? el.textContent);
  if (text) return text;
  const img = el.querySelector('img[alt],svg title');
  const alt = img ? clean(img.getAttribute('alt') ?? img.textContent) : '';
  return alt || clean(el.getAttribute('title')) || '';
}

function roleWord(el: Element): string {
  const role = el.getAttribute('role');
  if (role) return { menuitem: 'menu item', menuitemcheckbox: 'menu item', menuitemradio: 'menu item', option: 'option', combobox: 'dropdown', switch: 'switch' }[role] ?? role;
  const tag = el.tagName;
  if (tag === 'A') return 'link';
  if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
  if (tag === 'SELECT') return 'dropdown';
  if (tag === 'TEXTAREA') return 'text box';
  if (tag === 'LABEL') return 'label';
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'option';
    if (type === 'file') return 'file picker';
    return 'field';
  }
  if ((el as HTMLElement).isContentEditable) return 'text box';
  return tag.toLowerCase();
}

/** The control the user meant: the nearest button, link or field around what they clicked. */
export function controlOf(el: Element): Element {
  return el.closest(INTERACTIVE) ?? el;
}

/** `button "Save changes"`, `field "Email"`, `div "Order #1234"`. */
export function describeTarget(el: Element): string {
  const c = controlOf(el);
  const name = nameOf(c);
  return name ? `${roleWord(c)} "${name}"` : roleWord(c);
}

const isTextEntry = (el: Element) => {
  if (el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable) return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  return !['submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'file', 'range', 'color'].includes(type);
};

/**
 * Watches the page for the user's actions and calls onStep for each.
 * Never reads what was typed: only that the user typed in a field, and which one.
 * Returns a function that stops watching.
 */
export function watchSteps(win: Window, onStep: (s: Omit<Step, 't'>) => void): () => void {
  const doc = win.document;
  const here = () => win.location.href;
  let lastUrl = here();
  onStep({ kind: 'page', url: lastUrl });

  const checkUrl = () => {
    const now = here();
    if (now !== lastUrl) {
      lastUrl = now;
      onStep({ kind: 'page', url: now });
    }
  };

  const safe = (fn: (e: Event) => void) => (e: Event) => {
    try {
      // Only what a person did, not clicks the page made itself.
      if (!e.isTrusted) return;
      fn(e);
    } catch {
      /* never break the page */
    }
  };

  const onClick = safe((e) => {
    const el = e.target as Element | null;
    if (!el || el.nodeType !== 1) return;
    const c = controlOf(el);
    // Fields, dropdowns and checkboxes report through "change" instead, which says what happened.
    if (isTextEntry(c) || c.tagName === 'SELECT' || (c.tagName === 'INPUT' && ['checkbox', 'radio', 'file'].includes((c.getAttribute('type') || '').toLowerCase()))) return;
    onStep({ kind: 'click', target: describeTarget(el), url: here() });
    // A click often changes the page address a moment later (client-side routing).
    setTimeout(checkUrl, 300);
  });

  const onChange = safe((e) => {
    const el = e.target as Element | null;
    if (!el || el.nodeType !== 1) return;
    const target = describeTarget(el);
    if (el.tagName === 'SELECT') {
      const sel = el as HTMLSelectElement;
      onStep({ kind: 'choose', target, detail: clean(sel.selectedOptions[0]?.textContent, 40), url: here() });
    } else if (el.tagName === 'INPUT') {
      const input = el as HTMLInputElement;
      const type = (input.type || 'text').toLowerCase();
      if (type === 'checkbox') onStep({ kind: input.checked ? 'check' : 'uncheck', target, url: here() });
      else if (type === 'radio') onStep({ kind: 'choose', target, url: here() });
      else if (type === 'file') onStep({ kind: 'file', target, url: here() });
      else if (isTextEntry(el)) onStep({ kind: 'type', target, url: here() });
    } else if (isTextEntry(el)) {
      onStep({ kind: 'type', target, url: here() });
    }
  });

  // Text boxes that never fire "change" (contenteditable editors) still count as typing, once per box.
  let typedIn: Element | null = null;
  const onInput = safe((e) => {
    const el = e.target as Element | null;
    if (!el || el.nodeType !== 1 || !(el as HTMLElement).isContentEditable || el === typedIn) return;
    typedIn = el;
    onStep({ kind: 'type', target: describeTarget(el), url: here() });
  });

  const onKey = safe((e) => {
    const k = e as KeyboardEvent;
    if (k.key !== 'Enter' && k.key !== 'Escape') return;
    if (k.key === 'Enter' && k.shiftKey) return; // a new line in a text box
    const el = k.target as Element | null;
    const inField = el && el.nodeType === 1 && el !== doc.body && el !== doc.documentElement;
    onStep({ kind: 'key', detail: k.key === 'Escape' ? 'Esc' : 'Enter', target: inField ? describeTarget(el) : undefined, url: here() });
    if (k.key === 'Enter') setTimeout(checkUrl, 300);
  });

  const opts = { capture: true, passive: true } as const;
  doc.addEventListener('click', onClick, opts);
  doc.addEventListener('change', onChange, opts);
  doc.addEventListener('input', onInput, opts);
  doc.addEventListener('keydown', onKey, opts);
  win.addEventListener('popstate', checkUrl);
  win.addEventListener('hashchange', checkUrl);
  const poll = win.setInterval(checkUrl, 1000);
  return () => {
    doc.removeEventListener('click', onClick, opts);
    doc.removeEventListener('change', onChange, opts);
    doc.removeEventListener('input', onInput, opts);
    doc.removeEventListener('keydown', onKey, opts);
    win.removeEventListener('popstate', checkUrl);
    win.removeEventListener('hashchange', checkUrl);
    win.clearInterval(poll);
  };
}

/** Adds a step, merging repeats (typing in the same field twice, the same page twice in a row). */
export function addStep(list: Step[], s: Step, max: number): Step[] {
  const last = list.at(-1);
  if (last && last.kind === s.kind && last.target === s.target && last.detail === s.detail && (s.kind === 'type' || (s.kind === 'page' && last.url === s.url))) {
    return list;
  }
  const next = [...list, s];
  return next.length > max ? next.slice(next.length - max) : next;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** Steps can come from the page (which can send anything): keep only known kinds and short, redacted strings. */
export function cleanStep(v: unknown, keepShot = false): Step | null {
  const s = v as Partial<Step> | null;
  if (!s || typeof s !== 'object' || !KINDS.includes(s.kind as Step['kind'])) return null;
  const target = str(s.target, 80);
  const detail = str(s.detail, 50);
  const url = str(s.url, 1000);
  const shot = keepShot && typeof s.shot === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s.shot) && s.shot.length < 400_000 ? s.shot : undefined;
  return {
    t: typeof s.t === 'number' && Number.isFinite(s.t) ? s.t : Date.now(),
    kind: s.kind as Step['kind'],
    ...(target && { target: redactText(target) }),
    ...(detail && { detail: redactText(detail) }),
    ...(url && { url: redactUrl(url) }),
    ...(shot && { shot }),
  };
}

export function cleanSteps(v: unknown, keepShot = false, max = MAX_RECORDED_STEPS): Step[] {
  return Array.isArray(v) ? v.slice(-max).map((s) => cleanStep(s, keepShot)).filter((s): s is Step => !!s) : [];
}

/** The last automatic steps worth showing: recent ones only. */
export function recentSteps(steps: Step[], now = Date.now()): Step[] {
  return steps.filter((s) => s.t >= now - AUTO_MAX_AGE).slice(-AUTO_STEPS);
}

function pathOf(url = ''): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
}

/** One step in plain words, for the report. Quotes and backticks from the page can't break the markdown. */
export function stepText(s: Step): string {
  const t = (s.target ?? '').replace(/`/g, "'");
  const d = (s.detail ?? '').replace(/["`]/g, "'");
  switch (s.kind) {
    case 'page':
      return `Opened \`${pathOf(s.url).replace(/[`\s]/g, '') || '/'}\``;
    case 'click':
      return `Clicked ${t || 'the page'}`;
    case 'type':
      return `Typed in ${t || 'a field'}`;
    case 'choose':
      return d ? `Chose "${d}" in ${t || 'a dropdown'}` : `Chose ${t || 'an option'}`;
    case 'check':
      return `Ticked ${t || 'a checkbox'}`;
    case 'uncheck':
      return `Unticked ${t || 'a checkbox'}`;
    case 'file':
      return `Picked a file in ${t || 'a file picker'}`;
    case 'key':
      return `Pressed ${d || 'a key'}${t ? ` in ${t}` : ''}`;
  }
}
