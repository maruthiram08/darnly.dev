// Domain checker: asks /api/domain about one domain, then shows each check, the redirect chains and the DNS records.

type Level = 'pass' | 'warn' | 'fail' | 'info';
type Check = { id: string; label: string; level: Level; detail: string; fix?: string; prompt?: string };
type Records = { A: string[]; AAAA: string[]; CNAME: string[]; MX: string[]; TXT: string[]; NS: string[] };
type Chain = { start: string; steps: { url: string; status: number }[]; end: string | null; status: number | null; problem: string | null };
type Result = {
  name: string;
  www: string | null;
  apex: Records;
  wwwRecords: Records | null;
  dnsCompany: string | null;
  host: string | null;
  chains: Chain[];
  checks: Check[];
  error?: string;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('dc-form');
const input = $<HTMLInputElement>('dc-domain');
const button = $<HTMLButtonElement>('dc-go');
const error = $<HTMLParagraphElement>('dc-error');
const out = $<HTMLDivElement>('dc-out');
const list = $<HTMLUListElement>('dc-list');
const verdict = $<HTMLParagraphElement>('dc-verdict');
const facts = $<HTMLParagraphElement>('dc-facts');
const promptBtn = $<HTMLButtonElement>('dc-prompt');
const chainsBox = $<HTMLElement>('dc-chains-box');
const chainsList = $<HTMLUListElement>('dc-chains');
const recordsBody = $<HTMLTableSectionElement>('dc-records');

const PROMPT_LABEL = 'Copy all fixes for your AI agent';
const ORDER: Record<Level, number> = { fail: 0, warn: 1, pass: 2, info: 3 };
const MARK: Record<Level, string> = { pass: '✓', warn: '!', fail: '✕', info: 'i' };
const WORD: Record<Level, string> = { pass: 'Working', warn: 'Worth fixing', fail: 'Broken', info: 'Good to know' };
const PROBLEM: Record<string, string> = {
  cert: 'certificate problem',
  unreachable: 'no answer',
  timeout: 'timed out',
  loop: 'too many redirects',
  blocked: 'can’t check',
  error: 'error',
  forbidden: 'blocks checks',
};
let lastPrompt = '';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
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

function item(c: Check): HTMLLIElement {
  const li = el('li', `item ${c.level}`);
  const dot = el('span', 'dot', MARK[c.level]);
  dot.setAttribute('aria-label', WORD[c.level]);
  dot.setAttribute('role', 'img');
  li.append(dot, el('p', 'label', c.label), el('p', 'detail', c.detail));
  if (c.fix && (c.level === 'fail' || c.level === 'warn')) {
    const fix = el('p', 'fix');
    fix.append(el('b', '', 'Fix: '), document.createTextNode(c.fix));
    li.append(fix);
  }
  if (c.prompt && (c.level === 'fail' || c.level === 'warn')) {
    const actions = el('div', 'actions');
    const b = el('button', '', 'Copy prompt for your AI agent');
    b.type = 'button';
    b.addEventListener('click', () => copyText(c.prompt!, b, 'Copy prompt for your AI agent'));
    actions.append(b);
    li.append(actions);
  }
  return li;
}

function allFixes(r: Result, todo: Check[]): string {
  const where = [r.host ? `My site is hosted on ${r.host}` : 'I’m not sure which host my site is on', r.dnsCompany ? `and my DNS is managed at ${r.dnsCompany}` : 'and I’m not sure where my DNS is managed'].join(' ');
  const lines = [`My domain ${r.name} isn’t working properly. ${where}. A domain check found these problems:`, ''];
  todo.forEach((c, i) => lines.push(`${i + 1}. ${c.label}: ${c.detail}${c.fix ? ` Suggested fix: ${c.fix}` : ''}`, ''));
  lines.push('Walk me through fixing them one step at a time, in plain words, with exactly what to click and type at my host and my DNS company. If anything needs a change in this project’s code or config (like a redirect), make that change, and don’t change anything else.');
  return lines.join('\n');
}

function codeClass(status: number | null, problem: string | null) {
  if (problem && problem !== 'forbidden') return 'code bad';
  if (status && status >= 300 && status < 400) return 'code redirect';
  return 'code';
}

function chainRow(ch: Chain): HTMLLIElement {
  const li = el('li');
  ch.steps.forEach((s, i) => {
    if (i) li.append(el('span', 'arrow', '→'));
    li.append(el('span', 'url', s.url.replace(/\/$/, '')));
    const last = i === ch.steps.length - 1;
    li.append(el('span', codeClass(s.status, last ? ch.problem : null), String(s.status)));
  });
  if (!ch.steps.length) li.append(el('span', 'url', ch.start.replace(/\/$/, '')));
  if (ch.problem && (ch.problem !== 'error' || !ch.status) && ch.problem !== 'forbidden') {
    if (ch.steps.length) li.append(el('span', 'arrow', '→'));
    li.append(el('span', 'code bad', PROBLEM[ch.problem] ?? ch.problem));
  }
  return li;
}

function recordRows(name: string, r: Records): HTMLTableRowElement[] {
  const rows: HTMLTableRowElement[] = [];
  const add = (type: string, values: string[]) =>
    values.forEach((v) => {
      const tr = el('tr');
      tr.append(el('td', 'n', name), el('td', '', type), el('td', 'v', v));
      rows.push(tr);
    });
  add('CNAME', r.CNAME);
  add('A', r.A);
  add('AAAA', r.AAAA);
  add('MX', r.MX);
  add('TXT', r.TXT);
  add('NS', r.NS);
  return rows;
}

function render(r: Result) {
  const checks = [...r.checks].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const fail = checks.filter((c) => c.level === 'fail').length;
  const warn = checks.filter((c) => c.level === 'warn').length;
  verdict.textContent =
    fail ? `${r.name} has ${fail} problem${fail === 1 ? '' : 's'} to fix${warn ? `, and ${warn} more worth fixing` : ''}.` :
    warn ? `${r.name} works, with ${warn} thing${warn === 1 ? '' : 's'} worth fixing.` :
    `${r.name} is set up right.`;
  facts.textContent = [r.host ? `Hosted on ${r.host}` : 'Host not recognised', r.dnsCompany ? `DNS at ${r.dnsCompany}` : null].filter(Boolean).join(' · ');

  const todo = checks.filter((c) => (c.level === 'fail' || c.level === 'warn') && (c.fix || c.prompt));
  lastPrompt = todo.length ? allFixes(r, todo) : '';
  promptBtn.hidden = !todo.length;
  list.replaceChildren(...checks.map(item));

  chainsList.replaceChildren(...r.chains.map(chainRow));
  chainsBox.hidden = !r.chains.length;

  const rows = [...recordRows(r.name, r.apex), ...(r.www && r.wwwRecords ? recordRows(r.www, r.wwwRecords) : [])];
  if (!rows.length) {
    const tr = el('tr');
    const td = el('td', '', 'No records found.');
    td.colSpan = 3;
    tr.append(td);
    rows.push(tr);
  }
  recordsBody.replaceChildren(...rows);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const domain = input.value.trim();
  if (!domain) return;
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    const res = await fetch(`/api/domain?domain=${encodeURIComponent(domain)}`);
    const data: Result = await res.json().catch(() => ({ error: 'Something went wrong. Try again.' }) as Result);
    if (!res.ok || data.error) throw new Error(data.error ?? 'Something went wrong. Try again.');
    out.hidden = false;
    render(data);
    history.replaceState(null, '', `?domain=${encodeURIComponent(domain)}`);
  } catch (err) {
    error.textContent = (err as Error).message;
    error.hidden = false;
    out.hidden = true;
  } finally {
    button.disabled = false;
    button.textContent = 'Check domain';
  }
});

promptBtn.addEventListener('click', () => copyText(lastPrompt, promptBtn, PROMPT_LABEL));

// Shared links like /tools/domain-checker/?domain=example.com run straight away.
const preset = new URLSearchParams(location.search).get('domain');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
