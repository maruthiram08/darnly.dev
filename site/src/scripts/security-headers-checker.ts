// Security headers checker: asks /api/headers to grade a site's security headers, then shows a big
// grade, a card per header, a ready config file for the visitor's host, and one prompt for their agent.
import { checkHeaders, type HeadersReport, type HeaderCheck, type HostId, type Level } from '../../worker/headers';

type Result = HeadersReport & { url: string; finalUrl: string; status: number; error?: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('sh-form');
const input = $<HTMLInputElement>('sh-url');
const button = $<HTMLButtonElement>('sh-go');
const error = $<HTMLParagraphElement>('sh-error');
const tag = $<HTMLParagraphElement>('sh-tag');
const hero = $<HTMLDivElement>('sh-hero');
const gradeEl = $<HTMLSpanElement>('sh-grade');
const scoreEl = $<HTMLElement>('sh-score');
const siteEl = $<HTMLParagraphElement>('sh-site');
const verdict = $<HTMLParagraphElement>('sh-verdict');
const chips = $<HTMLUListElement>('sh-chips');
const fixbox = $<HTMLElement>('sh-fixbox');
const hosts = $<HTMLDivElement>('sh-hosts');
const where = $<HTMLParagraphElement>('sh-where');
const snippet = $<HTMLPreElement>('sh-snippet');
const copyBtn = $<HTMLButtonElement>('sh-copy');
const hint = $<HTMLParagraphElement>('sh-hint');
const promptBtn = $<HTMLButtonElement>('sh-prompt');
const list = $<HTMLUListElement>('sh-list');
const note = $<HTMLParagraphElement>('sh-note');
const raw = $<HTMLTableSectionElement>('sh-raw');

const PROMPT_LABEL = 'Copy one prompt for your AI agent';
const ORDER: Record<Level, number> = { fail: 0, warn: 1, pass: 2 };
const MARK: Record<Level, string> = { pass: '✓', warn: '!', fail: '✕' };
const WORD: Record<Level, string> = { pass: 'Good', warn: 'Worth fixing', fail: 'Missing or unsafe' };
const SHORT: Record<string, string> = { hsts: 'HTTPS', csp: 'CSP', frames: 'Framing', nosniff: 'nosniff', referrer: 'Referrer', permissions: 'Permissions', cookies: 'Cookies', version: 'Version' };
const VERDICT: Record<HeadersReport['grade'], string> = {
  A: 'Your security headers are set up well.',
  B: 'Good, with a couple of gaps worth closing.',
  C: 'Some important protections are missing.',
  D: 'Most of the basic protections are missing.',
  F: 'Your site sends almost none of the basic protections.',
};
const WHERE: Record<HostId, string> = {
  vercel: 'Put this in <code>vercel.json</code> at the root of your project, then redeploy. If you already have one, add the <code>headers</code> part to it.',
  netlify: 'Save this as a file called <code>_headers</code> in the folder Netlify deploys (often <code>public/</code>), then redeploy.',
  cloudflare: 'Save this as a file called <code>_headers</code> in the folder Cloudflare deploys (often <code>public/</code>), then redeploy.',
  next: 'Add this to <code>next.config.js</code> (or <code>next.config.mjs</code> with <code>export default</code>), then redeploy.',
  other: 'Ask your host or server to send these headers with every page. Or copy the prompt below and let your agent do it.',
};

let current: Result | null = null;
let host: HostId = 'vercel';
let lastPrompt = '';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const hostName = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

async function copyText(text: string, btn: HTMLButtonElement, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.textContent = label), 1500);
}

// The headers to add, as one config file for the chosen host.
function configFor(h: HostId, sets: { key: string; value: string }[], hidePowered = false): string {
  const q = (s: string) => JSON.stringify(s);
  if (h === 'vercel') {
    return JSON.stringify({ headers: [{ source: '/(.*)', headers: sets.map((s) => ({ key: s.key, value: s.value })) }] }, null, 2);
  }
  if (h === 'netlify' || h === 'cloudflare') {
    return ['/*', ...sets.map((s) => `  ${s.key}: ${s.value}`)].join('\n');
  }
  if (h === 'next') {
    return [
      'const securityHeaders = [',
      ...sets.map((s) => `  { key: ${q(s.key)}, value: ${q(s.value)} },`),
      '];',
      '',
      'module.exports = {',
      ...(hidePowered ? ['  poweredByHeader: false,'] : []),
      '  async headers() {',
      "    return [{ source: '/(.*)', headers: securityHeaders }];",
      '  },',
      '};',
    ].join('\n');
  }
  return sets.map((s) => `${s.key}: ${s.value}`).join('\n');
}

// One header in the chosen host's format, short enough for a card. The box above has the whole file.
const FILE: Record<HostId, string> = { vercel: 'vercel.json', netlify: '_headers', cloudflare: '_headers', next: 'next.config.js', other: 'header' };
function oneLine(h: HostId, s: { key: string; value: string }): string {
  const q = (v: string) => JSON.stringify(v);
  if (h === 'vercel') return `{ "key": ${q(s.key)}, "value": ${q(s.value)} }`;
  if (h === 'next') return `{ key: ${q(s.key)}, value: ${q(s.value)} },`;
  if (h === 'other') return `${s.key}: ${s.value}`;
  return `/*\n  ${s.key}: ${s.value}`;
}

const toAdd = (r: Result) => r.checks.filter((c) => c.level !== 'pass' && c.set).map((c) => c.set!);
const nextPowered = (r: Result) => r.checks.some((c) => c.id === 'version' && c.level !== 'pass' && /next\.js/i.test(c.value ?? ''));

function showSnippet() {
  if (!current) return;
  for (const b of hosts.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-checked', String(b.dataset.host === host));
  const sets = toAdd(current);
  where.innerHTML = WHERE[host];
  snippet.textContent = sets.length ? configFor(host, sets, nextPowered(current)) : '';
  copyBtn.hidden = !sets.length;
  snippet.parentElement!.hidden = !sets.length;
  where.hidden = !sets.length;
  hint.innerHTML = sets.some((s) => s.key === 'Content-Security-Policy')
    ? 'The Content-Security-Policy is a starter built from what your page loads. Try it on a preview deploy first and check the browser console, because it blocks anything it doesn’t list.'
    : '';
  hint.hidden = !hint.innerHTML;
  for (const pre of list.querySelectorAll<HTMLPreElement>('pre[data-id]')) {
    const c = current.checks.find((x) => x.id === pre.dataset.id);
    if (c?.set) pre.textContent = oneLine(host, c.set);
    const label = pre.parentElement?.querySelector('small');
    if (label) label.textContent = FILE[host];
  }
}

function card(c: HeaderCheck): HTMLLIElement {
  const li = el('li', `item ${c.level}`);
  const dot = el('span', 'dot', MARK[c.level]);
  dot.setAttribute('aria-label', WORD[c.level]);
  dot.setAttribute('role', 'img');
  li.append(dot, el('p', 'label', c.label));
  const body = el('div', 'body');
  body.append(el('p', 'detail', c.detail));
  if (c.value) body.append(el('p', 'now', c.value.length > 220 ? `${c.value.slice(0, 220)}…` : c.value));
  if (c.level !== 'pass' && c.fix) {
    const fix = el('p', 'fix');
    fix.append(el('b', '', 'Fix: '), document.createTextNode(c.fix));
    body.append(fix);
  }
  if (c.level !== 'pass' && c.set) {
    const wrap = el('div', 'snip');
    const pre = el('pre');
    pre.dataset.id = c.id;
    const b = el('button', 'copy', 'Copy');
    b.type = 'button';
    b.addEventListener('click', () => copyText(pre.textContent ?? '', b, 'Copy'));
    wrap.append(el('small'), pre, b);
    body.append(wrap);
  }
  li.append(body);
  return li;
}

function agentPrompt(r: Result): string {
  const todo = r.checks.filter((c) => c.level !== 'pass');
  if (!todo.length) return '';
  const sets = toAdd(r);
  const where = { vercel: 'Vercel', netlify: 'Netlify', cloudflare: 'Cloudflare', next: 'Next.js', other: '' }[r.host];
  const lines = [
    `Fix the security headers on my site ${hostName(r.finalUrl)}. A security headers check gave it grade ${r.grade} (${r.score}/100).${where ? ` It looks like it’s on ${where}.` : ''}`,
    '',
  ];
  if (sets.length) {
    lines.push('Send these response headers with every page, the way this project is set up (vercel.json, a _headers file, next.config.js, or server code):');
    for (const s of sets) lines.push(`- ${s.key}: ${s.value}`);
    lines.push('');
  }
  const other = todo.filter((c) => !c.set && c.fix);
  if (other.length) {
    lines.push('Also:');
    for (const c of other) lines.push(`- ${c.label}: ${c.detail} ${c.fix}`);
    lines.push('');
  }
  if (sets.some((s) => s.key === 'Content-Security-Policy')) {
    lines.push('The Content-Security-Policy above is a starter. Before adding it, look through the code for every outside service the app uses (analytics, fonts, payments, auth, APIs, embeds) and add their domains to the right directives, so nothing breaks. If the framework needs inline scripts, prefer nonces over \'unsafe-inline\' if that’s simple here.');
    lines.push('');
  }
  lines.push('Don’t change anything else. Tell me any step I have to do myself, like a setting at my host, and how to check the headers after deploying.');
  return lines.join('\n');
}

function render(r: Result, example = false) {
  current = r;
  host = r.host === 'other' && example ? 'vercel' : r.host;
  const checks = [...r.checks].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  hero.className = `hero g${r.grade}`;
  gradeEl.textContent = r.grade;
  scoreEl.textContent = `${r.score} / 100`;
  siteEl.textContent = hostName(r.finalUrl) + (r.framework ? ` · ${r.framework}` : '');
  verdict.textContent = VERDICT[r.grade];
  chips.replaceChildren(
    ...r.checks.map((c) => {
      const li = el('li', c.level);
      const i = el('i', '', MARK[c.level]);
      i.setAttribute('aria-hidden', 'true');
      li.append(i, document.createTextNode(SHORT[c.id] ?? c.label));
      li.title = `${c.label}: ${WORD[c.level]}`;
      return li;
    }),
  );
  list.replaceChildren(...checks.map(card));
  lastPrompt = agentPrompt(r);
  fixbox.hidden = !lastPrompt;
  showSnippet();

  tag.textContent = example
    ? 'Example result for a typical new app. Paste your site above to check yours.'
    : `Checked ${hostName(r.finalUrl)} just now.`;
  tag.classList.toggle('example', example);

  const problems: string[] = [];
  if (r.status >= 400) problems.push(`The page answered with error ${r.status}, so it may not send the same headers as your real pages.`);
  if (hostName(r.url) !== hostName(r.finalUrl)) problems.push(`${hostName(r.url)} redirected to ${hostName(r.finalUrl)}, so we checked that.`);
  note.textContent = problems.join(' ');
  note.hidden = !problems.length;

  raw.replaceChildren(
    ...[...r.raw]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => {
        const tr = el('tr');
        tr.append(el('td', '', k), el('td', '', v));
        return tr;
      }),
  );
}

hosts.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-host]');
  if (!b) return;
  host = b.dataset.host as HostId;
  showSnippet();
});
copyBtn.addEventListener('click', () => copyText(snippet.textContent ?? '', copyBtn, 'Copy'));
promptBtn.addEventListener('click', () => copyText(lastPrompt, promptBtn, PROMPT_LABEL));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    const res = await fetch(`/api/headers?url=${encodeURIComponent(url)}`);
    const data: Result = await res.json().catch(() => ({ error: 'Something went wrong. Try again.' }) as Result);
    if (!res.ok || data.error) throw new Error(data.error ?? 'Something went wrong. Try again.');
    render(data);
    history.replaceState(null, '', `?url=${encodeURIComponent(url)}`);
  } catch (err) {
    error.textContent = (err as Error).message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Check my site';
  }
});

// The example: what a fresh app on a typical host sends, graded by the same code as the real check.
function example(): Result {
  const finalUrl = 'https://my-new-app.vercel.app/';
  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    server: 'Vercel',
    'strict-transport-security': 'max-age=63072000',
    'x-powered-by': 'Express 4.18.2',
    'cache-control': 'public, max-age=0, must-revalidate',
    'x-vercel-id': 'iad1::abcde-1730000000000',
  });
  headers.append('set-cookie', 'session=abc123; Path=/');
  const html = '<script src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script><script>window.dataLayer=[]</script><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">';
  return { url: finalUrl, finalUrl, status: 200, ...checkHeaders(headers, finalUrl, html) };
}

// Shared links like /tools/security-headers-checker/?url=example.com run straight away.
const preset = new URLSearchParams(location.search).get('url');
render(example(), true);
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
