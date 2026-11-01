// Accessibility checker: asks /api/a11y to check one page's HTML, then shows a big score,
// a tile per check, and a card per problem with the HTML behind it and a one-line fix.

type Level = 'pass' | 'fail' | 'warn' | 'na';
type Sample = { html: string; note?: string; img?: string; fg?: string; bg?: string; ratio?: string; text?: string };
type Check = {
  id: string;
  label: string;
  level: Level;
  summary: string;
  who: string;
  fix: string;
  samples: Sample[];
  more: number;
  tool?: { href: string; name: string };
};
type Result = { url: string; finalUrl: string; status: number; score: number | null; checks: Check[]; jsOnly: boolean; prompt: string; counted: number; error?: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('ax-form');
const input = $<HTMLInputElement>('ax-url');
const button = $<HTMLButtonElement>('ax-go');
const error = $<HTMLParagraphElement>('ax-error');
const out = $<HTMLDivElement>('ax-out');
const hero = $<HTMLElement>('ax-hero');
const bar = document.getElementById('ax-bar') as unknown as SVGCircleElement;
const scoreEl = $<HTMLElement>('ax-score');
const ofEl = $<HTMLElement>('ax-of');
const site = $<HTMLParagraphElement>('ax-site');
const verdict = $<HTMLParagraphElement>('ax-verdict');
const counts = $<HTMLParagraphElement>('ax-counts');
const copyAll = $<HTMLButtonElement>('ax-copy');
const tiles = $<HTMLUListElement>('ax-tiles');
const cards = $<HTMLUListElement>('ax-cards');
const passedBox = $<HTMLDetailsElement>('ax-passed-box');
const passedSum = $<HTMLElement>('ax-passed-sum');
const passedList = $<HTMLUListElement>('ax-passed');
const note = $<HTMLParagraphElement>('ax-note');

const CIRC = 2 * Math.PI * 52;
const MARK: Record<Level, string> = { pass: '✓', fail: '✕', warn: '!', na: '–' };
let prompt = '';

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
    btn.textContent = 'Copied. Paste it into your AI agent';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.textContent = label), 1800);
}

function sample(s: Sample): HTMLLIElement {
  const li = el('li', 'sample');
  if (s.fg && s.bg) {
    const sw = el('div', 'swatch', s.text || 'Sample text');
    sw.style.color = s.fg;
    sw.style.background = s.bg;
    sw.append(el('small', '', s.ratio ?? ''));
    li.append(sw);
  } else if (s.img) {
    const img = el('img', 'thumb');
    img.src = s.img;
    img.alt = 'The image with no alt text';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove());
    li.append(img);
  } else {
    li.classList.add('plain');
  }
  const box = el('div');
  box.append(el('code', 'html', s.html));
  const extra = [s.note, s.fg ? `Text ${s.fg} on ${s.bg} is ${s.ratio}.` : ''].filter(Boolean).join(' ');
  if (extra) box.append(el('p', 'sample-note', extra));
  li.append(box);
  return li;
}

function card(c: Check): HTMLLIElement {
  const li = el('li', `card ${c.level}`);
  li.id = `ax-${c.id}`;
  const head = el('div', 'head');
  head.append(el('span', 'tag', c.level === 'warn' ? 'Worth fixing' : 'Problem'), el('p', 'title', c.label));
  li.append(head, el('p', 'what', c.summary), el('p', 'who', c.who));
  if (c.samples.length) {
    const ul = el('ul', 'samples');
    ul.append(...c.samples.map(sample));
    li.append(ul);
    if (c.more) li.append(el('p', 'more', `And ${c.more} more like ${c.more === 1 ? 'this' : 'these'}.`));
  }
  const fix = el('p', 'fix');
  fix.append(el('b', '', 'Fix: '), document.createTextNode(c.fix));
  li.append(fix);
  if (c.tool) {
    const p = el('p', 'tool');
    const a = el('a', '', `Check other colors with the ${c.tool.name.toLowerCase()} →`);
    a.href = c.tool.href;
    p.append(a);
    li.append(p);
  }
  return li;
}

function tile(c: Check): HTMLLIElement {
  const li = el('li');
  const a = el('a', c.level);
  a.href = c.level === 'fail' || c.level === 'warn' ? `#ax-${c.id}` : '#ax-passed-box';
  a.title = c.summary;
  a.append(el('span', 'dot', MARK[c.level]), el('span', '', c.label));
  if (a.hash === '#ax-passed-box') a.addEventListener('click', () => (passedBox.open = true));
  li.append(a);
  return li;
}

function render(r: Result) {
  const bad = r.checks.filter((c) => c.level === 'fail' || c.level === 'warn');
  const good = r.checks.filter((c) => c.level === 'pass');
  const skipped = r.checks.filter((c) => c.level === 'na');
  const name = host(r.finalUrl);

  // Score ring
  const s = r.score;
  hero.className = `hero ${s === null ? 'unknown' : s >= 90 ? 'high' : s >= 60 ? 'mid' : 'low'}`;
  scoreEl.textContent = s === null ? '?' : String(s);
  ofEl.textContent = s === null ? 'no score' : '/ 100';
  bar.style.strokeDashoffset = String(CIRC);
  bar.style.opacity = s === null || s === 0 ? '0' : '1';
  requestAnimationFrame(() => requestAnimationFrame(() => (bar.style.strokeDashoffset = String(CIRC * (1 - (s ?? 0) / 100)))));

  site.textContent = name;
  if (r.jsOnly) {
    verdict.textContent = 'This page is built by JavaScript, so most of it isn’t in the HTML we can read.';
  } else if (!bad.length) {
    verdict.textContent = 'The basics are in place.';
  } else {
    const n = bad.length;
    verdict.textContent = s !== null && s >= 90 ? `Nearly there: ${n} thing${n === 1 ? '' : 's'} to fix.` : `${n} problem${n === 1 ? '' : 's'} people will run into.`;
  }
  const parts = [`${good.length} passed`];
  if (bad.length) parts.push(`${bad.length} to fix`);
  if (skipped.length) parts.push(`${skipped.length} didn’t apply`);
  counts.textContent = r.jsOnly
    ? 'We could only check the language, zoom and keyboard settings. For the rest, open your site in Chrome, press F12, open the Lighthouse tab and run an Accessibility report.'
    : parts.join(' · ');

  prompt = r.prompt;
  copyAll.hidden = !prompt;

  tiles.replaceChildren(...r.checks.map(tile));
  cards.replaceChildren(...bad.map(card));
  cards.hidden = !bad.length;

  passedSum.textContent = `Passed and skipped checks (${good.length + skipped.length})`;
  passedList.replaceChildren(
    ...[...good, ...skipped].map((c) => {
      const li = el('li');
      li.append(el('b', '', `${MARK[c.level]} ${c.label}: `), document.createTextNode(c.summary));
      return li;
    }),
  );
  passedBox.open = !bad.length;

  const notes: string[] = [];
  if (r.status >= 400) notes.push(`The page answered with error ${r.status}, so it may not be the page visitors see.`);
  if (host(r.url) !== name) notes.push(`${host(r.url)} redirected to ${name}, so we checked that.`);
  note.textContent = notes.join(' ');
  note.hidden = !notes.length;
}

copyAll.addEventListener('click', () => copyText(prompt, copyAll, 'Copy one prompt to fix all of these'));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    const res = await fetch(`/api/a11y?url=${encodeURIComponent(url)}`);
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
    button.textContent = 'Check accessibility';
  }
});

// Shared links like /tools/accessibility-checker/?url=example.com run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
