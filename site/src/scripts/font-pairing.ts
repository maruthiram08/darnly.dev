// Font pairing ideas: a hand-picked list of Google Fonts heading + body pairs, each shown on a mini landing page.
// Only the fonts on screen are loaded from Google Fonts. Nothing is uploaded.

export {};

type Kind = 'serif' | 'sans' | 'mono';
type Mood = 'modern' | 'classic' | 'friendly' | 'technical' | 'editorial';
type Heading = { name: string; kind: Kind; weight: number; moods: Mood[]; bodies: string[] };
type Pair = { heading: string; body: string; moods: Mood[] };

// Every body font is loaded at 400 and 700; each of these has both weights on Google Fonts.
const BODY_KIND: Record<string, Kind> = {
  'Inter': 'sans', 'Source Sans 3': 'sans', 'Lato': 'sans', 'Open Sans': 'sans', 'Karla': 'sans',
  'Libre Franklin': 'sans', 'DM Sans': 'sans', 'Work Sans': 'sans', 'Figtree': 'sans', 'Nunito Sans': 'sans',
  'Nunito': 'sans', 'Manrope': 'sans', 'Roboto': 'sans', 'Public Sans': 'sans', 'IBM Plex Sans': 'sans',
  'Mulish': 'sans', 'Rubik': 'sans', 'Archivo': 'sans', 'Atkinson Hyperlegible': 'sans',
  'Source Serif 4': 'serif', 'Merriweather': 'serif', 'Lora': 'serif', 'PT Serif': 'serif',
  'IBM Plex Serif': 'serif', 'Spectral': 'serif', 'Space Mono': 'mono',
};

const HEADINGS: Heading[] = [
  { name: 'Playfair Display', kind: 'serif', weight: 700, moods: ['classic', 'editorial'], bodies: ['Source Sans 3', 'Lato', 'Inter', 'Open Sans', 'Karla', 'Libre Franklin'] },
  { name: 'DM Serif Display', kind: 'serif', weight: 400, moods: ['editorial', 'classic'], bodies: ['DM Sans', 'Inter', 'Work Sans', 'Figtree', 'Source Serif 4', 'Nunito Sans'] },
  { name: 'Fraunces', kind: 'serif', weight: 700, moods: ['friendly', 'editorial'], bodies: ['Inter', 'Nunito Sans', 'Figtree', 'Work Sans', 'Karla', 'Manrope'] },
  { name: 'Libre Baskerville', kind: 'serif', weight: 700, moods: ['classic'], bodies: ['Source Sans 3', 'Lato', 'Open Sans', 'Libre Franklin', 'Roboto', 'Nunito Sans'] },
  { name: 'Instrument Serif', kind: 'serif', weight: 400, moods: ['editorial', 'modern'], bodies: ['Inter', 'DM Sans', 'Manrope', 'IBM Plex Sans', 'Figtree', 'Public Sans'] },
  { name: 'Montserrat', kind: 'sans', weight: 700, moods: ['modern'], bodies: ['Merriweather', 'Lora', 'Source Serif 4', 'Open Sans', 'Roboto', 'Karla'] },
  { name: 'Poppins', kind: 'sans', weight: 600, moods: ['friendly', 'modern'], bodies: ['Inter', 'Lora', 'Nunito', 'Open Sans', 'Mulish', 'PT Serif'] },
  { name: 'Space Grotesk', kind: 'sans', weight: 700, moods: ['technical', 'modern'], bodies: ['Inter', 'IBM Plex Sans', 'DM Sans', 'Work Sans', 'IBM Plex Serif', 'Space Mono'] },
  { name: 'Bricolage Grotesque', kind: 'sans', weight: 700, moods: ['friendly', 'modern'], bodies: ['Figtree', 'Inter', 'DM Sans', 'Manrope', 'Source Serif 4', 'Atkinson Hyperlegible'] },
  { name: 'Outfit', kind: 'sans', weight: 600, moods: ['friendly'], bodies: ['Inter', 'Nunito Sans', 'Lora', 'Work Sans', 'Karla', 'Rubik'] },
  { name: 'Archivo Black', kind: 'sans', weight: 400, moods: ['modern', 'editorial'], bodies: ['Archivo', 'Inter', 'Roboto', 'Libre Franklin', 'Lora', 'Spectral'] },
  { name: 'JetBrains Mono', kind: 'mono', weight: 700, moods: ['technical'], bodies: ['Inter', 'IBM Plex Sans', 'DM Sans', 'Manrope', 'Source Sans 3', 'Public Sans'] },
];

const PAIRS: Pair[] = HEADINGS.flatMap((h) =>
  h.bodies.map((body) => ({
    heading: h.name,
    body,
    moods: BODY_KIND[body] === 'mono' && !h.moods.includes('technical') ? [...h.moods, 'technical' as Mood] : h.moods,
  })),
);

const headingOf = (name: string) => HEADINGS.find((h) => h.name === name)!;
const kindOf = (name: string): Kind => HEADINGS.find((h) => h.name === name)?.kind ?? BODY_KIND[name] ?? 'sans';
const FALLBACK: Record<Kind, string[]> = {
  serif: ['Georgia', "'Times New Roman'", 'serif'],
  sans: ['system-ui', '-apple-system', "'Segoe UI'", 'sans-serif'],
  mono: ['ui-monospace', 'Menlo', 'Consolas', 'monospace'],
};
const quote = (name: string) => (/^[A-Za-z]+$/.test(name) ? name : `'${name}'`);
const stack = (name: string) => [quote(name), ...FALLBACK[kindOf(name)]].join(', ');
const plus = (name: string) => encodeURIComponent(name).replace(/%20/g, '+');

const familyParam = (p: Pair) => {
  const h = headingOf(p.heading);
  if (p.heading === p.body) return `family=${plus(p.heading)}:wght@400;700`;
  return `family=${plus(p.heading)}:wght@${h.weight}&family=${plus(p.body)}:wght@400;700`;
};

// One stylesheet per font, so a slow or failed font never blocks the others.
const loaded = new Set<string>();
function load(name: string, weights: string) {
  const href = `https://fonts.googleapis.com/css2?family=${plus(name)}:wght@${weights}&display=swap`;
  if (loaded.has(href)) return;
  loaded.add(href);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}
function loadPair(p: Pair) {
  load(p.heading, String(headingOf(p.heading).weight));
  load(p.body, '400;700');
}

// ---------- Snippets ----------

function linkTag(p: Pair) {
  return [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link href="https://fonts.googleapis.com/css2?${familyParam(p)}&display=swap" rel="stylesheet">`,
  ].join('\n');
}

function cssVars(p: Pair) {
  const w = headingOf(p.heading).weight;
  return [
    `/* Put the <link> tag in your <head> first, or use this line at the top of your CSS: */`,
    `@import url('https://fonts.googleapis.com/css2?${familyParam(p)}&display=swap');`,
    '',
    ':root {',
    `  --font-heading: ${stack(p.heading)};`,
    `  --font-body: ${stack(p.body)};`,
    '}',
    '',
    'body { font-family: var(--font-body); }',
    `h1, h2, h3, h4 { font-family: var(--font-heading); font-weight: ${w}; }`,
  ].join('\n');
}

function tailwind(p: Pair) {
  const arr = (name: string) => [`'${name}'`, ...FALLBACK[kindOf(name)].map((f) => `'${f.replace(/'/g, '')}'`)].join(', ');
  return [
    '// Tailwind v3: tailwind.config.js',
    'module.exports = {',
    '  theme: {',
    '    extend: {',
    '      fontFamily: {',
    `        heading: [${arr(p.heading)}],`,
    `        body: [${arr(p.body)}],`,
    '      },',
    '    },',
    '  },',
    '};',
    '',
    '/* Tailwind v4: put this in your main CSS file instead */',
    '@theme {',
    `  --font-heading: ${stack(p.heading)};`,
    `  --font-body: ${stack(p.body)};`,
    '}',
    '',
    '/* Then use class="font-heading" on headings and class="font-body" on <body>.',
    '   Load the fonts with the Google Fonts <link> tag. */',
  ].join('\n');
}

function prompt(p: Pair) {
  const w = headingOf(p.heading).weight;
  return [
    `Change this project's fonts: use ${p.heading} for all headings (h1 to h4, weight ${w}) and ${p.body} for body text (400 for normal text, 700 for bold).`,
    'Both are free Google Fonts.',
    '',
    '- If this is a Next.js app, load both with next/font/google and expose them as CSS variables.',
    '- Otherwise add this to the <head> of every page (or the main layout):',
    '',
    linkTag(p),
    '',
    `- Set the font stacks: headings ${stack(p.heading)}; body ${stack(p.body)}.`,
    '- If the project uses Tailwind, add fontFamily "heading" and "body" to the theme and use font-heading / font-body.',
    '- Make the change globally (in the root layout or global CSS), not page by page.',
    '- Only change font families and the heading weight. Keep all sizes, colors and spacing as they are.',
  ].join('\n');
}

const SNIPPETS = { link: linkTag, css: cssVars, tailwind, prompt } as const;
type SnippetKey = keyof typeof SNIPPETS;
const COPIED: Record<SnippetKey, string> = {
  link: 'Copied the <link> tag. Paste it into your <head>.',
  css: 'Copied the CSS.',
  tailwind: 'Copied the Tailwind config.',
  prompt: 'Copied. Paste it into Claude Code, Codex or Cursor.',
};

function why(p: Pair) {
  const h = kindOf(p.heading);
  const b = kindOf(p.body);
  if (h === 'serif' && b === 'sans') return 'Serif headings with a clean sans body: the classic contrast.';
  if (h === 'sans' && b === 'serif') return 'Sans headings with a serif body: easy long reads, modern feel.';
  if (h === 'mono') return 'Code-style headings with a calm body: looks built by developers.';
  if (b === 'mono') return 'Monospace body: a terminal feel, best for short text.';
  if (h === 'serif' && b === 'serif') return 'Two serifs with different jobs: bookish and warm.';
  return 'Two sans fonts with different shapes: clear, with some personality.';
}

// ---------- Page ----------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const grid = $<HTMLDivElement>('fp-grid');
const headingSel = $<HTMLSelectElement>('fp-heading');
const shuffleBtn = $<HTMLButtonElement>('fp-shuffle');
const moodBox = $<HTMLDivElement>('fp-moods');
const nameInput = $<HTMLInputElement>('fp-name');
const headlineInput = $<HTMLInputElement>('fp-headline');
const pickName = $<HTMLElement>('fp-pick-name');
const pickWhy = $<HTMLElement>('fp-pick-why');
const code = $<HTMLElement>('fp-code');
const codeTabs = $<HTMLDivElement>('fp-tabs');
const status = $<HTMLParagraphElement>('fp-status');
const note = $<HTMLParagraphElement>('fp-note');

const ACCENTS = [
  { bg: '#FFFFFF', ink: '#14212B', soft: '#5B6B77', accent: '#0593C6', card: '#F2F7FA' },
  { bg: '#FBF6EE', ink: '#2A1F14', soft: '#6E5E4C', accent: '#B4532A', card: '#F3EADB' },
  { bg: '#14171C', ink: '#F4F1EA', soft: '#A8ADB5', accent: '#F2C14E', card: '#1F242B' },
  { bg: '#F4F7F2', ink: '#16251B', soft: '#56685B', accent: '#2F7D4F', card: '#E5EEE2' },
  { bg: '#F6F4FD', ink: '#1E1838', soft: '#625C7E', accent: '#6A4FD8', card: '#EAE5FB' },
  { bg: '#FFF5F6', ink: '#2B1418', soft: '#785A60', accent: '#C42C55', card: '#FBE4E8' },
];

let mood: Mood | 'all' = 'all';
let shown: Pair[] = [];
let picked: Pair = PAIRS[0];
let tab: SnippetKey = 'link';

function shuffle<T>(list: T[]) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pool() {
  return PAIRS.filter((p) => (headingSel.value === '' || p.heading === headingSel.value) && (mood === 'all' || p.moods.includes(mood)));
}

// Pick 6 pairs, preferring different heading fonts so the grid shows variety.
function choose(list: Pair[], random: boolean) {
  const src = random ? shuffle(list) : list;
  if (headingSel.value) return src.slice(0, 6);
  const out: Pair[] = [];
  const used = new Set<string>();
  for (const p of src) if (out.length < 6 && !used.has(p.heading)) { out.push(p); used.add(p.heading); }
  for (const p of src) if (out.length < 6 && !out.includes(p)) out.push(p);
  return out;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

function card(p: Pair, i: number) {
  const c = ACCENTS[i % ACCENTS.length];
  const h = headingOf(p.heading);
  const site = nameInput.value.trim() || 'Brightside';
  const headline = headlineInput.value.trim() || 'Ship your side project this weekend';

  const fig = el('figure', 'pair');
  fig.dataset.key = `${p.heading}|${p.body}`;
  if (p === picked) fig.classList.add('on');

  const page = el('div', 'mini');
  page.style.setProperty('--bg', c.bg);
  page.style.setProperty('--ink', c.ink);
  page.style.setProperty('--soft', c.soft);
  page.style.setProperty('--accent', c.accent);
  page.style.setProperty('--card', c.card);
  page.style.setProperty('--hf', stack(p.heading));
  page.style.setProperty('--hw', String(h.weight));
  page.style.setProperty('--bf', stack(p.body));
  page.setAttribute('aria-hidden', 'true');

  const nav = el('div', 'nav');
  nav.append(el('span', 'logo', site), el('span', 'links', 'Features   Pricing   Log in'));
  const hero = el('div', 'hero');
  hero.append(
    el('span', 'kicker', 'New: version 2.0'),
    el('h3', 'title', headline),
    el('p', 'para', `${site} turns your rough idea into a working app. Describe it in plain words, watch it build, and share a link with friends in minutes.`),
  );
  const btns = el('div', 'btns');
  btns.append(el('span', 'btn', 'Start free'), el('span', 'btn alt', 'See a demo'));
  hero.append(btns);
  const feats = el('div', 'feats');
  const f1 = el('div', 'feat');
  f1.append(el('h4', '', 'Fast by default'), el('p', '', 'Pages load in under a second, on any phone.'));
  const f2 = el('div', 'feat');
  f2.append(el('h4', '', 'Built to share'), el('p', '', 'One link, and your friends can try it right away.'));
  feats.append(f1, f2);
  page.append(nav, hero, feats);

  const cap = el('figcaption');
  const names = el('div', 'names');
  const hn = el('strong', '', p.heading);
  const bn = el('span', '', `+ ${p.body}`);
  names.append(hn, bn);
  const tags = el('div', 'tags');
  for (const m of p.moods) tags.append(el('span', 'tag', m));
  const use = el('button', 'use', p === picked ? 'Picked' : 'Use this pair');
  use.type = 'button';
  use.setAttribute('aria-label', `Use ${p.heading} with ${p.body}`);
  use.addEventListener('click', () => pick(p, true));
  cap.append(names, tags, use);

  page.addEventListener('click', () => pick(p, true));
  fig.append(page, cap);
  return fig;
}

function draw() {
  grid.replaceChildren(...shown.map(card));
  shown.forEach(loadPair);
}

function show(random = false) {
  const list = pool();
  shown = choose(list, random);
  if (!shown.length) {
    note.textContent = 'No pairs match both choices. Try another style, or pick “Any heading font”.';
    note.hidden = false;
    grid.replaceChildren();
    return;
  }
  note.hidden = shown.length >= 6 || !!headingSel.value;
  note.textContent = `Only ${shown.length} pairs match. Pick “All” to see more.`;
  if (!shown.includes(picked)) picked = shown[0];
  draw();
  update();
}

function pick(p: Pair, scroll = false) {
  picked = p;
  for (const fig of grid.querySelectorAll<HTMLElement>('figure.pair')) {
    const on = fig.dataset.key === `${p.heading}|${p.body}`;
    fig.classList.toggle('on', on);
    const b = fig.querySelector('button.use');
    if (b) b.textContent = on ? 'Picked' : 'Use this pair';
  }
  update();
  say('');
  if (scroll) $('fp-pick').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function update() {
  pickName.textContent = `${picked.heading} + ${picked.body}`;
  pickName.style.fontFamily = stack(picked.heading);
  pickName.style.fontWeight = String(headingOf(picked.heading).weight);
  pickWhy.textContent = why(picked);
  code.textContent = SNIPPETS[tab](picked);
  const url = new URL(location.href);
  url.searchParams.set('heading', picked.heading);
  url.searchParams.set('body', picked.body);
  history.replaceState(null, '', url);
}

function say(msg: string) {
  status.textContent = msg;
}

async function copy(key: SnippetKey) {
  try {
    await navigator.clipboard.writeText(SNIPPETS[key](picked));
    say(COPIED[key]);
  } catch {
    say('Your browser blocked copying. Open “See the code” and select the text instead.');
  }
}

// ---------- Wire up ----------

for (const h of HEADINGS) {
  const o = document.createElement('option');
  o.value = h.name;
  o.textContent = h.name;
  headingSel.append(o);
}

for (const b of moodBox.querySelectorAll<HTMLButtonElement>('button[data-mood]')) {
  b.addEventListener('click', () => {
    mood = b.dataset.mood as Mood | 'all';
    for (const o of moodBox.querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
    show();
  });
}

headingSel.addEventListener('change', () => show());
shuffleBtn.addEventListener('click', () => {
  headingSel.value = '';
  show(true);
  picked = shown[0] ?? picked;
  pick(picked);
});

let typing = 0;
for (const i of [nameInput, headlineInput]) {
  i.addEventListener('input', () => {
    clearTimeout(typing);
    typing = window.setTimeout(draw, 120);
  });
}

for (const b of codeTabs.querySelectorAll<HTMLButtonElement>('button[data-tab]')) {
  b.addEventListener('click', () => {
    tab = b.dataset.tab as SnippetKey;
    for (const o of codeTabs.querySelectorAll('button')) o.setAttribute('aria-selected', String(o === b));
    code.textContent = SNIPPETS[tab](picked);
  });
}

for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
  b.addEventListener('click', () => copy(b.dataset.copy as SnippetKey));
}

// A shared link (?heading=…&body=…) opens on that pair; ?heading=… alone shows that font's pairs.
const params = new URLSearchParams(location.search);
const wantHeading = params.get('heading') ?? '';
const wantBody = params.get('body') ?? '';
if (HEADINGS.some((h) => h.name === wantHeading)) headingSel.value = wantHeading;
show(!headingSel.value);
const fromLink = PAIRS.find((p) => p.heading === wantHeading && p.body === wantBody);
if (fromLink && shown.includes(fromLink)) pick(fromLink);
else pick(shown[0] ?? PAIRS[0]);
