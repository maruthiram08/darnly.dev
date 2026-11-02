// Responsive checker: the visitor's browser loads their page in three frames. Nothing goes through Darnly.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('rc-form');
const input = $<HTMLInputElement>('rc-url');
const error = $<HTMLParagraphElement>('rc-error');
const result = $<HTMLDivElement>('rc-result');
const views = $<HTMLDivElement>('rc-views');
const hint = $<HTMLParagraphElement>('rc-hint');
const shotsButton = $<HTMLButtonElement>('rc-shots');

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
  const w = Number(screen.dataset.w);
  const h = Number(screen.dataset.h);
  const scale = Math.min(1, screen.clientWidth / w);
  const frame = screen.querySelector('iframe');
  if (frame) frame.style.transform = `scale(${scale})`;
  screen.style.height = `${Math.round(h * scale)}px`;
}

// The browser fills the whole screen (Mac full screen or F11), so popups can't be sized.
function isFullScreen(): boolean {
  return !!document.fullscreenElement || (window.outerWidth >= screen.width && window.outerHeight >= screen.height);
}

function show(u: URL) {
  error.hidden = true;
  hint.hidden = false;
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
    const tip = document.createElement('p');
    tip.className = 'rc-tip';
    tip.hidden = true;
    tip.textContent = navigator.platform.startsWith('Mac')
      ? 'Your browser is in full screen, so the window would open full size too. Leave full screen (Control + Command + F), then press the button again. Or press it again now to open it anyway.'
      : 'Your browser is in full screen, so the window would open full size too. Leave full screen (F11), then press the button again. Or press it again now to open it anyway.';
    open.addEventListener('click', () => {
      // In full screen, new windows open full screen too, so the width would be lost. Say so once first.
      if (tip.hidden && isFullScreen()) {
        tip.hidden = false;
        return;
      }
      tip.hidden = true;
      // Chrome ignores the size when "noopener" is passed, so open a blank sized window and cut the link back to us after.
      const h = Math.min(d.height, (screen.availHeight || d.height) - 80);
      const win = window.open('about:blank', `rc-${d.width}`, `popup=yes,width=${d.width},height=${h}`);
      if (!win) return void window.open(u.href, '_blank', 'noopener');
      win.opener = null;
      win.location.replace(u.href);
    });

    const box = document.createElement('div');
    box.className = 'rc-screen';
    box.dataset.w = String(d.width);
    box.dataset.h = String(d.height);
    const frame = document.createElement('iframe');
    frame.title = `${u.hostname} at ${d.width} pixels wide`;
    frame.width = String(d.width);
    frame.height = String(d.height);
    // Keeps the page from taking over this tab, while letting it run normally inside its box.
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.src = u.href;
    box.append(frame);

    view.append(name, box, open, tip);
    views.append(view);
    observer.observe(box);
  }
  result.hidden = false;
  checkFraming(u);
  requestAnimationFrame(() => views.querySelectorAll<HTMLElement>('.rc-screen').forEach(fit));
}

let checking = 0;

// Asks our server whether the site lets other pages show it. If it doesn't, we show screenshots instead.
async function checkFraming(u: URL) {
  const run = ++checking;
  let framing = 'unknown';
  try {
    const res = await fetch(`/api/frame?url=${encodeURIComponent(u.href)}`);
    if (res.ok) framing = ((await res.json()) as { framing?: string }).framing ?? 'unknown';
  } catch {
    // Offline or the check failed: leave the frames as they are.
  }
  if (run !== checking || framing !== 'blocked') return;
  showShots(u, run);
}

// Puts a plain-words message in every box, in place of the live page.
function noteInBoxes(title: string, text: string) {
  views.querySelectorAll<HTMLElement>('.rc-screen').forEach((box) => {
    const note = document.createElement('div');
    note.className = 'rc-blocked';
    const t = document.createElement('strong');
    t.textContent = title;
    const p = document.createElement('span');
    p.textContent = text;
    note.append(t, p);
    box.classList.remove('rc-shot');
    box.replaceChildren(note);
  });
}

async function showShots(u: URL, run = ++checking) {
  hint.hidden = true;
  const site = u.hostname.replace(/^www\./, '');
  noteInBoxes(`${site} doesn’t allow being shown inside other pages`, 'Taking screenshots at each width instead. This takes about 10 seconds.');
  let data: { shots?: { width: number; image: string }[]; error?: string } = {};
  try {
    data = await (await fetch(`/api/shots?url=${encodeURIComponent(u.href)}`)).json();
  } catch {
    data = { error: 'We couldn’t take screenshots just now.' };
  }
  if (run !== checking) return;
  if (!data.shots?.length) {
    noteInBoxes(`${site} doesn’t allow being shown inside other pages`, `${data.error ?? 'We couldn’t take screenshots of it.'} Use “Open at this width” below to see it.`);
    return;
  }
  views.querySelectorAll<HTMLElement>('.rc-screen').forEach((box) => {
    const shot = data.shots!.find((s) => String(s.width) === box.dataset.w);
    if (!shot) return;
    const img = document.createElement('img');
    img.src = shot.image;
    img.alt = `Screenshot of ${site} at ${shot.width} pixels wide`;
    box.classList.add('rc-shot');
    box.replaceChildren(img);
  });
}

shotsButton.addEventListener('click', () => {
  const u = parse(input.value);
  if (typeof u !== 'string') showShots(u);
});

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
