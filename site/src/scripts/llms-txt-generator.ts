// llms.txt generator: asks /api/llms to crawl a site, then builds llms.txt in the browser,
// shows it as a live preview people can edit, and shows which AI crawlers robots.txt lets in.

type Page = { url: string; title: string; description: string };
type Bot = { name: string; owner: string; what: string; state: 'allowed' | 'blocked' | 'partly'; rule: 'own' | 'all' | 'none'; closed: string[] };
type Result = {
  url: string;
  finalUrl: string;
  origin: string;
  siteOrigin: string;
  name: string;
  summary: string;
  pages: Page[];
  bots: Bot[];
  robots: { found: boolean; text: string | null };
  existing: string | null;
  framework: string;
  stopped: 'limit' | 'time' | null;
  notCrawled: number;
  maxPages: number;
  error?: string;
};
type Item = { title: string; url: string; description: string };
type Section = { title: string; items: Item[] };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('lt-form');
const input = $<HTMLInputElement>('lt-url');
const button = $<HTMLButtonElement>('lt-go');
const status = $<HTMLParagraphElement>('lt-status');
const error = $<HTMLParagraphElement>('lt-error');
const nameIn = $<HTMLInputElement>('lt-name');
const summaryIn = $<HTMLTextAreaElement>('lt-summary');
const fw = $<HTMLSelectElement>('lt-fw');
const rendered = $<HTMLDivElement>('lt-rendered');
const plain = $<HTMLPreElement>('lt-plain');

const GO_LABEL = 'Make my llms.txt';
const PROMPT_LABEL = 'Copy prompt for your AI agent';
let result: Result | null = null;
let text = '';
const excluded = new Set<string>();

// The example shown before anyone runs it, so the page shows what they'll get.
const EXAMPLE: Result = {
  url: 'https://yoursite.com/',
  finalUrl: 'https://yoursite.com/',
  origin: 'https://yoursite.com',
  siteOrigin: 'https://yoursite.com',
  name: 'Your Site',
  summary: 'A habit tracker for busy people. Log a habit in one tap and see your streaks on any device.',
  pages: [
    { url: 'https://yoursite.com/', title: 'Home', description: '' },
    { url: 'https://yoursite.com/pricing/', title: 'Pricing', description: 'Free for 3 habits, $4 a month for unlimited habits and reminders.' },
    { url: 'https://yoursite.com/about/', title: 'About', description: 'Who builds Your Site and why.' },
    { url: 'https://yoursite.com/blog/', title: 'Blog', description: 'Tips on building habits that last.' },
    { url: 'https://yoursite.com/blog/start-small/', title: 'Start with one tiny habit', description: 'Why two minutes a day beats an hour once a week.' },
    { url: 'https://yoursite.com/privacy/', title: 'Privacy policy', description: 'What we collect and why.' },
  ],
  bots: [],
  robots: { found: false, text: null },
  existing: null,
  framework: 'next',
  stopped: null,
  notCrawled: 0,
  maxPages: 50,
};

const WHERE: Record<string, { folder: string; text: string }> = {
  next: { folder: 'public/', text: 'Put llms.txt in the <code>public/</code> folder at the top of your project. Next.js serves it at the root of your site.' },
  vite: { folder: 'public/', text: 'Put llms.txt in the <code>public/</code> folder at the top of your project (next to <code>index.html</code>). Vite copies it to your site’s root on each build.' },
  astro: { folder: 'public/', text: 'Put llms.txt in the <code>public/</code> folder. Astro serves everything in it from your site’s root.' },
  nuxt: { folder: 'public/', text: 'Put llms.txt in the <code>public/</code> folder. Nuxt serves it from your site’s root.' },
  sveltekit: { folder: 'static/', text: 'Put llms.txt in the <code>static/</code> folder. SvelteKit serves everything in it from your site’s root.' },
  wordpress: { folder: 'the site root', text: 'Upload llms.txt to the main folder of your WordPress site (the one with <code>wp-config.php</code>), or use an SEO plugin that has an llms.txt option.' },
  other: { folder: 'the folder your site is served from', text: 'Put llms.txt in the folder your site is served from, next to your home page’s <code>index.html</code>.' },
};

const LEGAL = /^\/?(privacy|privacy-policy|terms|terms-of-service|tos|cookies?|cookie-policy|legal|imprint|impressum|disclaimer|refund|refunds|gdpr|dpa)(\/|$)/i;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, txt?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt) e.textContent = txt;
  return e;
};
const host = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};
const pathOf = (u: string) => {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const titleCase = (s: string) => {
  const w = decodeURIComponent(s).replace(/[-_]+/g, ' ').trim();
  return w.charAt(0).toUpperCase() + w.slice(1);
};
// Markdown link text can't hold brackets, and each entry has to stay on one line.
const md = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/\[/g, '(').replace(/\]/g, ')').trim();

async function copyText(t: string, btn: HTMLButtonElement, label: string) {
  try {
    await navigator.clipboard.writeText(t);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.textContent = label), 1500);
}
function download(name: string, t: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([t], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Pages grouped by the first part of their address: /blog/... becomes a "Blog" section.
// Pages on their own go under "Pages", and legal pages under "Optional", which llms.txt
// readers may skip when they're short on room.
function sections(r: Result): Section[] {
  const main: Item[] = [];
  const optional: Item[] = [];
  const groups = new Map<string, Item[]>();
  for (const p of r.pages) {
    const path = pathOf(p.url);
    if (path === '/' || path === '' || excluded.has(p.url)) continue;
    const item = { title: p.title || titleCase(path.split('/').filter(Boolean).pop() ?? path), url: p.url, description: p.description };
    if (LEGAL.test(path)) {
      optional.push(item);
      continue;
    }
    const seg = path.split('/').filter(Boolean)[0] ?? '';
    if (!groups.has(seg)) groups.set(seg, []);
    groups.get(seg)!.push(item);
  }
  const out: Section[] = [];
  const big: Section[] = [];
  for (const [seg, items] of groups) {
    if (items.length >= 2) {
      // The section's own page (/blog/) goes first.
      items.sort((a, b) => pathOf(a.url).length - pathOf(b.url).length);
      big.push({ title: titleCase(seg), items });
    } else main.push(...items);
  }
  if (main.length) out.push({ title: 'Pages', items: main });
  big.sort((a, b) => b.items.length - a.items.length);
  out.push(...big);
  if (optional.length) out.push({ title: 'Optional', items: optional });
  return out;
}

function build(r: Result): string {
  const name = md(nameIn.value) || host(r.siteOrigin);
  const summary = summaryIn.value.replace(/\s+/g, ' ').trim();
  const lines = [`# ${name}`, ''];
  if (summary) lines.push(`> ${summary}`, '');
  for (const s of sections(r)) {
    lines.push(`## ${s.title}`, '');
    for (const i of s.items) lines.push(`- [${md(i.title)}](${i.url})${i.description ? `: ${md(i.description)}` : ''}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

// The same content drawn as a document, the way an AI tool reads it.
function drawPreview(r: Result) {
  const name = nameIn.value.trim() || host(r.siteOrigin);
  const summary = summaryIn.value.trim();
  const nodes: HTMLElement[] = [el('p', 'h1', name)];
  if (summary) nodes.push(el('blockquote', '', summary));
  const secs = sections(r);
  for (const s of secs) {
    nodes.push(el('p', 'h2', s.title));
    const ul = el('ul');
    for (const i of s.items) {
      const li = el('li');
      const a = el('a', '', i.title);
      a.href = i.url;
      a.rel = 'noopener nofollow';
      a.target = '_blank';
      li.append(a);
      if (i.description) li.append(el('span', 'desc', ` ${i.description}`));
      ul.append(li);
    }
    nodes.push(ul);
  }
  if (!secs.length) nodes.push(el('p', 'empty', 'No other pages yet. Add links to your pages and run it again.'));
  rendered.replaceChildren(...nodes);
}

function refresh() {
  const r = result ?? EXAMPLE;
  text = build(r);
  plain.textContent = text;
  drawPreview(r);
  $('lt-size').textContent = `${plural(text.split('\n').filter((l) => l.startsWith('- ')).length, 'link')} · ${(new Blob([text]).size / 1024).toFixed(1)} KB`;
}

function agentPrompt(r: Result): string {
  const w = WHERE[fw.value] ?? WHERE.other;
  const blocked = r.bots.filter((b) => b.state !== 'allowed');
  const lines = [
    `Add an llms.txt file to my site so AI tools like ChatGPT, Claude and Perplexity can understand it.`,
    '',
    `1. Save the llms.txt below in ${w.folder} so it's served at ${r.siteOrigin}/llms.txt. If one already exists, replace it.`,
    `2. Check the links in it still work, and fix any title or description that's wrong.`,
  ];
  if (blocked.length) lines.push(`3. My robots.txt blocks ${blocked.map((b) => b.name).join(', ')}. Don't change that unless I ask.`);
  lines.push('', 'Don’t change anything else.', '', 'llms.txt:', '```markdown', text.trimEnd(), '```');
  return lines.join('\n');
}

// ---- AI crawler cards ----

const STATE_TEXT: Record<Bot['state'], string> = { allowed: 'Allowed', blocked: 'Blocked', partly: 'Partly blocked' };

function botWhy(b: Bot, robotsFound: boolean): string {
  if (!robotsFound) return 'You have no robots.txt, so every crawler is allowed.';
  if (b.rule === 'none') return 'Your robots.txt doesn’t mention it, so it’s allowed.';
  const by = b.rule === 'own' ? `a rule for ${b.name}` : 'the rule for every crawler (User-agent: *)';
  if (b.state === 'allowed') return b.closed.length ? `Allowed everywhere except ${b.closed.join(', ')}, by ${by}.` : `Allowed by ${by}.`;
  if (b.state === 'blocked') return `Blocked from the whole site by ${by}.`;
  return `Some pages are blocked by ${by}.`;
}

function snippet(b: Bot, allow: boolean) {
  return `User-agent: ${b.name}\n${allow ? 'Allow' : 'Disallow'}: /\n`;
}

function drawBots(r: Result) {
  const list = $('lt-bots');
  list.replaceChildren(
    ...r.bots.map((b) => {
      const card = el('li', `bot ${b.state}`);
      const top = el('div', 'bot-top');
      top.append(el('span', 'bot-name', b.name), el('span', `badge ${b.state}`, STATE_TEXT[b.state]));
      card.append(top, el('p', 'bot-what', `${b.owner} · ${b.what}`), el('p', 'bot-why', botWhy(b, r.robots.found)));
      const allow = b.state !== 'allowed';
      const label = allow ? 'Copy rule to allow' : 'Copy rule to block';
      const btn = el('button', 'small', label) as HTMLButtonElement;
      btn.type = 'button';
      btn.addEventListener('click', () => copyText(snippet(b, allow), btn, label));
      card.append(btn);
      return card;
    }),
  );
  const open = r.bots.filter((b) => b.state === 'allowed').length;
  $('lt-bots-title').textContent = `${open} of ${r.bots.length} AI crawlers can read your site`;
  $('lt-bots-hint').textContent = r.robots.found
    ? 'Paste a rule at the end of robots.txt (in the same folder as llms.txt). A crawler that has its own rule ignores the User-agent: * rules.'
    : 'To block one, make a robots.txt next to llms.txt and paste its rule in.';
}

function drawPages(r: Result) {
  const list = $('lt-pages');
  const pages = r.pages.filter((p) => pathOf(p.url) !== '/');
  list.replaceChildren(
    ...pages.map((p) => {
      const li = el('li');
      const label = el('label');
      const box = el('input') as HTMLInputElement;
      box.type = 'checkbox';
      box.checked = !excluded.has(p.url);
      box.addEventListener('change', () => {
        if (box.checked) excluded.delete(p.url);
        else excluded.add(p.url);
        refresh();
      });
      const textBox = el('span', 'page-text');
      textBox.append(el('span', 'page-title', p.title || pathOf(p.url)), el('span', 'page-path', pathOf(p.url)));
      if (!p.description) textBox.append(el('span', 'page-warn', 'No description found. Add a meta description to this page.'));
      label.append(box, textBox);
      li.append(label);
      return li;
    }),
  );
  $('lt-pages-title').textContent = `${plural(pages.length, 'page')} found. Untick any you want to leave out.`;
  $('lt-pages-box').hidden = !pages.length;
}

function render(r: Result) {
  result = r;
  excluded.clear();
  nameIn.value = r.name || host(r.siteOrigin);
  summaryIn.value = r.summary;
  refresh();

  const site = host(r.finalUrl);
  const open = r.bots.filter((b) => b.state === 'allowed').length;
  $('lt-verdict').textContent = r.existing ? `${site} already has an llms.txt. Here’s a fresh one to compare.` : `${site} has no llms.txt yet. Here’s one, ready to add.`;
  $('lt-counts').textContent = `${plural(r.pages.length, 'page')} read · ${open} of ${r.bots.length} AI crawlers allowed`;
  $('lt-badge').textContent = 'Your llms.txt';
  $('lt-badge').classList.remove('example');

  const notes: string[] = [];
  const noDesc = r.pages.filter((p) => !p.description && pathOf(p.url) !== '/').length;
  if (!r.summary) notes.push('Your home page has no meta description, so the summary is empty. Write one sentence about what your site does in the summary box.');
  if (noDesc) notes.push(`${plural(noDesc, 'page')} had no description or first paragraph, so they’re listed by title only.`);
  if (r.stopped === 'limit') notes.push(`We stopped at ${r.maxPages} pages and didn’t open ${plural(r.notCrawled, 'more address', 'more addresses')}. llms.txt is meant to list your main pages, not all of them, so this is usually enough.`);
  if (r.stopped === 'time') notes.push('Your site was slow to answer, so we stopped after 25 seconds. The file has the pages we reached.');
  if (r.pages.length <= 1 && !r.stopped) notes.push('We found almost no links to follow. If your site builds its pages with JavaScript, add your main pages to the file by hand.');
  if (r.siteOrigin !== r.origin) notes.push(`Your pages say their main address is on ${host(r.siteOrigin)}, so the links point there.`);
  if (host(r.url) !== site) notes.push(`${host(r.url)} redirected to ${site}.`);
  $('lt-note').textContent = notes.join(' ');
  $('lt-note').hidden = !notes.length;

  const ex = $<HTMLDetailsElement>('lt-existing-box');
  ex.hidden = !r.existing;
  $('lt-existing').textContent = r.existing ?? '';

  if (r.framework in WHERE) fw.value = r.framework;
  drawWhere(r);
  drawBots(r);
  drawPages(r);
  for (const id of ['lt-summary-row', 'lt-actions', 'lt-ai', 'lt-where-box', 'lt-prompt', 'lt-head']) $(id).hidden = false;
}

function drawWhere(r: Result) {
  const w = WHERE[fw.value] ?? WHERE.other;
  $('lt-where').innerHTML = w.text; // fixed text from WHERE, never page content
  $('lt-check').textContent = `${r.siteOrigin}/llms.txt`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  error.hidden = true;
  status.hidden = false;
  button.disabled = true;
  button.textContent = 'Reading your site…';
  try {
    const res = await fetch(`/api/llms?url=${encodeURIComponent(url)}`);
    const data: Result = await res.json().catch(() => ({ error: 'Something went wrong. Try again.' }) as Result);
    if (!res.ok || data.error) throw new Error(data.error ?? 'Something went wrong. Try again.');
    render(data);
    history.replaceState(null, '', `?url=${encodeURIComponent(url)}`);
  } catch (err) {
    error.textContent = (err as Error).message;
    error.hidden = false;
  } finally {
    status.hidden = true;
    button.disabled = false;
    button.textContent = GO_LABEL;
  }
});

nameIn.addEventListener('input', refresh);
summaryIn.addEventListener('input', refresh);
fw.addEventListener('change', () => result && drawWhere(result));
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  b.addEventListener('click', () => {
    const view = b.dataset.view;
    rendered.hidden = view !== 'rendered';
    plain.hidden = view !== 'plain';
    for (const x of document.querySelectorAll<HTMLButtonElement>('[data-view]')) x.setAttribute('aria-pressed', String(x === b));
  });
}
$<HTMLButtonElement>('lt-copy').addEventListener('click', (e) => copyText(text, e.currentTarget as HTMLButtonElement, 'Copy'));
$<HTMLButtonElement>('lt-dl').addEventListener('click', () => download('llms.txt', text, 'text/plain'));
$<HTMLButtonElement>('lt-prompt').addEventListener('click', (e) => result && copyText(agentPrompt(result), e.currentTarget as HTMLButtonElement, PROMPT_LABEL));

// Show the example until a site is read.
nameIn.value = EXAMPLE.name;
summaryIn.value = EXAMPLE.summary;
refresh();

// Shared links like /tools/llms-txt-generator/?url=example.com run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
