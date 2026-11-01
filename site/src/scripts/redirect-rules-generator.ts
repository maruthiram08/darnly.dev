// Redirect rules generator: everything runs in the visitor's browser. Nothing is uploaded.
import {
  EXAMPLE, PLATFORMS, check, cleanDomain, generate, parse, show, usable,
  type Check, type Code, type HostMode, type Options, type Platform, type SlashMode,
} from './redirect-rules-generator-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const listIn = $<HTMLTextAreaElement>('rr-list');
const fileIn = $<HTMLInputElement>('rr-file');
const badEl = $<HTMLUListElement>('rr-bad');
const verdict = $<HTMLDivElement>('rr-verdict');
const badge = $<HTMLSpanElement>('rr-badge');
const vtitle = $<HTMLParagraphElement>('rr-vtitle');
const vsub = $<HTMLParagraphElement>('rr-vsub');
const fixBtn = $<HTMLButtonElement>('rr-fix');
const mapEl = $<HTMLOListElement>('rr-map');
const showAll = $<HTMLButtonElement>('rr-showall');
const domainWrap = $<HTMLDivElement>('rr-domain-wrap');
const domainIn = $<HTMLInputElement>('rr-domain');
const tabsEl = $<HTMLDivElement>('rr-tabs');
const fname = $<HTMLSpanElement>('rr-fname');
const whereEl = $<HTMLParagraphElement>('rr-where');
const codeOut = $<HTMLElement>('rr-code-out');
const copyBtn = $<HTMLButtonElement>('rr-copy');
const dlBtn = $<HTMLButtonElement>('rr-dl');
const promptBtn = $<HTMLButtonElement>('rr-prompt');
const status = $<HTMLSpanElement>('rr-status');

const PLATFORM_KEY = 'darnly-redirects-platform';
const MAP_LIMIT = 60;

const opts: Options = { code: 301, host: 'leave', domain: '', slash: 'leave' };
let platform: Platform = 'vercel';
let checks: Check[] = [];
let guessed: string[] = [];
let expanded = false;
let output = '';

try {
  const saved = localStorage.getItem(PLATFORM_KEY) as Platform | null;
  if (saved && PLATFORMS.some((p) => p.id === saved)) platform = saved;
} catch { /* storage blocked: keep the default */ }

function say(msg: string) {
  status.textContent = msg;
  window.clearTimeout(say.timer);
  say.timer = window.setTimeout(() => (status.textContent = ''), 2500);
}
say.timer = 0;

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    say(ok ? done : 'Couldn’t copy. Select the text and copy it yourself.');
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function arrow(code?: number) {
  const a = el('span', 'arrow');
  a.setAttribute('aria-label', code ? `redirects with ${code} to` : 'then to');
  a.append(el('i'));
  if (code) { a.append(el('b', undefined, String(code))); a.append(el('i')); }
  return a;
}

function row(c: Check): HTMLLIElement {
  const li = el('li', c.kind === 'loop' || c.kind === 'chain' ? 'bad' : c.kind === 'hop' ? 'warn' : c.kind === 'dup' ? 'dup' : '');
  const path = el('div', 'path');
  path.append(el('span', 'ln', `${c.rule.line}`));
  const loopBack = c.kind === 'loop' && c.hops.length > 1 ? c.hops[c.hops.length - 1] : null;
  c.hops.forEach((h, i) => {
    if (i > 0) path.append(arrow(i === 1 ? c.rule.code : undefined));
    const ext = /^https?:\/\//i.test(h) && i > 0;
    const hit = (c.kind === 'chain' && i > 0 && i < c.hops.length - 1) || (loopBack !== null && h === loopBack);
    path.append(el('span', `node${ext ? ' ext' : ''}${hit ? ' hit' : ''}`, h));
  });
  if (c.kind === 'loop') path.append(el('span', 'loopmark', ' ↺'));
  li.append(path);
  if (c.why) li.append(el('p', 'why', c.why));
  return li;
}

function readOpts() {
  opts.domain = domainIn.value;
}

function render() {
  readOpts();
  const parsed = parse(listIn.value, opts);
  guessed = parsed.hosts;
  checks = check(parsed.rules, opts, guessed);

  // Domain box: only when a www rule is wanted.
  domainWrap.hidden = opts.host === 'leave';
  if (!domainIn.value && guessed[0]) domainIn.placeholder = guessed[0];
  const needDomain = opts.host !== 'leave' && !cleanDomain(domainIn.value);
  domainWrap.classList.toggle('need', needDomain);

  // Lines we couldn't read.
  badEl.replaceChildren(...parsed.bad.map((b) => {
    const li = el('li');
    li.append(`Line ${b.line}: `, el('code', undefined, b.text.length > 60 ? b.text.slice(0, 57) + '…' : b.text), ` ${b.why}`);
    return li;
  }));

  // Verdict.
  const n = (k: Check['kind']) => checks.filter((c) => c.kind === k).length;
  const loops = n('loop');
  const chains = n('chain');
  const hops = n('hop');
  const dups = n('dup');
  const total = checks.length - dups;
  const problems: string[] = [];
  if (loops) problems.push(`${loops} loop${loops > 1 ? 's' : ''}`);
  if (chains) problems.push(`${chains} chain${chains > 1 ? 's' : ''}`);
  if (!total) {
    verdict.dataset.state = 'empty';
    badge.textContent = '→';
    vtitle.textContent = 'Paste your old and new addresses below';
    vsub.textContent = 'One pair per line, like /old-page /new-page. Your redirect map shows up here.';
  } else if (loops || chains) {
    verdict.dataset.state = 'bad';
    badge.textContent = '!';
    vtitle.textContent = `${problems.join(' and ')} to fix`;
    vsub.textContent = `${total} redirect${total > 1 ? 's' : ''}. ${loops ? 'Loops never load: the browser shows “too many redirects”. ' : ''}${chains ? 'Chains are slow and can lose your Google ranking.' : ''}`.trim();
  } else if (hops || dups || needDomain || parsed.bad.length) {
    verdict.dataset.state = 'warn';
    badge.textContent = '!';
    vtitle.textContent = `${total} redirect${total > 1 ? 's' : ''}, no loops or chains`;
    const notes = [];
    if (hops) notes.push(`${hops} take${hops > 1 ? '' : 's'} an extra hop through the www or https redirect`);
    if (dups) notes.push(`${dups} duplicate${dups > 1 ? 's are' : ' is'} ignored`);
    if (parsed.bad.length) notes.push(`${parsed.bad.length} line${parsed.bad.length > 1 ? 's' : ''} couldn’t be read`);
    if (needDomain) notes.push('type your domain to add the www rule');
    vsub.textContent = notes.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.';
  } else {
    verdict.dataset.state = 'ok';
    badge.textContent = '✓';
    vtitle.textContent = `${total} redirect${total > 1 ? 's' : ''}, no loops or chains`;
    vsub.textContent = 'Every old address goes straight to its new page in one step. Ready to copy.';
  }
  const fixable = checks.filter((c) => (c.kind === 'chain' || c.kind === 'hop') && c.final && !c.rule.wild).length;
  fixBtn.hidden = fixable === 0;
  fixBtn.textContent = chains ? `Fix ${chains > 1 ? `${chains} chains` : 'chain'}` : 'Fix extra hops';

  // Map: problems first, then the rest in list order.
  const rank = { loop: 0, chain: 1, hop: 2, dup: 3, ok: 4 } as const;
  const sorted = [...checks].sort((a, b) => rank[a.kind] - rank[b.kind] || a.rule.line - b.rule.line);
  const shown = expanded ? sorted : sorted.slice(0, MAP_LIMIT);
  if (sorted.length === 0) {
    const li = el('li', 'empty', 'No redirects yet.');
    mapEl.replaceChildren(li);
  } else mapEl.replaceChildren(...shown.map(row));
  showAll.hidden = sorted.length <= MAP_LIMIT;
  showAll.textContent = expanded ? 'Show fewer' : `Show all ${sorted.length}`;

  renderOutput();
}

function renderOutput() {
  const p = PLATFORMS.find((x) => x.id === platform)!;
  for (const b of tabsEl.querySelectorAll<HTMLButtonElement>('[role=tab]')) {
    const on = b.dataset.p === platform;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  fname.textContent = p.file;
  whereEl.innerHTML = p.where; // fixed copy from the core file, not user input
  output = generate(platform, usable(checks), opts);
  // Grey out comment lines; the text itself goes in as text, never HTML.
  const frag = document.createDocumentFragment();
  output.split('\n').forEach((line, i) => {
    if (i) frag.append('\n');
    const t = line.trimStart();
    if (t.startsWith('#') || t.startsWith('//') || t.startsWith('/**')) frag.append(el('span', 'c', line));
    else frag.append(line);
  });
  codeOut.replaceChildren(frag);
}

function seg(id: string, onPick: (v: string) => void) {
  const box = $<HTMLDivElement>(id);
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
    if (!b) return;
    for (const x of box.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    onPick(b.dataset.v!);
    render();
  });
}

seg('rr-code', (v) => (opts.code = Number(v) as Code));
seg('rr-host', (v) => {
  opts.host = v as HostMode;
  if (v !== 'leave' && !domainIn.value && guessed[0]) domainIn.value = guessed[0];
  if (v !== 'leave' && !domainIn.value) window.setTimeout(() => domainIn.focus(), 0);
});
seg('rr-slash', (v) => (opts.slash = v as SlashMode));

let timer = 0;
listIn.addEventListener('input', () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(render, 120);
});
domainIn.addEventListener('input', render);

$<HTMLButtonElement>('rr-example').addEventListener('click', () => { listIn.value = EXAMPLE; render(); });
$<HTMLButtonElement>('rr-clear').addEventListener('click', () => { listIn.value = ''; render(); listIn.focus(); });
showAll.addEventListener('click', () => { expanded = !expanded; render(); });

fileIn.addEventListener('change', async () => {
  const f = fileIn.files?.[0];
  if (!f) return;
  if (f.size > 2_000_000) { say('That file is over 2 MB. Try a shorter list.'); return; }
  listIn.value = (await f.text()).replace(/^﻿/, '');
  fileIn.value = '';
  render();
});

// Point every chain (and extra www/https hop) straight at its final address.
fixBtn.addEventListener('click', () => {
  const lines = listIn.value.split(/\r?\n/);
  let fixed = 0;
  for (const c of checks) {
    if ((c.kind !== 'chain' && c.kind !== 'hop') || !c.final || c.rule.wild) continue;
    const i = c.rule.line - 1;
    const code = c.rule.code !== opts.code ? `  ${c.rule.code}` : '';
    lines[i] = `${show(c.rule, 'from')}  ${c.final}${code}`;
    fixed++;
  }
  listIn.value = lines.join('\n');
  render();
  say(fixed ? `Fixed ${fixed}. Every old address now goes straight to its page.` : '');
});

tabsEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[role=tab]');
  if (!b) return;
  platform = b.dataset.p as Platform;
  try { localStorage.setItem(PLATFORM_KEY, platform); } catch { /* fine */ }
  renderOutput();
});
tabsEl.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const i = PLATFORMS.findIndex((p) => p.id === platform);
  const n = (i + (e.key === 'ArrowRight' ? 1 : PLATFORMS.length - 1)) % PLATFORMS.length;
  platform = PLATFORMS[n].id;
  renderOutput();
  tabsEl.querySelector<HTMLButtonElement>(`[data-p="${platform}"]`)?.focus();
});

copyBtn.addEventListener('click', () => copy(output, 'Copied.'));

dlBtn.addEventListener('click', () => {
  const p = PLATFORMS.find((x) => x.id === platform)!;
  const blob = new Blob([output + '\n'], { type: p.file.endsWith('.json') ? 'application/json' : 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = p.file;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  say(`Downloaded ${p.file}.`);
});

promptBtn.addEventListener('click', () => {
  const p = PLATFORMS.find((x) => x.id === platform)!;
  const first = usable(checks).find((r) => !r.wild);
  const lines = [
    `Add these redirects to my project. My site runs on ${p.label}.`,
    '',
    `Put them in ${p.file}${platform === 'nginx' ? ' (or my nginx site config)' : ''}. If that file already exists, merge them in and keep every rule that's already there. Put these before any catch-all rules.`,
    '',
    '```',
    output,
    '```',
    '',
    first
      ? `When you're done, check that ${first.from} sends me to ${first.to} with a ${first.code}, and that no redirect leads to another redirect.`
      : 'When you\'re done, check that each old address sends me to its new page in one step.',
  ];
  copy(lines.join('\n'), 'Prompt copied. Paste it into your agent.');
});

render();
