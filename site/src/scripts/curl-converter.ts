// curl converter: everything runs in the visitor's browser. Nothing is sent anywhere.
import { parseCurl, generate, isSecretHeader, secretQuery, CurlError, EXAMPLES, type Lang, type Request, type Env } from './curl-converter-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>('cc-input');
const error = $<HTMLDivElement>('cc-error');
const out = $<HTMLDivElement>('cc-out');
const verdict = $<HTMLParagraphElement>('cc-verdict');
const methodEl = $<HTMLSpanElement>('cc-method');
const urlEl = $<HTMLSpanElement>('cc-url');
const rows = $<HTMLDivElement>('cc-rows');
const warn = $<HTMLDivElement>('cc-warn');
const toNext = $<HTMLButtonElement>('cc-to-next');
const code = $<HTMLPreElement>('cc-code');
const tabNote = $<HTMLParagraphElement>('cc-tab-note');
const copy = $<HTMLButtonElement>('cc-copy');
const envToggle = $<HTMLInputElement>('cc-env');
const envBox = $<HTMLDivElement>('cc-env-box');
const envCode = $<HTMLPreElement>('cc-env-code');
const envCopy = $<HTMLButtonElement>('cc-env-copy');
const promptBtn = $<HTMLButtonElement>('cc-prompt');
const notesBox = $<HTMLDetailsElement>('cc-notes-box');
const notesSum = $<HTMLElement>('cc-notes-sum');
const notesList = $<HTMLUListElement>('cc-notes');
const tabs = [...document.querySelectorAll<HTMLButtonElement>('#cc-tabs [role="tab"]')];
const chips = [...document.querySelectorAll<HTMLButtonElement>('[data-example]')];

let lang: Lang = 'fetch';
let req: Request | null = null;
let current = { code: '', env: [] as Env[] };
let secretCount = 0;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// "sk-proj-4f9a…" so screenshots of the card don't show the whole key.
const mask = (v: string) => {
  const m = /^(Bearer|Token|Basic|Bot)\s+(.+)$/i.exec(v);
  const word = m ? m[1] + ' ' : '';
  const key = m ? m[2] : v;
  return key.length <= 8 ? word + '•'.repeat(key.length) : word + key.slice(0, 7) + '•'.repeat(Math.min(12, key.length - 7));
};

function kv(name: string, value: string, secret = false, tag?: string) {
  const row = el('div', secret ? 'kv secret' : 'kv');
  const dt = el('dt', '', name);
  if (secret) dt.append(el('span', 'tag', 'secret'));
  else if (tag) dt.append(el('span', 'tag soft', tag));
  row.append(dt, el('dd', '', secret ? mask(value) : value || '(empty)'));
  return row;
}

function section(title: string, ...children: Node[]) {
  const s = el('div');
  s.append(el('h3', '', title), ...children);
  return s;
}

function renderCard(r: Request) {
  methodEl.textContent = r.method;
  methodEl.className = `method m-${r.method}`;
  const u = new URL(r.url);
  urlEl.replaceChildren(el('span', 'path', u.protocol + '//'), el('span', 'host', u.host), el('span', 'path', u.pathname));
  rows.replaceChildren();

  const secretQ = secretQuery(r.url);
  const params = [...u.searchParams];
  if (params.length) {
    const dl = el('dl');
    for (const [k, v] of params) dl.append(kv(k, v, secretQ.includes(k)));
    rows.append(section('Query', dl));
  }

  const dl = el('dl');
  for (const h of r.headers) dl.append(kv(h.name, h.value, isSecretHeader(h)));
  if (r.basic) dl.append(kv('Login (-u)', r.basic.user + (r.basic.pass ? ':' + r.basic.pass : ''), true));
  rows.append(section('Headers', ...(dl.childElementCount ? [dl] : [el('p', 'none', 'No headers.')])));

  const b = r.body;
  if (b.kind === 'json') rows.append(section('Body · JSON', el('pre', 'body', JSON.stringify(b.value, null, 2))));
  else if (b.kind === 'urlencoded') {
    const d = el('dl');
    for (const [k, v] of b.fields) d.append(kv(k, v));
    rows.append(section('Body · form fields', d));
  } else if (b.kind === 'multipart') {
    const d = el('dl');
    for (const f of b.fields) d.append(kv(f.name, f.value, false, f.file ? 'file' : undefined));
    rows.append(section('Body · multipart form', d));
  } else if (b.kind === 'raw') rows.append(section('Body · text', el('pre', 'body', b.text)));

  secretCount = r.headers.filter(isSecretHeader).length + secretQ.length + (r.basic ? 1 : 0);
  const bodyWord = { none: 'no body', json: 'a JSON body', urlencoded: 'form fields', raw: 'a text body', multipart: 'a file upload form' }[b.kind];
  const where = `${r.method} to ${u.hostname} with ${bodyWord}`;
  if (secretCount) {
    verdict.textContent = `${where}. ${secretCount === 1 ? '1 secret key' : `${secretCount} secret keys`} found: keep ${secretCount === 1 ? 'it' : 'them'} on a server.`;
    verdict.className = 'verdict bad';
  } else {
    verdict.textContent = `${where}. No secret keys found, so this is safe in browser code.`;
    verdict.className = 'verdict';
  }
  warn.hidden = !secretCount;
}

// Small highlighter: strings, comments, env vars and a few keywords.
const TOKENS = /(\/\/[^\n]*|#[^\n]*)|(`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|(process\.env\.\w+|os\.environ\[[^\]]+\])|\b(const|await|async|export|function|return|import|from|if|throw|new|def|None|True|False)\b/g;
function highlight(text: string, python: boolean) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(TOKENS)) {
    if (m[1] && (python ? m[1].startsWith('//') : m[1].startsWith('#'))) continue;
    const at = m.index ?? 0;
    if (at > last) frag.append(text.slice(last, at));
    const cls = m[1] ? 'c' : m[2] ? (/process\.env|os\.environ/.test(m[2]) ? 'e' : 's') : m[3] ? 'e' : 'k';
    frag.append(el('span', cls, m[0]));
    last = at + m[0].length;
  }
  frag.append(text.slice(last));
  code.replaceChildren(frag);
}

const NOTES: Record<Lang, string> = {
  fetch: 'Built into browsers, Node.js 18+, Next.js and Cloudflare Workers. Nothing to install.',
  axios: 'Run npm install axios first.',
  node: 'Node.js 18 or newer. Save as a .mjs file (or use "type": "module") so await works at the top level.',
  python: 'Run pip install requests first.',
  next: 'Save as app/api/…/route.ts in a Next.js App Router project. The key stays on the server.',
};

function renderCode() {
  if (!req) return;
  current = generate(req, lang, envToggle.checked);
  highlight(current.code, lang === 'python');
  copy.textContent = 'Copy';
  const browserLike = lang === 'fetch' || lang === 'axios';
  if (secretCount && browserLike) {
    tabNote.textContent = 'This code has a secret key. Only run it on a server (an API route or backend), never in a page’s code. The Next.js route tab does this for you.';
    tabNote.className = 'tab-note bad';
  } else {
    tabNote.textContent = NOTES[lang];
    tabNote.className = 'tab-note';
  }
  envBox.hidden = !current.env.length;
  envCode.textContent = current.env.map((e) => `${e.name}=${e.value}`).join('\n');
  envCopy.textContent = 'Copy';
}

function render() {
  const text = input.value;
  error.hidden = true;
  if (!text.trim()) {
    out.classList.add('dim');
    req = null;
    return;
  }
  try {
    req = parseCurl(text);
  } catch (e) {
    if (!(e instanceof CurlError)) throw e;
    error.textContent = e.message;
    error.hidden = false;
    out.classList.add('dim');
    return;
  }
  out.classList.remove('dim');
  renderCard(req);
  renderCode();
  notesList.replaceChildren(...req.notes.map((n) => el('li', '', n)));
  notesBox.hidden = !req.notes.length;
  notesSum.textContent = `What changed from your command (${req.notes.length})`;
}

function selectTab(next: Lang) {
  lang = next;
  for (const t of tabs) {
    const on = t.dataset.tab === lang;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  }
  renderCode();
}

async function copyText(text: string, btn: HTMLButtonElement, label: string, select?: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Press Ctrl+C';
    if (select) {
      const range = document.createRange();
      range.selectNodeContents(select);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }
  }
  setTimeout(() => (btn.textContent = label), 1600);
}

let timer = 0;
input.addEventListener('input', () => {
  for (const c of chips) c.setAttribute('aria-pressed', 'false');
  clearTimeout(timer);
  timer = window.setTimeout(render, 120);
});
envToggle.addEventListener('input', renderCode);

for (const c of chips) {
  c.addEventListener('click', () => {
    input.value = EXAMPLES[c.dataset.example!].curl;
    for (const x of chips) x.setAttribute('aria-pressed', String(x === c));
    render();
  });
}
$<HTMLButtonElement>('cc-clear').addEventListener('click', () => {
  input.value = '';
  for (const x of chips) x.setAttribute('aria-pressed', 'false');
  render();
  input.focus();
});

tabs.forEach((t, k) => {
  t.addEventListener('click', () => selectTab(t.dataset.tab as Lang));
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs[(k + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.click();
    next.focus();
  });
});

toNext.addEventListener('click', () => {
  envToggle.checked = true;
  selectTab('next');
  code.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

copy.addEventListener('click', () => copyText(current.code, copy, 'Copy', code));
envCopy.addEventListener('click', () => copyText(envCode.textContent ?? '', envCopy, 'Copy', envCode));

promptBtn.addEventListener('click', () => {
  if (!req) return;
  const host = new URL(req.url).hostname;
  const lines = [
    `Add this ${host} API call to my project. Here is working code converted from the API docs' curl example:`,
    '',
    current.code.trim(),
    '',
  ];
  if (current.env.length)
    lines.push(
      `Read the key${current.env.length > 1 ? 's' : ''} from environment variables (${current.env.map((e) => e.name).join(', ')}). I'll put the real value${current.env.length > 1 ? 's' : ''} in .env.local myself; add placeholder lines to .env.example and make sure .env.local is in .gitignore.`,
    );
  if (secretCount)
    lines.push('This request uses a secret key, so it must run on the server only (an API route, server action or backend), never in client-side code. Have the page call that route instead.');
  lines.push('Match my project\'s language, framework and style, add error handling, and tell me where you put it.');
  copyText(lines.join('\n'), promptBtn, 'Copy prompt for your AI agent');
});

render();
