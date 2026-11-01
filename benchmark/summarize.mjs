// Turns a results.csv into summary.md: per bug and overall, plain description vs Darnly report.
// Usage: node summarize.mjs [runs/<folder>]   (default: the newest folder in runs/)
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
let dir = process.argv[2];
if (!dir) {
  const all = fs.existsSync(path.join(here, 'runs')) ? fs.readdirSync(path.join(here, 'runs')).sort() : [];
  if (!all.length) throw new Error('No runs yet. Run: node run.mjs');
  dir = path.join('runs', all.at(-1));
}
dir = path.resolve(here, dir);

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

const rows = parseCsv(fs.readFileSync(path.join(dir, 'results.csv'), 'utf8')).filter((r) => !r.error);
const skipped = parseCsv(fs.readFileSync(path.join(dir, 'results.csv'), 'utf8')).length - rows.length;
const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const num = (r, k) => Number(r[k]);
const fmt = (x, d = 0) => (Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '–');
const pct = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && a ? `${b <= a ? '−' : '+'}${fmt(Math.abs(1 - b / a) * 100)}%` : '–');

const METRICS = [
  ['cost_usd', 'Cost (USD)', 3],
  ['total_tokens', 'Tokens', 0],
  ['new_tokens', 'New tokens (not from cache)', 0],
  ['tool_calls', 'Tool calls', 1],
  ['bookkeeping_calls', 'Darnly bookkeeping calls', 1],
  ['search_calls', 'Searches (grep/glob/find)', 1],
  ['file_reads', 'File reads', 1],
  ['turns', 'Turns', 1],
  ['seconds', 'Seconds', 0],
];

const bugs = [...new Set(rows.map((r) => r.bug))].sort();
const by = (bug, cond) => rows.filter((r) => r.bug === bug && r.condition === cond);

// Per bug: the median of the repeats, so one odd run doesn't swing the result.
const perBug = bugs.map((bug) => {
  const p = by(bug, 'plain'), d = by(bug, 'darnly');
  const out = { bug, kind: (p[0] ?? d[0]).kind, n: [p.length, d.length] };
  for (const [k] of METRICS) out[k] = [median(p.map((r) => num(r, k))), median(d.map((r) => num(r, k)))];
  out.fixed = [p.filter((r) => r.fixed === 'yes').length, d.filter((r) => r.fixed === 'yes').length];
  out.asked = [p.filter((r) => r.asked_question === 'yes').length, d.filter((r) => r.asked_question === 'yes').length];
  return out;
}).filter((b) => b.n[0] && b.n[1]);

// Sign test: if Darnly made no difference, it would be cheaper on about half the bugs by chance.
function signTestP(wins, n) {
  const choose = (n, k) => { let c = 1; for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1); return c; };
  let p = 0;
  for (let k = wins; k <= n; k++) p += choose(n, k) / 2 ** n;
  return p;
}

const lines = [];
lines.push(`# Darnly token benchmark: results`, '');
const settings = fs.existsSync(path.join(dir, 'settings.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) : {};
const models = [...new Set(rows.map((r) => r.model).filter(Boolean))].join(', ') || settings.model || '?';
lines.push(`Runs: ${rows.length} (${perBug.length} bugs, up to ${settings.reps ?? '?'} repeats each way). Model: ${models}.${skipped ? ` ${skipped} runs failed to run and are left out.` : ''}`, '');

const costWins = perBug.filter((b) => b.cost_usd[1] < b.cost_usd[0]).length;
const tokenWins = perBug.filter((b) => b.total_tokens[1] < b.total_tokens[0]).length;
const ratios = (k) => perBug.map((b) => b[k][1] / b[k][0]).filter(Number.isFinite);
const medRatio = (k) => median(ratios(k));
const sum = (k, i) => perBug.reduce((s, b) => s + (Number.isFinite(b[k][i]) ? b[k][i] : 0), 0);
const fixedP = perBug.reduce((s, b) => s + b.fixed[0], 0), fixedD = perBug.reduce((s, b) => s + b.fixed[1], 0);
const runsP = perBug.reduce((s, b) => s + b.n[0], 0), runsD = perBug.reduce((s, b) => s + b.n[1], 0);

lines.push('## Headline', '');
lines.push(`- **Cost:** Darnly was cheaper on ${costWins} of ${perBug.length} bugs. Typical bug: ${pct(1, medRatio('cost_usd'))} (median of per-bug changes). All bugs together: $${fmt(sum('cost_usd', 0), 2)} plain vs $${fmt(sum('cost_usd', 1), 2)} with Darnly (${pct(sum('cost_usd', 0), sum('cost_usd', 1))}).`);
lines.push(`- **Tokens:** fewer on ${tokenWins} of ${perBug.length} bugs. Typical bug: ${pct(1, medRatio('total_tokens'))} in all tokens, ${pct(1, medRatio('new_tokens'))} in new (not cached) tokens.`);
lines.push(`- **Searches (grep, glob, find):** typical bug ${pct(1, medRatio('search_calls'))}; all bugs ${fmt(sum('search_calls', 0), 1)} vs ${fmt(sum('search_calls', 1), 1)}.`);
lines.push(`- **Tool calls:** typical bug ${pct(1, medRatio('tool_calls'))}. Of the Darnly runs' calls, ${fmt(sum('bookkeeping_calls', 1), 1)} in total were Darnly's own steps (loading the skill, reading the report, noting the fix, moving it to done/).`);
lines.push(`- **Really fixed (checked in a browser):** ${fixedP} of ${runsP} plain runs, ${fixedD} of ${runsD} Darnly runs.`);
const p = signTestP(costWins, perBug.length);
lines.push(`- **Could this be luck?** If Darnly made no difference, being cheaper on ${costWins} or more of ${perBug.length} bugs happens by chance ${fmt(p * 100, 1)}% of the time. ${p < 0.05 ? 'That is under 5%, so the cost difference is unlikely to be luck.' : 'That is not under 5%, so do not claim a cost saving from this run alone.'}`);
lines.push('');

lines.push('## Per bug (median of repeats; plain → Darnly)', '');
lines.push('| Bug | Kind | Cost | Tokens | Tool calls | Searches | Reads | Darnly steps | Fixed | Asked instead of fixing |');
lines.push('|---|---|---|---|---|---|---|---|---|---|');
for (const b of perBug) {
  const cell = (k, d) => `${fmt(b[k][0], d)} → ${fmt(b[k][1], d)}`;
  lines.push(`| ${b.bug} | ${b.kind} | ${cell('cost_usd', 3)} (${pct(b.cost_usd[0], b.cost_usd[1])}) | ${cell('total_tokens')} (${pct(b.total_tokens[0], b.total_tokens[1])}) | ${cell('tool_calls', 1)} | ${cell('search_calls', 1)} | ${cell('file_reads', 1)} | ${fmt(b.bookkeeping_calls[1], 1)} | ${b.fixed[0]}/${b.n[0]} → ${b.fixed[1]}/${b.n[1]} | ${b.asked[0]} → ${b.asked[1]} |`);
}
lines.push('');

const ro = rows.filter((r) => r.condition === 'report-only');
if (ro.length) {
  lines.push('## Report only (no Darnly setup or workflow)', '');
  lines.push('Same report, but the prompt just points at the file, with no skill, no AGENTS.md and no moving files to done/. The gap between this and "darnly" is what the workflow costs.', '');
  lines.push('| Bug | Cost plain → report only → darnly | Tool calls plain → report only → darnly |');
  lines.push('|---|---|---|');
  for (const b of perBug) {
    const r = ro.filter((x) => x.bug === b.bug);
    if (!r.length) continue;
    lines.push(`| ${b.bug} | ${fmt(b.cost_usd[0], 3)} → ${fmt(median(r.map((x) => num(x, 'cost_usd'))), 3)} → ${fmt(b.cost_usd[1], 3)} | ${fmt(b.tool_calls[0], 1)} → ${fmt(median(r.map((x) => num(x, 'tool_calls'))), 1)} → ${fmt(b.tool_calls[1], 1)} |`);
  }
  lines.push('');
}

const kinds = [...new Set(perBug.map((b) => b.kind))];
lines.push('## By kind of bug (median per-bug change in cost)', '');
for (const k of kinds) {
  const bs = perBug.filter((b) => b.kind === k);
  lines.push(`- ${k} (${bs.length} bugs): ${pct(1, median(bs.map((b) => b.cost_usd[1] / b.cost_usd[0])))}`);
}
lines.push('');
lines.push('## Read before quoting these numbers', '');
lines.push('- One small demo app (about 30 files) and bugs we planted ourselves. Real projects are bigger, which usually makes searching cost more, but we have not measured that.');
lines.push('- Every run is a single non-interactive Claude Code session. The agent cannot ask a follow-up question, so "asked instead of fixing" counts runs that ended with a question and no change.');
lines.push('- Darnly reports were captured on localhost from a React dev build, where Darnly can name the source file. On a live, built site it cannot, and the saving is likely smaller.');
lines.push('- The plain prompt is the same sentence the user typed into Darnly, with no screenshot. A user who pastes a screenshot or names the file would be a stronger baseline.');
lines.push('- The agent runs with a fixed list of allowed commands. Some commands (for example `mv` with a wildcard) are refused and the agent retries; that costs calls and is counted as failed_calls in results.csv.');
lines.push('- Cost uses Claude Code\'s own price estimate. Cache reads are cheap, so "tokens" can move differently from cost.');
fs.writeFileSync(path.join(dir, 'summary.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log(`\nSaved: ${path.relative(process.cwd(), path.join(dir, 'summary.md'))}`);
