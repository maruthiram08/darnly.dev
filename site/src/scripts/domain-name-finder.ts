// Domain name finder: type a name, see which endings are free, and get name ideas checked live.
import { ALL_TLDS, MAIN_TLDS, STORES, chunks, ideas, monthYear } from './domain-name-finder-core';

type State = 'free' | 'taken' | 'maybe' | 'unknown';
type Result = { name: string; state: State; registered?: string; expires?: string; registrar?: string };

const IDEAS_STEP = 10;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('dn-form');
const input = $<HTMLInputElement>('dn-q');
const go = $<HTMLButtonElement>('dn-go');
const errorBox = $('dn-error');
const tldBox = $('dn-tlds');
const hero = $('dn-hero');
const heroDomain = $('dn-hero-domain');
const heroBar = $('dn-hero-bar');
const heroBadge = $('dn-hero-badge');
const heroLine = $('dn-hero-line');
const heroBuy = $('dn-hero-buy');
const heroAfter = $('dn-hero-after');
const summary = $('dn-summary');
const exactBox = $('dn-exact');
const ideasBox = $('dn-ideas');
const moreBtn = $<HTMLButtonElement>('dn-more');
const hideTaken = $<HTMLInputElement>('dn-hide');

const results = new Map<string, Result>();
const pending = new Set<string>();
let tlds = new Set(MAIN_TLDS);
let names: string[] = []; // [the name as typed, ...ideas]
let shown = IDEAS_STEP;
let picked: string | null = null; // a domain the person clicked
let queue: string[] = [];
let running = false;
let paused = ''; // set when the server asks us to slow down

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const order = () => ALL_TLDS.filter((t) => tlds.has(t));
const domainsFor = (label: string) => order().map((t) => `${label}.${t}`);
const stateOf = (d: string): State | 'checking' => results.get(d)?.state ?? 'checking';
const isOpen = (s: State | 'checking') => s === 'free' || s === 'maybe';

// ----- lookups -----

function wanted(): string[] {
  const list = names.slice(0, shown + 1).flatMap(domainsFor);
  return list.filter((d) => !results.has(d));
}

function check() {
  queue = wanted();
  if (!running) void drain();
}

async function drain() {
  running = true;
  try {
    while (queue.length && !paused) {
      const batch = chunks(queue.filter((d) => !pending.has(d) && !results.has(d)))[0];
      if (!batch) break;
      batch.forEach((d) => pending.add(d));
      try {
        const res = await fetch(`/api/domains?names=${encodeURIComponent(batch.join(','))}`);
        const data = (await res.json().catch(() => ({}))) as { results?: Result[]; error?: string };
        if (res.status === 429) {
          paused = data.error ?? 'Too many lookups in a minute.';
          setTimeout(() => {
            paused = '';
            render();
            check();
          }, 20_000);
        } else if (!res.ok || !data.results) {
          batch.forEach((d) => results.set(d, { name: d, state: 'unknown' }));
        } else {
          for (const r of data.results) results.set(r.name, r);
        }
      } catch {
        batch.forEach((d) => results.set(d, { name: d, state: 'unknown' }));
      } finally {
        batch.forEach((d) => pending.delete(d));
      }
      queue = wanted();
      render();
    }
  } finally {
    running = false;
  }
}

// ----- drawing -----

function storeLinks(domain: string, big: boolean): HTMLElement {
  const box = el('div', big ? 'buy' : 'buy small');
  for (const s of STORES) {
    const a = el('a', `store ${s.id}`, big ? `Buy at ${s.name}` : s.name);
    a.href = s.url(domain);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    box.append(a);
  }
  return box;
}

function takenNote(r?: Result): string {
  if (!r) return '';
  const parts: string[] = [];
  if (r.registered) parts.push(`since ${monthYear(r.registered)}`);
  if (r.expires) parts.push(`renews ${monthYear(r.expires)}`);
  return parts.join(' · ');
}

const LABEL: Record<State | 'checking', string> = {
  free: 'Free',
  maybe: 'Probably free',
  taken: 'Taken',
  unknown: 'Couldn’t check',
  checking: 'Checking…',
};

// The best domain to show at the top: the one picked, else the first free ending of the name, else the first free idea.
function best(): string | null {
  if (picked && tlds.has(picked.slice(picked.lastIndexOf('.') + 1)) && names.some((n) => picked!.startsWith(`${n}.`))) return picked;
  for (const label of names.slice(0, shown + 1)) {
    for (const d of domainsFor(label)) if (stateOf(d) === 'free') return d;
  }
  for (const label of names.slice(0, shown + 1)) {
    for (const d of domainsFor(label)) if (stateOf(d) === 'maybe') return d;
  }
  return null;
}

function renderHero() {
  hero.hidden = !names.length;
  if (!names.length) return;
  const base = names[0];
  const exact = domainsFor(base);
  const done = exact.filter((d) => stateOf(d) !== 'checking');
  const open = exact.filter((d) => isOpen(stateOf(d)));
  const choice = best();
  const stillChecking = done.length < exact.length;

  heroBuy.replaceChildren();
  heroAfter.hidden = true;
  if (choice) {
    const s = stateOf(choice);
    heroDomain.textContent = choice;
    heroBar.textContent = choice;
    heroBadge.textContent = s === 'free' ? 'Free to register' : LABEL[s];
    heroBadge.className = `badge ${s}`;
    hero.dataset.state = s === 'checking' ? 'checking' : isOpen(s) ? 'free' : s;
    const isExact = choice.startsWith(`${base}.`);
    heroLine.textContent = isExact
      ? s === 'maybe'
        ? 'It has no website or DNS, but the registry didn’t answer. Search it at a store to be sure.'
        : 'Nobody has registered it. Grab it before you tell anyone the name.'
      : choice === picked
        ? s === 'maybe'
          ? 'It has no website or DNS, but the registry didn’t answer. Search it at a store to be sure.'
          : 'Nobody has registered it. Grab it before you tell anyone the name.'
        : `Every ending of ${base} you picked is taken, but this one is free.`;
    heroBuy.append(storeLinks(choice, true));
    heroAfter.hidden = false;
  } else if (stillChecking) {
    heroDomain.textContent = `${base}.${order()[0] ?? 'com'}`;
    heroBar.textContent = heroDomain.textContent;
    heroBadge.textContent = 'Checking…';
    heroBadge.className = 'badge checking';
    hero.dataset.state = 'checking';
    heroLine.textContent = 'Asking the registries…';
  } else {
    heroDomain.textContent = `${base}.${order()[0] ?? 'com'}`;
    heroBar.textContent = heroDomain.textContent;
    heroBadge.textContent = 'Taken';
    heroBadge.className = 'badge taken';
    hero.dataset.state = 'taken';
    heroLine.textContent = 'Every name here is taken. Try more ideas below, add more endings, or try a different word.';
  }

  summary.textContent = stillChecking
    ? `Checking ${base} on ${exact.length} endings…`
    : open.length === exact.length
      ? `${base} is free on every ending you picked.`
      : open.length
        ? `${base} is free on ${open.length} of ${exact.length} endings.`
        : `${base} is taken on every ending you picked.`;
}

function card(d: string): HTMLElement {
  const s = stateOf(d);
  const r = results.get(d);
  const c = el(isOpen(s) || s === 'unknown' ? 'button' : 'div', `card ${s}`);
  if (c instanceof HTMLButtonElement) {
    c.type = 'button';
    c.setAttribute('aria-pressed', String(best() === d));
    c.addEventListener('click', () => pick(d));
  }
  const dot = d.lastIndexOf('.');
  const name = el('span', 'cname');
  name.append(el('span', 'clabel', d.slice(0, dot)), el('span', 'ctld', d.slice(dot)));
  c.append(name, el('span', `pill ${s}`, LABEL[s]));
  const note = s === 'taken' ? takenNote(r) : s === 'unknown' ? 'Tap to search it' : '';
  if (note) c.append(el('span', 'cnote', note));
  return c;
}

function renderExact() {
  exactBox.replaceChildren(...(names.length ? domainsFor(names[0]).map(card) : []));
}

function chip(d: string): HTMLElement {
  const s = stateOf(d);
  const tld = d.slice(d.lastIndexOf('.'));
  const r = results.get(d);
  if (isOpen(s) || s === 'unknown') {
    const b = el('button', `tld ${s}`, tld);
    b.type = 'button';
    b.title = `${d}: ${LABEL[s]}`;
    b.setAttribute('aria-pressed', String(best() === d));
    b.addEventListener('click', () => pick(d));
    return b;
  }
  const span = el('span', `tld ${s}`, tld);
  span.title = s === 'taken' ? `${d} is taken${takenNote(r) ? ` (${takenNote(r)})` : ''}` : `${d}: checking`;
  return span;
}

function renderIdeas() {
  const rows = names.slice(1, shown + 1).flatMap((label) => {
    const ds = domainsFor(label);
    const states = ds.map(stateOf);
    if (hideTaken.checked && states.every((s) => s === 'taken')) return [];
    const row = el('li', `idea${states.some(isOpen) ? ' has-free' : ''}`);
    row.append(el('span', 'iname', label));
    const chips = el('span', 'chips');
    chips.append(...ds.map(chip));
    row.append(chips);
    return [row];
  });
  if (!rows.length && names.length > 1) {
    rows.push(el('li', 'idea empty', hideTaken.checked ? 'Every idea so far is taken. Show more ideas, or add endings above.' : 'No ideas yet.'));
  }
  ideasBox.replaceChildren(...rows);
  moreBtn.hidden = shown + 1 >= names.length;
}

function render() {
  renderHero();
  renderExact();
  renderIdeas();
  errorBox.hidden = !paused;
  if (paused) errorBox.textContent = `${paused} We’ll carry on in a few seconds.`;
}

function pick(d: string) {
  picked = d;
  if (stateOf(d) === 'unknown') {
    // We couldn't tell, so send them to look it up at a store.
    window.open(STORES[1].url(d), '_blank', 'noopener,noreferrer');
  }
  render();
  hero.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ----- inputs -----

function search() {
  const list = ideas(input.value);
  if (!list.length) {
    errorBox.hidden = false;
    errorBox.textContent = 'Type a project name or a few words, like “tiny invoice”.';
    return;
  }
  names = list;
  shown = IDEAS_STEP;
  picked = null;
  const q = new URL(location.href);
  q.searchParams.set('q', input.value.trim());
  history.replaceState(null, '', q);
  render();
  check();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  search();
});

tldBox.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tld]');
  if (!b) return;
  const t = b.dataset.tld!;
  if (tlds.has(t) && tlds.size === 1) return; // keep at least one
  tlds = new Set(tlds);
  if (tlds.has(t)) tlds.delete(t);
  else tlds.add(t);
  b.setAttribute('aria-pressed', String(tlds.has(t)));
  render();
  check();
});

moreBtn.addEventListener('click', () => {
  shown += IDEAS_STEP;
  render();
  check();
});

hideTaken.addEventListener('change', render);

// Start with the name from the link, or the example in the box, so the page shows a result straight away.
const fromLink = new URL(location.href).searchParams.get('q');
if (fromLink) input.value = fromLink.slice(0, 80);
go.disabled = false;
search();
