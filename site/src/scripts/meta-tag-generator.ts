// Meta tag generator: everything runs in the visitor's browser. Nothing is sent anywhere.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const title = $<HTMLInputElement>('mt-title');
const desc = $<HTMLTextAreaElement>('mt-desc');
const url = $<HTMLInputElement>('mt-url');
const image = $<HTMLInputElement>('mt-image');
const site = $<HTMLInputElement>('mt-site');
const colorOn = $<HTMLInputElement>('mt-color-on');
const color = $<HTMLInputElement>('mt-color');
const titleCount = $<HTMLSpanElement>('mt-title-count');
const descCount = $<HTMLSpanElement>('mt-desc-count');
const urlNote = $<HTMLParagraphElement>('mt-url-note');
const imageNote = $<HTMLParagraphElement>('mt-image-note');
const gSite = $<HTMLSpanElement>('mt-g-site');
const gUrl = $<HTMLSpanElement>('mt-g-url');
const gTitle = $<HTMLSpanElement>('mt-g-title');
const gDesc = $<HTMLSpanElement>('mt-g-desc');
const sImage = $<HTMLDivElement>('mt-s-image');
const sDomain = $<HTMLSpanElement>('mt-s-domain');
const sTitle = $<HTMLSpanElement>('mt-s-title');
const sDesc = $<HTMLSpanElement>('mt-s-desc');
const code = $<HTMLElement>('mt-code');
const copy = $<HTMLButtonElement>('mt-copy');

// Google cuts titles at about 600px wide and descriptions at about 160 characters.
const TITLE_PX = 600;
const DESC_CHARS = 160;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Adds https:// when someone types just "mysite.com".
function pageUrl(): URL | null {
  const raw = url.value.trim();
  if (!raw) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

// Social sites need a full link to the image, so "/og.png" is joined to the page URL.
function imageUrl(base: URL | null): string {
  const raw = image.value.trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (base) {
    try {
      return new URL(raw, base).toString();
    } catch {
      /* fall through */
    }
  }
  return raw;
}

let ctx: CanvasRenderingContext2D | null = null;
function textWidth(s: string, font: string): number {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return s.length * 9;
  ctx.font = font;
  return ctx.measureText(s).width;
}

function cutToWidth(s: string, px: number, font: string): string {
  if (textWidth(s, font) <= px) return s;
  let out = s;
  while (out.length > 1 && textWidth(out + ' …', font) > px) out = out.slice(0, -1);
  return out.trimEnd() + ' …';
}

function cutToChars(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + ' …';
}

function counter(el: HTMLElement, n: number, low: number, high: number, longMsg: string) {
  let msg = 'Good length';
  let state = 'good';
  if (n === 0) {
    msg = 'Empty';
    state = 'empty';
  } else if (n < low) {
    msg = 'A bit short';
    state = 'warn';
  } else if (n > high) {
    msg = longMsg;
    state = 'bad';
  }
  el.textContent = `${n} / ${high} · ${msg}`;
  el.dataset.state = state;
}

function tags(): string {
  const t = title.value.trim();
  const d = desc.value.trim();
  const u = pageUrl();
  const img = imageUrl(u);
  const s = site.value.trim();
  if (!t && !d && !u && !img && !s) return '<!-- Fill in the form above to get your tags -->';

  const out: string[] = ['<!-- Basic SEO -->'];
  if (t) out.push(`<title>${esc(t)}</title>`);
  if (d) out.push(`<meta name="description" content="${esc(d)}">`);
  if (u) out.push(`<link rel="canonical" href="${esc(u.toString())}">`);
  if (colorOn.checked) out.push(`<meta name="theme-color" content="${esc(color.value)}">`);

  out.push('', '<!-- Open Graph: Facebook, LinkedIn, WhatsApp, Slack, Discord -->');
  out.push('<meta property="og:type" content="website">');
  if (u) out.push(`<meta property="og:url" content="${esc(u.toString())}">`);
  if (s) out.push(`<meta property="og:site_name" content="${esc(s)}">`);
  if (t) out.push(`<meta property="og:title" content="${esc(t)}">`);
  if (d) out.push(`<meta property="og:description" content="${esc(d)}">`);
  if (img) out.push(`<meta property="og:image" content="${esc(img)}">`);

  out.push('', '<!-- X (Twitter) -->');
  out.push(`<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}">`);
  if (t) out.push(`<meta name="twitter:title" content="${esc(t)}">`);
  if (d) out.push(`<meta name="twitter:description" content="${esc(d)}">`);
  if (img) out.push(`<meta name="twitter:image" content="${esc(img)}">`);
  return out.join('\n');
}

function refresh() {
  const t = title.value.trim();
  const d = desc.value.trim();
  const u = pageUrl();
  const s = site.value.trim();
  const rawImage = image.value.trim();

  counter(titleCount, t.length, 30, 60, 'Google may cut it off');
  counter(descCount, d.length, 70, DESC_CHARS, 'Google may cut it off');

  urlNote.hidden = !(url.value.trim() && !u);
  const img = imageUrl(u);
  imageNote.hidden = !(rawImage && !/^https?:\/\//i.test(img));
  color.disabled = !colorOn.checked;

  // Google result preview.
  const host = u ? u.hostname.replace(/^www\./, '') : 'example.com';
  const path = u ? u.pathname.split('/').filter(Boolean).join(' › ') : '';
  gSite.textContent = s || host;
  gUrl.textContent = u ? `${u.protocol}//${u.hostname}${path ? ' › ' + path : ''}` : 'https://example.com';
  gTitle.textContent = cutToWidth(t || 'Your page title shows up here', TITLE_PX, '20px Arial');
  gDesc.textContent = cutToChars(d || 'Your description shows up here. Write one or two sentences that tell people what they get on this page.', DESC_CHARS);

  // Social card preview. The picture itself isn't loaded, only described.
  sImage.textContent = img ? `Your image: ${img.split('/').pop() || img}` : 'No image yet. Links with a picture get more clicks.';
  sImage.dataset.empty = img ? 'false' : 'true';
  sDomain.textContent = host.toUpperCase();
  sTitle.textContent = t || 'Your page title';
  sDesc.textContent = cutToChars(d || 'Your description', 110);

  code.textContent = tags();
}

for (const el of [title, desc, url, image, site, colorOn, color]) el.addEventListener('input', refresh);

copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(code.textContent ?? '');
    copy.textContent = 'Copied';
  } catch {
    // Clipboard blocked: select the text so Cmd/Ctrl+C works.
    const r = document.createRange();
    r.selectNodeContents(code);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    copy.textContent = 'Press Ctrl+C';
  }
  setTimeout(() => (copy.textContent = 'Copy'), 1500);
});

refresh();
