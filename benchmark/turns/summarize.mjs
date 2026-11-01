// Turns a turns-to-fix results.csv into summary.md: screenshot vs Darnly, per bug and overall.
// Usage: node summarize.mjs [runs/<folder> ...]   (default: the newest folder; several folders are combined)
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
let dirs = process.argv.slice(2);
if (!dirs.length) {
  const all = fs.existsSync(path.join(here, 'runs')) ? fs.readdirSync(path.join(here, 'runs')).filter((d) => !d.startsWith('_')).sort() : [];
  if (!all.length) throw new Error('No runs yet. Run: node run.mjs');
  dirs = [path.join('runs', all.at(-1))];
}
dirs = dirs.map((d) => path.resolve(here, d));

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const all = dirs.flatMap((d) => parseCsv(fs.readFileSync(path.join(d, 'results.csv'), 'utf8')));
const rows = all.filter((r) => !r.error);
const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const num = (r, k) => Number(r[k]);
const fmt = (x, d = 0) => (Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '–');
const settings = JSON.parse(fs.readFileSync(path.join(dirs[0], 'settings.json'), 'utf8'));
const conds = ['screenshot', 'darnly', 'text'].filter((c) => rows.some((r) => r.condition === c));
const NAMES = { screenshot: 'Screenshot + sentence', darnly: 'Darnly', text: 'Sentence only' };

function stats(rs) {
  const fixed = rs.filter((r) => r.fixed === 'yes' && r.scope_ok === 'yes');
  return {
    n: rs.length,
    fixedRight: fixed.length,
    fixedAnyScope: rs.filter((r) => r.fixed === 'yes').length,
    firstTry: rs.filter((r) => r.fixed_at_message === '1').length,
    msgs: mean(rs.map((r) => num(r, 'user_messages'))),
    msgsFixed: mean(fixed.map((r) => num(r, 'fixed_at_message'))),
    questions: rs.reduce((s, r) => s + num(r, 'questions'), 0),
    wrongScope: rs.filter((r) => num(r, 'wrong_scope_turns') > 0).length,
    cost: mean(rs.map((r) => num(r, 'cost_usd'))),
    costTotal: rs.reduce((s, r) => s + num(r, 'cost_usd'), 0),
    tokens: median(rs.map((r) => num(r, 'total_tokens'))),
    newTokens: median(rs.map((r) => num(r, 'new_tokens'))),
    searches: mean(rs.map((r) => num(r, 'search_calls'))),
    reads: mean(rs.map((r) => num(r, 'file_reads'))),
    tools: mean(rs.map((r) => num(r, 'tool_calls'))),
    darnly: mean(rs.map((r) => num(r, 'darnly_calls'))),
    seconds: mean(rs.map((r) => num(r, 'seconds'))),
  };
}

const lines = [];
lines.push('# Turns to fix: screenshot vs Darnly', '');
lines.push(`App: Excalidraw (${settings.commit?.slice(0, 7)}), 8 planted UI bugs. Agent: Claude Code, model ${settings.model}. Simulated user: ${settings.userModel}. Up to ${settings.maxMessages} user messages per bug. Runs: ${rows.length}${all.length > rows.length ? ` (${all.length - rows.length} failed to run, left out)` : ''}.`, '');

lines.push('## Overall', '');
lines.push(`| | ${conds.map((c) => NAMES[c]).join(' | ')} |`);
lines.push(`|---|${conds.map(() => '---').join('|')}|`);
const S = Object.fromEntries(conds.map((c) => [c, stats(rows.filter((r) => r.condition === c))]));
const row = (label, f) => lines.push(`| ${label} | ${conds.map((c) => f(S[c])).join(' | ')} |`);
row('Fixed, right scope (checked in a browser)', (s) => `${s.fixedRight} of ${s.n}`);
row('Fixed from the first message', (s) => `${s.firstTry} of ${s.n}`);
row('User messages per bug (average)', (s) => fmt(s.msgs, 1));
row('Follow-up questions from the agent (total)', (s) => String(s.questions));
row('Runs that fixed the wrong scope at some point', (s) => String(s.wrongScope));
row('Cost per bug (average)', (s) => `$${fmt(s.cost, 2)}`);
row('Tokens per bug (median)', (s) => fmt(s.tokens));
row('Searches per bug (average)', (s) => fmt(s.searches, 1));
row('File reads per bug (average)', (s) => fmt(s.reads, 1));
row('Tool calls per bug (average)', (s) => fmt(s.tools, 1));
row('…of which Darnly steps', (s) => fmt(s.darnly, 1));
row('Agent time per bug, seconds (average)', (s) => fmt(s.seconds));
lines.push('');

for (const scope of ['global', 'local']) {
  const rs = rows.filter((r) => r.scope === scope);
  if (!rs.length) continue;
  lines.push(`## ${scope === 'global' ? 'Global bugs (the fix belongs in a shared place)' : 'Local bugs (the fix belongs in one component)'}`, '');
  lines.push(`| | ${conds.map((c) => NAMES[c]).join(' | ')} |`);
  lines.push(`|---|${conds.map(() => '---').join('|')}|`);
  const T = Object.fromEntries(conds.map((c) => [c, stats(rs.filter((r) => r.condition === c))]));
  const r2 = (label, f) => lines.push(`| ${label} | ${conds.map((c) => f(T[c])).join(' | ')} |`);
  r2('Fixed, right scope', (s) => `${s.fixedRight} of ${s.n}`);
  r2('Fixed from the first message', (s) => `${s.firstTry} of ${s.n}`);
  r2('User messages (average)', (s) => fmt(s.msgs, 1));
  r2('Wrong scope at some point', (s) => String(s.wrongScope));
  r2('Cost (average)', (s) => `$${fmt(s.cost, 2)}`);
  r2('Searches (average)', (s) => fmt(s.searches, 1));
  lines.push('');
}

lines.push('## Per bug', '');
lines.push(`| Bug | Kind | Scope | ${conds.map((c) => `${NAMES[c]}: messages · questions · cost`).join(' | ')} |`);
lines.push(`|---|---|---|${conds.map(() => '---').join('|')}|`);
for (const bug of [...new Set(rows.map((r) => r.bug))].sort()) {
  const any = rows.find((r) => r.bug === bug);
  const cells = conds.map((c) => {
    const rs = rows.filter((r) => r.bug === bug && r.condition === c);
    if (!rs.length) return '–';
    return rs.map((r) => `${r.fixed === 'yes' && r.scope_ok === 'yes' ? '' : '✗ '}${r.user_messages} · ${r.questions} · $${fmt(num(r, 'cost_usd'), 2)}`).join('; ');
  });
  lines.push(`| ${bug} | ${any.kind} | ${any.scope} | ${cells.join(' | ')} |`);
}
lines.push('', '✗ = not fixed with the right scope within the message limit.', '');

for (const d of dirs) fs.writeFileSync(path.join(d, 'summary.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
