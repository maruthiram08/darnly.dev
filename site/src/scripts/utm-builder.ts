// UTM link builder: everything runs in the visitor's browser. Nothing is uploaded.
import qrcode from 'qrcode-generator';
import { PRESETS, build, parseUrl, tidy, type Built, type Key, type Tags } from './utm-builder-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const urlIn = $<HTMLInputElement>('ub-url');
const errEl = $<HTMLParagraphElement>('ub-error');
const presetsEl = $<HTMLDivElement>('ub-presets');
const campaignIn = $<HTMLInputElement>('ub-campaign');
const contentIn = $<HTMLInputElement>('ub-content');
const sourceIn = $<HTMLInputElement>('ub-source');
const mediumIn = $<HTMLInputElement>('ub-medium');
const termIn = $<HTMLInputElement>('ub-term');
const tidyIn = $<HTMLInputElement>('ub-tidy');
const more = $<HTMLDetailsElement>('ub-more');
const linkEl = $<HTMLParagraphElement>('ub-link');
const emptyEl = $<HTMLParagraphElement>('ub-empty');
const partsEl = $<HTMLUListElement>('ub-parts');
const noteEl = $<HTMLParagraphElement>('ub-note');
const copyBtn = $<HTMLButtonElement>('ub-copy');
const openLink = $<HTMLAnchorElement>('ub-open');
const status = $<HTMLSpanElement>('ub-status');
const qrEl = $<HTMLDivElement>('ub-qr');
const qrDl = $<HTMLButtonElement>('ub-qr-dl');
const allEl = $<HTMLUListElement>('ub-all');
const copyAll = $<HTMLButtonElement>('ub-copy-all');
const recentEl = $<HTMLUListElement>('ub-recent');
const recentEmpty = $<HTMLParagraphElement>('ub-recent-empty');
const recentCount = $<HTMLSpanElement>('ub-recent-count');
const clearBtn = $<HTMLButtonElement>('ub-clear');

// Every QR byte is UTF-8, so non-Latin page addresses still scan.
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

const EXAMPLE = 'https://your-site.com';
const STORE_KEY = 'darnly-utm-recent';
const MAX_RECENT = 20;

// What each label means, in plain words, and its color in the preview.
const INFO: Record<Key, { name: string; means: string; color: string; tint: string }> = {
  utm_source: { name: 'Source', means: 'Where the click came from', color: '#0593C6', tint: '#D6EFF8' },
  utm_medium: { name: 'Medium', means: 'What kind of channel it is', color: '#D83995', tint: '#F8DCEC' },
  utm_campaign: { name: 'Campaign', means: 'Which push it belongs to', color: '#C27A00', tint: '#FBEACB' },
  utm_term: { name: 'Keyword', means: 'The paid search word', color: '#6A4BC4', tint: '#E6DEFA' },
  utm_content: { name: 'Content', means: 'Which post or button', color: '#1E8A5A', tint: '#D5F0E2' },
};

let preset = 'x';
let current: Built | null = null;

function say(msg: string) {
  status.textContent = msg;
  window.clearTimeout(say.timer);
  say.timer = window.setTimeout(() => (status.textContent = ''), 2500);
}
say.timer = 0;

async function copy(text: string, done: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
    return true;
  } catch {
    say('Your browser blocked copying. Select the link instead.');
    return false;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- Reading the form ----------

function clean(value: string): string {
  return tidyIn.checked ? tidy(value) : value.trim();
}

function tagsFor(source: string, medium: string): Tags {
  return {
    utm_source: clean(source),
    utm_medium: clean(medium),
    utm_campaign: clean(campaignIn.value),
    utm_term: clean(termIn.value),
    utm_content: clean(contentIn.value),
  };
}

function setPreset(id: string) {
  preset = id;
  for (const b of presetsEl.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
    b.setAttribute('aria-pressed', String(b.dataset.preset === id));
  }
  const p = PRESETS.find((x) => x.id === id);
  if (p) {
    sourceIn.value = p.source;
    mediumIn.value = p.medium;
  } else {
    // "Somewhere else": let them type the source.
    sourceIn.value = '';
    mediumIn.value = '';
    more.open = true;
    sourceIn.focus();
  }
}

// ---------- Live preview ----------

function renderLink(b: Built, example: boolean) {
  linkEl.replaceChildren();
  for (const part of b.parts) {
    const span = el('span', part.kind, part.text);
    if (part.kind === 'tag' && part.key) {
      span.style.background = INFO[part.key].tint;
      span.style.color = INFO[part.key].color;
    }
    linkEl.append(span);
  }
  linkEl.style.opacity = example ? '0.45' : '';
}

function renderParts(tags: Tags) {
  partsEl.replaceChildren();
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as Key[]) {
    const value = tags[key];
    if (!value) continue;
    const info = INFO[key];
    const li = el('li');
    li.style.setProperty('--c', info.color);
    li.append(el('span', 'k', `${info.name} · ${key}`), el('span', 'v', value), el('span', 'm', info.means));
    partsEl.append(li);
  }
}

function renderQr(text: string, on: boolean) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  // 4 modules of white around the code so phones can find it.
  qrEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
  qrEl.classList.toggle('off', !on);
}

function render() {
  const parsed = parseUrl(urlIn.value);
  const tags = tagsFor(sourceIn.value, mediumIn.value);
  const has = parsed.ok;

  errEl.hidden = parsed.ok || parsed.reason === 'empty';
  if (!parsed.ok && parsed.reason !== 'empty') errEl.textContent = parsed.reason;

  const target = has ? parsed.url : new URL(EXAMPLE);
  const b = build(target, tags);
  current = has ? b : null;

  renderLink(b, !has);
  emptyEl.hidden = has;
  renderParts(tags);
  renderQr(b.href, has);

  copyBtn.disabled = !has;
  qrDl.disabled = !has;
  openLink.href = has ? b.href : '#';
  openLink.setAttribute('aria-disabled', String(!has));

  const notes: string[] = [];
  if (!tags.utm_source) notes.push('Add a source so your analytics knows where the click came from.');
  if (!tags.utm_campaign) notes.push('Add a campaign name, like launch.');
  if (has && b.replaced.length) notes.push(`Your link already had ${b.replaced.join(', ')}. We replaced it.`);
  if (has && parsed.url.href !== urlIn.value.trim() && !/^https?:\/\//i.test(urlIn.value.trim())) notes.push('We added https:// to the start.');
  noteEl.textContent = notes.join(' ');
  noteEl.hidden = notes.length === 0;

  renderAll(has ? parsed.url : null);
}

// ---------- Every channel at once ----------

let allLinks: { label: string; href: string }[] = [];

function linkRow(label: string, href: string, extra?: HTMLElement) {
  const li = el('li');
  const btns = el('span', 'btns');
  const c = el('button', 'mini', 'Copy');
  c.type = 'button';
  c.addEventListener('click', async () => {
    if (await copy(href, `Copied the ${label} link.`)) remember(label, href);
  });
  btns.append(c);
  if (extra) btns.append(extra);
  li.append(el('span', 'who', label), el('span', 'url', href), btns);
  return li;
}

function renderAll(url: URL | null) {
  allEl.replaceChildren();
  allLinks = [];
  if (!url) {
    allEl.append(el('li', 'url', 'Paste your page above to see a link for each channel.'));
    copyAll.disabled = true;
    return;
  }
  for (const p of PRESETS) {
    const href = build(url, tagsFor(p.source, p.medium)).href;
    allLinks.push({ label: p.label, href });
    allEl.append(linkRow(p.label, href));
  }
  copyAll.disabled = false;
}

copyAll.addEventListener('click', () => {
  if (!allLinks.length) return;
  copy(allLinks.map((l) => `${l.label}: ${l.href}`).join('\n'), `Copied ${allLinks.length} links.`);
});

// ---------- Recent links (this browser only, a convenience) ----------

type Recent = { label: string; href: string; at: number };

function loadRecent(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(list) ? list.filter((r) => r && typeof r.href === 'string' && typeof r.label === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecent(list: Recent[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    // Private windows can block storage; the list just won't be kept.
  }
}

function remember(label: string, href: string) {
  const list = loadRecent().filter((r) => r.href !== href);
  list.unshift({ label, href, at: Date.now() });
  saveRecent(list.slice(0, MAX_RECENT));
  renderRecent();
}

function renderRecent() {
  const list = loadRecent();
  recentEl.replaceChildren();
  for (const r of list) {
    const del = el('button', 'mini', 'Remove');
    del.type = 'button';
    del.setAttribute('aria-label', `Remove ${r.label} link`);
    del.addEventListener('click', () => {
      saveRecent(loadRecent().filter((x) => x.href !== r.href));
      renderRecent();
    });
    recentEl.append(linkRow(r.label, r.href, del));
  }
  recentEmpty.hidden = list.length > 0;
  clearBtn.hidden = list.length === 0;
  recentCount.textContent = list.length ? `(${list.length})` : '';
}

clearBtn.addEventListener('click', () => {
  saveRecent([]);
  renderRecent();
  say('Cleared.');
});

// ---------- Actions ----------

function presetLabel(): string {
  return PRESETS.find((p) => p.id === preset)?.label ?? (clean(sourceIn.value) || 'Link');
}

copyBtn.addEventListener('click', async () => {
  if (!current) return;
  if (await copy(current.href, 'Copied. Paste it in your post.')) remember(presetLabel(), current.href);
});

openLink.addEventListener('click', (e) => {
  if (!current) e.preventDefault();
});

qrDl.addEventListener('click', () => {
  if (!current) return;
  const qr = qrcode(0, 'M');
  qr.addData(current.href, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const total = n + 8;
  const px = Math.ceil(1024 / total);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px * total;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0B2230';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + 4) * px, (r + 4) * px, px, px);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qr-${clean(sourceIn.value) || 'link'}-${clean(campaignIn.value) || 'campaign'}.png`.replace(/[^\w.-]+/g, '-');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    say('QR code saved.');
  }, 'image/png');
});

presetsEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-preset]');
  if (!b?.dataset.preset) return;
  setPreset(b.dataset.preset);
  render();
});

// Typing a source by hand picks the matching preset, or "Somewhere else".
sourceIn.addEventListener('input', () => {
  const match = PRESETS.find((p) => p.source === clean(sourceIn.value));
  preset = match ? match.id : 'other';
  for (const b of presetsEl.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
    b.setAttribute('aria-pressed', String(b.dataset.preset === preset));
  }
});

for (const input of [urlIn, campaignIn, contentIn, sourceIn, mediumIn, termIn, tidyIn]) {
  input.addEventListener('input', render);
}

// A link like /tools/utm-builder/?url=mysite.com prefills the page.
const pre = new URLSearchParams(location.search).get('url');
if (pre) urlIn.value = pre.slice(0, 2000);

setPreset('x');
render();
renderRecent();
