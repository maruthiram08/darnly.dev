// Launch checker: asks /api/launch to grade a site's launch basics, then shows each as green, amber or red.

type Level = 'pass' | 'warn' | 'fail';
type Check = { id: string; label: string; level: Level; detail: string; fix?: string; prompt?: string; tool?: { href: string; name: string } };
type Result = { url: string; finalUrl: string; status: number; checks: Check[]; error?: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('lc-form');
const input = $<HTMLInputElement>('lc-url');
const button = $<HTMLButtonElement>('lc-go');
const error = $<HTMLParagraphElement>('lc-error');
const out = $<HTMLDivElement>('lc-out');
const list = $<HTMLUListElement>('lc-list');
const verdict = $<HTMLParagraphElement>('lc-verdict');
const counts = $<HTMLParagraphElement>('lc-counts');
const promptBtn = $<HTMLButtonElement>('lc-prompt');
const note = $<HTMLParagraphElement>('lc-note');

const PROMPT_LABEL = 'Copy all fixes for your AI agent';
const ORDER: Record<Level, number> = { fail: 0, warn: 1, pass: 2 };
const MARK: Record<Level, string> = { pass: '✓', warn: '!', fail: '✕' };
const WORD: Record<Level, string> = { pass: 'Done', warn: 'Worth fixing', fail: 'Fix before launch' };
let lastPrompt = '';

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
  if (c.level !== 'pass' && c.fix) {
    const fix = el('p', 'fix');
    fix.append(el('b', '', 'Fix: '), document.createTextNode(c.fix));
    li.append(fix);
  }
  const actions = el('div', 'actions');
  if (c.level !== 'pass' && c.prompt) {
    const b = el('button', '', 'Copy prompt');
    b.type = 'button';
    b.addEventListener('click', () => copyText(c.prompt!, b, 'Copy prompt'));
    actions.append(b);
  }
  if (c.level !== 'pass' && c.tool) {
    const a = el('a', '', `Open ${c.tool.name}`);
    a.href = c.tool.href;
    actions.append(a);
  }
  if (actions.childElementCount) li.append(actions);
  return li;
}

function allFixes(r: Result, todo: Check[]): string {
  const lines = [`Get my site ${host(r.finalUrl)} ready to launch. A launch check found these problems:`, ''];
  todo.forEach((c, i) => lines.push(`${i + 1}. ${c.label}: ${c.prompt ?? c.fix ?? c.detail}`, ''));
  lines.push('Fix them the way this project is already set up (framework, hosting, file layout). Don’t change anything else, and tell me about any step I have to do myself, like a setting at my host.');
  return lines.join('\n');
}

function render(r: Result) {
  const checks = [...r.checks].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const n = (l: Level) => checks.filter((c) => c.level === l).length;
  const [fail, warn, pass] = [n('fail'), n('warn'), n('pass')];
  const name = host(r.finalUrl);
  verdict.textContent =
    fail ? `${name} isn’t ready yet: ${fail} thing${fail === 1 ? '' : 's'} to fix before launch.` :
    warn ? `${name} is nearly ready: ${warn} thing${warn === 1 ? '' : 's'} worth fixing.` :
    `${name} is ready to launch.`;
  counts.textContent = `${pass} done · ${warn} worth fixing · ${fail} to fix before launch`;
  const todo = checks.filter((c) => c.level !== 'pass' && (c.prompt || c.fix));
  lastPrompt = todo.length ? allFixes(r, todo) : '';
  promptBtn.hidden = !todo.length;
  list.replaceChildren(...checks.map(item));
  const problems: string[] = [];
  if (r.status >= 400) problems.push(`The page answered with error ${r.status}, so it may not be the page visitors see.`);
  if (host(r.url) !== name) problems.push(`${host(r.url)} redirected to ${name}, so we checked that.`);
  note.textContent = problems.join(' ');
  note.hidden = !problems.length;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    const res = await fetch(`/api/launch?url=${encodeURIComponent(url)}`);
    const data: Result = await res.json().catch(() => ({ error: 'Something went wrong. Try again.' }) as Result);
    if (!res.ok || data.error) throw new Error(data.error ?? 'Something went wrong. Try again.');
    out.hidden = false;
    render(data);
    history.replaceState(null, '', `?url=${encodeURIComponent(url)}`);
  } catch (err) {
    error.textContent = (err as Error).message;
    error.hidden = false;
    out.hidden = true;
  } finally {
    button.disabled = false;
    button.textContent = 'Check my site';
  }
});

promptBtn.addEventListener('click', () => copyText(lastPrompt, promptBtn, PROMPT_LABEL));

// Shared links like /tools/launch-checker/?url=example.com run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
