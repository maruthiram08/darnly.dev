// Responsive checker: the visitor's browser loads their page in three frames. Nothing goes through Darnly.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('rc-form');
const input = $<HTMLInputElement>('rc-url');
const error = $<HTMLParagraphElement>('rc-error');
const result = $<HTMLDivElement>('rc-result');
const views = $<HTMLDivElement>('rc-views');

const DEVICES = [
  { name: 'Phone', width: 390, height: 844 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Desktop', width: 1280, height: 800 },
];

// Turns what was typed into a web address we can show, or a plain-words reason we can't.
function parse(raw: string): URL | string {
  const text = raw.trim();
  if (!text) return 'Paste the address of the page you want to check.';
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return 'That doesn’t look like a web address.';
  }
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || /^(127\.|10\.|192\.168\.|0\.0\.0\.0)/.test(h) || h === '[::1]') {
    return 'That’s an address on your own computer, so this page can’t see it. Deploy your site (a preview link works), then paste its public address.';
  }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:') return 'Only web addresses (https://…) work here.';
  if (!h.includes('.')) return 'That doesn’t look like a web address.';
  return u;
}

function showError(msg: string) {
  error.textContent = msg;
  error.hidden = false;
  result.hidden = true;
}

const observer = new ResizeObserver((entries) => {
  for (const e of entries) fit(e.target as HTMLElement);
});

// Shrinks each full-size frame so it fits its column, keeping the real width the page sees.
function fit(screen: HTMLElement) {
  const frame = screen.querySelector('iframe');
  if (!frame) return;
  const w = Number(frame.dataset.w);
  const h = Number(frame.dataset.h);
  const scale = Math.min(1, screen.clientWidth / w);
  frame.style.transform = `scale(${scale})`;
  screen.style.height = `${Math.round(h * scale)}px`;
}

function show(u: URL) {
  error.hidden = true;
  observer.disconnect();
  views.replaceChildren();
  for (const d of DEVICES) {
    const view = document.createElement('div');
    view.className = 'rc-view';

    const name = document.createElement('span');
    name.className = 'rc-name';
    name.textContent = `${d.name} · ${d.width} px`;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'rc-open';
    open.textContent = 'Open at this width';
    open.addEventListener('click', () => {
      window.open(u.href, `rc-${d.width}`, `popup,noopener,width=${d.width},height=${Math.min(d.height, screen.availHeight || d.height)}`);
    });

    const box = document.createElement('div');
    box.className = 'rc-screen';
    const frame = document.createElement('iframe');
    frame.title = `${u.hostname} at ${d.width} pixels wide`;
    frame.width = String(d.width);
    frame.height = String(d.height);
    frame.dataset.w = String(d.width);
    frame.dataset.h = String(d.height);
    // Keeps the page from taking over this tab, while letting it run normally inside its box.
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.src = u.href;
    box.append(frame);

    view.append(name, box, open);
    views.append(view);
    observer.observe(box);
  }
  result.hidden = false;
  requestAnimationFrame(() => views.querySelectorAll<HTMLElement>('.rc-screen').forEach(fit));
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const u = parse(input.value);
  if (typeof u === 'string') return showError(u);
  input.value = u.href;
  // Puts the address in the page link, so a check can be shared or reloaded.
  const here = new URL(location.href);
  here.searchParams.set('url', u.href);
  history.replaceState(null, '', here);
  show(u);
});

const start = new URLSearchParams(location.search).get('url');
if (start) {
  input.value = start;
  form.requestSubmit();
}
