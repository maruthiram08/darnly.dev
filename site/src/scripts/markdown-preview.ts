// Markdown editor and preview: everything runs in the visitor's browser. Nothing is uploaded.
// Markdown goes through `marked`, then every tag and attribute is checked against an allowlist,
// so raw HTML in a document can never run scripts or load frames.

import { marked } from 'marked';
import { SAMPLE } from './markdown-preview-sample';

export {};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('md-input');
const preview = $<HTMLElement>('md-preview');
const stats = $<HTMLElement>('md-stats');
const verdict = $<HTMLElement>('md-verdict');
const issues = $<HTMLUListElement>('md-issues');
const toolbar = $<HTMLDivElement>('md-toolbar');
const status = $<HTMLElement>('md-status');
const htmlOut = $<HTMLElement>('md-html');
const htmlFold = $<HTMLDetailsElement>('md-html-fold');
const restored = $<HTMLElement>('md-restored');
const fileInput = $<HTMLInputElement>('md-file');

const STORE_KEY = 'darnly-markdown-draft';

// ---------- Sanitizing ----------

const DROP = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript', 'template',
  'svg', 'math', 'form', 'textarea', 'select', 'option', 'button', 'link', 'meta', 'base', 'title', 'head',
  'video', 'audio', 'source', 'track', 'canvas', 'portal', 'dialog',
]);

const ALLOWED: Record<string, string[]> = {
  a: ['href', 'title'],
  abbr: ['title'],
  b: [], blockquote: [], br: [], caption: [], cite: [], code: ['class'], dd: [], del: [], details: ['open'],
  div: [], dl: [], dt: [], em: [], figcaption: [], figure: [],
  h1: [], h2: [], h3: [], h4: [], h5: [], h6: [], hr: [], i: [],
  img: ['src', 'alt', 'title', 'width', 'height'],
  input: ['type', 'checked', 'disabled'],
  ins: [], kbd: [], li: [], mark: [], ol: ['start', 'reversed'], p: [], pre: [], q: [], s: [], samp: [],
  small: [], span: [], strike: [], strong: [], sub: [], summary: [], sup: [],
  table: [], tbody: [], td: ['colspan', 'rowspan'], tfoot: [], th: ['colspan', 'rowspan'], thead: [], tr: [],
  u: [], ul: [], var: [], picture: [],
};
const GLOBAL_ATTRS = ['align', 'lang', 'dir'];

function safeUrl(raw: string, forImage: boolean): string | null {
  const url = raw.replace(/[\u0000- \u007f-\u009f]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!scheme) return raw.trim(); // relative link, #anchor or path
  const s = scheme[1].toLowerCase();
  if (s === 'http' || s === 'https') return raw.trim();
  if (!forImage && s === 'mailto') return raw.trim();
  if (forImage && /^data:image\/(png|jpe?g|gif|webp|avif);/i.test(url)) return url;
  return null;
}

function clean(parent: Node): void {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) continue;
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove(); // comments, processing instructions
      continue;
    }
    const el = node as Element;
    const tag = el.localName;
    if (DROP.has(tag)) {
      el.remove();
      continue;
    }
    const allowed = ALLOWED[tag];
    if (!allowed) {
      // Unknown tag: keep what's inside, lose the tag.
      clean(el);
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!allowed.includes(name) && !GLOBAL_ATTRS.includes(name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'href' || name === 'src') {
        const ok = safeUrl(attr.value, name === 'src');
        if (ok === null) el.removeAttribute(attr.name);
        else el.setAttribute(name, ok);
      }
      if (name === 'class' && !/^language-[\w+#.-]{1,30}$/.test(attr.value)) el.removeAttribute(attr.name);
    }
    if (tag === 'input' && el.getAttribute('type')?.toLowerCase() !== 'checkbox') {
      el.remove();
      continue;
    }
    clean(el);
  }
}

// ---------- Syntax colors ----------

type Lang = { re: RegExp; keywords: Set<string>; caseless?: boolean; tags?: boolean; lines?: boolean };

const words = (s: string) => new Set(s.split(' '));
const STR = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'`;
const NUM = String.raw`\b(?:0x[\da-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b`;
const WORD = String.raw`[A-Za-z_$][\w$]*`;
const lang = (comment: string, str: string, keywords: string, extra = '', caseless = false): Lang => ({
  re: new RegExp(`(?<c>${comment})|(?<s>${str})|(?<n>${NUM})|${extra}(?<w>${WORD})`, caseless ? 'gi' : 'g'),
  keywords: words(caseless ? keywords.toLowerCase() : keywords),
  caseless,
});

const JS_KW = 'abstract any as async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface keyof let module namespace never new null number of private protected public readonly return satisfies set static string super switch this throw true try type typeof undefined unknown var void while with yield';
const clike = lang(String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`, `${STR}|\`(?:[^\`\\\\]|\\\\.)*\``, JS_KW + ' fn func go package defer chan map struct impl pub use mut match self Self loop where trait crate int float double char long short unsigned bool void include define echo php');
const hash = lang('#[^\\n]*', `"""[\\s\\S]*?"""|${STR}`, 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield begin end do then fi esac case done function local export echo cd sudo npm npx pnpm yarn bun git curl true false null');
const css = lang(String.raw`\/\*[\s\S]*?\*\/`, STR, 'important', String.raw`(?<a>@[\w-]+)|(?<h>#[\da-fA-F]{3,8}\b)|(?<p>[\w-]+(?=\s*:))|`);
const sql = lang('--[^\\n]*', STR, 'select from where and or not insert into values update set delete create table alter drop index primary key foreign references join left right inner outer on group by order having limit offset as distinct count null is in like between union all case when then else end default unique returning with', '', true);
const markup: Lang = {
  re: /(?<c><!--[\s\S]*?-->)|(?<t><\/?[\w-]+|\/?>)|(?<s>"[^"]*"|'[^']*')|(?<a>[\w:-]+(?==))/g,
  keywords: new Set(),
  tags: true,
};
const diff: Lang = { re: /^(?<add>\+[^\n]*)|^(?<del>-[^\n]*)|^(?<at>@@[^\n]*)/gm, keywords: new Set(), lines: true };

const LANGS: Record<string, Lang> = {
  js: clike, javascript: clike, jsx: clike, ts: clike, typescript: clike, tsx: clike, mjs: clike, cjs: clike,
  json: clike, jsonc: clike, java: clike, c: clike, cpp: clike, 'c++': clike, cs: clike, csharp: clike, go: clike,
  rust: clike, rs: clike, swift: clike, kotlin: clike, kt: clike, php: clike, dart: clike, scala: clike,
  py: hash, python: hash, rb: hash, ruby: hash, sh: hash, bash: hash, shell: hash, zsh: hash, console: hash,
  yaml: hash, yml: hash, toml: hash, ini: hash, dockerfile: hash, docker: hash, env: hash, r: hash, makefile: hash,
  css: css, scss: css, sass: css, less: css, postcss: css,
  html: markup, xml: markup, svg: markup, vue: markup, svelte: markup, astro: markup,
  sql: sql, postgres: sql, postgresql: sql, mysql: sql, sqlite: sql,
  diff: diff, patch: diff,
};

const span = (cls: string, text: string) => {
  const s = document.createElement('span');
  s.className = `tok-${cls}`;
  s.textContent = text;
  return s;
};

function highlight(code: HTMLElement, langName: string): void {
  const l = LANGS[langName.toLowerCase()];
  const text = code.textContent ?? '';
  if (!l || text.length > 40000) return;
  const out = document.createDocumentFragment();
  let last = 0;
  l.re.lastIndex = 0;
  for (const m of text.matchAll(l.re)) {
    const g = m.groups ?? {};
    const value = m[0];
    if (!value) continue;
    let cls = '';
    if (g.c) cls = 'c';
    else if (g.s) cls = 's';
    else if (g.n) cls = 'n';
    else if (g.t) cls = 'k';
    else if (g.a || g.p) cls = 'a';
    else if (g.h) cls = 'n';
    else if (g.add) cls = 'add';
    else if (g.del) cls = 'del';
    else if (g.at) cls = 'a';
    else if (g.w) {
      if (l.keywords.has(l.caseless ? value.toLowerCase() : value)) cls = 'k';
      else if (text[m.index + value.length] === '(') cls = 'f';
    }
    if (!cls) continue;
    if (m.index > last) out.append(text.slice(last, m.index));
    out.append(span(cls, value));
    last = m.index + value.length;
  }
  if (last === 0) return;
  out.append(text.slice(last));
  code.replaceChildren(out);
}

// ---------- Rendering ----------

const ALERTS: Record<string, [string, string]> = {
  NOTE: ['note', 'ⓘ Note'],
  TIP: ['tip', '💡 Tip'],
  IMPORTANT: ['important', '❗ Important'],
  WARNING: ['warning', '⚠️ Warning'],
  CAUTION: ['caution', '🛑 Caution'],
};

function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-');
}

// Where each "- [ ]" task box sits in the source, so ticking one in the preview can tick it in the text.
function taskPositions(src: string): number[] {
  const out: number[] = [];
  let fence: string | null = null;
  let offset = 0;
  for (const line of src.split('\n')) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    } else if (!fence) {
      const m = /^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+\[)[ xX](?=\]\s)/.exec(line);
      if (m) out.push(offset + m[1].length);
    }
    offset += line.length + 1;
  }
  return out;
}

function unclosedFence(src: string): boolean {
  let fence: string | null = null;
  for (const line of src.split('\n')) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (!f) continue;
    if (!fence) fence = f[1];
    else if (f[1][0] === fence[0] && f[1].length >= fence.length && /^\s{0,3}[`~]+\s*$/.test(line)) fence = null;
  }
  return fence !== null;
}

function build(src: string): HTMLElement {
  const html = marked.parse(src, { gfm: true, breaks: false, async: false }) as string;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const body = doc.body;
  clean(body);

  // GitHub alerts: > [!NOTE]
  for (const bq of Array.from(body.querySelectorAll('blockquote'))) {
    const p = bq.firstElementChild;
    if (!p || p.localName !== 'p') continue;
    const first = p.firstChild;
    if (!first || first.nodeType !== Node.TEXT_NODE) continue;
    const m = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(first.textContent ?? '');
    if (!m) continue;
    const [kind, label] = ALERTS[m[1].toUpperCase()];
    first.textContent = (first.textContent ?? '').slice(m[0].length);
    if (p.firstChild?.nodeName === 'BR') p.firstChild.remove();
    if (!p.textContent?.trim() && !p.querySelector('img')) p.remove();
    const box = doc.createElement('div');
    box.className = `md-alert md-alert-${kind}`;
    const title = doc.createElement('p');
    title.className = 'md-alert-title';
    title.textContent = label;
    box.append(title, ...Array.from(bq.childNodes));
    bq.replaceWith(box);
  }

  // Heading anchors, prefixed so a heading can never take over one of this page's ids.
  const seen = new Map<string, number>();
  for (const h of Array.from(body.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
    const base = slugify(h.textContent ?? '') || 'section';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    h.id = `user-content-${n ? `${base}-${n}` : base}`;
  }

  // Links open in a new tab; #anchors scroll inside the preview.
  for (const a of Array.from(body.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    if (!href.startsWith('#')) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer nofollow ugc');
    }
  }

  // Images load without sending where they were seen.
  for (const img of Array.from(body.querySelectorAll('img'))) {
    img.setAttribute('loading', 'lazy');
    img.setAttribute('referrerpolicy', 'no-referrer');
  }

  // Code colors.
  for (const code of Array.from(body.querySelectorAll('pre > code'))) {
    const cls = code.getAttribute('class') ?? '';
    const m = /^language-(.+)$/.exec(cls);
    if (m) {
      code.parentElement?.setAttribute('data-lang', m[1]);
      highlight(code as HTMLElement, m[1]);
    }
  }

  // Task boxes become clickable when they line up with the source.
  const boxes = Array.from(body.querySelectorAll<HTMLInputElement>('li > input[type="checkbox"]'));
  const positions = taskPositions(src);
  if (boxes.length === positions.length) {
    boxes.forEach((box, i) => {
      box.removeAttribute('disabled');
      box.dataset.task = String(positions[i]);
      box.setAttribute('aria-label', 'Tick this task');
      box.closest('li')?.classList.add('task');
    });
  } else {
    boxes.forEach((box) => box.closest('li')?.classList.add('task'));
  }
  for (const list of Array.from(body.querySelectorAll('ul, ol'))) {
    if (list.querySelector(':scope > li.task')) list.classList.add('tasks');
  }
  return body;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function checks(src: string, body: HTMLElement): string[] {
  const out: string[] = [];
  if (unclosedFence(src)) out.push('A code block (```) is never closed, so everything after it shows as code. Add a closing ``` line.');
  const noAlt = body.querySelectorAll('img:not([alt]), img[alt=""]').length;
  if (noAlt) out.push(`${plural(noAlt, 'image')} ${noAlt === 1 ? 'has' : 'have'} no description. Write one inside the brackets: ![a short description](…)`);
  const emptyLinks = Array.from(body.querySelectorAll('a')).filter((a) => !(a.getAttribute('href') ?? '').trim()).length;
  if (emptyLinks) out.push(`${plural(emptyLinks, 'link')} ${emptyLinks === 1 ? 'has' : 'have'} no address yet. Put it inside the brackets: [text](https://…)`);
  let prev = 0;
  for (const h of Array.from(body.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
    const level = Number(h.localName[1]);
    if (prev && level > prev + 1) {
      out.push(`The heading “${(h.textContent ?? '').trim().slice(0, 40)}” jumps from level ${prev} to ${level}. Use ${'#'.repeat(prev + 1)} so it nests right.`);
      break;
    }
    prev = level;
  }
  const h1s = body.querySelectorAll('h1').length;
  if (h1s > 1) out.push(`There are ${h1s} top headings (#). Most READMEs have one title and use ## for sections.`);
  const lost = (src.match(/<(script|iframe|style|object|embed|form)\b/gi) ?? []).length;
  if (lost) out.push(`${plural(lost, 'HTML tag')} like <script> or <iframe> ${lost === 1 ? 'was' : 'were'} removed. GitHub strips these too.`);
  return out;
}

let renderedSrc = '';

function render(): void {
  const src = input.value;
  renderedSrc = src;
  const body = build(src);
  preview.replaceChildren(...Array.from(body.childNodes));
  if (!src.trim()) {
    const empty = document.createElement('p');
    empty.className = 'md-empty';
    empty.textContent = 'Start typing on the left, or use the buttons above it. Your preview shows up here.';
    preview.append(empty);
  }

  const text = (preview.textContent ?? '').trim();
  const wordCount = src.trim() ? (text.match(/\S+/g) ?? []).length : 0;
  const mins = Math.max(1, Math.round(wordCount / 230));
  stats.textContent = `${plural(wordCount, 'word')} · ${mins} min read`;

  const found = src.trim() ? checks(src, preview) : [];
  issues.replaceChildren(
    ...found.map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }),
  );
  verdict.dataset.tone = found.length ? 'warn' : 'ok';
  verdict.textContent = found.length ? `${plural(found.length, 'thing')} to check` : '✓ Looks right';
  verdict.setAttribute('aria-expanded', String(!issues.hidden));
  if (!found.length) issues.hidden = true;

  if (htmlFold.open) htmlOut.textContent = bodyHtml();
}

let timer = 0;
function scheduleRender(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(render, input.value.length > 30000 ? 250 : 60);
  save();
}

// ---------- Saving the draft ----------

let saveTimer = 0;
function save(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      if (input.value === SAMPLE) localStorage.removeItem(STORE_KEY);
      else localStorage.setItem(STORE_KEY, input.value);
    } catch {
      /* private mode: nothing saved */
    }
  }, 400);
}

function loadDraft(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

// ---------- Editing helpers ----------

function replaceRange(start: number, end: number, text: string, selStart: number, selEnd = selStart): void {
  input.focus();
  input.setSelectionRange(start, end);
  // insertText keeps Ctrl+Z working; fall back where it's missing.
  const ok = document.execCommand?.('insertText', false, text);
  if (!ok) {
    input.setRangeText(text, start, end, 'end');
    input.dispatchEvent(new Event('input'));
  }
  input.setSelectionRange(selStart, selEnd);
}

function wrap(before: string, after: string, placeholder: string): void {
  const { selectionStart: s, selectionEnd: e, value } = input;
  const sel = value.slice(s, e);
  if (sel && value.slice(s - before.length, s) === before && value.slice(e, e + after.length) === after) {
    replaceRange(s - before.length, e + after.length, sel, s - before.length, e - before.length);
    return;
  }
  const inner = sel || placeholder;
  replaceRange(s, e, before + inner + after, s + before.length, s + before.length + inner.length);
}

function lineBounds(): [number, number] {
  const { selectionStart: s, selectionEnd: e, value } = input;
  const start = value.lastIndexOf('\n', s - 1) + 1;
  let end = value.indexOf('\n', e > s && value[e - 1] === '\n' ? e - 1 : e);
  if (end === -1) end = value.length;
  return [start, end];
}

function prefixLines(make: (i: number) => string, strip: RegExp): void {
  const [start, end] = lineBounds();
  const lines = input.value.slice(start, end).split('\n');
  if (lines.length === 1 && !lines[0].trim()) {
    const text = make(0);
    replaceRange(start, end, text, start + text.length);
    return;
  }
  const all = lines.every((l) => strip.test(l) || !l.trim());
  const next = lines
    .map((l, i) => (all ? l.replace(strip, '') : l.trim() ? make(i) + l.replace(/^(#{1,6} |> |[-*+] \[[ xX]\] |[-*+] |\d+\. )/, '') : l))
    .join('\n');
  replaceRange(start, end, next, start, start + next.length);
}

function insertBlock(block: string, selectFrom?: string): void {
  const { selectionStart: s, selectionEnd: e, value } = input;
  const before = value.slice(0, s);
  const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const after = value.slice(e);
  const trail = !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const text = lead + block + trail;
  const at = selectFrom ? text.indexOf(selectFrom) : -1;
  if (at >= 0) replaceRange(s, e, text, s + at, s + at + selectFrom!.length);
  else replaceRange(s, e, text, s + lead.length + block.length);
}

const ACTIONS: Record<string, () => void> = {
  heading: () => prefixLines(() => '## ', /^#{1,6} /),
  bold: () => wrap('**', '**', 'bold text'),
  italic: () => wrap('_', '_', 'italic text'),
  strike: () => wrap('~~', '~~', 'crossed out'),
  code: () => wrap('`', '`', 'code'),
  link: () => {
    const { selectionStart: s, selectionEnd: e, value } = input;
    const sel = value.slice(s, e);
    if (/^https?:\/\/\S+$/.test(sel)) {
      replaceRange(s, e, `[link text](${sel})`, s + 1, s + 10);
    } else {
      const label = sel || 'link text';
      const text = `[${label}](https://)`;
      replaceRange(s, e, text, s + label.length + 3, s + text.length - 1);
    }
  },
  image: () => {
    const { selectionStart: s, selectionEnd: e } = input;
    const text = '![describe the image](https://)';
    replaceRange(s, e, text, s + 2, s + 20);
  },
  quote: () => prefixLines(() => '> ', /^> ?/),
  ul: () => prefixLines(() => '- ', /^[-*+] (?!\[)/),
  ol: () => prefixLines((i) => `${i + 1}. `, /^\d+\. /),
  task: () => prefixLines(() => '- [ ] ', /^[-*+] \[[ xX]\] /),
  codeblock: () => {
    const { selectionStart: s, selectionEnd: e, value } = input;
    const sel = value.slice(s, e);
    if (sel) insertBlock('```\n' + sel.replace(/\n$/, '') + '\n```');
    else insertBlock('```js\nconsole.log("hello");\n```', 'console.log("hello");');
  },
  table: () => insertBlock('| Column | Column |\n| --- | --- |\n| Cell | Cell |\n| Cell | Cell |', 'Column'),
  alert: () => insertBlock('> [!NOTE]\n> Something people should know.', 'Something people should know.'),
  hr: () => insertBlock('---'),
};

toolbar.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (!btn) return;
  ACTIONS[btn.dataset.action!]?.();
});

input.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey) {
    const key = e.key.toLowerCase();
    const action = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'k' ? 'link' : '';
    if (action) {
      e.preventDefault();
      ACTIONS[action]();
    }
    return;
  }
  // Enter in a list carries on the list; Enter on an empty item ends it.
  if (e.key === 'Enter' && !e.shiftKey && input.selectionStart === input.selectionEnd) {
    const { selectionStart: s, value } = input;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const line = value.slice(lineStart, s);
    const m = /^(\s*(?:> )?)([-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) )/.exec(line);
    if (!m || value.slice(s, value.indexOf('\n', s) === -1 ? value.length : value.indexOf('\n', s)).trim()) return;
    e.preventDefault();
    if (line.trim() === m[2].trim()) {
      replaceRange(lineStart, s, m[1].replace(/> $/, ''), lineStart + m[1].replace(/> $/, '').length);
      return;
    }
    let marker = m[2];
    if (m[3]) marker = `${Number(m[3]) + 1}${m[4]} `;
    else if (/\[[ xX]\]/.test(marker)) marker = marker.replace(/\[[xX]\]/, '[ ]');
    const text = `\n${m[1]}${marker}`;
    replaceRange(s, s, text, s + text.length);
  }
});

input.addEventListener('input', scheduleRender);

// Tick a task in the preview, tick it in the text.
preview.addEventListener('change', (e) => {
  const box = e.target as HTMLInputElement;
  const at = Number(box.dataset.task);
  if (!box.dataset.task || input.value !== renderedSrc) return;
  const v = input.value;
  if (!/[ xX]/.test(v[at] ?? '')) return;
  input.value = v.slice(0, at) + (box.checked ? 'x' : ' ') + v.slice(at + 1);
  renderedSrc = input.value;
  save();
  if (htmlFold.open) htmlOut.textContent = bodyHtml();
});

// #anchor links scroll inside the preview.
preview.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a');
  const href = a?.getAttribute('href') ?? '';
  if (!href.startsWith('#')) return;
  e.preventDefault();
  let id = href.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    /* keep as typed */
  }
  const target = document.getElementById(`user-content-${id}`) ?? document.getElementById(`user-content-${slugify(id)}`);
  if (target && preview.contains(target)) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Keep the preview roughly in step with where you're typing.
let syncing = false;
input.addEventListener('scroll', () => {
  if (syncing || preview.scrollHeight <= preview.clientHeight) return;
  const max = input.scrollHeight - input.clientHeight;
  if (max <= 0) return;
  syncing = true;
  preview.scrollTop = (input.scrollTop / max) * (preview.scrollHeight - preview.clientHeight);
  requestAnimationFrame(() => (syncing = false));
});

// ---------- Export ----------

function cleanForExport(): HTMLElement {
  const copy = preview.cloneNode(true) as HTMLElement;
  copy.querySelector('.md-empty')?.remove();
  for (const el of Array.from(copy.querySelectorAll('[id^="user-content-"]'))) el.id = el.id.slice(13);
  for (const box of Array.from(copy.querySelectorAll('input'))) {
    box.setAttribute('disabled', '');
    box.removeAttribute('data-task');
    box.removeAttribute('aria-label');
    if (box.checked) box.setAttribute('checked', '');
    else box.removeAttribute('checked');
  }
  for (const img of Array.from(copy.querySelectorAll('img'))) img.removeAttribute('loading');
  return copy;
}

function bodyHtml(): string {
  return cleanForExport().innerHTML.trim();
}

function docTitle(): string {
  const h = preview.querySelector('h1, h2');
  return (h?.textContent ?? '').trim() || 'Document';
}

function fileBase(): string {
  return slugify(docTitle()).slice(0, 60) || 'document';
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function fullHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(docTitle())}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<article class="markdown-body">
${bodyHtml()}
</article>
</body>
</html>
`;
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function say(text: string): void {
  status.textContent = text;
}

async function copyText(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
  } catch {
    say('Your browser blocked copying. Open “See the HTML code”, select it and copy it by hand.');
  }
}

// Inline styles so the formatting survives a paste into Google Docs, Notion, Word or an email.
function richHtml(): string {
  const copy = cleanForExport();
  const style = (sel: string, css: string) => copy.querySelectorAll<HTMLElement>(sel).forEach((el) => el.setAttribute('style', css));
  style('table', 'border-collapse:collapse');
  style('th,td', 'border:1px solid #d0d7de;padding:6px 12px');
  style('th', 'border:1px solid #d0d7de;padding:6px 12px;background:#f6f8fa;font-weight:600');
  style('pre', 'background:#f6f8fa;padding:12px 16px;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap');
  style('code', 'font-family:Menlo,Consolas,monospace;background:#f2f4f6;padding:1px 4px;border-radius:4px');
  style('pre code', 'font-family:Menlo,Consolas,monospace');
  style('blockquote', 'border-left:4px solid #d0d7de;margin:0;padding:0 1em;color:#59636e');
  style('.md-alert', 'border-left:4px solid #0969da;padding:4px 1em;margin:0 0 1em');
  style('.md-alert-title', 'font-weight:600;margin:0 0 4px');
  for (const [cls, color] of Object.entries(SYNTAX_COLORS)) style(`.tok-${cls}`, `color:${color}`);
  return `<meta charset="utf-8">${copy.innerHTML}`;
}

async function copyRich(): Promise<void> {
  const html = richHtml();
  const plain = input.value;
  try {
    if (typeof ClipboardItem === 'undefined') throw new Error('no ClipboardItem');
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      }),
    ]);
    say('Copied with formatting. Paste it into Notion, Google Docs, Word or an email.');
  } catch {
    // Older browsers: select the preview and copy what's on screen.
    const range = document.createRange();
    range.selectNodeContents(preview);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = document.execCommand('copy');
    sel?.removeAllRanges();
    say(ok ? 'Copied with formatting. Paste it into Notion, Google Docs, Word or an email.' : 'Your browser blocked copying. Select the preview and press Ctrl+C (⌘C on a Mac).');
  }
}

$('md-copy-rich').addEventListener('click', copyRich);
$('md-download-html').addEventListener('click', () => {
  download(`${fileBase()}.html`, fullHtml(), 'text/html');
  say(`Saved ${fileBase()}.html. Open it in any browser, or upload it as a page.`);
});
$('md-copy-html').addEventListener('click', () => copyText(bodyHtml(), 'HTML copied.'));
$('md-copy-md').addEventListener('click', () => copyText(input.value, 'Markdown copied. Paste it into a README.md file or a GitHub comment.'));
$('md-download-md').addEventListener('click', () => {
  const name = /^(readme|# )/i.test(input.value.trim()) && /readme/i.test(docTitle() + input.value.slice(0, 200)) ? 'README.md' : `${fileBase()}.md`;
  download(name, input.value, 'text/markdown');
  say(`Saved ${name}.`);
});

htmlFold.addEventListener('toggle', () => {
  if (htmlFold.open) htmlOut.textContent = bodyHtml();
});

verdict.addEventListener('click', () => {
  if (verdict.dataset.tone !== 'warn') return;
  issues.hidden = !issues.hidden;
  verdict.setAttribute('aria-expanded', String(!issues.hidden));
});

// ---------- Loading text ----------

function setText(text: string): void {
  input.value = text;
  input.scrollTop = 0;
  preview.scrollTop = 0;
  render();
  save();
}

$('md-sample').addEventListener('click', () => {
  if (input.value.trim() && input.value !== SAMPLE && !confirm('Replace your text with the sample README?')) return;
  setText(SAMPLE);
  restored.hidden = true;
  say('Sample README loaded.');
});
$('md-clear').addEventListener('click', () => {
  if (input.value.trim() && input.value !== SAMPLE && !confirm('Clear everything you wrote?')) return;
  setText('');
  restored.hidden = true;
  input.focus();
});

async function openFile(file: File): Promise<void> {
  if (file.size > 2_000_000) {
    say('That file is over 2 MB. Open a smaller Markdown file.');
    return;
  }
  setText(await file.text());
  restored.hidden = true;
  say(`Opened ${file.name}.`);
}

$('md-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) openFile(f);
  fileInput.value = '';
});
input.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
input.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files[0];
  if (!f) return;
  e.preventDefault();
  openFile(f);
});

// ---------- Start ----------

const draft = loadDraft();
if (draft && draft.trim() && draft !== SAMPLE) {
  input.value = draft;
  restored.hidden = false;
} else {
  input.value = SAMPLE;
}
render();

// ---------- Styles for the exported file ----------

const SYNTAX_COLORS: Record<string, string> = {
  c: '#6e7781', s: '#0a3069', n: '#0550ae', k: '#cf222e', f: '#8250df', a: '#0550ae', add: '#116329', del: '#82071e',
};

const EXPORT_CSS = `
body{margin:0;background:#fff;color:#1f2328;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.markdown-body{max-width:860px;margin:0 auto;padding:40px 24px}
.markdown-body>*:first-child{margin-top:0}
h1,h2,h3,h4,h5,h6{margin:24px 0 16px;font-weight:600;line-height:1.25}
h1{font-size:2em;padding-bottom:.3em;border-bottom:1px solid #d1d9e0}
h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid #d1d9e0}
h3{font-size:1.25em}
p,ul,ol,blockquote,pre,table,details,.md-alert{margin:0 0 16px}
a{color:#0969da}
img{max-width:100%}
p img{display:inline-block;vertical-align:middle}
ul,ol{padding-left:2em}
li+li{margin-top:.25em}
ul.tasks{list-style:none;padding-left:1.2em}
li.task>input{margin:0 .4em 0 -1.2em;vertical-align:middle}
code{font:85% ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#eff1f3;padding:.2em .4em;border-radius:6px}
pre{background:#f6f8fa;padding:16px;border-radius:6px;overflow:auto;line-height:1.45}
pre code{background:none;padding:0;font-size:85%}
blockquote{margin-left:0;padding:0 1em;color:#59636e;border-left:.25em solid #d1d9e0}
hr{height:.25em;border:0;background:#d1d9e0;margin:24px 0}
table{border-collapse:collapse;display:block;overflow:auto;max-width:100%}
th,td{border:1px solid #d1d9e0;padding:6px 13px}
th{font-weight:600;background:#f6f8fa}
tr:nth-child(2n) td{background:#f6f8fa}
kbd{font:11px ui-monospace,Menlo,monospace;padding:3px 5px;border:1px solid #d1d9e0;border-bottom-width:2px;border-radius:6px;background:#f6f8fa}
.md-alert{padding:8px 16px;border-left:.25em solid #0969da}
.md-alert>:last-child{margin-bottom:0}
.md-alert-title{font-weight:600;margin-bottom:4px}
.md-alert-note{border-color:#0969da}.md-alert-note .md-alert-title{color:#0969da}
.md-alert-tip{border-color:#1a7f37}.md-alert-tip .md-alert-title{color:#1a7f37}
.md-alert-important{border-color:#8250df}.md-alert-important .md-alert-title{color:#8250df}
.md-alert-warning{border-color:#9a6700}.md-alert-warning .md-alert-title{color:#9a6700}
.md-alert-caution{border-color:#d1242f}.md-alert-caution .md-alert-title{color:#d1242f}
${Object.entries(SYNTAX_COLORS).map(([k, v]) => `.tok-${k}{color:${v}}`).join('')}
`;
