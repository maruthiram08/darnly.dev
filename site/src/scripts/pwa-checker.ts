// PWA checker: asks /api/pwa whether a site can be installed, then shows the phone's install
// sheet and home screen with the site's real icon and name, the checklist, and a fixed manifest.

import { BLOCKERS, agentPrompt, buildManifest, headTags, host, nameFromTitle, type Check, type Level, type Result } from './pwa-checker-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('pw-form');
const input = $<HTMLInputElement>('pw-url');
const button = $<HTMLButtonElement>('pw-go');
const error = $<HTMLParagraphElement>('pw-error');
const out = $<HTMLDivElement>('pw-out');

const ORDER: Record<Level, number> = { fail: 0, warn: 1, pass: 2 };
const MARK: Record<Level, string> = { pass: '✓', warn: '!', fail: '✕' };
const WORD: Record<Level, string> = { pass: 'Done', warn: 'Worth fixing', fail: 'Stops install' };

let current: Result | null = null;
let os: 'android' | 'ios' = 'android';
let manifestText = '';
let promptText = '';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

// A sample app shown before the first check, so the preview is never empty.
const SAMPLE_ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="#0593C6"/><rect x="26" y="20" width="44" height="56" rx="8" fill="#fff"/><rect x="34" y="32" width="28" height="5" rx="2.5" fill="#D83995"/><rect x="34" y="43" width="22" height="5" rx="2.5" fill="#9CC9DC"/><rect x="34" y="54" width="25" height="5" rx="2.5" fill="#9CC9DC"/></svg>',
  );
const SAMPLE: Result = {
  url: 'https://pocketnotes.app/',
  finalUrl: 'https://pocketnotes.app/',
  status: 200,
  https: true,
  title: 'Pocket Notes',
  description: 'Quick notes that sync.',
  metaThemeColor: '#0593C6',
  appleTouchIcon: null,
  favicon: SAMPLE_ICON,
  manifestUrl: 'https://pocketnotes.app/manifest.json',
  manifestError: null,
  manifest: { name: 'Pocket Notes', short_name: 'Notes', start_url: '/', display: 'standalone', theme_color: '#0593C6', background_color: '#ffffff', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] },
  icons: [{ src: 'https://pocketnotes.app/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any', max: 1024, ok: true }],
  app: { name: 'Pocket Notes', shortName: 'Notes', icon: SAMPLE_ICON, maskable: null, themeColor: '#0593C6', backgroundColor: '#ffffff', display: 'standalone', startUrl: 'https://pocketnotes.app/' },
  serviceWorker: { found: false, url: null, where: null, scanned: 3 },
  checks: [],
};

function img(src: string, onFail: () => void): HTMLImageElement {
  const i = new Image();
  i.alt = '';
  i.referrerPolicy = 'no-referrer';
  i.decoding = 'async';
  i.addEventListener('error', onFail, { once: true });
  i.src = src;
  return i;
}

function letterIcon(box: HTMLElement, name: string, color: string | null) {
  box.replaceChildren(el('span', 'letter', (name.trim()[0] ?? '?').toUpperCase()));
  box.style.background = color && color.toLowerCase() !== '#ffffff' && color.toLowerCase() !== '#fff' ? color : '#5B6B75';
  box.classList.remove('padded');
}

// Android: a maskable icon fills the circle; any other icon is shrunk onto a white circle.
function androidIcon(box: HTMLElement, r: Result, name: string) {
  box.className = 'icon round';
  box.style.background = '';
  const src = r.app.maskable ?? r.app.icon;
  if (!src) return letterIcon(box, name, r.app.themeColor);
  if (!r.app.maskable) box.classList.add('padded');
  box.replaceChildren(img(src, () => letterIcon(box, name, r.app.themeColor)));
}

// iPhone: only the apple-touch-icon counts; without it, iOS uses a tiny screenshot of the page.
function iosIcon(box: HTMLElement, r: Result) {
  box.style.background = '';
  const shot = () => {
    box.className = 'icon shot';
    box.replaceChildren(el('i'), el('i'), el('i'), el('i'));
  };
  if (!r.appleTouchIcon) return shot();
  box.className = 'icon squircle';
  box.replaceChildren(img(r.appleTouchIcon, shot));
}

function labelFor(r: Result) {
  return r.app.shortName ?? r.app.name ?? nameFromTitle(r.title, host(r.finalUrl));
}

function renderHome(r: Result) {
  const grid = $<HTMLDivElement>('pw-grid');
  grid.classList.toggle('ios', os === 'ios');
  const apps: HTMLElement[] = [];
  for (let i = 0; i < 15; i++) {
    const a = el('div', 'app');
    if (i === 5) {
      a.classList.add('mine');
      const box = el('span', 'icon');
      if (os === 'android') androidIcon(box, r, labelFor(r));
      else iosIcon(box, r);
      a.append(box, el('small', '', labelFor(r)));
    } else {
      a.append(el('span', 'ph'), el('small', '', ' '));
    }
    apps.push(a);
  }
  grid.replaceChildren(...apps);
}

function renderStage(r: Result, sample: boolean) {
  const checks = r.checks;
  const blockers = checks.filter((c) => c.level === 'fail' && BLOCKERS.includes(c.id));
  const fails = checks.filter((c) => c.level === 'fail');
  const warns = checks.filter((c) => c.level === 'warn');
  const name = r.app.name ?? r.app.shortName ?? nameFromTitle(r.title, host(r.finalUrl));
  const site = host(r.finalUrl);

  const banner = $<HTMLDivElement>('pw-banner');
  const badge = $<HTMLSpanElement>('pw-badge');
  const verdict = $<HTMLParagraphElement>('pw-verdict');
  const sub = $<HTMLParagraphElement>('pw-sub');
  if (sample) {
    banner.className = 'banner';
    badge.textContent = 'Example';
    verdict.textContent = 'This is what an installable app looks like.';
    sub.textContent = 'Paste your site above to see your own icon and name, and what’s missing.';
  } else if (fails.length) {
    banner.className = 'banner fail';
    badge.textContent = 'Not yet';
    verdict.textContent = `${site} can’t be installed yet: ${fails.length} thing${fails.length === 1 ? '' : 's'} to fix.`;
    sub.textContent = 'Phones won’t offer “Install app” until these are fixed. The manifest below fills in what’s missing.';
  } else if (warns.length) {
    banner.className = 'banner warn';
    badge.textContent = 'Installable';
    verdict.textContent = `${site} can be installed, with ${warns.length} thing${warns.length === 1 ? '' : 's'} worth fixing.`;
    sub.textContent = 'Chrome offers “Install app”, but it could look or work better. See below.';
  } else {
    banner.className = 'banner pass';
    badge.textContent = 'Installable';
    verdict.textContent = `${site} is ready to install on phones and computers.`;
    sub.textContent = 'Everything we check is in place.';
  }

  // The install sheet.
  const status = $<HTMLDivElement>('pw-status');
  status.style.background = '';
  if (r.app.themeColor) status.style.background = r.app.themeColor;
  $('pw-host').textContent = site;
  $('pw-lock').textContent = r.https ? '🔒' : '⚠';
  $('pw-lock').parentElement!.classList.toggle('insecure', !r.https);
  $('pw-sheet-name').textContent = name;
  $('pw-sheet-host').textContent = site;
  androidIcon($('pw-sheet-icon'), r, name);
  const sheet = $<HTMLDivElement>('pw-sheet');
  const blocked = $<HTMLDivElement>('pw-blocked');
  sheet.classList.toggle('off', blockers.length > 0);
  blocked.hidden = !blockers.length;
  if (blockers.length) {
    $('pw-blocked-why').textContent = blockers.length === 1 ? blockers[0].label + '.' : `${blockers[0].label}, and ${blockers.length - 1} more.`;
  }
  renderHome(r);

  // The fixed manifest and actions.
  const { manifest, added, newIcons } = buildManifest(r);
  manifestText = JSON.stringify(manifest, null, 2) + '\n';
  promptText = agentPrompt(r, manifest, newIcons);
  const actions = $<HTMLDivElement>('pw-actions');
  actions.hidden = sample;
  const addedEl = $<HTMLParagraphElement>('pw-added');
  addedEl.textContent = sample ? '' : !r.manifest ? `A complete manifest for ${site}, named “${manifest.name}”. Open “The manifest we made for you” below to see it.` : added.length ? `The download keeps your current manifest and adds: ${added.join(', ')}.` : 'Your manifest already has everything. The download is a tidied copy.';
  $('pw-download').textContent = r.manifest && !added.length ? 'Download a tidied manifest' : 'Download manifest.webmanifest';
  $('pw-manifest').textContent = manifestText;
  $('pw-tags').textContent = headTags(r, String(manifest.theme_color));
  $('pw-icon-hint').hidden = !newIcons && !!r.appleTouchIcon;
}

function item(c: Check): HTMLLIElement {
  const li = el('li', `item ${c.level}`);
  const dot = el('span', 'dot', MARK[c.level]);
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', WORD[c.level]);
  li.append(dot, el('p', 'label', c.label), el('p', 'detail', c.detail));
  if (c.level !== 'pass' && c.fix) {
    const fix = el('p', 'fix');
    fix.append(el('b', '', 'Fix: '), document.createTextNode(c.fix));
    li.append(fix);
  }
  if (c.level !== 'pass' && c.tool) {
    const a = el('a', 'tool-link', `Open the ${c.tool.name.toLowerCase()}`);
    a.href = c.tool.href;
    li.append(a);
  }
  return li;
}

function fact(dl: HTMLElement, k: string, v: string | null) {
  dl.append(el('dt', '', k), el('dd', '', v ?? '—'));
}

function renderDetails(r: Result) {
  const checks = [...r.checks].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const n = (l: Level) => checks.filter((c) => c.level === l).length;
  $('pw-counts').textContent = `${n('pass')} done · ${n('warn')} worth fixing · ${n('fail')} stopping install`;
  $('pw-list').replaceChildren(...checks.map(item));

  const notes: string[] = [];
  if (r.status >= 400) notes.push(`The page answered with error ${r.status}, so it may not be the page visitors see.`);
  if (host(r.url) !== host(r.finalUrl)) notes.push(`${host(r.url)} redirected to ${host(r.finalUrl)}, so we checked that.`);
  const note = $<HTMLParagraphElement>('pw-note');
  note.textContent = notes.join(' ');
  note.hidden = !notes.length;

  const dl = $<HTMLElement>('pw-facts');
  dl.replaceChildren();
  fact(dl, 'Page', r.finalUrl);
  fact(dl, 'Manifest', r.manifestUrl);
  fact(dl, 'name', r.app.name);
  fact(dl, 'short_name', r.app.shortName);
  fact(dl, 'start_url', r.app.startUrl);
  fact(dl, 'display', r.app.display);
  fact(dl, 'theme_color', r.app.themeColor);
  fact(dl, 'background_color', r.app.backgroundColor);
  fact(dl, 'Icons', r.icons.length ? r.icons.map((i) => `${i.sizes || '?'} ${i.purpose}${i.ok === false ? ' (doesn’t load)' : ''}`).join(', ') : null);
  fact(dl, 'apple-touch-icon', r.appleTouchIcon);
  fact(dl, 'Service worker', r.serviceWorker.found ? r.serviceWorker.url ?? 'registered' : `none found in ${r.serviceWorker.scanned} script files`);
}

async function copyText(text: string, btn: HTMLElement) {
  const label = btn.textContent;
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
    const res = await fetch(`/api/pwa?url=${encodeURIComponent(url)}`);
    const data: Result = await res.json().catch(() => ({ error: 'Something went wrong. Try again.' }) as Result);
    if (!res.ok || data.error) throw new Error(data.error ?? 'Something went wrong. Try again.');
    current = data;
    renderStage(data, false);
    renderDetails(data);
    out.hidden = false;
    history.replaceState(null, '', `?url=${encodeURIComponent(url)}`);
  } catch (err) {
    error.textContent = (err as Error).message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Check my site';
  }
});

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-try]')) {
  b.addEventListener('click', () => {
    input.value = b.dataset.try!;
    form.requestSubmit();
  });
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-os]')) {
  b.addEventListener('click', () => {
    os = b.dataset.os === 'ios' ? 'ios' : 'android';
    for (const o of document.querySelectorAll<HTMLButtonElement>('[data-os]')) {
      o.classList.toggle('on', o === b);
      o.setAttribute('aria-pressed', String(o === b));
    }
    renderHome(current ?? SAMPLE);
  });
}

$('pw-download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([manifestText], { type: 'application/manifest+json' }));
  a.download = 'manifest.webmanifest';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('pw-prompt').addEventListener('click', (e) => copyText(promptText, e.currentTarget as HTMLElement));

renderStage(SAMPLE, true);

// Shared links like /tools/pwa-checker/?url=example.com run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
