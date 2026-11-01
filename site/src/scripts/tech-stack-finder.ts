// Tech stack finder: asks /api/stack what a page was built with and shows it by category.

type Category = 'Built with' | 'Hosting' | 'UI and styling' | 'Analytics' | 'Services';
type Tech = { name: string; category: Category; evidence: string };
type Result = { url: string; finalUrl: string; status: number; tech: Tech[]; read: number; readFailed: number; error?: string };

const CATEGORIES: Category[] = ['Built with', 'Hosting', 'UI and styling', 'Analytics', 'Services'];
const EMPTY: Record<Category, string> = {
  'Built with': 'We couldn’t tell. The site may hide it, or build its pages in a way that leaves no trace.',
  Hosting: 'We couldn’t tell from the server’s answer.',
  'UI and styling': 'No UI library or CSS framework we know of.',
  Analytics: 'No analytics we know of. The site may load it later, or not use any.',
  Services: 'None we could see from the page.',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('ts-form');
const input = $<HTMLInputElement>('ts-url');
const button = $<HTMLButtonElement>('ts-go');
const error = $<HTMLParagraphElement>('ts-error');
const out = $<HTMLDivElement>('ts-out');
const groups = $<HTMLDivElement>('ts-groups');
const summary = $<HTMLParagraphElement>('ts-summary');
const promptBtn = $<HTMLButtonElement>('ts-prompt');
const note = $<HTMLParagraphElement>('ts-note');
const more = $<HTMLParagraphElement>('ts-more');

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

const names = (list: Tech[]) => list.map((t) => t.name);
const join = (a: string[]) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

// Web servers and CDNs in front of a host aren't much use in a summary or a prompt.
const MINOR = new Set(['nginx', 'Apache', 'LiteSpeed', 'Cloudflare', 'Fastly', 'Akamai', 'Amazon CloudFront']);

function group(cat: Category, list: Tech[]): HTMLElement {
  const box = el('section', 'group');
  box.append(el('h3', '', cat));
  if (!list.length) {
    box.append(el('p', 'empty', EMPTY[cat]));
    return box;
  }
  const ul = el('ul');
  for (const t of list) {
    const li = el('li');
    li.append(el('span', 'tech', t.name), el('span', 'why', t.evidence));
    ul.append(li);
  }
  box.append(ul);
  return box;
}

function agentPrompt(r: Result, by: Record<Category, Tech[]>): string {
  const lines = [`Build my project with the same tech stack as ${host(r.finalUrl)}:`];
  const label: Record<Category, string> = {
    'Built with': 'Framework or builder',
    Hosting: 'Hosting',
    'UI and styling': 'UI and styling',
    Analytics: 'Analytics',
    Services: 'Other services',
  };
  for (const cat of CATEGORIES) {
    const list = names(by[cat]).filter((n) => !(cat === 'Hosting' && MINOR.has(n) && by[cat].length > 1));
    if (list.length) lines.push(`- ${label[cat]}: ${list.join(', ')}`);
  }
  lines.push(
    '',
    'If this is a new project, set it up with this stack. If my project already uses a different framework, don’t rewrite it: tell me what would change and ask me first.',
    'Skip anything that needs an account I don’t have (hosting, analytics, payments) and list those for me at the end, with what I need to sign up for.',
  );
  return lines.join('\n');
}

function render(r: Result) {
  const name = host(r.finalUrl);
  const by = Object.fromEntries(CATEGORIES.map((c) => [c, r.tech.filter((t) => t.category === c)])) as Record<Category, Tech[]>;

  if (!r.tech.length) {
    summary.textContent = `We couldn’t find any tools we know on ${name}.`;
    promptBtn.hidden = true;
  } else {
    const built = names(by['Built with']).slice(0, 3);
    const hostedOn = names(by.Hosting).filter((n) => !MINOR.has(n));
    const parts = [built.length ? `${name} is built with ${join(built)}` : `${name} uses ${join(names(r.tech).slice(0, 3))}`];
    if (hostedOn.length) parts.push(`hosted on ${hostedOn[0]}`);
    summary.textContent = parts.join(', ') + '.';
    promptBtn.hidden = false;
    lastPrompt = agentPrompt(r, by);
  }

  groups.replaceChildren(...CATEGORIES.map((c) => group(c, by[c])));

  const problems: string[] = [];
  if (r.status >= 400) problems.push(`The page answered with error ${r.status}, so this may not be the real page.`);
  if (r.readFailed) problems.push(`${r.readFailed} of the site’s files couldn’t be read, so something may be missing.`);
  note.textContent = problems.join(' ');
  note.hidden = !problems.length;

  // Send people to the next tool with the same address.
  const q = `?url=${encodeURIComponent(r.url)}`;
  const fonts = el('a', '', 'See its fonts');
  fonts.href = `/tools/font-finder/${q}`;
  const og = el('a', '', 'check how its links look when shared');
  og.href = `/tools/open-graph-checker/${q}`;
  more.replaceChildren(document.createTextNode('Next: '), fonts, document.createTextNode(', or '), og, document.createTextNode('.'));
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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Looking…';
  try {
    const res = await fetch(`/api/stack?url=${encodeURIComponent(url)}`);
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
    button.textContent = 'Find stack';
  }
});

promptBtn.addEventListener('click', () => copyText(lastPrompt, promptBtn, 'Copy prompt for your AI agent'));

// Shared links like /tools/tech-stack-finder/?url=linear.app run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
