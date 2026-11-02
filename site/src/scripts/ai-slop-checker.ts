// AI slop checker: asks /api/slop how AI-made a page looks and shows the score, tells and fixes.

type Tell = { id: string; title: string; detail: string; fix: string; points: number };
type Result = {
  url: string; finalUrl: string; status: number; title: string | null;
  score: number; verdict: string; tells: Tell[]; passed: { id: string; title: string }[]; scripted: boolean;
  error?: string;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('as-form');
const input = $<HTMLInputElement>('as-url');
const button = $<HTMLButtonElement>('as-go');
const error = $<HTMLParagraphElement>('as-error');
const out = $<HTMLDivElement>('as-out');
const card = $<HTMLElement>('as-card');
const meter = $<HTMLDivElement>('as-meter');
const scoreEl = $<HTMLSpanElement>('as-score');
const verdictEl = $<HTMLHeadingElement>('as-verdict');
const hostEl = $<HTMLParagraphElement>('as-host');
const chips = $<HTMLUListElement>('as-chips');
const list = $<HTMLOListElement>('as-list');
const passedList = $<HTMLUListElement>('as-passed');
const passedH = $<HTMLElement>('as-passed-h');
const promptBtn = $<HTMLButtonElement>('as-prompt');
const shareBtn = $<HTMLButtonElement>('as-share');
const note = $<HTMLParagraphElement>('as-note');

// Where one of our own tools fixes the tell.
const TOOL_LINK: Record<string, { href: string; label: string }> = {
  favicon: { href: '/tools/favicon-generator/', label: 'Favicon generator' },
  share: { href: '/tools/og-image-generator/', label: 'OG image generator' },
  font: { href: '/tools/font-finder/', label: 'Font finder' },
};

let lastPrompt = '';
let lastUrl = '';

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

const level = (s: number) => (s < 15 ? 0 : s < 35 ? 1 : s < 60 ? 2 : 3);

function agentPrompt(r: Result): string {
  if (!r.tells.length) return '';
  const lines = [
    `My site (${host(r.finalUrl)}) looks AI-generated. Fix these tells so it looks designed on purpose, without changing what the site does:`,
    '',
    ...r.tells.map((t, i) => `${i + 1}. ${t.title}. ${t.detail} Fix: ${t.fix}`),
    '',
    'Keep the changes small and consistent with the rest of the project. Tell me which files you changed and anything you need from me (like a logo or brand color).',
  ];
  return lines.join('\n');
}

function tellItem(t: Tell): HTMLLIElement {
  const li = el('li');
  const head = el('div', 'head');
  head.append(el('strong', '', t.title), el('span', 'pts', `+${t.points}`));
  const fix = el('p', 'fix');
  fix.append(el('b', '', 'Fix: '), document.createTextNode(t.fix));
  const tool = TOOL_LINK[t.id];
  if (tool) {
    const a = el('a', '', tool.label);
    a.href = tool.href;
    fix.append(document.createTextNode(' '), a);
  }
  li.append(head, el('p', 'detail', t.detail), fix);
  return li;
}

function render(r: Result) {
  const name = host(r.finalUrl);
  card.dataset.level = String(level(r.score));
  meter.style.setProperty('--p', String(r.score));
  scoreEl.textContent = String(r.score);
  meter.setAttribute('aria-label', `Score ${r.score} out of 100`);
  verdictEl.textContent = r.verdict;
  hostEl.textContent = r.tells.length
    ? `${name}: ${r.tells.length} AI tell${r.tells.length === 1 ? '' : 's'} out of ${r.tells.length + r.passed.length} checks`
    : `${name} passed all ${r.passed.length} checks`;

  chips.replaceChildren(
    ...(r.tells.length ? r.tells.slice(0, 5).map((t) => el('li', '', t.title)) : [el('li', 'ok', 'No AI tells found')]),
  );

  const clean = el('li');
  clean.append(el('p', 'clean', 'Nothing gives it away. This site looks made on purpose.'));
  list.replaceChildren(...(r.tells.length ? r.tells.map(tellItem) : [clean]));

  passedH.textContent = `Checks it passed (${r.passed.length})`;
  passedList.replaceChildren(...r.passed.map((p) => el('li', '', p.title)));

  lastPrompt = agentPrompt(r);
  promptBtn.hidden = !lastPrompt;

  const notes: string[] = [];
  if (r.status >= 400) notes.push(`The page answered with error ${r.status}, so this may not be the real page.`);
  if (r.scripted) notes.push('This site builds itself with JavaScript, so we also read its main script. Words loaded later from a database can be missed.');
  note.textContent = notes.join(' ');
  note.hidden = !notes.length;
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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    const res = await fetch(`/api/slop?url=${encodeURIComponent(url)}`);
    const data: Result = await res.json().catch(() => ({ error: 'Something went wrong. Try again.' }) as Result);
    if (!res.ok || data.error) throw new Error(data.error ?? 'Something went wrong. Try again.');
    out.hidden = false;
    render(data);
    lastUrl = url;
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

promptBtn.addEventListener('click', () => copyText(lastPrompt, promptBtn, 'Copy prompt for your AI agent'));
shareBtn.addEventListener('click', () =>
  copyText(`${location.origin}/tools/ai-slop-checker/?url=${encodeURIComponent(lastUrl)}`, shareBtn, 'Copy link to this score'),
);

// Shared links like /tools/ai-slop-checker/?url=example.com run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
