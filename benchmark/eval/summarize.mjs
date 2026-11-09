// Turns runs/<dir>/results.jsonl into summary.md and results.csv in the same folder.
// Usage: node summarize.mjs runs/<dir>
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? '');
const file = path.join(dir, 'results.jsonl');
if (!fs.existsSync(file)) throw new Error(`No results.jsonl in ${dir}`);
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));

const CONDS = ['text', 'screenshot', 'darnly'].filter((c) => rows.some((r) => r.condition === c));
const NAME = { text: 'Text only', screenshot: 'Screenshot + text', darnly: 'Darnly report' };
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');

// Exact two-sided sign test on discordant pairs.
function signTest(wins, losses) {
  const n = wins + losses;
  if (!n) return 1;
  const k = Math.min(wins, losses);
  let p = 0;
  let c = 1;
  for (let i = 0; i <= n; i++) {
    if (i > 0) c = (c * (n - i + 1)) / i;
    if (i <= k) p += c;
  }
  return Math.min(1, (2 * p) / 2 ** n);
}

const groups = {};
for (const r of rows) (groups[`${r.model}|${r.note}`] ??= []).push(r);

let md = `# Does a Darnly report help the agent fix the bug? Results\n\n`;
md += `Models: ${settings.models.join(', ')}. Effort: ${settings.effort}. Notes: ${settings.notes.join(', ')}. ${rows.length} runs, $${rows.reduce((s, r) => s + (r.cost ?? 0), 0).toFixed(2)} spent.${settings.mock ? ' **MOCK RUN (no API calls), numbers are not real.**' : ''}\n\n`;
md += `"Fixed" means a real browser test passed after the agent's change. For some bugs the test also checks that the fix did not change things it shouldn't (counted under "wrong scope").\n\n`;

for (const [g, rs] of Object.entries(groups)) {
  const [model, note] = g.split('|');
  md += `## ${model}, ${note} notes\n\n`;
  md += `| | ${CONDS.map((c) => NAME[c]).join(' | ')} |\n|---|${CONDS.map(() => '---').join('|')}|\n`;
  const by = (c) => rs.filter((r) => r.condition === c);
  const line = (label, f) => (md += `| ${label} | ${CONDS.map((c) => f(by(c))).join(' | ')} |\n`);
  line('Fixed (browser test)', (x) => `${x.filter((r) => r.fixed).length} of ${x.length} (${pct(x.filter((r) => r.fixed).length, x.length)})`);
  line('Wrong scope (changed other things too)', (x) => String(x.filter((r) => r.wrongScope).length));
  line('Edited the file with the bug', (x) => pct(x.filter((r) => r.editedRightFile).length, x.length));
  line('Gave up / ran out of turns', (x) => String(x.filter((r) => r.end !== 'finish' && r.end !== 'stopped').length));
  line('Cost per bug (avg)', (x) => `$${fmt(mean(x.map((r) => r.cost)), 3)}`);
  line('Turns per bug (avg)', (x) => fmt(mean(x.map((r) => r.turns ?? 0))));
  line('Searches + file reads + listings (avg)', (x) => fmt(mean(x.map((r) => (r.searches ?? 0) + (r.reads ?? 0) + (r.lists ?? 0)))));
  line('Files changed (avg)', (x) => fmt(mean(x.map((r) => r.changed?.length ?? 0))));
  md += '\n';

  for (const kind of [...new Set(rs.map((r) => r.kind))].sort()) {
    md += `- ${kind}: ` + CONDS.map((c) => {
      const x = by(c).filter((r) => r.kind === kind);
      return `${NAME[c]} ${x.filter((r) => r.fixed).length}/${x.length}`;
    }).join(', ') + '\n';
  }
  md += '\n';

  // Paired comparisons: same bug, same rep.
  const key = (r) => `${r.bug}|${r.rep}`;
  const idx = Object.fromEntries(CONDS.map((c) => [c, Object.fromEntries(by(c).map((r) => [key(r), r]))]));
  for (const other of CONDS.filter((c) => c !== 'darnly')) {
    if (!idx.darnly) continue;
    let wins = 0;
    let losses = 0;
    const winBugs = [];
    const lossBugs = [];
    for (const [k, d] of Object.entries(idx.darnly)) {
      const o = idx[other][k];
      if (!o) continue;
      if (d.fixed && !o.fixed) wins++, winBugs.push(d.bug);
      if (!d.fixed && o.fixed) losses++, lossBugs.push(d.bug);
    }
    md += `Darnly vs ${NAME[other].toLowerCase()}: Darnly fixed ${wins} that the other missed${winBugs.length ? ` (${winBugs.join(', ')})` : ''}; missed ${losses} that the other fixed${lossBugs.length ? ` (${lossBugs.join(', ')})` : ''}. Sign test p = ${fmt(signTest(wins, losses), 2)}${signTest(wins, losses) < 0.05 ? ' (unlikely to be chance)' : ' (could be chance)'}.\n\n`;
  }
}

md += `## Every run that was not fixed\n\n| Model | Note | Bug | Way | Why |\n|---|---|---|---|---|\n`;
for (const r of rows.filter((r) => !r.fixed)) md += `| ${r.model} | ${r.note} | ${r.bug} | ${r.condition} | ${(r.why ?? r.end ?? '').replace(/\|/g, '/')} |\n`;

fs.writeFileSync(path.join(dir, 'summary.md'), md);
const cols = ['model', 'note', 'bug', 'kind', 'condition', 'rep', 'fixed', 'wrongScope', 'editedRightFile', 'end', 'turns', 'searches', 'reads', 'lists', 'edits', 'input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'cost', 'seconds', 'why', 'summary'];
const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? '')).join(','))).join('\n');
fs.writeFileSync(path.join(dir, 'results.csv'), csv);
console.log(md);
