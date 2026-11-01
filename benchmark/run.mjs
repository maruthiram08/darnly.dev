// Runs the benchmark: each bug, fixed twice by Claude Code in a fresh session,
// once from the plain description and once from the Darnly report. Records tool calls,
// tokens, cost, time, and whether the bug is really fixed (checked in a browser).
//
// Usage (from the benchmark folder):
//   node run.mjs                         all 10 bugs x 2 ways x 3 repeats (60 runs)
//   node run.mjs --reps 1                one repeat (20 runs), a quick first look
//   node run.mjs --bugs b01-place-order,b07-orders-empty --reps 1
//   node run.mjs --model sonnet          pick the model (default: your Claude Code default)
//
// Results go to runs/<date-time>/: results.csv (one row per run) and transcripts/.
// Then: node summarize.mjs   (writes summary.md next to results.csv)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { BUGS } from './bugs.mjs';
import { runChecks } from './check.mjs';
import { loadPlaywright } from './lib/playwright.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] == null ? 'true' : all[i + 1]]] : acc), []),
);
const reps = Number(args.reps ?? 3);
const bugIds = args.bugs ? args.bugs.split(',') : BUGS.map((b) => b.id);
const conditions = (args.conditions ?? 'plain,darnly').split(',');
const model = args.model;
const timeoutMin = Number(args.timeout ?? 15);
const claudeBin = args.claude ?? 'claude';

// The words the user types in each condition. The bug note is identical in both; see bugs.mjs.
const DARNLY_PROMPT = 'fix my bugs';
// Optional third way (--conditions plain,darnly,report-only): the report alone, without Darnly's
// setup files and workflow. Separates what the report itself saves from what the workflow costs.
const reportOnlyPrompt = (bug) => {
  const md = fs.readdirSync(path.join(here, 'reports', bug.id)).find((f) => f.endsWith('.md'));
  return `Fix the bug described in .darnly/inbox/${md}`;
};

// Tools the agent may use without asking. Anything else is denied (and counted), the same in both conditions.
const ALLOWED = [
  'Read', 'Edit', 'MultiEdit', 'Write', 'Glob', 'Grep', 'Skill', 'TodoWrite',
  'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(grep:*)', 'Bash(rg:*)', 'Bash(find:*)', 'Bash(wc:*)',
  'Bash(mv:*)', 'Bash(mkdir:*)', 'Bash(sed:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)',
  'Bash(npx tsc:*)', 'Bash(npm run build:*)',
];

const appDir = path.join(here, 'app');
if (!fs.existsSync(path.join(appDir, 'node_modules'))) {
  console.log('Installing the sample app once (npm install in benchmark/app)…');
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: appDir, stdio: 'inherit' });
}
for (const id of bugIds) {
  if (!BUGS.find((b) => b.id === id)) throw new Error(`Unknown bug id: ${id}`);
  for (const c of conditions) if (!['plain', 'darnly', 'report-only'].includes(c)) throw new Error(`Unknown way: ${c} (use plain, darnly, report-only)`);
  if (conditions.some((c) => c !== 'plain') && !fs.existsSync(path.join(here, 'reports', id))) throw new Error(`No Darnly report for ${id} in reports/`);
}

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const outDir = path.join(here, 'runs', stamp);
const workRoot = path.join(outDir, 'work');
fs.mkdirSync(path.join(outDir, 'transcripts'), { recursive: true });
const csvPath = path.join(outDir, 'results.csv');
const COLUMNS = [
  'bug', 'kind', 'condition', 'rep', 'fixed', 'fixed_why', 'asked_question', 'files_changed',
  'tool_calls', 'search_calls', 'file_reads', 'edits', 'failed_calls', 'bookkeeping_calls', 'turns',
  'input_tokens', 'cache_write_tokens', 'cache_read_tokens', 'output_tokens', 'total_tokens', 'new_tokens',
  'cost_usd', 'seconds', 'model', 'error',
];
fs.writeFileSync(csvPath, COLUMNS.join(',') + '\n');
fs.writeFileSync(path.join(outDir, 'settings.json'), JSON.stringify({ reps, bugIds, conditions, model: model ?? 'default', allowed: ALLOWED, darnlyPrompt: DARNLY_PROMPT, started: new Date().toISOString() }, null, 2));

const csv = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function copyApp(dest) {
  fs.cpSync(appDir, dest, { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules`) && !src.endsWith(`${path.sep}dist`) });
  fs.symlinkSync(path.join(appDir, 'node_modules'), path.join(dest, 'node_modules'), 'dir');
}

function git(dir, ...a) {
  return execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

function prepare(bug, condition, rep) {
  const dir = path.join(workRoot, `${bug.id}-${condition}-r${rep}`);
  copyApp(dir);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\ndist\n');
  if (condition === 'darnly') {
    // What "Set up this project" adds, committed like in a real project.
    fs.cpSync(path.join(here, 'reports', '_setup'), dir, { recursive: true });
  }
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.email=bench@example.com', '-c', 'user.name=bench', 'commit', '-qm', 'Pebble Store');
  if (condition !== 'plain') {
    // The capture itself: gitignored, like Darnly's own .darnly/.gitignore does.
    const inbox = path.join(dir, '.darnly', 'inbox');
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(dir, '.darnly', '.gitignore'), '*\n');
    fs.cpSync(path.join(here, 'reports', bug.id), inbox, { recursive: true });
  }
  return dir;
}

function runClaude(dir, prompt, transcriptPath) {
  return new Promise((resolve) => {
    const a = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
      '--allowedTools', ALLOWED.join(','), '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence'];
    if (model) a.push('--model', model);
    const child = spawn(claudeBin, a, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = fs.createWriteStream(transcriptPath);
    let stderr = '';
    let buf = '';
    const events = [];
    child.stdout.on('data', (d) => {
      out.write(d);
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) try { events.push(JSON.parse(line)); } catch { /* not json */ }
      }
    });
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMin * 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      out.end();
      resolve({ events, code, stderr });
    });
  });
}

const SEARCH_BASH = /(^|[\s|;&(])(grep|rg|find|ls|ag|fd)\s/;

function measure(events) {
  const m = { tool_calls: 0, search_calls: 0, file_reads: 0, edits: 0, failed_calls: 0, bookkeeping_calls: 0 };
  let finalText = '';
  for (const e of events) {
    if (e.type === 'assistant') {
      for (const c of e.message?.content ?? []) {
        if (c.type !== 'tool_use') continue;
        m.tool_calls++;
        // Darnly's own steps: loading the skill, reading the report, writing the Fixed line, moving files to done/.
        // Those are counted apart, so searches and reads below are about finding the code.
        if (c.name === 'Skill' || JSON.stringify(c.input ?? {}).includes('.darnly')) {
          m.bookkeeping_calls++;
          continue;
        }
        if (c.name === 'Grep' || c.name === 'Glob' || (c.name === 'Bash' && SEARCH_BASH.test(' ' + (c.input?.command ?? '')))) m.search_calls++;
        if (c.name === 'Read' || (c.name === 'Bash' && /(^|\s)(cat|head|tail)\s/.test(c.input?.command ?? ''))) m.file_reads++;
        if (['Edit', 'MultiEdit', 'Write'].includes(c.name)) m.edits++;
      }
    }
    if (e.type === 'user') {
      for (const c of e.message?.content ?? []) {
        if (c.type === 'tool_result' && c.is_error) m.failed_calls++;
      }
    }
  }
  const result = events.findLast((e) => e.type === 'result');
  const u = result?.usage ?? {};
  finalText = result?.result ?? '';
  const modelName = Object.keys(result?.modelUsage ?? {}).join('+') || events.find((e) => e.type === 'system')?.model || '';
  return {
    ...m,
    turns: result?.num_turns ?? '',
    input_tokens: u.input_tokens ?? '',
    cache_write_tokens: u.cache_creation_input_tokens ?? '',
    cache_read_tokens: u.cache_read_input_tokens ?? '',
    output_tokens: u.output_tokens ?? '',
    total_tokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0),
    // Tokens not served from cache: what the session added on top of what was already cached.
    new_tokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0),
    cost_usd: result?.total_cost_usd != null ? result.total_cost_usd.toFixed(4) : '',
    seconds: result?.duration_ms != null ? Math.round(result.duration_ms / 1000) : '',
    model: modelName,
    error: result?.is_error ? (result.subtype ?? 'error') : result ? '' : 'no result',
    finalText,
  };
}

// Run order is shuffled within each repeat, so neither way always goes first.
const jobs = [];
for (let rep = 1; rep <= reps; rep++) {
  const round = [];
  for (const id of bugIds) for (const c of conditions) round.push({ bug: BUGS.find((b) => b.id === id), condition: c, rep });
  round.sort(() => Math.random() - 0.5);
  jobs.push(...round);
}

console.log(`${jobs.length} runs. Results: ${path.relative(process.cwd(), csvPath)}`);
// Warm-up: the first session of a batch pays to cache Claude Code's own instructions.
// One throwaway session first, so the first real run isn't charged for that.
{
  const warm = path.join(workRoot, '_warmup');
  fs.mkdirSync(warm, { recursive: true });
  process.stdout.write('Warm-up session … ');
  const { events } = await runClaude(warm, 'Reply with the word ready.', path.join(outDir, 'transcripts', '_warmup.jsonl'));
  const r = events.findLast((e) => e.type === 'result');
  if (!r || r.is_error) {
    console.log('failed. Is Claude Code installed and signed in? Try running `claude` once.');
    process.exit(1);
  }
  console.log('ok');
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
let n = 0;
try {
  for (const { bug, condition, rep } of jobs) {
    n++;
    const dir = prepare(bug, condition, rep);
    const prompt = condition === 'darnly' ? DARNLY_PROMPT : condition === 'report-only' ? reportOnlyPrompt(bug) : bug.note;
    const label = `[${n}/${jobs.length}] ${bug.id} ${condition} #${rep}`;
    process.stdout.write(`${label} … `);
    const transcript = path.join(outDir, 'transcripts', `${bug.id}-${condition}-r${rep}.jsonl`);
    const { events, code, stderr } = await runClaude(dir, prompt, transcript);
    const m = measure(events);
    if (!events.length) m.error = `claude exited ${code}: ${stderr.trim().split('\n').pop()}`;
    const changed = git(dir, 'status', '--porcelain').split('\n').map((l) => l.slice(3).trim()).filter((f) => f && !f.startsWith('.darnly'));
    const check = (await runChecks(dir, [bug.id], { browser }))[bug.id];
    const asked = !changed.length && /\?\s*$|\?\s*\n/.test(m.finalText) ? 'yes' : 'no';
    const row = {
      bug: bug.id, kind: bug.kind, condition, rep, fixed: check.fixed ? 'yes' : 'no', fixed_why: check.why ?? '', asked_question: asked,
      files_changed: changed.join(' '), ...m,
    };
    fs.appendFileSync(csvPath, COLUMNS.map((c) => csv(row[c])).join(',') + '\n');
    console.log(`${check.fixed ? 'fixed' : 'NOT fixed'}, ${m.tool_calls} tool calls (${m.search_calls} searches), ${m.total_tokens} tokens, $${m.cost_usd || '?'}${m.error ? `, error: ${m.error}` : ''}`);
    if (!args.keep) fs.rmSync(dir, { recursive: true, force: true });
  }
} finally {
  await browser.close();
}
console.log(`\nDone. Now run: node summarize.mjs ${path.relative(here, outDir)}`);
