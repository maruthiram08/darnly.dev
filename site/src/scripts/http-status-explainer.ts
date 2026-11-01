// HTTP status explainer: everything is static data in the page. Nothing is fetched or uploaded.
import { HOPS, TAGS, VERDICT, buildPrompt, fallback, findById, search, toneOf, type StatusCode, type Tag } from './http-status-data';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const card = $<HTMLElement>('hs-card');
const q = $<HTMLInputElement>('hs-q');
const results = $<HTMLUListElement>('hs-results');
const status = $<HTMLSpanElement>('hs-status');

const GROUP_LABEL: Record<string, string> = {
  '1xx': '1xx · Informational', '2xx': '2xx · Success', '3xx': '3xx · Redirect', '4xx': '4xx · Client error', '5xx': '5xx · Server error',
  Cloudflare: 'Cloudflare error', Vercel: 'Vercel error', Netlify: 'Netlify error',
};

const STACK_KEY = 'darnly-http-status-stack';
const picked = new Set<Tag>();
try {
  for (const t of JSON.parse(localStorage.getItem(STACK_KEY) || '[]')) if (TAGS.includes(t)) picked.add(t);
} catch { /* storage blocked: start with no filter */ }

let current: StatusCode = findById('404')!;

function render(x: StatusCode) {
  current = x;
  const tone = toneOf(x);
  card.className = `card ${tone}`;
  const isNum = /^\d+$/.test(x.id);
  // The big number is always what the browser sees; platform codes (FUNCTION_INVOCATION_TIMEOUT, 1020) go in the label.
  $('hs-num').textContent = String(x.status);
  $('hs-group').textContent = x.group === 'Netlify' || isNum && x.id === String(x.status) ? GROUP_LABEL[x.group] : `${GROUP_LABEL[x.group]} · ${x.id}`;
  $('hs-name').textContent = x.name;
  $('hs-verdict').textContent = VERDICT[tone];
  $('hs-means').textContent = x.means;

  // Where it broke.
  const chain = $('hs-chain');
  const bad = x.hop ? HOPS.findIndex((h) => h.id === x.hop) : -1;
  chain.replaceChildren(
    ...HOPS.map((h, i) => {
      const state = bad < 0 ? (h.id === 'app' ? 'done' : i < 2 ? 'ok' : 'after') : i < bad ? 'ok' : i === bad ? 'bad' : 'after';
      const hop = el('div', `hop ${state}`);
      hop.append(
        el('span', 'dot', state === 'bad' ? '!' : state === 'after' ? '·' : '✓'),
        el('span', 'lbl', h.label),
        el('span', 'sub', h.sub),
      );
      if (state === 'bad') hop.append(el('span', 'flag', 'Likely problem'));
      if (state === 'done') hop.append(el('span', 'flag', 'Answered fine'));
      return hop;
    }),
  );
  chain.setAttribute('aria-label', bad < 0 ? 'Where it broke: nothing broke' : `Where it broke: most likely ${HOPS[bad].label} (${HOPS[bad].sub})`);

  renderCauses();

  const fixes = $('hs-fixes');
  fixes.replaceChildren(...x.fixes.map((f) => el('li', '', f)));

  for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-id]')) {
    a.setAttribute('aria-current', String(a.dataset.id?.toLowerCase() === x.id.toLowerCase()));
  }
  document.title = `${x.id} ${x.name}: what it means and how to fix it · Darnly`;
}

function renderTags() {
  const box = $('hs-tags');
  box.replaceChildren(
    ...TAGS.map((t) => {
      const b = el('button', '', t);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(picked.has(t)));
      b.addEventListener('click', () => {
        if (picked.has(t)) picked.delete(t);
        else picked.add(t);
        try { localStorage.setItem(STACK_KEY, JSON.stringify([...picked])); } catch { /* ignore */ }
        b.setAttribute('aria-pressed', String(picked.has(t)));
        renderCauses();
      });
      return b;
    }),
  );
}

function renderCauses() {
  const list = $('hs-causes');
  const x = current;
  $('hs-tags').hidden = !x.causes.some((k) => k.tag !== 'Any');
  if (!x.causes.length) {
    list.replaceChildren(el('li', 'empty', 'Nothing usually goes wrong here.'));
    return;
  }
  // Causes for the picked stack come first; the rest stay visible but faded.
  // If nothing matches the picked stack, show every cause at full strength.
  const anyPicked = x.causes.some((k) => k.tag !== 'Any' && picked.has(k.tag));
  const match = (tag: Tag) => !picked.size || !anyPicked || tag === 'Any' || picked.has(tag);
  const sorted = [...x.causes].sort((a, b) => Number(match(b.tag)) - Number(match(a.tag)));
  list.replaceChildren(
    ...sorted.map((k) => {
      const li = el('li', match(k.tag) ? '' : 'dim');
      li.append(el('span', 'tag', k.tag === 'Any' ? 'Any stack' : k.tag), el('span', '', k.text));
      return li;
    }),
  );
}

function fromHash(): StatusCode | undefined {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return undefined;
  return findById(id) ?? (/^\d{3}$/.test(id) ? fallback(Number(id)) : undefined);
}

function pick(x: StatusCode, scroll = true) {
  history.replaceState(null, '', `#${x.id}`);
  render(x);
  closeResults();
  if (scroll && card.getBoundingClientRect().top < 0) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Links in the quick row, the full list and the FAQ open the code without jumping the page.
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!a || a.closest('.results')) return;
  const id = decodeURIComponent(a.getAttribute('href')!.slice(1));
  const x = findById(id);
  if (!x) return;
  e.preventDefault();
  pick(x, false);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
window.addEventListener('hashchange', () => {
  const x = fromHash();
  if (x) render(x);
});

// ---- Search ----
let hits: StatusCode[] = [];
let active = 0;

function closeResults() {
  results.hidden = true;
  q.setAttribute('aria-expanded', 'false');
}

function showResults() {
  const v = q.value.trim();
  if (!v) return closeResults();
  hits = search(v).slice(0, 8);
  const fb = /^\d{3}$/.test(v) && !hits.some((h) => h.id === v) ? fallback(Number(v)) : undefined;
  if (fb) hits.unshift(fb);
  active = 0;
  if (!hits.length) {
    results.replaceChildren(el('li', 'none', 'No code matches. Try the number, like 502, or a word from the error page.'));
  } else {
    results.replaceChildren(
      ...hits.map((h, i) => {
        const li = el('li');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === active));
        li.append(el('b', '', /^\d+$/.test(h.id) || h.group === 'Netlify' ? String(h.status) : `${h.status} ${h.id}`), el('span', '', h.name));
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pick(h);
          q.blur();
        });
        return li;
      }),
    );
  }
  results.hidden = false;
  q.setAttribute('aria-expanded', 'true');
}

q.addEventListener('input', () => {
  showResults();
  // An exact match shows straight away, so typing "502" is enough.
  const v = q.value.trim();
  const exact = findById(v);
  if (exact) render(exact);
  else if (/^\d{3}$/.test(v)) render(fallback(Number(v)) ?? current);
});
q.addEventListener('keydown', (e) => {
  if (results.hidden || !hits.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
    results.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    pick(hits[active]);
  } else if (e.key === 'Escape') {
    closeResults();
  }
});
q.addEventListener('blur', () => setTimeout(closeResults, 120));
q.addEventListener('focus', () => q.value.trim() && showResults());

// ---- Copy ----
async function copy(text: string, msg: string) {
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = msg;
  } catch {
    status.textContent = 'Couldn’t copy. Your browser blocked the clipboard.';
  }
  setTimeout(() => (status.textContent = ''), 2500);
}
$('hs-prompt').addEventListener('click', () => copy(buildPrompt(current, [...picked]), 'Prompt copied. Paste it into Claude Code, Cursor or Codex.'));
$('hs-link').addEventListener('click', () => copy(`${location.origin}${location.pathname}#${current.id}`, 'Link copied.'));

renderTags();
render(fromHash() ?? current);
if (location.hash && fromHash()) requestAnimationFrame(() => card.scrollIntoView({ block: 'start' }));
