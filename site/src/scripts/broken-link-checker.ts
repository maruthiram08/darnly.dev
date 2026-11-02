// Broken link checker: asks /api/links to crawl a site and check every link and image on it,
// then shows the count, a bar of fine/redirect/broken links, and a card for each problem.

type Kind = 'broken' | 'redirect' | 'blocked';
type Place = { page: string; text: string };
type Found = { url: string; type: 'link' | 'image'; internal: boolean; kind: Kind; status: number; to?: string; places: Place[]; total: number };
type Result = {
  url: string;
  finalUrl: string;
  pagesCrawled: number;
  pages: string[];
  linksFound: number;
  ok: number;
  found: Found[];
  brokenPages: number;
  notChecked: number;
  stopped: 'limit' | 'time' | null;
  morePages: number;
  error?: string;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('bl-form');
const input = $<HTMLInputElement>('bl-url');
const go = $<HTMLButtonElement>('bl-go');
const error = $<HTMLParagraphElement>('bl-error');
const board = $<HTMLElement>('bl-board');
const hero = $<HTMLDivElement>('bl-hero');
const working = $<HTMLDivElement>('bl-working');
const cards = $<HTMLDivElement>('bl-cards');
const promptBtn = $<HTMLButtonElement>('bl-prompt');

const GO_LABEL = 'Find broken links';
const PROMPT_LABEL = 'Copy prompt for your AI agent';
const MAX_CARDS = 60;
let result: Result | null = null;

board.classList.add('is-sample');

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const host = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};

const STATUS: Record<number, string> = {
  400: 'Bad request', 401: 'Needs a login', 403: 'Forbidden', 404: 'Not found', 405: 'Not allowed', 410: 'Gone',
  429: 'Too many requests', 500: 'Server error', 502: 'Bad gateway', 503: 'Unavailable', 504: 'Timed out', 999: 'Refused',
};
const statusLabel = (f: Found) => {
  if (f.kind === 'redirect') return 'Redirects';
  if (f.kind === 'blocked') return `Couldn’t check (${f.status})`;
  if (!f.status) return 'Doesn’t load';
  return `${f.status} ${STATUS[f.status] ?? (f.status >= 500 ? 'Server error' : 'Error')}`;
};
const WHY: Record<Kind, string> = {
  broken: 'Visitors who click this hit a dead end.',
  redirect: 'Works, but bounces through another address first.',
  blocked: 'This site refuses automated checks. Open it yourself to be sure.',
};

// "/pricing" and "/about" and 3 more
function wherePages(f: Found) {
  const pages = [...new Set(f.places.map((p) => p.page))];
  const span = el('span', 'c-where');
  span.append('on ');
  pages.slice(0, 2).forEach((p, i) => {
    if (i) span.append(' and ');
    span.append(el('b', '', p));
  });
  const more = f.total > 1 && pages.length > 2 ? pages.length - 2 : 0;
  if (more) span.append(` and ${plural(more, 'more page')}`);
  return span;
}

function card(f: Found) {
  const a = el('article', `card ${f.kind}`);
  a.title = WHY[f.kind];
  const top = el('div', 'c-top');
  top.append(el('span', `badge ${f.kind}`, statusLabel(f)), wherePages(f));
  const text = f.places[0]?.text || '(no link text)';
  const link = el('p', 'c-link');
  link.append(el('span', f.type === 'image' ? 'anchor img' : 'anchor', f.type === 'image' ? `Image: ${text}` : text));
  const url = el('p', 'c-url');
  const open = el('a', '', f.url);
  open.href = f.url;
  open.target = '_blank';
  open.rel = 'noopener nofollow';
  url.append(open);
  if (f.to) url.append(' ', el('span', 'arrow', '→'), ` ${f.to}`);
  a.append(top, link, url);
  const otherTexts = [...new Set(f.places.map((p) => p.text))].filter((t) => t && t !== text);
  if (f.total > 1) a.append(el('p', 'c-more', `Used ${plural(f.total, 'time')}${otherTexts.length ? `, also as “${otherTexts[0]}”` : ''}.`));
  return a;
}

function renderBar(ok: number, redirect: number, broken: number, blocked: number) {
  const segs: [string, number][] = [['ok', ok], ['redirect', redirect], ['broken', broken], ['blocked', blocked]];
  $('bl-bar').replaceChildren(
    ...segs.filter(([, n]) => n > 0).map(([cls, n]) => {
      const s = el('span', `seg ${cls}`);
      s.style.flexGrow = String(n);
      return s;
    }),
  );
  const words: [string, number, string][] = [
    ['ok', ok, `${ok} fine`],
    ['redirect', redirect, plural(redirect, 'redirect')],
    ['broken', broken, `${broken} broken`],
    ['blocked', blocked, `${blocked} couldn’t check`],
  ];
  $('bl-legend').replaceChildren(
    ...words.filter(([, n]) => n > 0).map(([cls, , label]) => {
      const li = el('li');
      li.append(el('i', `dot ${cls}`), label);
      return li;
    }),
  );
}

function render(r: Result) {
  result = r;
  board.classList.remove('is-sample');
  $('bl-sample').hidden = true;
  const broken = r.found.filter((f) => f.kind === 'broken');
  const redirects = r.found.filter((f) => f.kind === 'redirect');
  const blocked = r.found.filter((f) => f.kind === 'blocked');
  const name = host(r.finalUrl);

  if (broken.length) {
    hero.dataset.tone = 'bad';
    $('bl-num').textContent = String(broken.length);
    $('bl-what').textContent = `broken ${broken.length === 1 ? 'link' : 'links'} on ${plural(r.brokenPages || 1, 'page')}`;
  } else if (redirects.length) {
    hero.dataset.tone = 'warn';
    $('bl-num').textContent = '0';
    $('bl-what').textContent = `broken links, and ${plural(redirects.length, 'redirect')} to tidy up`;
  } else {
    hero.dataset.tone = 'good';
    $('bl-num').textContent = '0';
    $('bl-what').textContent = 'broken links. Nice.';
  }
  const checked = r.ok + r.found.length;
  $('bl-sub').textContent = `We checked ${plural(checked, 'link and image', 'links and images')} on ${plural(r.pagesCrawled, 'page')} of ${name}.`;
  renderBar(r.ok, redirects.length, broken.length, blocked.length);
  promptBtn.disabled = !broken.length && !redirects.length;
  promptBtn.hidden = !broken.length && !redirects.length;

  const notes: string[] = [];
  if (r.stopped === 'limit' || r.morePages) notes.push(`We stopped at ${plural(r.pagesCrawled, 'page')} to keep it quick, so pages deeper in your site weren’t opened.`);
  if (r.stopped === 'time') notes.push('Your site was slow to answer, so we stopped opening pages after 20 seconds.');
  if (r.notChecked) notes.push(`We didn’t get to ${plural(r.notChecked, 'more link')} (we check up to 150 per run). Fix these first, then run it again.`);
  if (r.pagesCrawled <= 1 && r.linksFound < 5) notes.push('We found almost no links. If your site builds its pages with JavaScript in the browser, its links only appear after it loads, so we can’t see them.');
  if (host(r.url) !== name) notes.push(`${host(r.url)} redirected to ${name}, so we checked ${name}.`);
  $('bl-note').textContent = notes.join(' ');
  $('bl-note').hidden = !notes.length;

  const shown = r.found.slice(0, MAX_CARDS);
  const list: HTMLElement[] = shown.map(card);
  if (!r.found.length) list.push(el('p', 'all-good', `Every link and image we checked on ${name} works.`));
  if (r.found.length > MAX_CARDS) list.push(el('p', 'all-good', `And ${r.found.length - MAX_CARDS} more. The prompt includes all of them.`));
  cards.replaceChildren(...list);

  $('bl-pages-title').textContent = `${plural(r.pagesCrawled, 'page')} we opened`;
  $('bl-pages').replaceChildren(...r.pages.map((p) => el('li', '', p)));
  $('bl-pages-box').hidden = !r.pages.length;
}

function agentPrompt(r: Result): string {
  const broken = r.found.filter((f) => f.kind === 'broken');
  const redirects = r.found.filter((f) => f.kind === 'redirect');
  const where = (f: Found) => f.places.map((p) => `${p.page}${p.text ? ` ("${p.text}")` : ''}`).join(', ');
  const lines = [`Fix the broken links on my site ${host(r.finalUrl)}. A link checker found these:`];
  if (broken.length) {
    lines.push('', 'Broken (visitors hit an error):');
    for (const f of broken) lines.push(`- ${f.type === 'image' ? 'Image' : 'Link'} to ${f.url} (${statusLabel(f)}), on ${where(f)}`);
  }
  if (redirects.length) {
    lines.push('', 'Redirects (they work, but point them straight at the final address):');
    for (const f of redirects.slice(0, 40)) lines.push(`- ${f.url} → ${f.to}, on ${where(f)}`);
  }
  lines.push(
    '',
    'For each broken one: find where the link or image is in the code (it may be in a shared header, footer or layout, so fix it once there). If the page or file moved, point it at the new address. If it no longer exists, remove the link or point it somewhere sensible, and tell me which ones you removed. For a missing image on my own site, check whether the file is in the project under a different name or folder.',
    'Don’t change anything else. When you’re done, list what you changed.',
  );
  return lines.join('\n');
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    promptBtn.textContent = 'Copied. Paste it into your agent';
  } catch {
    promptBtn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (promptBtn.textContent = PROMPT_LABEL), 2000);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  error.hidden = true;
  working.hidden = false;
  go.disabled = true;
  go.textContent = 'Checking…';
  hero.hidden = true;
  cards.hidden = true;
  $('bl-note').hidden = true;
  $('bl-sample').hidden = true;
  try {
    const res = await fetch(`/api/links?url=${encodeURIComponent(url)}`);
    const data: Result = await res.json().catch(() => ({ error: 'Something went wrong. Try again.' }) as Result);
    if (!res.ok || data.error) throw new Error(data.error ?? 'Something went wrong. Try again.');
    render(data);
    history.replaceState(null, '', `?url=${encodeURIComponent(url)}`);
  } catch (err) {
    error.textContent = (err as Error).message;
    error.hidden = false;
    if (!result) $('bl-sample').hidden = false;
  } finally {
    working.hidden = true;
    hero.hidden = false;
    cards.hidden = false;
    go.disabled = false;
    go.textContent = GO_LABEL;
  }
});

promptBtn.addEventListener('click', () => result && copy(agentPrompt(result)));

// Shared links like /tools/broken-link-checker/?url=example.com run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
