// CSP generator: asks /api/csp what a site loads, shows each directive as a card of the places
// it allows (people can remove or add any), and builds the policy live in five formats.

export {};
type Source = { value: string; why: string; guess?: boolean };
type Directive = { name: string; sources: Source[] };
type Inline = {
  scripts: { hash: string; preview: string }[];
  scriptCount: number;
  handlers: { attr: string; preview: string }[];
  handlerCount: number;
  jsUrls: number;
  styleBlocks: number;
  styleAttrs: number;
};
type Result = {
  url: string;
  finalUrl: string;
  status: number;
  https: boolean;
  framework: string | null;
  existing: { header: string | null; reportOnly: string | null; meta: string | null };
  directives: Directive[];
  inline: Inline;
  notes: string[];
  files: { url: string; ok: boolean; kind: 'script' | 'style' }[];
  error?: string;
};

type ScriptMode = 'hash' | 'unsafe' | 'block';
type Format = 'header' | 'headers' | 'vercel' | 'next' | 'meta';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('csp-form');
const input = $<HTMLInputElement>('csp-url');
const button = $<HTMLButtonElement>('csp-go');
const error = $<HTMLParagraphElement>('csp-error');
const out = $<HTMLDivElement>('csp-out');
const verdict = $<HTMLParagraphElement>('csp-verdict');
const sub = $<HTMLParagraphElement>('csp-sub');
const badge = $<HTMLSpanElement>('csp-badge');
const map = $<HTMLDivElement>('csp-map');
const inlineBox = $<HTMLDivElement>('csp-inline');
const policyCode = $<HTMLElement>('csp-code');
const reportOnly = $<HTMLInputElement>('csp-report');
const fmtNote = $<HTMLParagraphElement>('csp-fmt-note');
const copyBtn = $<HTMLButtonElement>('csp-copy');
const promptBtn = $<HTMLButtonElement>('csp-prompt');
const existingBox = $<HTMLDetailsElement>('csp-existing');
const existingCode = $<HTMLElement>('csp-existing-code');
const filesBox = $<HTMLDetailsElement>('csp-files-box');
const filesSum = $<HTMLElement>('csp-files-sum');
const filesList = $<HTMLUListElement>('csp-files');
const note = $<HTMLParagraphElement>('csp-note');

// Plain words for each directive.
const INFO: Record<string, { title: string; icon: string; what: string }> = {
  'script-src': { title: 'Scripts', icon: '⚡', what: 'JavaScript files the page runs' },
  'style-src': { title: 'Styles', icon: '🎨', what: 'Stylesheets' },
  'img-src': { title: 'Images', icon: '🖼', what: 'Pictures, icons and backgrounds' },
  'font-src': { title: 'Fonts', icon: 'Aa', what: 'Web fonts' },
  'connect-src': { title: 'APIs and data', icon: '⇄', what: 'Where your code fetches data from' },
  'frame-src': { title: 'Embeds', icon: '▣', what: 'Frames like YouTube, Stripe or maps' },
  'media-src': { title: 'Video and audio', icon: '▶', what: 'Video and audio files' },
  'object-src': { title: 'Plugins', icon: '⧉', what: 'Old <object> and <embed> plugins' },
  'manifest-src': { title: 'App manifest', icon: '📱', what: 'The web app manifest' },
  'form-action': { title: 'Form submits', icon: '✉', what: 'Where forms can send to' },
};
const ORDER = ['script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'frame-src', 'media-src', 'manifest-src', 'form-action'];

// Live state the policy is built from.
let data: Result | null = null;
let chosen = new Map<string, Source[]>();
let scriptMode: ScriptMode = 'hash';
let allowInlineStyles = true;
let format: Format = 'header';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

// A CSP source typed by a person: "cdn.foo.com" → "https://cdn.foo.com".
function cleanSource(raw: string): string | null {
  const v = raw.trim().replace(/\/+$/, '');
  if (!v) return null;
  if (/^'[\w-]+'$/.test(v) || /^(data|blob|https|wss):$/.test(v)) return v;
  const withScheme = /^[a-z]+:\/\//i.test(v) ? v : `https://${v}`;
  const m = withScheme.match(/^(https?|wss?):\/\/(\*\.)?([a-z0-9-]+(\.[a-z0-9-]+)*)(:\d+)?/i);
  return m ? `${m[1].toLowerCase()}://${m[2] ?? ''}${m[3].toLowerCase()}${m[5] ?? ''}` : null;
}

function policyParts(forMeta: boolean): [string, string[]][] {
  if (!data) return [];
  const d = data;
  const parts: [string, string[]][] = [["default-src", ["'self'"]]];
  for (const name of ORDER) {
    const list = (chosen.get(name) ?? []).map((s) => s.value);
    if (name === 'script-src') {
      const extra: string[] = [];
      if (d.inline.scriptCount && scriptMode === 'hash') extra.push(...d.inline.scripts.map((s) => s.hash));
      if (d.inline.scriptCount + d.inline.handlerCount + d.inline.jsUrls > 0 && scriptMode === 'unsafe') extra.push("'unsafe-inline'");
      parts.push([name, ["'self'", ...extra, ...list]]);
    } else if (name === 'style-src') {
      const inl = allowInlineStyles && d.inline.styleBlocks + d.inline.styleAttrs > 0 ? ["'unsafe-inline'"] : [];
      parts.push([name, ["'self'", ...inl, ...list]]);
    } else if (name === 'img-src' || name === 'font-src' || name === 'connect-src') {
      parts.push([name, ["'self'", ...list]]);
    } else if (list.length) {
      parts.push([name, ["'self'", ...list]]);
    }
  }
  if (!(chosen.get('form-action') ?? []).length) parts.push(['form-action', ["'self'"]]);
  if (!(chosen.get('object-src') ?? []).length) parts.push(['object-src', ["'none'"]]);
  parts.push(['base-uri', ["'self'"]]);
  if (!forMeta) parts.push(['frame-ancestors', ["'self'"]]);
  if (d.https && !(reportOnly.checked && !forMeta)) parts.push(['upgrade-insecure-requests', []]);
  return parts;
}

const policy = (forMeta = false) =>
  policyParts(forMeta)
    .map(([n, v]) => (v.length ? `${n} ${v.join(' ')}` : n))
    .join('; ');

function output(): { text: string; note: string } {
  const name = reportOnly.checked ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  const p = policy();
  const q = p.replace(/"/g, '\\"');
  switch (format) {
    case 'header':
      return { text: `${name}: ${p}`, note: 'Add this response header wherever your host lets you set headers.' };
    case 'headers':
      return {
        text: `/*\n  ${name}: ${p}`,
        note: 'For Cloudflare Pages, Cloudflare Workers static assets and Netlify: put this in a file named _headers in your public (or build output) folder. If the file already has a /* block, add just the second line to it.',
      };
    case 'vercel':
      return {
        text: JSON.stringify({ headers: [{ source: '/(.*)', headers: [{ key: name, value: p }] }] }, null, 2),
        note: 'Add the "headers" part to vercel.json in the root of your project (create the file if there isn’t one).',
      };
    case 'next':
      return {
        text: `// next.config.js\nconst csp = "${q}";\n\nmodule.exports = {\n  async headers() {\n    return [\n      {\n        source: '/(.*)',\n        headers: [{ key: '${name}', value: csp }],\n      },\n    ];\n  },\n};`,
        note: 'Merge headers() into your existing next.config.js (or .mjs / .ts). Restart the dev server after.',
      };
    case 'meta': {
      const mp = policy(true).replace(/"/g, '&quot;');
      return {
        text: `<meta http-equiv="Content-Security-Policy" content="${mp}">`,
        note: reportOnly.checked
          ? 'A <meta> tag can’t be Report-Only, so this one blocks for real. It also can’t set frame-ancestors, so it’s left out. Put it first inside <head>. Use a header if you can.'
          : 'Put this first inside <head>. A <meta> tag can’t set frame-ancestors, so it’s left out. Use a header if your host allows it.',
      };
    }
  }
}

function renderOutput() {
  const o = output();
  policyCode.textContent = o.text;
  fmtNote.textContent = o.note;
  renderBadges();
}

// Chips on each card; the summary line counts what's allowed now.
function renderBadges() {
  if (!data) return;
  const outside = new Set<string>();
  for (const list of chosen.values()) for (const s of list) if (/^(https?|wss?):\/\//.test(s.value)) outside.add(s.value.replace(/^[a-z]+:\/\/(\*\.)?(www\.)?/, ''));
  const n = outside.size;
  verdict.textContent =
    n === 0
      ? `${host(data.finalUrl)} only loads from itself.`
      : `${host(data.finalUrl)} loads from ${n} other ${n === 1 ? 'place' : 'places'}.`;
}

function chip(dir: string, s: Source): HTMLLIElement {
  const li = el('li', `chip${s.guess ? ' guess' : ''}`);
  const label = s.value === 'data:' ? 'inline data (data:)' : s.value === 'blob:' ? 'blob:' : s.value.replace(/^https:\/\//, '');
  const av = el('span', 'av', s.value.startsWith('wss') ? '⇄' : (s.value.replace(/^[a-z]+:\/\/(\*\.)?(www\.)?/, '')[0] ?? '?').toUpperCase());
  li.append(av, el('span', 'v', label));
  li.title = s.guess ? `${s.why}. We found this address in your code; remove it if your site never calls it.` : s.why;
  const x = el('button', 'x', '×');
  x.type = 'button';
  x.setAttribute('aria-label', `Remove ${label}`);
  x.addEventListener('click', () => {
    chosen.set(dir, (chosen.get(dir) ?? []).filter((c) => c.value !== s.value));
    li.remove();
    renderOutput();
  });
  li.append(x);
  return li;
}

function card(dir: string): HTMLElement {
  const info = INFO[dir];
  const box = el('section', 'card');
  const head = el('div', 'card-h');
  head.append(el('span', 'icon', info.icon));
  const t = el('div');
  t.append(el('h3', '', info.title), el('code', 'dname', dir));
  head.append(t);
  box.append(head, el('p', 'what', info.what));
  const ul = el('ul', 'chips');
  const selfChip = el('li', 'chip self');
  selfChip.append(el('span', 'av', '✓'), el('span', 'v', `${host(data!.finalUrl)} (this site)`));
  ul.append(selfChip);
  const list = chosen.get(dir) ?? [];
  for (const s of list) ul.append(chip(dir, s));
  box.append(ul);
  const addForm = el('form', 'add');
  const inp = el('input');
  inp.placeholder = '+ add a domain';
  inp.setAttribute('aria-label', `Add a domain to ${info.title}`);
  addForm.append(inp);
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = cleanSource(inp.value);
    if (!v) {
      inp.classList.add('bad');
      return;
    }
    inp.classList.remove('bad');
    const cur = chosen.get(dir) ?? [];
    if (!cur.some((c) => c.value === v)) {
      const s = { value: v, why: 'added by you' };
      chosen.set(dir, [...cur, s]);
      ul.append(chip(dir, s));
      renderOutput();
    }
    inp.value = '';
  });
  box.append(addForm);
  return box;
}

function renderMap() {
  map.textContent = '';
  // Always show the four everyday ones, plus any other directive the site needs.
  const show = ORDER.filter((d) => ['script-src', 'style-src', 'img-src', 'connect-src'].includes(d) || (chosen.get(d) ?? []).length);
  for (const d of show) map.append(card(d));
}

function radio(name: string, value: string, label: string, hint: string, checked: boolean, onPick: () => void): HTMLLabelElement {
  const l = el('label', 'opt');
  const r = el('input');
  r.type = 'radio';
  r.name = name;
  r.value = value;
  r.checked = checked;
  r.addEventListener('change', () => {
    if (r.checked) onPick();
  });
  const txt = el('span');
  txt.append(el('b', '', label), el('small', '', hint));
  l.append(r, txt);
  return l;
}

function renderInline() {
  const d = data!;
  const i = d.inline;
  inlineBox.textContent = '';
  const scriptsTotal = i.scriptCount + i.handlerCount + i.jsUrls;
  const nextLike = d.framework === 'Next.js' || d.framework === 'Nuxt' || d.framework === 'SvelteKit';
  const hashable = i.scriptCount > 0 && i.scriptCount <= i.scripts.length && !nextLike;
  scriptMode = scriptsTotal === 0 ? 'hash' : hashable && i.handlerCount + i.jsUrls === 0 ? 'hash' : 'unsafe';

  if (scriptsTotal) {
    const box = el('div', 'warn');
    const parts: string[] = [];
    if (i.scriptCount) parts.push(`${i.scriptCount} inline ${i.scriptCount === 1 ? 'script' : 'scripts'}`);
    if (i.handlerCount) parts.push(`${i.handlerCount} inline event ${i.handlerCount === 1 ? 'handler' : 'handlers'} (like onclick="…")`);
    if (i.jsUrls) parts.push(`${i.jsUrls} javascript: ${i.jsUrls === 1 ? 'link' : 'links'}`);
    box.append(el('h3', '', `Your page has ${parts.join(', ')}`));
    box.append(
      el('p', '', 'A strict policy blocks code written straight into the HTML, because that’s how most cross-site scripting attacks run. Choose how to handle yours:'),
    );
    const opts = el('div', 'opts');
    if (i.scriptCount) {
      opts.append(
        radio(
          'mode',
          'hash',
          scriptMode === 'hash' ? 'Allow these exact scripts (recommended)' : 'Allow these exact scripts',
          i.handlerCount + i.jsUrls
            ? `Adds a fingerprint (hash) of each inline script. If one changes, update the policy. ${i.handlerCount + i.jsUrls === 1 ? 'Your inline handler' : `Your ${i.handlerCount + i.jsUrls} inline handlers`} will still be blocked: move ${i.handlerCount + i.jsUrls === 1 ? 'it' : 'them'} into a script file.`
            : nextLike
              ? `Adds a fingerprint (hash) of each inline script. ${d.framework} writes new inline scripts on every page, so hashes from one page won’t match others. Use a nonce instead (the AI prompt below sets one up).`
              : 'Adds a fingerprint (hash) of each inline script. If one changes, update the policy.',
          scriptMode === 'hash',
          () => ((scriptMode = 'hash'), renderOutput()),
        ),
      );
    }
    opts.append(
      radio(
        'mode',
        'unsafe',
        'Allow all inline code',
        "Adds 'unsafe-inline'. Nothing breaks, but it switches off most of the protection against injected scripts.",
        scriptMode === 'unsafe',
        () => ((scriptMode = 'unsafe'), renderOutput()),
      ),
      radio(
        'mode',
        'block',
        'Block it (I’ll move it into files)',
        'Strictest. Move each inline script into a .js file and replace onclick="…" with addEventListener. The AI prompt below does this.',
        false,
        () => ((scriptMode = 'block'), renderOutput()),
      ),
    );
    box.append(opts);
    const ex = el('details', 'ex');
    ex.append(el('summary', '', 'See the inline code we found'));
    const ul = el('ul');
    for (const s of i.scripts) {
      const li = el('li');
      li.append(el('code', 'pre', s.preview), el('code', 'hash', s.hash));
      ul.append(li);
    }
    for (const h of i.handlers) {
      const li = el('li');
      li.append(el('code', 'pre', `${h.attr}="${h.preview}"`));
      ul.append(li);
    }
    if (i.scriptCount > i.scripts.length) ul.append(el('li', '', `…and ${i.scriptCount - i.scripts.length} more scripts.`));
    ex.append(ul);
    box.append(ex);
    inlineBox.append(box);
  }

  if (i.styleBlocks + i.styleAttrs) {
    const box = el('label', 'soft');
    const c = el('input');
    c.type = 'checkbox';
    c.checked = allowInlineStyles;
    c.addEventListener('change', () => {
      allowInlineStyles = c.checked;
      renderOutput();
    });
    const t = el('span');
    const n = i.styleBlocks + i.styleAttrs;
    t.append(
      el('b', '', `Allow inline styles (${n} found)`),
      el('small', '', "Adds 'unsafe-inline' to styles. Low risk, and most sites and frameworks need it. Untick only if you’ve moved every style into a .css file."),
    );
    box.append(c, t);
    inlineBox.append(box);
  }
  inlineBox.hidden = !inlineBox.childElementCount;
}

function render(d: Result) {
  data = d;
  chosen = new Map(d.directives.map((x) => [x.name, x.sources.slice().sort((a, b) => Number(!!a.guess) - Number(!!b.guess))]));
  allowInlineStyles = true;

  const has = d.existing.header || d.existing.meta;
  badge.textContent = has ? 'Has a CSP' : d.existing.reportOnly ? 'Has a Report-Only CSP' : 'No CSP yet';
  badge.className = `badge ${has ? 'ok' : 'none'}`;
  sub.textContent = has
    ? 'It already sends a policy (see below). Here’s one built from what the page actually loads, to compare or replace it with.'
    : 'Here’s a policy that allows exactly those, and blocks everything else. Remove anything you don’t recognise, or add what we missed.';
  const cur = [d.existing.header && `Content-Security-Policy: ${d.existing.header}`, d.existing.reportOnly && `Content-Security-Policy-Report-Only: ${d.existing.reportOnly}`, d.existing.meta && `<meta> tag: ${d.existing.meta}`].filter(Boolean);
  existingBox.hidden = !cur.length;
  existingCode.textContent = cur.join('\n\n');

  renderInline();
  renderMap();
  renderOutput();

  const read = d.files.filter((f) => f.ok);
  filesSum.textContent = `What we read: the page, ${plural(read.filter((f) => f.kind === 'style').length, 'stylesheet')} and ${plural(read.filter((f) => f.kind === 'script').length, 'script file')}`;
  filesList.textContent = '';
  filesList.append(el('li', '', `${d.finalUrl} (the page)`));
  for (const f of d.files) filesList.append(el('li', '', `${f.url}${f.ok ? '' : ' (couldn’t read)'}`));
  filesBox.hidden = false;

  const notes = [
    ...d.notes,
    'We read the page as a first-time visitor sees it. Anything loaded after sign-in, after a click, or by another script isn’t seen, which is why Report-Only first matters.',
  ];
  note.textContent = notes.join(' ');
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function agentPrompt(): string {
  const d = data!;
  const p = policy();
  const name = reportOnly.checked ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  const lines = [
    `Add a Content Security Policy to this site (${host(d.finalUrl)}). Send it as the ${name} response header on every page, using whatever this project already uses to set headers (_headers, vercel.json, next.config.js, middleware, or server code).`,
    '',
    'The policy:',
    p,
    '',
  ];
  const i = d.inline;
  if (scriptMode === 'block' && i.scriptCount + i.handlerCount + i.jsUrls) {
    lines.push(
      'The policy blocks inline JavaScript, so also: move every inline <script> into a .js file loaded with <script src>, replace inline event handlers (onclick="…" and similar) with addEventListener in a script file, and replace javascript: links with buttons that have click handlers.',
      '',
    );
  }
  if (d.framework === 'Next.js' && i.scriptCount) {
    lines.push(
      'This is a Next.js app, which writes its own inline scripts on every page. Instead of hashes, set the policy in middleware with a fresh nonce for each request (script-src \'self\' \'nonce-<value>\' \'strict-dynamic\'), as in the Next.js "Content Security Policy" guide, and keep the other directives as above.',
      '',
    );
  }
  lines.push(
    'Then open the main pages of the site in a browser with the developer console open and tell me about any "Content Security Policy" messages, so we can add what is missing before switching from Report-Only to enforcing.',
  );
  return lines.join('\n');
}

async function copyText(text: string, btn: HTMLButtonElement, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.textContent = label), 1500);
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-fmt]')) {
  b.addEventListener('click', () => {
    format = b.dataset.fmt as Format;
    for (const o of document.querySelectorAll<HTMLButtonElement>('[data-fmt]')) o.setAttribute('aria-pressed', String(o === b));
    renderOutput();
  });
}
reportOnly.addEventListener('change', renderOutput);
copyBtn.addEventListener('click', () => copyText(policyCode.textContent ?? '', copyBtn, 'Copy'));
promptBtn.addEventListener('click', () => copyText(agentPrompt(), promptBtn, 'Copy prompt for your AI agent'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Reading…';
  try {
    const res = await fetch(`/api/csp?url=${encodeURIComponent(url)}`);
    const d: Result = await res.json().catch(() => ({ error: 'Something went wrong. Try again.' }) as Result);
    if (!res.ok || d.error) throw new Error(d.error ?? 'Something went wrong. Try again.');
    out.hidden = false;
    render(d);
    history.replaceState(null, '', `?url=${encodeURIComponent(url)}`);
  } catch (err) {
    error.textContent = (err as Error).message;
    error.hidden = false;
    out.hidden = true;
  } finally {
    button.disabled = false;
    button.textContent = 'Build my CSP';
  }
});

// Shared links like /tools/csp-generator/?url=example.com run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
