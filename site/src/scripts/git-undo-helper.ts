// Git undo helper: pick what happened, see it on a commit graph, copy the fix. Runs in the browser only.
import {
  SITUATIONS,
  GROUPS,
  DANGER,
  commandsText,
  agentPrompt,
  findSituation,
  matches,
  type Graph,
  type Situation,
  type Tone,
} from './git-undo-helper-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

async function copyText(text: string, btn: HTMLButtonElement) {
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.textContent = label), 1500);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- Commit graph drawing ----

const PADX = 40;
const COLW = 108;
// Room above the top lane for branch labels: one row per label stacked on the same commit.
const topFor = (gs: Graph[]) => {
  let n = 1;
  for (const g of gs) {
    const count = new Map<string, number>();
    for (const r of g.refs) {
      const c = g.commits.find((x) => x.id === r.at);
      if (!c || (c.lane ?? 0) > 0) continue;
      count.set(r.at, (count.get(r.at) ?? 0) + 1);
      n = Math.max(n, count.get(r.at)!);
    }
  }
  return 38 + n * 28;
};
const LANEH = 100;
const R = 14;
const WORKW = 138;

const TONE_TEXT: Record<Tone, string> = {
  plain: 'A commit',
  focus: 'The commit this is about',
  agent: 'Made by your AI agent',
  bad: 'Has your secrets in it',
  new: 'Made or fixed by these steps',
  gone: 'Not on any branch any more',
  kept: 'Kept safe on a backup branch',
};

const pillW = (name: string) => Math.round(name.length * 7.4 + 22);

function size(gs: Graph[]) {
  let right = 0;
  let lanes = 1;
  for (const g of gs) {
    for (const c of g.commits) {
      const x = PADX + c.col * COLW;
      right = Math.max(right, x + 60);
      lanes = Math.max(lanes, (c.lane ?? 0) + 1);
    }
    if (g.work) {
      const c = g.commits.find((x) => x.id === g.work!.at);
      if (c) right = Math.max(right, PADX + c.col * COLW + 34 + WORKW + 8);
    }
  }
  // Lane 1+ puts branch labels under the commit, so leave room for one.
  const height = topFor(gs) + (lanes - 1) * LANEH + (lanes > 1 ? 84 : 52);
  return { width: Math.max(right, 260), height };
}

function svgFor(g: Graph, w: number, h: number, top: number): string {
  const pos = new Map(g.commits.map((c) => [c.id, { x: PADX + c.col * COLW, y: top + (c.lane ?? 0) * LANEH, c }]));
  const out: string[] = [];

  // Lines from each parent to its child.
  for (const c of g.commits) {
    const to = pos.get(c.id)!;
    for (const p of c.parents ?? []) {
      const from = pos.get(p);
      if (!from) continue;
      const faint = c.tone === 'gone' || c.tone === 'kept';
      const cls = `edge${faint ? ' faint' : ''}${c.tone === 'gone' ? ' dashed' : ''}`;
      if (from.y === to.y) out.push(`<line class="${cls}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>`);
      else {
        const mx = (from.x + to.x) / 2;
        out.push(`<path class="${cls}" d="M${from.x} ${from.y} C${mx} ${from.y} ${mx} ${to.y} ${to.x} ${to.y}"/>`);
      }
    }
  }

  // Uncommitted files: a box to the right of their commit.
  if (g.work) {
    const p = pos.get(g.work.at);
    if (p) {
      const bx = p.x + 34;
      const by = p.y - 18;
      out.push(`<line class="edge dashed wline" x1="${p.x + R}" y1="${p.y}" x2="${bx}" y2="${p.y}"/>`);
      out.push(`<rect class="work ${g.work.tone}" x="${bx}" y="${by}" width="${WORKW}" height="36" rx="9"/>`);
      const icon = { changes: '✎', staged: '＋', conflict: '⚠', gone: '✕', stash: '⤓', ok: '✓' }[g.work.tone];
      out.push(`<text class="wtext ${g.work.tone}" x="${bx + WORKW / 2}" y="${p.y + 5}" text-anchor="middle">${icon} ${esc(g.work.text)}</text>`);
    }
  }

  // Commit dots and their messages.
  for (const { x, y, c } of pos.values()) {
    const tone = c.tone ?? 'plain';
    out.push(`<circle class="dot ${tone}" cx="${x}" cy="${y}" r="${R}"/>`);
    if (tone === 'bad') out.push(`<text class="dotmark" x="${x}" y="${y + 5}" text-anchor="middle">!</text>`);
    if (tone === 'new') out.push(`<text class="dotmark" x="${x}" y="${y + 5}" text-anchor="middle">✓</text>`);
    out.push(`<text class="msg ${tone}" x="${x}" y="${y + 34}" text-anchor="middle">${esc(c.msg)}</text>`);
  }

  // Branch labels: above the dot on the top lane, below its message on lower lanes.
  const stack = new Map<string, number>();
  for (const r of g.refs) {
    const p = pos.get(r.at);
    if (!p) continue;
    const n = stack.get(r.at) ?? 0;
    stack.set(r.at, n + 1);
    const label = r.here ? `● ${r.name}` : r.name;
    const pw = pillW(label);
    let px = p.x - pw / 2;
    px = Math.max(4, Math.min(px, w - pw - 4));
    const below = (p.c.lane ?? 0) > 0;
    const py = below ? p.y + 46 + n * 28 : p.y - R - 32 - n * 28;
    const cls = r.here ? 'ref here' : r.remote ? 'ref remote' : 'ref';
    out.push(`<g class="${cls}"><rect x="${px}" y="${py}" width="${pw}" height="24" rx="12"/><text x="${px + pw / 2}" y="${py + 16.5}" text-anchor="middle">${esc(label)}</text></g>`);
    if (!below) out.push(`<line class="refstem${r.here ? ' here' : ''}" x1="${p.x}" y1="${py + 24}" x2="${p.x}" y2="${p.y - R - 2}"/>`);
  }

  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(g.caption)}">${out.join('')}</svg>`;
}

// ---- Picker ----

const picker = $<HTMLDivElement>('gu-picker');
const search = $<HTMLInputElement>('gu-search');
const moreBtn = $<HTMLButtonElement>('gu-more');
const empty = $<HTMLParagraphElement>('gu-empty');
let showAll = false;
let current: Situation = SITUATIONS[0];
const chips = new Map<string, HTMLButtonElement>();

for (const group of GROUPS) {
  const box = el('div', 'grp');
  box.dataset.group = group;
  box.append(el('span', 'glabel', group));
  const row = el('div', 'chips');
  for (const s of SITUATIONS.filter((x) => x.group === group)) {
    const b = el('button', `chip ${s.danger}`, s.title);
    b.type = 'button';
    b.dataset.id = s.id;
    if (s.top) b.dataset.top = '';
    b.addEventListener('click', () => {
      pick(s.id);
      $('gu-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    chips.set(s.id, b);
    row.append(b);
  }
  box.append(row);
  picker.append(box);
}

function filter() {
  const q = search.value;
  let shown = 0;
  for (const s of SITUATIONS) {
    const b = chips.get(s.id)!;
    const ok = q ? matches(s, q) : showAll || s.top || s.id === current.id;
    b.hidden = !ok;
    if (ok) shown++;
  }
  for (const g of picker.querySelectorAll<HTMLDivElement>('.grp')) {
    g.hidden = !g.querySelector('.chip:not([hidden])');
  }
  empty.hidden = shown > 0;
  moreBtn.hidden = !!q;
  moreBtn.textContent = showAll ? 'Show fewer' : `Show all ${SITUATIONS.length} situations`;
}

search.addEventListener('input', filter);
moreBtn.addEventListener('click', () => {
  showAll = !showAll;
  filter();
});

// ---- The answer card ----

const card = $<HTMLElement>('gu-card');
const title = $<HTMLHeadingElement>('gu-title');
const badge = $<HTMLSpanElement>('gu-badge');
const why = $<HTMLParagraphElement>('gu-why');
const summary = $<HTMLParagraphElement>('gu-summary');
const beforeBox = $<HTMLDivElement>('gu-before');
const afterBox = $<HTMLDivElement>('gu-after');
const beforeCap = $<HTMLSpanElement>('gu-before-cap');
const afterCap = $<HTMLSpanElement>('gu-after-cap');
const graphs = card.querySelector<HTMLDivElement>('.graphs')!;
const legend = $<HTMLUListElement>('gu-legend');
const steps = $<HTMLOListElement>('gu-steps');
const notes = $<HTMLUListElement>('gu-notes');
const links = $<HTMLParagraphElement>('gu-links');

// Draws placeholders like <commit-id> in a different color so it's clear they need filling in.
function codeWithHoles(cmd: string): HTMLElement {
  const code = el('code');
  for (const part of cmd.split(/(<[a-z-]+>|path\/to\/file)/)) {
    if (!part) continue;
    if (/^<[a-z-]+>$/.test(part) || part === 'path/to/file') code.append(el('span', 'hole', part));
    else code.append(document.createTextNode(part));
  }
  return code;
}

function pick(id: string, push = true) {
  const s = findSituation(id) ?? SITUATIONS[0];
  current = s;
  for (const [cid, b] of chips) b.setAttribute('aria-pressed', String(cid === s.id));
  filter();

  card.className = `card ${s.danger}`;
  title.textContent = s.title;
  badge.className = `badge ${s.danger}`;
  badge.textContent = `${DANGER[s.danger].icon} ${DANGER[s.danger].label}`;
  why.textContent = s.why;
  summary.textContent = s.summary;

  // Small graphs sit side by side at full size; wide ones go one above the other so the text stays readable.
  const { width, height } = size([s.before, s.after]);
  const stacked = width > 470;
  graphs.classList.toggle('stacked', stacked);
  const top = topFor([s.before, s.after]);
  beforeBox.innerHTML = svgFor(s.before, width, stacked ? size([s.before]).height : height, stacked ? topFor([s.before]) : top);
  afterBox.innerHTML = svgFor(s.after, width, stacked ? size([s.after]).height : height, stacked ? topFor([s.after]) : top);
  beforeCap.textContent = s.before.caption;
  afterCap.textContent = s.after.caption;

  const tones = new Set<Tone>();
  for (const g of [s.before, s.after]) for (const c of g.commits) tones.add(c.tone ?? 'plain');
  const items: HTMLLIElement[] = [];
  for (const t of ['focus', 'agent', 'bad', 'new', 'gone', 'kept'] as Tone[]) {
    if (!tones.has(t)) continue;
    const li = el('li');
    li.append(el('i', `sw ${t}`), document.createTextNode(TONE_TEXT[t]));
    items.push(li);
  }
  const here = el('li');
  here.append(el('i', 'sw herepill'), document.createTextNode('The branch you’re on'));
  items.push(here);
  legend.replaceChildren(...items);

  steps.replaceChildren(
    ...s.steps.map((st) => {
      const li = el('li', st.cmd ? 'step' : 'step manual');
      li.append(el('p', 'note', st.note));
      if (st.cmd) {
        const row = el('div', 'cmd');
        row.append(codeWithHoles(st.cmd));
        const b = el('button', 'copy1', 'Copy');
        b.type = 'button';
        b.setAttribute('aria-label', `Copy: ${st.cmd}`);
        b.addEventListener('click', () => copyText(st.cmd!, b));
        row.append(b);
        li.append(row);
      }
      return li;
    }),
  );

  notes.replaceChildren(...(s.notes ?? []).map((n) => el('li', '', n)));
  notes.hidden = !s.notes?.length;

  links.replaceChildren();
  for (const l of s.links ?? []) {
    const a = el('a', '', `${l.text} →`);
    a.href = l.href;
    links.append(a);
  }
  links.hidden = !s.links?.length;

  if (push) history.replaceState(null, '', `#${s.id}`);
}

$<HTMLButtonElement>('gu-copy').addEventListener('click', (e) => copyText(commandsText(current), e.currentTarget as HTMLButtonElement));
$<HTMLButtonElement>('gu-prompt').addEventListener('click', (e) => copyText(agentPrompt(current), e.currentTarget as HTMLButtonElement));

const fromHash = location.hash.slice(1);
pick(findSituation(fromHash) ? fromHash : 'wrong-branch', false);
window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (findSituation(id)) pick(id, false);
});
