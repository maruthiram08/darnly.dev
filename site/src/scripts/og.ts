// Open Graph checker: asks /api/og for a page's share tags, then draws how the link looks when shared.

type Result = {
  url: string;
  finalUrl: string;
  status: number;
  title: string | null;
  description: string | null;
  canonical: string | null;
  icon: string | null;
  og: Record<string, string>;
  twitter: Record<string, string>;
  error?: string;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('og-form');
const input = $<HTMLInputElement>('og-url');
const button = $<HTMLButtonElement>('og-go');
const error = $<HTMLParagraphElement>('og-error');
const out = $<HTMLDivElement>('og-out');
const checks = $<HTMLUListElement>('og-checks');
const fix = $<HTMLElement>('og-fix');
const fixBox = $<HTMLDivElement>('og-fix-box');
const copy = $<HTMLButtonElement>('og-copy');

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const domain = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

const cut = (s: string | null, n: number) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function pick(r: Result) {
  const title = r.og['og:title'] ?? r.title;
  const description = r.og['og:description'] ?? r.description;
  const image = r.og['og:image'] ?? r.og['og:image:url'] ?? r.og['og:image:secure_url'] ?? null;
  return {
    title,
    description,
    image,
    site: r.og['og:site_name'] ?? domain(r.finalUrl),
    xTitle: r.twitter['twitter:title'] ?? title,
    xImage: r.twitter['twitter:image'] ?? image,
    xCard: r.twitter['twitter:card'] ?? (image ? 'summary_large_image' : 'summary'),
  };
}

function imageBox(src: string | null, cls: string) {
  const box = el('div', cls);
  if (src) {
    const img = el('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = src;
    img.onerror = () => box.classList.add('broken');
    box.append(img);
  } else {
    box.classList.add('none');
    box.textContent = 'No image';
  }
  return box;
}

function card(platform: string, cls: string, body: HTMLElement) {
  const wrap = el('figure', `card ${cls}`);
  wrap.append(el('figcaption', '', platform), body);
  return wrap;
}

function renderPreviews(r: Result) {
  const p = pick(r);
  const host = domain(r.finalUrl);

  const x = el('div', 'x');
  if (p.xCard === 'summary') {
    x.classList.add('small');
    x.append(imageBox(p.xImage, 'img'));
    const t = el('div', 'text');
    t.append(el('span', 'muted', host), el('strong', '', cut(p.xTitle, 70)), el('span', 'muted', cut(p.description, 100)));
    x.append(t);
  } else {
    x.append(imageBox(p.xImage, 'img'));
    x.append(el('span', 'x-title', `${host} · ${cut(p.xTitle, 70) ?? ''}`));
  }

  const li = el('div', 'li');
  li.append(imageBox(p.image, 'img'));
  const lt = el('div', 'text');
  lt.append(el('strong', '', cut(p.title, 100)), el('span', 'muted', host));
  li.append(lt);

  const wa = el('div', 'wa');
  const bubble = el('div', 'bubble');
  bubble.append(imageBox(p.image, 'img'));
  const wt = el('div', 'text');
  wt.append(el('strong', '', cut(p.title, 80)), el('span', 'muted', cut(p.description, 100)), el('span', 'muted', host));
  bubble.append(wt, el('a', 'link', r.url));
  wa.append(bubble);

  const sl = el('div', 'sl');
  const st = el('div', 'text');
  st.append(el('strong', 'site', p.site), el('a', 'title', cut(p.title, 100)), el('span', '', cut(p.description, 160)));
  sl.append(st, imageBox(p.image, 'img'));

  $('og-cards').replaceChildren(
    card('X (Twitter)', 'c-x', x),
    card('LinkedIn', 'c-li', li),
    card('WhatsApp', 'c-wa', wa),
    card('Slack', 'c-sl', sl),
  );
}

type Check = { ok: boolean | 'warn'; label: string; detail: string };

async function imageSize(src: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function renderChecks(r: Result) {
  const p = pick(r);
  const list: Check[] = [];
  const t = r.og['og:title'];
  list.push(
    t
      ? { ok: t.length <= 70 ? true : 'warn', label: 'og:title', detail: t.length <= 70 ? `“${t}”` : `${t.length} characters. Most apps cut titles after about 70.` }
      : { ok: false, label: 'og:title', detail: r.title ? `Missing. Apps fall back to your page title, “${cut(r.title, 60)}”.` : 'Missing, and the page has no title either.' },
  );
  const d = r.og['og:description'];
  list.push(
    d
      ? { ok: d.length <= 200 ? true : 'warn', label: 'og:description', detail: d.length <= 200 ? cut(d, 120)! : `${d.length} characters. Keep it under about 200.` }
      : { ok: false, label: 'og:description', detail: r.description ? 'Missing. Some apps use your meta description instead.' : 'Missing. Links will show no summary.' },
  );
  if (!p.image) {
    list.push({ ok: false, label: 'og:image', detail: 'Missing. Your link will show without a picture, which gets far fewer clicks.' });
  } else if (!p.image.startsWith('https://')) {
    list.push({ ok: 'warn', label: 'og:image', detail: 'Uses http. Some apps only load images over https.' });
  } else {
    const size = await imageSize(p.image);
    if (!size) list.push({ ok: false, label: 'og:image', detail: 'Set, but the image didn’t load. Check that the address works.' });
    else if (size.w < 600 || size.h < 315) list.push({ ok: 'warn', label: 'og:image', detail: `${size.w}×${size.h}. That’s small; use 1200×630 so it looks sharp everywhere.` });
    else list.push({ ok: true, label: 'og:image', detail: `${size.w}×${size.h}` });
  }
  list.push(
    r.og['og:url']
      ? { ok: true, label: 'og:url', detail: r.og['og:url'] }
      : { ok: 'warn', label: 'og:url', detail: 'Missing. Not required, but it tells apps which address to count shares on.' },
  );
  list.push(
    r.twitter['twitter:card']
      ? { ok: true, label: 'twitter:card', detail: r.twitter['twitter:card'] }
      : { ok: 'warn', label: 'twitter:card', detail: 'Missing. X shows a small card instead of the large picture.' },
  );
  if (r.status >= 400) list.unshift({ ok: false, label: 'Page status', detail: `The page answered with error ${r.status}.` });

  checks.replaceChildren(
    ...list.map((c) => {
      const li = el('li', c.ok === true ? 'ok' : c.ok === 'warn' ? 'warn' : 'bad');
      li.append(el('span', 'mark', c.ok === true ? '✓' : c.ok === 'warn' ? '!' : '✕'), el('code', '', c.label), el('span', 'detail', c.detail));
      return li;
    }),
  );

  const needsFix = list.some((c) => c.ok !== true);
  fixBox.hidden = !needsFix;
  if (needsFix) fix.textContent = snippet(r);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function snippet(r: Result): string {
  const p = pick(r);
  const url = r.og['og:url'] ?? r.canonical ?? r.finalUrl;
  return [
    `<meta property="og:title" content="${esc(p.title ?? 'Your page title')}">`,
    `<meta property="og:description" content="${esc(p.description ?? 'One sentence on what this page is for.')}">`,
    `<meta property="og:image" content="${esc(p.image ?? 'https://your-site.com/og-image.png')}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join('\n');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    const res = await fetch(`/api/og?url=${encodeURIComponent(url)}`);
    const data: Result = await res.json().catch(() => ({ error: 'Something went wrong. Try again.' }) as Result);
    if (!res.ok || data.error) throw new Error(data.error ?? 'Something went wrong. Try again.');
    out.hidden = false;
    renderPreviews(data);
    await renderChecks(data);
    history.replaceState(null, '', `?url=${encodeURIComponent(url)}`);
  } catch (err) {
    error.textContent = (err as Error).message;
    error.hidden = false;
    out.hidden = true;
  } finally {
    button.disabled = false;
    button.textContent = 'Check';
  }
});

copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(fix.textContent ?? '');
  copy.textContent = 'Copied';
  setTimeout(() => (copy.textContent = 'Copy'), 1500);
});

// Shared links like /tools/open-graph-checker/?url=example.com run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
