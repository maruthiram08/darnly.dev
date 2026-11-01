// API key leak checker: asks /api/secrets for secret keys in a site's public JavaScript and shows
// each one (masked) with what it allows and three steps to fix it.

type Level = 'leak' | 'check' | 'ok';
type Finding = {
  kind: string;
  name: string;
  level: Level;
  preview: string;
  files: string[];
  risk: string;
  rotate: { href: string; label: string } | null;
  fix: string;
  prompt: string;
};
type Result = { url: string; finalUrl: string; status: number; findings: Finding[]; files: { url: string; ok: boolean }[]; capped: boolean; error?: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('kl-form');
const input = $<HTMLInputElement>('kl-url');
const button = $<HTMLButtonElement>('kl-go');
const error = $<HTMLParagraphElement>('kl-error');
const out = $<HTMLDivElement>('kl-out');
const summary = $<HTMLDivElement>('kl-summary');
const verdict = $<HTMLParagraphElement>('kl-verdict');
const counts = $<HTMLParagraphElement>('kl-counts');
const list = $<HTMLUListElement>('kl-list');
const filesSum = $<HTMLElement>('kl-files-sum');
const filesList = $<HTMLUListElement>('kl-files');
const filesBox = $<HTMLDetailsElement>('kl-files-box');
const note = $<HTMLParagraphElement>('kl-note');

const TAG: Record<Level, string> = { leak: 'Secret: fix now', check: 'Check this', ok: 'Fine to be public' };

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

// "/assets/index-a1b2.js", or "the page itself" for the HTML.
const fileName = (u: string, page: string) => {
  if (u === page) return 'the page itself (HTML)';
  try {
    const x = new URL(u);
    return x.pathname + x.search;
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

function step(title: string, text: string, action?: HTMLElement): HTMLLIElement {
  const li = el('li');
  li.append(el('b', '', `${title} `), document.createTextNode(text));
  if (action) li.append(el('br'), action);
  return li;
}

function item(f: Finding, page: string): HTMLLIElement {
  const li = el('li', `item ${f.level}`);
  const head = el('div', 'head');
  head.append(el('span', 'tag', TAG[f.level]), el('p', 'name', f.name), el('code', 'preview', f.preview));
  const risk = el('p', 'risk');
  risk.append(el('b', '', f.level === 'ok' ? 'Why it’s fine: ' : 'What someone could do: '), document.createTextNode(f.risk));
  li.append(head, risk, el('p', 'where', `Found in ${f.files.map((u) => fileName(u, page)).join(', ')}`));
  if (f.level === 'ok') return li;

  const steps = el('ol', 'steps');
  let rotate: HTMLElement | undefined;
  if (f.rotate) {
    const a = el('a', 'act', `${f.rotate.label} ↗`);
    a.href = f.rotate.href;
    a.target = '_blank';
    a.rel = 'noopener';
    rotate = a;
  }
  steps.append(
    step(
      f.level === 'check' && f.kind === 'google' ? 'Restrict the key now.' : 'Rotate the key now.',
      f.level === 'check' && f.kind === 'google'
        ? 'Limit it to your website’s address and only the Google APIs it needs.'
        : 'Make a new key and delete this one in the provider’s dashboard. Assume the old one has been copied, so removing it from your code isn’t enough.',
      rotate,
    ),
    step(f.kind === 'google' ? 'Move paid calls to your server.' : 'Move the call to your server.', f.fix),
  );
  const b = el('button', 'act primary', 'Copy prompt');
  b.type = 'button';
  b.addEventListener('click', () => copyText(f.prompt, b, 'Copy prompt'));
  steps.append(step('Let your AI agent do step 2.', 'Paste this prompt into Claude Code, Cursor or Codex.', b));
  li.append(steps);
  return li;
}

function render(r: Result) {
  const n = (l: Level) => r.findings.filter((f) => f.level === l).length;
  const [leak, check, ok] = [n('leak'), n('check'), n('ok')];
  const read = r.files.filter((f) => f.ok);
  const name = host(r.finalUrl);
  summary.className = `summary ${leak ? 'leak' : check ? 'check' : 'clean'}`;
  verdict.textContent = leak
    ? `We found ${leak} secret key${leak === 1 ? '' : 's'} on ${name} that anyone can copy.`
    : check
      ? `No secret keys found on ${name}, but ${check} key${check === 1 ? ' needs' : 's need'} a check.`
      : 'No secret keys found in the files we checked.';
  const parts = [`${read.length} file${read.length === 1 ? '' : 's'} checked`];
  if (leak) parts.push(`${leak} to fix now`);
  if (check) parts.push(`${check} to check`);
  if (ok) parts.push(`${ok} fine to be public`);
  counts.textContent = parts.join(' · ');

  list.replaceChildren(...r.findings.map((f) => item(f, r.finalUrl)));
  list.hidden = !r.findings.length;

  filesSum.textContent = `Files we checked (${read.length})`;
  filesList.replaceChildren(
    ...r.files.map((f) => el('li', '', `${fileName(f.url, r.finalUrl)}${f.ok ? '' : ' (couldn’t read it)'}`)),
  );
  // With nothing found, the file list is the answer, so show it open.
  filesBox.open = !leak && !check;

  const notes: string[] = [];
  if (r.status >= 400) notes.push(`The page answered with error ${r.status}, so it may not be the page visitors see.`);
  if (host(r.url) !== name) notes.push(`${host(r.url)} redirected to ${name}, so we checked that.`);
  if (r.capped) notes.push('This site loads more than 20 scripts, so we checked the first 20.');
  if (read.length <= 1) notes.push('We didn’t find any JavaScript files from this site. Keys can still be in code that loads after sign-in, which we can’t see.');
  note.textContent = notes.join(' ');
  note.hidden = !notes.length;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    const res = await fetch(`/api/secrets?url=${encodeURIComponent(url)}`);
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
    button.textContent = 'Check for leaks';
  }
});

// Shared links like /tools/api-key-leak-checker/?url=example.com run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
