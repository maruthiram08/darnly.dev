// npm package checker: asks /api/npm about up to three packages and shows them side by side.
import { fmtNum, type Check, type Level, type Missing, type PackageReport } from '../../worker/npm';

type Result = PackageReport | Missing | { name: string; error: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('np-form');
const input = $<HTMLInputElement>('np-name');
const go = $<HTMLButtonElement>('np-go');
const error = $<HTMLParagraphElement>('np-error');
const cols = $<HTMLDivElement>('np-cols');
const actions = $<HTMLDivElement>('np-actions');
const copyBtn = $<HTMLButtonElement>('np-copy');
const copied = $<HTMLSpanElement>('np-copied');

const EXAMPLE = 'axios, got, request';
let last: Result[] = [];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const MARK: Record<Level, string> = { good: '✓', warn: '!', bad: '✕', info: 'i' };
const RANK: Record<Level, number> = { good: 3, info: 2, warn: 1, bad: 0 };

// "npm i zod valibot", "zod, valibot", "zod valibot" → up to three names, no repeats.
function parse(raw: string): string[] {
  const s = raw.trim().replace(/^(npm|pnpm|yarn|bun)\s+(i|install|add)\s+/i, '');
  const names = s.split(/[\s,]+|\s+vs\.?\s+/i).map((x) => x.trim()).filter((x) => x && !x.startsWith('-') && !/^vs\.?$/i.test(x));
  return [...new Set(names.map((n) => n.toLowerCase()))];
}

function sparkline(weeks: number[]): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const W = 300;
  const H = 64;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const max = Math.max(...weeks, 1);
  const pts = weeks.map((v, i) => [(i / Math.max(weeks.length - 1, 1)) * W, H - 4 - (v / max) * (H - 10)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const area = document.createElementNS(NS, 'path');
  area.setAttribute('d', `${line}L${W},${H}L0,${H}Z`);
  area.setAttribute('fill', 'rgba(5,147,198,0.12)');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', line);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#0593C6');
  path.setAttribute('stroke-width', '2.5');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(area, path);
  return svg;
}

function trend(weeks: number[]): string {
  if (weeks.length < 30) return 'Weekly downloads';
  // Average of the last 4 weeks against the same 4 weeks a year (or as far back as we have) ago.
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
  const now = avg(weeks.slice(-4));
  const then = avg(weeks.slice(0, 4));
  if (!then) return 'Weekly downloads over the last year';
  const pct = Math.round(((now - then) / then) * 100);
  if (Math.abs(pct) < 5) return 'Steady over the last year';
  return pct > 0 ? `Up ${pct > 999 ? fmtNum(pct) : pct}% on a year ago` : `Down ${-pct}% on a year ago`;
}

function card(label: string, c: Check): HTMLElement {
  const box = el('div', `card ${c.level}`);
  box.append(el('span', 'label', label), el('span', 'value', c.value), el('span', 'note', c.note));
  return box;
}

function verdictBox(v: { level: Level; title: string; text: string }): HTMLElement {
  const box = el('div', `verdict ${v.level}`);
  const t = el('strong');
  t.append(el('span', 'mark', MARK[v.level]), document.createTextNode(v.title));
  box.append(t, el('span', '', v.text));
  return box;
}

function link(href: string, text: string): HTMLAnchorElement {
  const a = el('a', '', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener nofollow';
  return a;
}

function render(r: Result, best: boolean): HTMLElement {
  const box = el('section', 'pkg');
  const head = el('div', 'head');
  const h = el('h3');
  if ('found' in r && r.found) {
    h.append(link(`https://www.npmjs.com/package/${r.name}`, r.name), el('span', 'ver', r.version));
    if (best) h.append(el('span', 'best', 'Best pick'));
    head.append(h, el('p', 'desc', r.description || 'No description.'));
  } else {
    h.textContent = r.name;
    head.append(h);
  }
  box.append(head);

  if ('error' in r) {
    box.append(verdictBox({ level: 'info', title: 'Couldn’t check this one', text: r.error }));
    return box;
  }
  box.append(verdictBox(r.verdict));
  if (!r.found) return box;

  const dl = el('div', 'dl');
  const big = el('div', 'big', r.weekly === null ? '?' : fmtNum(r.weekly));
  big.append(el('small', '', 'downloads a week'));
  dl.append(big);
  if (r.weeks.length > 4) dl.append(sparkline(r.weeks));
  dl.append(el('span', 'trend', r.weeks.length > 4 ? trend(r.weeks) : r.checks.downloads.note));
  box.append(dl);

  const cards = el('div', 'cards');
  cards.append(
    card('Last published', r.checks.published),
    card('Deprecated', r.checks.deprecated),
    card('License', r.checks.license),
    card('TypeScript types', r.checks.types),
    card('Dependencies', r.checks.deps),
    card('Install size', r.checks.size),
    card('Maintainers', r.checks.maintainers),
  );
  box.append(cards);

  const foot = el('div', 'foot');
  const cmd = `npm i ${r.name}${r.typesPackage ? ` && npm i -D ${r.typesPackage}` : ''}`;
  const inst = el('button', 'install', cmd);
  inst.type = 'button';
  inst.title = 'Copy install command';
  inst.addEventListener('click', async () => {
    await copy(cmd);
    inst.textContent = 'Copied';
    setTimeout(() => (inst.textContent = cmd), 1200);
  });
  foot.append(inst);
  if (r.repository) foot.append(link(r.repository, 'Code'));
  if (r.homepage && r.homepage !== r.repository) foot.append(link(r.homepage, 'Website'));
  box.append(foot);
  return box;
}

function skeleton(name: string): HTMLElement {
  const box = el('section', 'pkg loading');
  const head = el('div', 'head');
  head.append(el('h3', '', name), el('p', 'desc', 'Checking npm…'));
  const v = el('div', 'skel');
  v.style.height = '84px';
  const d = el('div', 'skel');
  d.style.height = '140px';
  box.append(head, v, d);
  return box;
}

// The best of two or three: best verdict first, then most downloads.
function bestOf(results: Result[]): string | null {
  const found = results.filter((r): r is PackageReport => 'found' in r && r.found);
  if (results.length < 2 || found.length < 2) return null;
  const sorted = [...found].sort((a, b) => RANK[b.verdict.level] - RANK[a.verdict.level] || (b.weekly ?? 0) - (a.weekly ?? 0));
  return sorted[0].verdict.level === 'bad' ? null : sorted[0].name;
}

function summary(results: Result[]): string {
  const lines = results.map((r) => {
    if ('error' in r) return `- ${r.name}: couldn’t check (${r.error})`;
    if (!r.found) return `- ${r.name}: DOES NOT EXIST on npm. Don’t install it; find the real package name.`;
    const c = r.checks;
    return `- ${r.name}@${r.version}: ${r.verdict.title}. ${r.weekly === null ? '?' : fmtNum(r.weekly)} downloads a week, last published ${c.published.value}, license ${c.license.value}, ${r.deps} dependencies, ${c.size.value}, TypeScript types: ${c.types.value.toLowerCase()}${r.typesPackage ? ` (${r.typesPackage})` : ''}${r.deprecated ? `, DEPRECATED: ${r.deprecated}` : ''}.`;
  });
  const best = bestOf(results);
  return [
    `I checked ${results.length === 1 ? 'this npm package' : 'these npm packages'} (darnly.dev/tools/npm-package-checker):`,
    ...lines,
    best ? `Use ${best} unless there’s a reason it won’t fit this project.` : results.length === 1 ? 'Keep this in mind before installing it.' : '',
  ].filter(Boolean).join('\n');
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = el('textarea');
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
}

async function fetchOne(name: string): Promise<Result> {
  try {
    const res = await fetch(`/api/npm?name=${encodeURIComponent(name)}`);
    const data = await res.json();
    if (!res.ok) return { name, error: data.error ?? `Error ${res.status}` };
    return data;
  } catch {
    return { name, error: 'We couldn’t reach the checker. Check your connection and try again.' };
  }
}

async function run(raw: string, push = true) {
  const all = parse(raw);
  const names = all.slice(0, 3);
  error.hidden = true;
  if (!names.length) {
    error.textContent = 'Type a package name, like zod.';
    error.hidden = false;
    return;
  }
  if (all.length > 3) {
    error.textContent = 'You can compare up to three packages at a time. We checked the first three.';
    error.hidden = false;
  }
  input.value = names.join(', ');
  if (push) {
    const u = new URL(location.href);
    u.searchParams.set('p', names.join(','));
    history.replaceState(null, '', u);
  }
  go.disabled = true;
  actions.hidden = true;
  cols.style.setProperty('--n', String(names.length));
  cols.classList.toggle('multi', names.length > 1);
  cols.replaceChildren(...names.map(skeleton));

  last = await Promise.all(names.map(fetchOne));
  const best = bestOf(last);
  cols.replaceChildren(...last.map((r) => render(r, r.name === best)));
  actions.hidden = false;
  go.disabled = false;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  run(input.value);
});
document.querySelectorAll<HTMLButtonElement>('[data-try]').forEach((b) =>
  b.addEventListener('click', () => {
    input.value = b.dataset.try ?? '';
    run(input.value);
  }),
);
copyBtn.addEventListener('click', async () => {
  await copy(summary(last));
  copied.hidden = false;
  setTimeout(() => (copied.hidden = true), 1500);
});

// Start with a shared link's packages, or a comparison that shows every color.
const start = new URL(location.href).searchParams.get('p');
run(start || EXAMPLE, !!start);
