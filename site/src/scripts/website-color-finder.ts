// Website color finder: asks /api/colors for a page's palette, then shows swatches and snippets.

type Swatch = { hex: string; uses: number; vars: string[] };
type ColorVar = { name: string; hex: string; value: string; dark: string | null; uses: number };
type Result = {
  url: string;
  finalUrl: string;
  status: number;
  vars: ColorVar[];
  backgrounds: Swatch[];
  text: Swatch[];
  accents: Swatch[];
  themeColor: string | null;
  sheets: number;
  sheetsFailed: number;
  error?: string;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('wc-form');
const input = $<HTMLInputElement>('wc-url');
const button = $<HTMLButtonElement>('wc-go');
const error = $<HTMLParagraphElement>('wc-error');
const out = $<HTMLDivElement>('wc-out');
const summary = $<HTMLParagraphElement>('wc-summary');
const promptBtn = $<HTMLButtonElement>('wc-prompt');
const strip = $<HTMLDivElement>('wc-strip');
const status = $<HTMLParagraphElement>('wc-status');
const note = $<HTMLParagraphElement>('wc-note');
const css = $<HTMLElement>('wc-css');
const tw = $<HTMLElement>('wc-tw');
const twVersion = $<HTMLSelectElement>('wc-tw-version');
const varsHint = $<HTMLParagraphElement>('wc-vars-hint');

const MAX_SNIPPET_VARS = 32;
let current: Result | null = null;

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

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const up = (hex: string) => hex.toUpperCase();

// Dark text on light colors, white text on dark ones.
function textOn(hex: string): string {
  const l = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b) > 0.4 ? '#0B2230' : '#FFFFFF';
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function say(msg: string) {
  status.textContent = msg;
}

async function copyColor(hex: string) {
  say((await copy(up(hex))) ? `Copied ${up(hex)}` : 'Your browser blocked copying. Select the text instead.');
}

function swatchList(id: string, items: Swatch[], label: string) {
  const list = $<HTMLUListElement>(id);
  (list.parentElement as HTMLElement).hidden = !items.length;
  list.replaceChildren(
    ...items.map((s, i) => {
      const li = el('li');
      const b = el('button', 'swatch');
      b.type = 'button';
      b.style.background = s.hex;
      b.style.color = textOn(s.hex);
      b.setAttribute('aria-label', `Copy ${up(s.hex)}`);
      b.append(el('strong', '', up(s.hex)));
      if (s.vars.length) b.append(el('span', '', s.vars.join(', ')));
      b.append(el('em', '', i === 0 ? `Main ${label} · click to copy` : 'Click to copy'));
      b.addEventListener('click', () => copyColor(s.hex));
      li.append(b);
      return li;
    }),
  );
}

function varList(vars: ColorVar[]) {
  const list = $<HTMLUListElement>('wc-vars');
  (list.parentElement as HTMLElement).hidden = !vars.length;
  const darkCount = vars.filter((v) => v.dark).length;
  varsHint.textContent = darkCount
    ? 'The names the site gives its colors. Chips split in two show the light and dark mode values. Click one to copy it.'
    : 'The names the site gives its colors. Click one to copy it.';
  list.replaceChildren(
    ...vars.map((v) => {
      const li = el('li');
      const b = el('button');
      b.type = 'button';
      b.title = v.value;
      const chip = el('span', 'chip');
      const a = el('i');
      a.style.background = v.hex;
      chip.append(a);
      if (v.dark) {
        const d = el('i');
        d.style.background = v.dark;
        chip.append(d);
      }
      const label = el('span', 'label');
      label.append(el('b', '', v.name), el('small', '', v.dark ? `${up(v.hex)} · dark ${up(v.dark)}` : up(v.hex)));
      b.append(chip, label);
      b.addEventListener('click', () => copyColor(v.hex));
      li.append(b);
      return li;
    }),
  );
}

// The main colors, named by what they're for.
function roles(r: Result): [string, string][] {
  const out: [string, string][] = [];
  // Don't clash with the site's own variables: if it already has --accent, ours is --main-accent.
  const taken = new Set(siteVars(r).flatMap((v) => [v.name.slice(2), cleanVar(v.name)]));
  const name = (base: string, i: number) => {
    const n = i === 0 ? base : `${base}-${i + 1}`;
    return taken.has(n) ? `main-${n}` : n;
  };
  r.backgrounds.slice(0, 3).forEach((s, i) => out.push([name('background', i), s.hex]));
  r.text.slice(0, 3).forEach((s, i) => out.push([name('text', i), s.hex]));
  r.accents.slice(0, 3).forEach((s, i) => out.push([name('accent', i), s.hex]));
  return out;
}

// A safe name for a variable in a snippet: "--color-brand-500" -> "brand-500".
const cleanVar = (name: string) => name.replace(/^--/, '').replace(/^colou?r-/, '').replace(/[^\w-]/g, '-');

function siteVars(r: Result): ColorVar[] {
  return r.vars.slice(0, MAX_SNIPPET_VARS);
}

function cssSnippet(r: Result): string {
  const lines = [':root {', '  /* Main colors */', ...roles(r).map(([n, h]) => `  --${n}: ${h};`)];
  const vs = siteVars(r);
  if (vs.length) lines.push('', `  /* ${host(r.finalUrl)}’s own color variables */`, ...vs.map((v) => `  ${v.name}: ${v.hex};`));
  lines.push('}');
  const dark = vs.filter((v) => v.dark);
  if (dark.length) lines.push('', '/* Dark mode */', '.dark {', ...dark.map((v) => `  ${v.name}: ${v.dark};`), '}');
  return lines.join('\n');
}

function twSnippet(r: Result): string {
  const seen = new Set<string>();
  const entries: [string, string][] = [];
  for (const [n, h] of [...roles(r), ...siteVars(r).map((v) => [cleanVar(v.name), v.hex] as [string, string])]) {
    if (!n || seen.has(n)) continue;
    seen.add(n);
    entries.push([n, h]);
  }
  if (twVersion.value === 'v3') {
    const rows = entries.map(([n, h]) => `        '${n}': '${h}',`).join('\n');
    return `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n${rows}\n      },\n    },\n  },\n};\n// Use them as bg-background, text-text, bg-accent, …`;
  }
  return `/* In your main CSS file, after @import "tailwindcss"; */\n@theme {\n${entries
    .map(([n, h]) => `  --color-${n}: ${h};`)
    .join('\n')}\n}\n/* Use them as bg-background, text-text, bg-accent, … */`;
}

function agentPrompt(r: Result): string {
  const list = (s: Swatch[]) => s.slice(0, 3).map((x) => x.hex + (x.vars.length ? ` (${x.vars[0]})` : '')).join(', ');
  const lines = [`Use the same color palette as ${host(r.finalUrl)} in my project:`];
  if (r.backgrounds.length) lines.push(`- Page background: ${r.backgrounds[0].hex}${r.backgrounds.length > 1 ? `; other backgrounds (cards, sections): ${list(r.backgrounds.slice(1))}` : ''}`);
  if (r.text.length) lines.push(`- Text: ${r.text[0].hex}${r.text.length > 1 ? `; secondary text: ${list(r.text.slice(1))}` : ''}`);
  if (r.accents.length) lines.push(`- Accent / brand color for buttons, links and highlights: ${list(r.accents)}`);
  if (r.themeColor) lines.push(`- Browser theme color: ${r.themeColor}`);
  const vs = siteVars(r);
  if (vs.length) {
    lines.push('', 'The site’s own color variables:');
    for (const v of vs) lines.push(`${v.name}: ${v.hex}${v.dark ? ` (dark mode: ${v.dark})` : ''}`);
  }
  lines.push(
    '',
    'Add these as theme colors the way this project already handles colors (Tailwind theme, CSS variables or a theme file), give them clear names, and use them in place of the current colors. Keep text readable on every background.' +
      (vs.some((v) => v.dark) ? ' Set up the dark mode values too.' : ''),
  );
  return lines.join('\n');
}

function render(r: Result) {
  current = r;
  const name = host(r.finalUrl);
  const all = [...r.backgrounds, ...r.text, ...r.accents];
  const unique = [...new Set([...all.map((s) => s.hex), ...r.vars.map((v) => v.hex)])];
  const empty = !unique.length;
  summary.textContent = empty
    ? `We couldn’t find any colors on ${name}.`
    : `${name} uses ${unique.length} color${unique.length === 1 ? '' : 's'}${r.vars.length ? `, ${r.vars.length} of them named as CSS variables` : ''}.`;
  promptBtn.hidden = empty;
  say('');

  const main = [r.backgrounds[0], r.text[0], ...r.accents.slice(0, 3), ...r.backgrounds.slice(1, 3), ...r.text.slice(1, 2)].filter(Boolean);
  strip.hidden = !main.length;
  strip.replaceChildren(
    ...main.map((s) => {
      const d = el('span');
      d.style.background = s.hex;
      return d;
    }),
  );

  swatchList('wc-bg', r.backgrounds, 'background');
  swatchList('wc-text', r.text, 'text color');
  swatchList('wc-accent', r.accents, 'accent');
  varList(r.vars);
  for (const box of document.querySelectorAll<HTMLElement>('.code')) box.hidden = empty;
  if (!empty) snippets();

  const problems: string[] = [];
  if (r.status >= 400) problems.push(`The page answered with error ${r.status}, so this may not be the real page.`);
  if (r.sheetsFailed) problems.push(`${r.sheetsFailed} stylesheet${r.sheetsFailed === 1 ? '' : 's'} couldn’t be read, so a color may be missing.`);
  if (empty || (!r.accents.length && !r.vars.length)) problems.push('The site may add its styles with JavaScript, or block automated visits. Try another page on the same site.');
  note.textContent = problems.join(' ');
  note.hidden = !problems.length;
}

function snippets() {
  if (!current) return;
  css.textContent = cssSnippet(current);
  tw.textContent = twSnippet(current);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Looking…';
  try {
    const res = await fetch(`/api/colors?url=${encodeURIComponent(url)}`);
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
    button.textContent = 'Find colors';
  }
});

twVersion.addEventListener('change', snippets);

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  b.addEventListener('click', async () => {
    const ok = await copy($(b.dataset.copy!).textContent ?? '');
    b.textContent = ok ? 'Copied' : 'Couldn’t copy';
    setTimeout(() => (b.textContent = 'Copy'), 1500);
  });
}

promptBtn.addEventListener('click', async () => {
  if (!current) return;
  const ok = await copy(agentPrompt(current));
  promptBtn.textContent = ok ? 'Copied' : 'Couldn’t copy';
  setTimeout(() => (promptBtn.textContent = 'Copy prompt for your AI agent'), 1500);
});

// Shared links like /tools/website-color-finder/?url=stripe.com run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
