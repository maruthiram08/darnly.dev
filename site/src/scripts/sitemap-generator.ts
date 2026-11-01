// Sitemap generator: asks /api/sitemap to crawl a site, then builds sitemap.xml and robots.txt
// in the browser and lists the pages that were left out.

type Kind = 'error' | 'redirect' | 'noindex' | 'canonical' | 'robots';
type Problem = { url: string; kind: Kind; status?: number; to?: string; from?: string };
type Result = {
  url: string;
  finalUrl: string;
  origin: string;
  siteOrigin: string;
  pages: { url: string; lastmod: string | null }[];
  problems: Problem[];
  robots: { found: boolean; text: string | null; sitemaps: string[]; blocksAll: boolean };
  framework: string;
  stopped: 'limit' | 'time' | null;
  notCrawled: number;
  skippedQuery: number;
  error?: string;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('sg-form');
const input = $<HTMLInputElement>('sg-url');
const button = $<HTMLButtonElement>('sg-go');
const status = $<HTMLParagraphElement>('sg-status');
const error = $<HTMLParagraphElement>('sg-error');
const out = $<HTMLDivElement>('sg-out');
const fw = $<HTMLSelectElement>('sg-fw');

const GO_LABEL = 'Make my sitemap';
const PROMPT_LABEL = 'Copy prompt for your AI agent';
let xml = '';
let robots = '';
let result: Result | null = null;

// Where each framework serves files from the site root, and its usual sitemap plugin.
const WHERE: Record<string, { folder: string; plugin: string; text: string }> = {
  next: { folder: 'public/', plugin: 'an app/sitemap.ts and app/robots.ts file (Next.js builds them for you)', text: 'Put both files in the <code>public/</code> folder at the top of your project. Next.js can also make them for you from <code>app/sitemap.ts</code> and <code>app/robots.ts</code>, which stay up to date.' },
  vite: { folder: 'public/', plugin: 'the vite-plugin-sitemap package', text: 'Put both files in the <code>public/</code> folder at the top of your project (next to <code>index.html</code>). Vite copies everything in it to your site’s root on each build.' },
  astro: { folder: 'public/', plugin: 'the @astrojs/sitemap integration', text: 'Put both files in the <code>public/</code> folder. Astro also has an official <code>@astrojs/sitemap</code> integration that updates the sitemap on every build.' },
  nuxt: { folder: 'public/', plugin: 'the @nuxtjs/sitemap module', text: 'Put both files in the <code>public/</code> folder. The <code>@nuxtjs/sitemap</code> module can keep the sitemap up to date for you.' },
  sveltekit: { folder: 'static/', plugin: 'a src/routes/sitemap.xml/+server.ts route', text: 'Put both files in the <code>static/</code> folder. SvelteKit serves everything in it from your site’s root.' },
  wordpress: { folder: 'the site root', plugin: 'WordPress’s built-in /wp-sitemap.xml or the Yoast SEO plugin', text: 'WordPress already makes a sitemap at <code>/wp-sitemap.xml</code>, and SEO plugins like Yoast make one too. Use that rather than uploading a file, so it stays up to date.' },
  other: { folder: 'the folder your site is served from', plugin: 'a sitemap step in the build', text: 'Put both files in the folder your site is served from, next to your home page’s <code>index.html</code>, so they open at the root of your domain.' },
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const host = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};
const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

async function copyText(text: string, btn: HTMLButtonElement, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.textContent = label), 1500);
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function buildXml(r: Result): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  for (const p of r.pages) {
    lines.push('  <url>', `    <loc>${esc(p.url)}</loc>`);
    if (p.lastmod) lines.push(`    <lastmod>${p.lastmod}</lastmod>`);
    lines.push('  </url>');
  }
  lines.push('</urlset>', '');
  return lines.join('\n');
}

// Keep an existing robots.txt and only add the sitemap line; otherwise start a simple one.
function buildRobots(r: Result): string {
  const line = `Sitemap: ${r.siteOrigin}/sitemap.xml`;
  if (!r.robots.found || !r.robots.text?.trim()) return `User-agent: *\nAllow: /\n\n${line}\n`;
  const kept = r.robots.text.replace(/\r\n/g, '\n').split('\n').filter((l) => !/^\s*sitemap\s*:/i.test(l)).join('\n').trimEnd();
  return `${kept}\n\n${line}\n`;
}

const WHY: Record<Kind, (p: Problem) => string> = {
  error: (p) => (p.status ? `Answers with error ${p.status}.` : 'We couldn’t load it (it timed out, or the site refused).'),
  redirect: (p) => `Redirects to ${p.to && host(p.to) === host(p.url) ? path(p.to) : p.to}. The sitemap lists where it ends up instead.`,
  noindex: () => 'Marked noindex, so it asks search engines not to list it.',
  canonical: (p) => `Its canonical tag says the main address is ${p.to && host(p.to) === host(p.url) ? path(p.to) : p.to}.`,
  robots: () => 'Your robots.txt blocks it, so we didn’t open it.',
};
const TAG: Record<Kind, [string, string]> = {
  error: ['Broken', 'error'],
  redirect: ['Redirect', 'redirect'],
  noindex: ['Noindex', 'skip'],
  canonical: ['Canonical', 'skip'],
  robots: ['Blocked', 'skip'],
};
const ORDER: Kind[] = ['error', 'redirect', 'canonical', 'noindex', 'robots'];

function agentPrompt(r: Result): string {
  const w = WHERE[fw.value] ?? WHERE.other;
  const broken = r.problems.filter((p) => p.kind === 'error');
  const lines = [
    `Add a sitemap and robots.txt to my site ${host(r.finalUrl)} so search engines can find every page.`,
    '',
    `1. If this project can generate the sitemap on each build (for example ${w.plugin}), set that up with ${r.siteOrigin} as the site address. Otherwise save the sitemap.xml below in ${w.folder} so it's served at ${r.siteOrigin}/sitemap.xml.`,
    `2. Make ${r.siteOrigin}/robots.txt match the robots.txt below. If one already exists in the project, keep its rules and only add the Sitemap line.`,
  ];
  if (broken.length) {
    lines.push(`3. These links on my site are broken. Fix or remove the links that point to them:`);
    for (const b of broken.slice(0, 20)) lines.push(`   - ${path(b.url)} (${b.status ? `error ${b.status}` : 'didn’t load'}${b.from ? `, linked from ${b.from}` : ''})`);
  }
  lines.push('', 'Don’t change anything else. Tell me if there’s a step I have to do myself, like submitting the sitemap in Google Search Console.');
  lines.push('', 'sitemap.xml:', '```xml', xml.trimEnd(), '```', '', 'robots.txt:', '```', robots.trimEnd(), '```');
  return lines.join('\n');
}

function renderWhere(r: Result) {
  const w = WHERE[fw.value] ?? WHERE.other;
  $('sg-where').innerHTML = w.text; // fixed text from WHERE, never page content
  $('sg-check').textContent = `${r.siteOrigin}/sitemap.xml`;
}

function render(r: Result) {
  result = r;
  xml = buildXml(r);
  robots = buildRobots(r);
  $('sg-xml').textContent = xml;
  $('sg-robots').textContent = robots;
  $('sg-robots-hint').textContent = r.robots.found
    ? 'This keeps the rules in your current robots.txt and points it to the new sitemap.'
    : 'You don’t have a robots.txt yet. This one lets every search engine in and points them to your sitemap.';

  const name = host(r.finalUrl);
  const leftOut = r.problems.length;
  $('sg-verdict').textContent = r.pages.length
    ? `Found ${plural(r.pages.length, 'page')} on ${name}.`
    : `We couldn’t find any pages to list on ${name}.`;
  const broken = r.problems.filter((p) => p.kind === 'error').length;
  $('sg-counts').textContent = `${plural(r.pages.length, 'page')} in the sitemap · ${leftOut} left out${broken ? ` · ${plural(broken, 'broken link')}` : ''}`;

  const notes: string[] = [];
  if (r.robots.blocksAll) notes.push('Your robots.txt blocks every search engine from the whole site (Disallow: /), so Google won’t list it. Change it to Allow: / before you launch.');
  if (r.stopped === 'limit') notes.push(`We stopped at 100 pages and didn’t open ${plural(r.notCrawled, 'more address', 'more addresses')}. For a big site, use the prompt so your agent adds a sitemap that lists every page on each build.`);
  if (r.stopped === 'time') notes.push('Your site was slow to answer, so we stopped after 25 seconds. The sitemap has the pages we reached. Try again, or use the prompt so your agent builds a complete one.');
  if (r.pages.length <= 1 && !r.stopped && !r.robots.blocksAll) notes.push('We found almost no links to follow. If your site builds its pages with JavaScript, the links may only appear after the page loads, so add your other pages to the sitemap by hand or use the prompt.');
  if (r.skippedQuery) notes.push(`We skipped ${plural(r.skippedQuery, 'address', 'addresses')} with a ? in them, like search or filter pages, which usually don’t belong in a sitemap.`);
  if (r.siteOrigin !== r.origin) notes.push(`Your pages say their main address is on ${host(r.siteOrigin)}, so the sitemap lists them there. Put the files on that site.`);
  if (host(r.url) !== name) notes.push(`${host(r.url)} redirected to ${name}, so the sitemap uses ${name}.`);
  if (r.robots.sitemaps.length) notes.push(`Your robots.txt already points to ${r.robots.sitemaps.join(' and ')}. The new robots.txt points to /sitemap.xml instead; keep the old line if that sitemap is still right.`);
  $('sg-note').textContent = notes.join(' ');
  $('sg-note').hidden = !notes.length;

  if (r.framework in WHERE) fw.value = r.framework;
  renderWhere(r);

  $('sg-pages-title').textContent = `${plural(r.pages.length, 'page')} in your sitemap`;
  $('sg-pages').replaceChildren(
    ...r.pages.map((p) => {
      const li = el('li');
      li.append(el('span', 'path', path(p.url)), el('span', 'meta', p.lastmod ? `updated ${p.lastmod}` : ''));
      return li;
    }),
  );
  $('sg-pages-box').hidden = !r.pages.length;

  const problems = [...r.problems].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  $('sg-problems-title').textContent = `${plural(problems.length, 'address', 'addresses')} left out`;
  $('sg-problems').replaceChildren(
    ...problems.map((p) => {
      const li = el('li');
      const [word, cls] = TAG[p.kind];
      li.append(el('span', 'path', host(p.url) === name ? path(p.url) : p.url), el('span', `tag ${cls}`, word));
      li.append(el('span', 'why', `${WHY[p.kind](p)}${p.from ? ` Linked from ${p.from}.` : ''}`));
      return li;
    }),
  );
  $('sg-problems-box').hidden = !problems.length;
  ($('sg-problems-box') as HTMLDetailsElement).open = problems.length <= 15;
  ($('sg-pages-box') as HTMLDetailsElement).open = r.pages.length <= 15;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  error.hidden = true;
  status.hidden = false;
  button.disabled = true;
  button.textContent = 'Crawling…';
  try {
    const res = await fetch(`/api/sitemap?url=${encodeURIComponent(url)}`);
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
    status.hidden = true;
    button.disabled = false;
    button.textContent = GO_LABEL;
  }
});

fw.addEventListener('change', () => result && renderWhere(result));
$<HTMLButtonElement>('sg-copy-xml').addEventListener('click', (e) => copyText(xml, e.currentTarget as HTMLButtonElement, 'Copy'));
$<HTMLButtonElement>('sg-copy-robots').addEventListener('click', (e) => copyText(robots, e.currentTarget as HTMLButtonElement, 'Copy'));
$<HTMLButtonElement>('sg-dl-xml').addEventListener('click', () => download('sitemap.xml', xml, 'application/xml'));
$<HTMLButtonElement>('sg-dl-robots').addEventListener('click', () => download('robots.txt', robots, 'text/plain'));
$<HTMLButtonElement>('sg-prompt').addEventListener('click', (e) => result && copyText(agentPrompt(result), e.currentTarget as HTMLButtonElement, PROMPT_LABEL));

// Shared links like /tools/sitemap-generator/?url=example.com run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
