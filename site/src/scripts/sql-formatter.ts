// SQL formatter: everything runs in the visitor's browser. Nothing is uploaded.
import { analyze, esc, friendlyError, type Dialect, type Level } from './sql-formatter-core';
import type { FormatOptions } from './sql-formatter-load';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('sf-input');
const code = $<HTMLElement>('sf-code');
const verdict = $<HTMLElement>('sf-verdict');
const verdictText = $<HTMLElement>('sf-verdict-text');
const verdictIcon = $<HTMLElement>('sf-verdict-icon');
const outline = $<HTMLOListElement>('sf-outline');
const error = $<HTMLParagraphElement>('sf-error');
const status = $<HTMLParagraphElement>('sf-status');
const copyBtn = $<HTMLButtonElement>('sf-copy');
const copyTop = $<HTMLButtonElement>('sf-copy-top');
const promptBtn = $<HTMLButtonElement>('sf-prompt');
const clearBtn = $<HTMLButtonElement>('sf-clear');
const stage = $<HTMLElement>('sf-stage');

const EXAMPLES: Record<string, string> = {
  messy: `select u.id,u.email,count(o.id) as orders,sum(o.total) as spent from users u left join orders o on o.user_id=u.id where u.created_at > now() - interval '30 days' and u.is_test = false group by u.id,u.email having count(o.id) > 0 order by spent desc limit 20;
update profiles set plan = 'free', trial_ends_at = null;`,
  supabase: `create table todos (id bigint generated always as identity primary key, user_id uuid references auth.users not null, title text not null, done boolean default false, created_at timestamptz default now());
alter table todos enable row level security;
create policy "Users see their own todos" on todos for select using (auth.uid() = user_id);
insert into todos (user_id, title) values (auth.uid(), 'Ship the landing page') returning id;`,
  danger: `delete from orders;
DELETE FROM sessions WHERE 1=1;
truncate table audit_log;
drop table if exists customers cascade;`,
  cte: `with paying as (select user_id, sum(amount) as total from payments where status = 'paid' group by user_id) select p.user_id, p.total, u.email from paying p join users u on u.id = p.user_id where p.total > 100 order by p.total desc;`,
};

let formatted = '';
let timer = 0;
let loader: Promise<typeof import('./sql-formatter-load')> | null = null;
const load = () => (loader ??= import('./sql-formatter-load'));

function pick(name: string): string {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '';
}

function options(): FormatOptions {
  return { dialect: pick('sf-dialect') as Dialect, keywordCase: pick('sf-case') as FormatOptions['keywordCase'], indent: pick('sf-indent') as FormatOptions['indent'] };
}

function say(msg: string) {
  status.textContent = msg;
}

async function copy(text: string, done: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    say(done);
  } catch {
    say('Your browser blocked copying. Select the text instead.');
  }
}

const RANK: Record<Level, number> = { other: 0, read: 1, schema: 2, write: 3, danger: 4 };
const ICON: Record<Level, string> = { read: '✓', write: '✎', schema: '▦', danger: '!', other: '•' };
const BADGE: Record<Level, string> = { read: 'Reads', write: 'Changes data', schema: 'Changes structure', danger: 'Danger', other: 'Other' };

function paint(sql: string) {
  const stmts = analyze(sql);
  // Code view: one block per statement so the risky ones can be marked in place.
  code.innerHTML = stmts.length
    ? stmts.map((s, i) => `${s.lead.trim()}<span class="stmt lvl-${s.level}" data-n="${i + 1}">${s.html}</span>`).join('')
    : '';

  const worst = stmts.reduce<Level>((w, s) => (RANK[s.level] > RANK[w] ? s.level : w), 'other');
  const dangers = stmts.filter((s) => s.level === 'danger');
  const writes = [...new Set(stmts.flatMap((s) => (s.level === 'read' ? [] : s.writes)))];
  let headline = '';
  if (!stmts.length) headline = 'Paste some SQL below';
  else if (dangers.length === 1) headline = dangers[0].headline;
  else if (dangers.length > 1) headline = `${dangers.length} statements here can wipe out data.`;
  else if (worst === 'write') headline = writes.length ? `Changes data in ${writes.map((w) => `<b>${esc(w)}</b>`).join(', ')}.` : 'Changes data.';
  else if (worst === 'schema') headline = stmts.length === 1 ? stmts[0].headline : 'Changes the structure of your database.';
  else if (worst === 'read') headline = stmts.length === 1 ? stmts[0].headline : 'Only reads data. Nothing is changed.';
  else headline = stmts[0].headline;
  verdict.className = `verdict lvl-${stmts.length ? worst : 'other'}`;
  verdictIcon.textContent = ICON[stmts.length ? worst : 'other'];
  verdictText.innerHTML = headline;
  stage.dataset.level = worst;

  outline.innerHTML = stmts
    .map(
      (s, i) => `<li class="card lvl-${s.level}">
        <div class="card-top">${stmts.length > 1 ? `<span class="n">${i + 1}</span>` : ''}<span class="badge">${BADGE[s.level]}</span><span class="verb">${esc(s.verb)}</span></div>
        <p class="head">${s.headline}</p>
        ${s.lines.length ? `<ul>${s.lines.map((l) => `<li${l.danger ? ' class="bad"' : ''}><span class="lbl">${esc(l.label)}</span> ${l.text}</li>`).join('')}</ul>` : ''}
      </li>`,
    )
    .join('');
}

async function render() {
  const sql = input.value;
  error.hidden = true;
  if (!sql.trim()) {
    formatted = '';
    paint('');
    return;
  }
  // Show colors and the outline straight away; the formatter loads in the background.
  if (!formatted) paint(sql);
  try {
    const { formatSql } = await load();
    if (sql !== input.value) return; // the visitor kept typing
    formatted = formatSql(sql, options());
    paint(formatted);
  } catch (e) {
    if (sql !== input.value) return;
    formatted = '';
    paint(sql);
    const f = friendlyError(e instanceof Error ? e.message : String(e));
    error.textContent = `${f.text} The outline below is a best guess from the text as you wrote it.`;
    error.hidden = false;
  }
}

function schedule() {
  clearTimeout(timer);
  timer = window.setTimeout(render, 150);
}

input.addEventListener('input', () => {
  say('');
  schedule();
});
document.querySelectorAll<HTMLInputElement>('.sf-opts input').forEach((r) => r.addEventListener('change', () => render()));

document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((b) =>
  b.addEventListener('click', () => {
    input.value = EXAMPLES[b.dataset.example!] ?? '';
    formatted = '';
    say('');
    render();
  }),
);

const copyFormatted = () => copy(formatted || input.value, formatted ? 'Formatted SQL copied.' : 'Copied (it couldn’t be formatted, so this is your original).');
copyBtn.addEventListener('click', copyFormatted);
copyTop.addEventListener('click', copyFormatted);

promptBtn.addEventListener('click', () => {
  const sql = formatted || input.value;
  if (!sql.trim()) return;
  const stmts = analyze(sql);
  const danger = stmts.some((s) => s.level === 'danger');
  const dialect = { postgresql: 'Postgres (Supabase)', mysql: 'MySQL', sqlite: 'SQLite' }[options().dialect];
  const text = `Check this ${dialect} SQL before I run it. Explain in plain words what it does, which tables and rows it touches, and anything risky.${danger ? ' It looks like at least one statement can change or delete every row in a table: tell me if that is really what I want, and give me a safer version with a WHERE clause.' : ''}

\`\`\`sql
${sql.trim()}
\`\`\``;
  copy(text, 'Prompt copied. Paste it into Claude Code, Codex or Cursor.');
});

clearBtn.addEventListener('click', () => {
  input.value = '';
  formatted = '';
  say('');
  render();
  input.focus();
});

render();
