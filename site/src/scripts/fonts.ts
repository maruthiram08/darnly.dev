// Font finder: asks /api/fonts which fonts a page uses, then shows each one with a live sample.

type Source = 'google' | 'adobe' | 'bunny' | 'self' | 'system' | 'unknown';
type Font = { name: string; source: Source; onGoogle: boolean; weights: string[]; styles: string[]; roles: string[]; uses: number; stack: string };
type Result = { url: string; finalUrl: string; status: number; fonts: Font[]; sheets: number; sheetsFailed: number; error?: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('ff-form');
const input = $<HTMLInputElement>('ff-url');
const button = $<HTMLButtonElement>('ff-go');
const error = $<HTMLParagraphElement>('ff-error');
const out = $<HTMLDivElement>('ff-out');
const list = $<HTMLDivElement>('ff-list');
const summary = $<HTMLParagraphElement>('ff-summary');
const promptBtn = $<HTMLButtonElement>('ff-prompt');
const note = $<HTMLParagraphElement>('ff-note');

const SAMPLE = 'The quick brown fox jumps over the lazy dog. 0123456789';
let lastPrompt = '';

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

const plus = (name: string) => encodeURIComponent(name).replace(/%20/g, '+');
const free = (f: Font) => f.source === 'google' || f.source === 'bunny' || f.source === 'system' || f.onGoogle;

function where(f: Font): { text: string; cls: string } {
  switch (f.source) {
    case 'google': return { text: 'Google Fonts, free', cls: 'free' };
    case 'bunny': return { text: 'Bunny Fonts, free', cls: 'free' };
    case 'adobe': return { text: 'Adobe Fonts, needs an Adobe plan', cls: 'paid' };
    case 'system': return { text: 'Built into the visitor’s computer, free', cls: 'free' };
    case 'self': return f.onGoogle
      ? { text: 'The site hosts its own copy. Free on Google Fonts', cls: 'free' }
      : { text: 'The site hosts its own copy. May be a paid font, check its license', cls: 'paid' };
    default: return f.onGoogle
      ? { text: 'Not downloaded by the site. Free on Google Fonts', cls: 'free' }
      : { text: 'Not downloaded by the site, so it only shows if the visitor has it installed', cls: '' };
  }
}

// Google fonts can be previewed for real; our page is allowed to load them.
function loadGoogle(name: string) {
  const href = `https://fonts.googleapis.com/css2?family=${plus(name)}&display=swap`;
  if (document.querySelector(`link[href="${CSS.escape(href)}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

function cssSnippet(f: Font): string {
  const fallback = /mono|code/i.test(f.name) || f.roles.includes('Code') ? 'monospace' : /serif/i.test(f.stack) && !/sans-serif/i.test(f.stack) ? 'serif' : 'sans-serif';
  if (f.source === 'system') return `font-family: ${f.stack};`;
  const lines: string[] = [];
  if (f.source === 'google' || f.onGoogle) {
    const nums = f.weights.filter((w) => /^\d+$/.test(w));
    const range = f.weights.find((w) => w.includes('–'));
    const spec = range ? `:wght@${range.replace('–', '..')}` : nums.length > 1 || (nums[0] && nums[0] !== '400') ? `:wght@${nums.join(';')}` : '';
    lines.push(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${plus(f.name)}${spec}&display=swap">`, '');
  }
  lines.push(`font-family: '${f.name}', ${fallback};`);
  return lines.join('\n');
}

function card(f: Font): HTMLElement {
  const box = el('article', 'font');
  const head = el('div', 'head');
  const name = el('h3', 'name', f.name);
  const sample = el('p', 'sample', SAMPLE);
  const previewable = f.source === 'google' || f.onGoogle || f.source === 'system';
  if (f.source === 'google' || f.onGoogle) loadGoogle(f.name);
  const family = f.source === 'system' ? f.stack : `'${f.name}', var(--body)`;
  if (previewable) {
    name.style.fontFamily = family;
    sample.style.fontFamily = family;
  }
  const roles = el('div', 'roles');
  for (const r of f.roles.length ? f.roles : ['Other text']) roles.append(el('span', 'role', r));
  head.append(name, roles);
  box.append(head, sample);
  if (!previewable) box.append(el('p', 'preview-note', 'We can’t show this font here because it lives on that site. The sample uses our font.'));

  const meta = el('div', 'meta');
  const w = where(f);
  const src = el('span', w.cls);
  src.append(el('b', '', 'Source: '), document.createTextNode(w.text));
  meta.append(src);
  if (f.weights.length) {
    const ws = el('span');
    ws.append(el('b', '', 'Weights: '), document.createTextNode(f.weights.join(', ') + (f.styles.includes('italic') ? ', plus italic' : '')));
    meta.append(ws);
  }
  box.append(meta);

  const actions = el('div', 'actions');
  if (f.source === 'google' || f.onGoogle) {
    const a = el('a', '', 'Open on Google Fonts');
    a.href = `https://fonts.google.com/specimen/${plus(f.name)}`;
    a.target = '_blank';
    a.rel = 'noopener';
    actions.append(a);
  }
  const copy = el('button', '', 'Copy CSS');
  copy.type = 'button';
  copy.addEventListener('click', () => copyText(cssSnippet(f), copy, 'Copy CSS'));
  actions.append(copy);
  box.append(actions);
  return box;
}

function agentPrompt(r: Result): string {
  const lines = [`Use the same fonts as ${host(r.finalUrl)} in my project:`];
  for (const f of r.fonts) {
    if (f.source === 'unknown' && !f.onGoogle) continue;
    const roles = f.roles.length ? f.roles.join(' and ') : 'Other text';
    const weights = f.weights.length ? ` (weights ${f.weights.join(', ')}${f.styles.includes('italic') ? ', plus italic' : ''})` : '';
    const from =
      f.source === 'system' ? `the system font stack: ${f.stack}` :
      f.source === 'google' || f.onGoogle ? `${f.name}${weights}, free on Google Fonts` :
      f.source === 'adobe' ? `${f.name}${weights}, from Adobe Fonts (needs an Adobe plan; suggest a free look-alike if I don’t have one)` :
      `${f.name}${weights}. It may be a paid font, so suggest a free look-alike on Google Fonts if it isn’t free`;
    lines.push(`- ${roles}: ${from}`);
  }
  lines.push('', 'Load them the way this project already loads fonts (for example next/font in Next.js), set them as the defaults for body text, headings and code, and only load the weights listed.');
  return lines.join('\n');
}

async function copyText(text: string, btn: HTMLButtonElement, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.textContent = label), 1500);
}

function render(r: Result) {
  const shown = r.fonts;
  const name = host(r.finalUrl);
  if (!shown.length) {
    summary.textContent = `We couldn’t find any fonts on ${name}.`;
    promptBtn.hidden = true;
  } else {
    const web = shown.filter((f) => f.source !== 'system' && f.source !== 'unknown').length;
    summary.textContent = `${name} uses ${shown.length} font${shown.length === 1 ? '' : 's'}${web ? `, ${web} downloaded from the web` : ''}${shown.every(free) ? '. All free to use.' : '.'}`;
    promptBtn.hidden = false;
    lastPrompt = agentPrompt(r);
  }
  list.replaceChildren(...shown.map(card));
  const problems: string[] = [];
  if (r.status >= 400) problems.push(`The page answered with error ${r.status}, so this may not be the real page.`);
  if (r.sheetsFailed) problems.push(`${r.sheetsFailed} stylesheet${r.sheetsFailed === 1 ? '' : 's'} couldn’t be read, so a font may be missing.`);
  if (!shown.length) problems.push('The site may add its styles with JavaScript, or block automated visits. Try another page on the same site.');
  note.textContent = problems.join(' ');
  note.hidden = !problems.length;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Looking…';
  try {
    const res = await fetch(`/api/fonts?url=${encodeURIComponent(url)}`);
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
    button.textContent = 'Find fonts';
  }
});

promptBtn.addEventListener('click', () => copyText(lastPrompt, promptBtn, 'Copy prompt for your AI agent'));

// Shared links like /tools/font-finder/?url=stripe.com run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
