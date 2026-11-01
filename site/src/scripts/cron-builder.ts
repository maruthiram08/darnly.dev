// Cron expression generator: everything runs in the visitor's browser. Nothing is uploaded.
import { parse, describe, nextRuns, warnings, snippets, build, numeric, MONTH_NAMES, ordinal, shiftTo, type Build, type Cron, type Freq } from './cron-builder-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const say = $<HTMLParagraphElement>('cb-say');
const sub = $<HTMLParagraphElement>('cb-sub');
const exprBig = $<HTMLButtonElement>('cb-expr-big');
const copyBtn = $<HTMLButtonElement>('cb-copy');
const err = $<HTMLParagraphElement>('cb-error');
const runsEl = $<HTMLOListElement>('cb-runs');
const weekEl = $<HTMLDivElement>('cb-week');
const warnEl = $<HTMLUListElement>('cb-warn');
const zoneEl = $<HTMLElement>('cb-zone');
const tzName = $<HTMLElement>('cb-tz-name');
const exprIn = $<HTMLInputElement>('cb-expr');
const partsEl = $<HTMLDivElement>('cb-parts');
const freqSeg = $<HTMLDivElement>('cb-freq');
const tzSeg = $<HTMLDivElement>('cb-tz');
const everyMin = $<HTMLSelectElement>('cb-every-min');
const everyHour = $<HTMLSelectElement>('cb-every-hour');
const atMin = $<HTMLInputElement>('cb-at-min');
const daysSel = $<HTMLSelectElement>('cb-days');
const dows = $<HTMLDivElement>('cb-dows');
const monthSel = $<HTMLSelectElement>('cb-month');
const domSel = $<HTMLSelectElement>('cb-dom');
const timeIn = $<HTMLInputElement>('cb-time');
const shiftNote = $<HTMLParagraphElement>('cb-shift');
const tabs = $<HTMLDivElement>('cb-tabs');
const tabHint = $<HTMLParagraphElement>('cb-tab-hint');
const snippetEl = $<HTMLPreElement>('cb-snippet');
const copySnippet = $<HTMLButtonElement>('cb-copy-snippet');
const promptBtn = $<HTMLButtonElement>('cb-prompt');
const linkBtn = $<HTMLButtonElement>('cb-link');
const status = $<HTMLParagraphElement>('cb-status');

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone';
const isUtcHere = new Date().getTimezoneOffset() === 0;
zoneEl.textContent = zone;
tzName.textContent = zone;

for (let i = 0; i < 12; i++) monthSel.add(new Option(MONTH_NAMES[i], String(i + 1)));
for (let d = 1; d <= 31; d++) domSel.add(new Option(ordinal(d), String(d)));

const state: Build & { tz: 'local' | 'utc' } = {
  freq: 'daily',
  everyMin: 5,
  everyHour: 1,
  atMinute: 0,
  time: '09:00',
  days: 'weekdays',
  weekdays: [1, 2, 3, 4, 5],
  dom: 1,
  month: 1,
  offset: 0,
  tz: isUtcHere ? 'utc' : 'local',
};

let tab: keyof ReturnType<typeof snippets> = 'vercel';
let current: Cron | null = null;

function flash(msg: string) {
  status.textContent = msg;
}

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    flash(done);
  } catch {
    flash('Your browser blocked copying. Select the text instead.');
  }
}

const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const fmtDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtUtc = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });

function inWords(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  if (d < 60) return `in ${d} days`;
  const mo = Math.round(d / 30);
  return mo < 24 ? `in ${mo} months` : `in ${Math.round(d / 365)} years`;
}

function el(tag: string, cls: string, text: string) {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

// ---------- The preview ----------

function render(fromBuilder: boolean) {
  const p = parse(exprIn.value);
  exprIn.classList.toggle('err', !p.ok);
  if (!p.ok) {
    err.textContent = p.error;
    err.hidden = false;
    return;
  }
  err.hidden = true;
  current = p.cron;
  const c = p.cron;
  const now = new Date();
  const runs = nextRuns(c, now, 10);

  // Say it in the visitor's own time when that is simple (one time a day); otherwise in UTC.
  const offsetNow = -now.getTimezoneOffset();
  const local = offsetNow ? shiftTo(c, offsetNow) : null;
  say.textContent = describe(local || c);
  say.append(' ', el('span', 'utc-tag', local ? 'your time' : 'UTC'));
  sub.textContent = '';
  if (local) sub.append(`In UTC: ${describe(c).replace(/^A/, 'a')}. `);
  if (runs.length) {
    const first = runs[0];
    sub.append('Next run: ');
    const s = document.createElement('strong');
    s.textContent = `${fmtDay.format(first)} ${fmtTime.format(first)}`;
    sub.append(s, ` your time, ${inWords(first.getTime() - now.getTime())}.`);
  }
  exprBig.textContent = numeric(c);
  if (p.note) sub.append(` ${p.note}`);

  runsEl.textContent = '';
  if (!runs.length) runsEl.append(el('li', 'none', 'No runs in the next 8 years.'));
  for (const r of runs) {
    const li = document.createElement('li');
    li.append(
      el('span', 'day', fmtDay.format(r)),
      el('span', 'date', fmtDate.format(r)),
      el('span', 'time', fmtTime.format(r)),
      el('span', 'u', `${fmtUtc.format(r)} UTC`),
      el('span', 'in', inWords(r.getTime() - now.getTime())),
    );
    runsEl.append(li);
  }

  renderWeek(c, now);
  renderParts(c);

  const ws = warnings(c, nextRuns(c, now, 300));
  warnEl.textContent = '';
  for (const w of ws) {
    const li = document.createElement('li');
    li.append(el('strong', '', `${w.who}:`), w.text);
    warnEl.append(li);
  }
  const info = document.createElement('li');
  info.className = 'info';
  info.append(el('strong', '', 'Times are UTC.'), 'Vercel Cron, GitHub Actions, Cloudflare and Supabase pg_cron read the schedule in UTC, not your own time.');
  warnEl.append(info);

  renderSnippet();
  if (!fromBuilder) markBuilder(false);
  const url = new URL(location.href);
  url.searchParams.set('cron', c.expr);
  history.replaceState(null, '', url);
}

// 7 days x 24 hours in the visitor's own time; darker means more runs in that hour.
function renderWeek(c: Cron, now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 7 * 86400000);
  const counts = new Map<string, number>();
  for (const r of nextRuns(c, new Date(start.getTime() - 60000), 7 * 1440, end)) {
    const k = `${Math.floor((r.getTime() - start.getTime()) / 86400000)}-${r.getHours()}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  weekEl.textContent = '';
  for (let d = 0; d < 7; d++) {
    const day = new Date(start.getTime() + d * 86400000 + 12 * 3600000);
    weekEl.append(el('span', 'wd', d === 0 ? 'Today' : fmtDay.format(day)));
    for (let h = 0; h < 24; h++) {
      const n = counts.get(`${d}-${h}`) || 0;
      const cell = el('span', `c${n ? ` on${n >= 30 ? 3 : n >= 4 ? 2 : 1}` : ''}`, '');
      if (n) cell.title = `${fmtDay.format(day)} ${h}:00, ${n} run${n > 1 ? 's' : ''}`;
      weekEl.append(cell);
    }
  }
}

function renderParts(c: Cron) {
  const labels = ['minute', 'hour', 'day of month', 'month', 'day of week'];
  const fields = [c.minute, c.hour, c.dom, c.month, c.dow];
  partsEl.textContent = '';
  fields.forEach((f, i) => {
    const d = document.createElement('div');
    d.append(el('code', '', f.text), el('span', '', f.text === '*' ? `every ${labels[i]}` : labels[i]));
    partsEl.append(d);
  });
}

const HINTS: Record<string, string> = {
  vercel: 'Add this to vercel.json at the root of your project. Vercel calls the path on schedule. On the free Hobby plan, once a day at most.',
  github: 'Put this at the top of a workflow file in .github/workflows/. GitHub may start a few minutes late.',
  supabase: 'Run this in the Supabase SQL editor (turn on the pg_cron extension first). Uses UTC unless you changed cron.timezone.',
  cloudflare: 'Add this to wrangler.jsonc and add a scheduled() handler to your Worker. Cloudflare reads day names, so they are spelled out.',
};

function renderSnippet() {
  if (!current) return;
  snippetEl.textContent = snippets(current)[tab];
  tabHint.textContent = HINTS[tab];
}

// ---------- Builder ----------

function markBuilder(active: boolean) {
  for (const b of freqSeg.querySelectorAll<HTMLButtonElement>('button')) {
    b.setAttribute('aria-checked', String(active && b.dataset.freq === state.freq));
  }
}

function syncBuilderUi() {
  markBuilder(true);
  for (const b of tzSeg.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-checked', String(b.dataset.tz === state.tz));
  for (const e of document.querySelectorAll<HTMLElement>('.card [data-show]')) {
    e.classList.toggle('on', (e.dataset.show || '').split(' ').includes(state.freq));
  }
  for (const b of dows.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(state.weekdays.includes(Number(b.dataset.dow))));
  everyMin.value = String(state.everyMin);
  everyHour.value = String(state.everyHour);
  atMin.value = String(state.atMinute);
  daysSel.value = state.days;
  monthSel.value = String(state.month);
  domSel.value = String(state.dom);
  timeIn.value = state.time;
}

function fromBuilder() {
  // Minutes to add to the picked time to reach UTC. Uses today's offset (summer time can move it by an hour).
  state.offset = state.tz === 'local' ? new Date().getTimezoneOffset() : 0;
  const b = build(state);
  syncBuilderUi();
  shiftNote.textContent = b.shiftNote || '';
  shiftNote.hidden = !b.shiftNote;
  exprIn.value = b.expr;
  render(true);
}

freqSeg.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-freq]');
  if (!b) return;
  state.freq = b.dataset.freq as Freq;
  fromBuilder();
});
tzSeg.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tz]');
  if (!b) return;
  state.tz = b.dataset.tz as 'local' | 'utc';
  fromBuilder();
});
dows.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-dow]');
  if (!b) return;
  const d = Number(b.dataset.dow);
  const has = state.weekdays.includes(d);
  if (has && state.weekdays.length === 1) return; // keep at least one day
  state.weekdays = has ? state.weekdays.filter((x) => x !== d) : [...state.weekdays, d].sort((a, z) => a - z);
  fromBuilder();
});
everyMin.addEventListener('change', () => ((state.everyMin = Number(everyMin.value)), fromBuilder()));
everyHour.addEventListener('change', () => ((state.everyHour = Number(everyHour.value)), fromBuilder()));
atMin.addEventListener('input', () => {
  const n = Math.round(Number(atMin.value));
  if (!Number.isFinite(n) || n < 0 || n > 59) return;
  state.atMinute = n;
  fromBuilder();
});
daysSel.addEventListener('change', () => ((state.days = daysSel.value as Build['days']), fromBuilder()));
monthSel.addEventListener('change', () => ((state.month = Number(monthSel.value)), fromBuilder()));
domSel.addEventListener('change', () => ((state.dom = Number(domSel.value)), fromBuilder()));
timeIn.addEventListener('input', () => {
  if (!/^\d{2}:\d{2}/.test(timeIn.value)) return;
  state.time = timeIn.value.slice(0, 5);
  fromBuilder();
});

const PRESETS: Record<string, Partial<Build>> = {
  '5min': { freq: 'minutes', everyMin: 5 },
  hour: { freq: 'hours', everyHour: 1, atMinute: 0 },
  midnight: { freq: 'daily', days: 'every', time: '00:00' },
  weekday9: { freq: 'daily', days: 'weekdays', time: '09:00' },
  monday9: { freq: 'weekly', weekdays: [1], time: '09:00' },
  first: { freq: 'monthly', dom: 1, time: '09:00' },
};
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
  b.addEventListener('click', () => {
    Object.assign(state, PRESETS[b.dataset.preset || '']);
    fromBuilder();
  }),
);

// ---------- Paste ----------

exprIn.addEventListener('input', () => {
  shiftNote.hidden = true;
  render(false);
});
document.querySelectorAll<HTMLButtonElement>('[data-expr]').forEach((b) =>
  b.addEventListener('click', () => {
    exprIn.value = b.dataset.expr || '';
    shiftNote.hidden = true;
    render(false);
  }),
);

// ---------- Copy ----------

exprBig.addEventListener('click', () => copy(exprBig.textContent || '', 'Cron expression copied.'));
copyBtn.addEventListener('click', () => copy(exprBig.textContent || '', 'Cron expression copied.'));
tabs.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]');
  if (!b) return;
  tab = b.dataset.tab as typeof tab;
  for (const t of tabs.querySelectorAll('button')) t.setAttribute('aria-selected', String(t === b));
  renderSnippet();
});
copySnippet.addEventListener('click', () => copy(snippetEl.textContent || '', 'Code copied.'));
promptBtn.addEventListener('click', () => {
  if (!current) return;
  const expr = numeric(current);
  const text = [
    `Add a scheduled job to this project that runs on the cron schedule \`${expr}\` (${describe(current)}, in UTC).`,
    '',
    'Use the scheduler that fits where this project is deployed (for example Vercel Cron in vercel.json, a GitHub Actions workflow, Supabase pg_cron, or Cloudflare Cron Triggers in wrangler.jsonc). Remember these run in UTC.',
    'Ask me what the job should do if it is not clear, make the endpoint or handler safe to call twice, and protect it so only the scheduler can call it (for example with a CRON_SECRET check).',
  ].join('\n');
  copy(text, 'Prompt copied. Paste it into Claude Code, Codex or Cursor.');
});
linkBtn.addEventListener('click', () => copy(location.href, 'Link copied.'));

// ---------- Start ----------

const q = new URLSearchParams(location.search).get('cron');
if (q && parse(q).ok) {
  exprIn.value = q;
  syncBuilderUi();
  render(false);
} else {
  fromBuilder();
}
