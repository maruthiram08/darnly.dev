// The eval: does a Darnly report help a coding agent fix the right thing?
//
// For every bug, the same agent (Claude through the API, with tools to list, search, read and edit the
// app's files) gets the bug three ways, each in a fresh copy of the app with only that bug planted:
//   text:       the user's note, typed into the chat. Nothing else.
//   screenshot: the same note plus a plain screenshot of the window (what people paste today).
//   darnly:     the Darnly report for the same note (the .md as the agent reads it, plus the PNG with
//               the red box; the logs file sits in .darnly/inbox/ for the agent to open).
// Each way is run with two notes: "clear" (a careful sentence) and "short" (what a hurried user types).
// Then a real browser checks whether the bug is fixed (and, for some bugs, that nothing else changed).
//
// Usage (from benchmark/eval, after npm install):
//   DARNLY_TEST_ANTHROPIC_KEY=... node run.mjs [--models sonnet,haiku] [--notes clear,short]
//        [--conditions text,screenshot,darnly] [--bugs b01-place-order,...] [--reps 1]
//        [--budget 35] [--concurrency 4] [--effort medium] [--workspace <id>] [--captures captures-v2] [--resume runs/<dir>] [--mock]
// --mock runs everything without the API: a fake agent that applies the known fix, to test the harness.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { BUGS } from './bugs.mjs';
import { makeWorkspace, changedFiles, diff } from './workspace.mjs';
import { loadPlaywright } from '../lib/playwright.mjs';
import { startApp } from '../lib/devserver.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean),
);

// Prices in $ per million tokens (input, output, cache read, cache write 5 min).
const MODELS = {
  sonnet: { id: 'claude-sonnet-5-5', price: [2, 10, 0.2, 2.5] },
  haiku: { id: 'claude-haiku-5-5', price: [0.1, 0.5, 0.01, 0.125] },
  opus: { id: 'claude-opus-5-5', price: [4, 20, 0.2, 5] },
};
const models = String(args.models ?? 'sonnet,haiku').split(',');
const notes = String(args.notes ?? 'clear,short').split(',');
const conditions = String(args.conditions ?? 'text,screenshot,darnly').split(',');
const bugIds = args.bugs ? String(args.bugs).split(',') : BUGS.map((b) => b.id);
const reps = Number(args.reps ?? 1);
const budget = Number(args.budget ?? 35);
const concurrency = Number(args.concurrency ?? 4);
const effort = String(args.effort ?? 'medium');
const mock = !!args.mock;
const MAX_TURNS = 30;
for (const m of models) if (!MODELS[m]) throw new Error(`Unknown model ${m} (use ${Object.keys(MODELS).join(', ')})`);
for (const c of conditions) if (!['text', 'screenshot', 'darnly'].includes(c)) throw new Error(`Unknown condition ${c}`);
for (const id of bugIds) if (!BUGS.some((b) => b.id === id)) throw new Error(`Unknown bug ${id}`);

// --captures captures-v2 uses another set of reports (made by capture.mjs with DARNLY_EVAL_CAPTURES).
const capturesDir = path.join(here, String(args.captures ?? 'captures'));
for (const id of bugIds) if (!fs.existsSync(path.join(capturesDir, id, 'screenshot.png'))) throw new Error(`No captures for ${id}: run capture.mjs first`);

let client;
if (!mock) {
  const apiKey = process.env.DARNLY_TEST_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Set DARNLY_TEST_ANTHROPIC_KEY (or ANTHROPIC_API_KEY)');
  // baseURL is explicit: some environments set ANTHROPIC_BASE_URL for other tools.
  // Some keys need the workspace named on every call: --workspace <id> or DARNLY_TEST_ANTHROPIC_WORKSPACE_ID.
  const workspace = args.workspace ?? process.env.DARNLY_TEST_ANTHROPIC_WORKSPACE_ID ?? process.env.ANTHROPIC_WORKSPACE_ID;
  client = new Anthropic({
    apiKey,
    baseURL: 'https://api.anthropic.com',
    maxRetries: 6,
    timeout: 10 * 60 * 1000,
    defaultHeaders: workspace ? { 'anthropic-workspace-id': String(workspace) } : undefined,
  });
}

const outDir = args.resume ? path.resolve(String(args.resume)) : path.join(here, 'runs', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
fs.mkdirSync(path.join(outDir, 'transcripts'), { recursive: true });
const resultsPath = path.join(outDir, 'results.jsonl');
const done = new Map();
if (fs.existsSync(resultsPath)) {
  for (const line of fs.readFileSync(resultsPath, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    done.set(r.key, r);
  }
}
let spent = [...done.values()].reduce((s, r) => s + (r.cost ?? 0), 0);
fs.writeFileSync(
  path.join(outDir, 'settings.json'),
  JSON.stringify({ captures: path.basename(capturesDir), models: models.map((m) => MODELS[m].id), notes, conditions, bugIds, reps, budget, effort, mock, maxTurns: MAX_TURNS, started: new Date().toISOString() }, null, 2),
);

// ---------------------------------------------------------------- the agent's tools

const SYSTEM = `You are a coding agent working in a web app's repository (React + Vite, TypeScript). The user reports a bug in their app. Find the cause in the code and fix it with the tools. The user is away, so don't ask questions: make the best fix you can. Keep the change to what the bug needs. The app is not running and you can't open a browser. When you are done, call finish with one line on what you changed.`;

const TOOLS = [
  {
    name: 'list_files',
    description: 'List files under a folder of the repository (recursive, skips node_modules and .git).',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Folder, relative to the repo root. Use "." for the root.' } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'search',
    description: 'Search file contents with a JavaScript regular expression. Returns matching lines as path:line: text (max 80).',
    input_schema: {
      type: 'object',
      properties: { pattern: { type: 'string' }, path: { type: 'string', description: 'Folder or file to search, relative to the repo root. Default ".".' } },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_file',
    description: 'Read a text file, with line numbers.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact piece of text in a file. old_text must appear exactly once. To create a new file, use an empty old_text and a path that does not exist.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } },
      required: ['path', 'old_text', 'new_text'],
      additionalProperties: false,
    },
  },
  {
    name: 'finish',
    description: 'Call when the fix is done (or you cannot fix it). One line on what you changed.',
    input_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false },
  },
];

function inside(root, p) {
  const full = path.resolve(root, String(p ?? '.'));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('path is outside the repository');
  return full;
}

function walk(root, dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(root, full, out);
    else out.push(path.relative(root, full));
  }
  return out;
}

function runTool(root, name, input, stats) {
  switch (name) {
    case 'list_files': {
      stats.lists++;
      const dir = inside(root, input.path);
      return walk(root, dir).sort().join('\n') || '(empty)';
    }
    case 'search': {
      stats.searches++;
      const re = new RegExp(input.pattern);
      const start = inside(root, input.path ?? '.');
      const files = fs.statSync(start).isDirectory() ? walk(root, start) : [path.relative(root, start)];
      const hits = [];
      for (const f of files) {
        if (/\.(png|jpg|svg|ico|lock)$/.test(f) || f.endsWith('package-lock.json')) continue;
        const lines = fs.readFileSync(path.join(root, f), 'utf8').split('\n');
        lines.forEach((l, i) => re.test(l) && hits.push(`${f}:${i + 1}: ${l.slice(0, 200)}`));
        if (hits.length > 80) break;
      }
      return hits.slice(0, 80).join('\n') || 'No matches.';
    }
    case 'read_file': {
      stats.reads++;
      const p = inside(root, input.path);
      if (/\.png$/.test(p)) return '(binary image file; the report image is already in the conversation)';
      return fs
        .readFileSync(p, 'utf8')
        .split('\n')
        .map((l, i) => `${String(i + 1).padStart(4)}  ${l}`)
        .join('\n');
    }
    case 'edit_file': {
      stats.edits++;
      const p = inside(root, input.path);
      if (input.old_text === '') {
        if (fs.existsSync(p)) throw new Error('file exists; give old_text to edit it');
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, input.new_text);
        return 'Created.';
      }
      const text = fs.readFileSync(p, 'utf8');
      const n = text.split(input.old_text).length - 1;
      if (n !== 1) throw new Error(`old_text found ${n} times; it must appear exactly once`);
      fs.writeFileSync(p, text.replace(input.old_text, () => input.new_text));
      return 'Edited.';
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

// ---------------------------------------------------------------- one run

function reportFiles(bugId, note) {
  const dir = path.join(capturesDir, bugId, note);
  const names = fs.readdirSync(dir);
  return { dir, names, md: names.find((n) => n.endsWith('.md')), png: names.find((n) => n.endsWith('.png')) };
}

const image = (file) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: fs.readFileSync(file).toString('base64') } });

function firstMessage(bug, condition, note, root) {
  const said = note === 'clear' ? bug.note : bug.short;
  if (condition === 'text') return [{ type: 'text', text: said }];
  if (condition === 'screenshot') return [image(path.join(capturesDir, bug.id, 'screenshot.png')), { type: 'text', text: said }];
  // darnly: the report files go where Darnly saves them, and the agent gets the report and its picture.
  const r = reportFiles(bug.id, note);
  const inbox = path.join(root, '.darnly', 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  for (const n of r.names) fs.copyFileSync(path.join(r.dir, n), path.join(inbox, n));
  const md = fs.readFileSync(path.join(r.dir, r.md), 'utf8');
  return [
    image(path.join(r.dir, r.png)),
    { type: 'text', text: `Fix this bug from my Darnly inbox (.darnly/inbox/${r.md}):\n\n${md}` },
  ];
}

function cost(model, u) {
  const [i, o, cr, cw] = MODELS[model].price;
  return ((u.input_tokens ?? 0) * i + (u.output_tokens ?? 0) * o + (u.cache_read_input_tokens ?? 0) * cr + (u.cache_creation_input_tokens ?? 0) * cw) / 1e6;
}

// A stand-in for the API used by --mock: reads the planted file, applies the known fix, finishes.
function mockResponse(bug, messages) {
  const step = messages.filter((m) => m.role === 'assistant').length;
  const plant = bug.plant;
  const use = (name, input) => ({ id: `t${step}_${name}`, type: 'tool_use', name, input });
  const content =
    step === 0
      ? [use('search', { pattern: 'x', path: 'src' }), use('read_file', { path: plant[0].file })]
      : step <= plant.length
        ? [use('edit_file', { path: plant[step - 1].file, old_text: plant[step - 1].buggy, new_text: plant[step - 1].clean })]
        : [use('finish', { summary: 'mock fix' })];
  return { content, stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 100 } };
}

async function agent(bug, model, condition, note, root, transcript) {
  const messages = [{ role: 'user', content: firstMessage(bug, condition, note, root) }];
  const stats = { turns: 0, lists: 0, searches: 0, reads: 0, edits: 0, toolErrors: 0 };
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let end = 'max_turns';
  let summary = '';
  let dollars = 0;
  while (stats.turns < MAX_TURNS) {
    stats.turns++;
    const res = mock
      ? mockResponse(bug, messages)
      : await client.messages.create({
          model: MODELS[model].id,
          max_tokens: 16000,
          system: SYSTEM,
          tools: TOOLS,
          thinking: { type: 'adaptive' },
          output_config: { effort },
          cache_control: { type: 'ephemeral' },
          messages,
        });
    for (const k of Object.keys(usage)) usage[k] += res.usage?.[k] ?? 0;
    const c = cost(model, res.usage ?? {});
    dollars += c;
    spent += c;
    messages.push({ role: 'assistant', content: res.content });
    transcript.push({ role: 'assistant', stop: res.stop_reason, content: res.content.map((b) => (b.type === 'thinking' ? { type: 'thinking' } : b)) });
    if (res.stop_reason === 'refusal') {
      end = 'refusal';
      break;
    }
    const uses = res.content.filter((b) => b.type === 'tool_use');
    if (!uses.length) {
      end = res.stop_reason === 'max_tokens' ? 'max_tokens' : 'stopped';
      summary = res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').slice(0, 300);
      break;
    }
    // Tools run first. A finish sent in the same turn as a failed tool call doesn't count: the model
    // often sends edit + finish together, and ending there would grade an edit it never saw fail.
    let finished = false;
    let failed = false;
    const out = new Map();
    for (const u of uses.filter((u) => u.name !== 'finish')) {
      try {
        out.set(u.id, { type: 'tool_result', tool_use_id: u.id, content: runTool(root, u.name, u.input ?? {}, stats).slice(0, 40000) });
      } catch (e) {
        stats.toolErrors++;
        failed = true;
        out.set(u.id, { type: 'tool_result', tool_use_id: u.id, content: `Error: ${e.message}`, is_error: true });
      }
    }
    for (const u of uses.filter((u) => u.name === 'finish')) {
      if (failed) {
        stats.finishRejected = (stats.finishRejected ?? 0) + 1;
        out.set(u.id, { type: 'tool_result', tool_use_id: u.id, content: 'Not finished: another tool call in this turn failed. Look at its error, then finish again.', is_error: true });
      } else {
        finished = true;
        summary = String(u.input?.summary ?? '').slice(0, 300);
        out.set(u.id, { type: 'tool_result', tool_use_id: u.id, content: 'OK' });
      }
    }
    const results = uses.map((u) => out.get(u.id));
    messages.push({ role: 'user', content: results });
    transcript.push({ role: 'tools', content: results.map((r) => ({ ...r, content: String(r.content).slice(0, 2000) })) });
    if (finished) {
      end = 'finish';
      break;
    }
  }
  return { stats, usage, cost: dollars, end, summary };
}

// ---------------------------------------------------------------- grading

const { chromium } = loadPlaywright();
const browser = await chromium.launch();

async function grade(root, bug) {
  let app;
  try {
    app = await startApp(root);
  } catch (e) {
    return { fixed: false, why: 'app does not start: ' + String(e.message).split('\n')[0].slice(0, 160) };
  }
  try {
    // Warm up Vite (the first page load compiles everything), then run the check. A failed check is
    // tried again so a slow machine can't turn a fixed bug into a "not fixed"; a real failure fails twice.
    let last;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      const page = await ctx.newPage();
      try {
        if (attempt === 0) {
          await page.goto(app.base + '/', { timeout: 30000 });
          await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        }
        await bug.check(page, app.base);
        return { fixed: true, attempts: attempt + 1 };
      } catch (e) {
        const why = String(e.message).split('\n')[0].slice(0, 200);
        last = { fixed: false, why, wrongScope: why.startsWith('guard:') };
        if (last.wrongScope) break;
      } finally {
        await ctx.close();
      }
    }
    return last;
  } finally {
    app.stop();
  }
}

// ---------------------------------------------------------------- the queue

// Jobs are ordered so the three conditions of a bug run together: if the budget runs out, the
// summary can still compare complete sets.
const jobs = [];
for (let rep = 1; rep <= reps; rep++)
  for (const model of models)
    for (const note of notes)
      for (const id of bugIds)
        for (const condition of conditions) jobs.push({ key: `${model}|${note}|${id}|${condition}|${rep}`, model, note, bug: BUGS.find((b) => b.id === id), condition, rep });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darnly-eval-'));
let stopped = false;
let n = 0;
const todo = jobs.filter((j) => !done.has(j.key));
console.log(`${jobs.length} runs planned, ${jobs.length - todo.length} already done, budget $${budget}, spent so far $${spent.toFixed(2)}. Results: ${outDir}`);

async function worker() {
  while (todo.length && !stopped) {
    if (spent >= budget) {
      if (!stopped) console.log(`Budget of $${budget} reached ($${spent.toFixed(2)}). Stopping; rerun with --resume ${outDir} and a higher --budget to continue.`);
      stopped = true;
      break;
    }
    const job = todo.shift();
    const root = makeWorkspace(path.join(tmp, job.key.replace(/\|/g, '_')), job.bug.id);
    const transcript = [];
    const t0 = Date.now();
    let run;
    try {
      run = await agent(job.bug, job.model, job.condition, job.note, root, transcript);
    } catch (e) {
      run = { stats: {}, usage: {}, cost: 0, end: 'api_error', summary: String(e.message).slice(0, 300) };
    }
    const changed = changedFiles(root);
    const plantFiles = [...new Set(job.bug.plant.map((p) => p.file))];
    const g = run.end === 'api_error' ? { fixed: false, why: 'api error' } : await grade(root, job.bug);
    const result = {
      key: job.key,
      model: job.model,
      note: job.note,
      bug: job.bug.id,
      kind: job.bug.kind,
      condition: job.condition,
      rep: job.rep,
      fixed: g.fixed,
      why: g.why ?? null,
      wrongScope: !!g.wrongScope,
      end: run.end,
      editedRightFile: plantFiles.some((f) => changed.includes(f)),
      changed,
      ...run.stats,
      ...run.usage,
      cost: run.cost,
      seconds: Math.round((Date.now() - t0) / 1000),
      summary: run.summary,
    };
    fs.writeFileSync(path.join(outDir, 'transcripts', job.key.replace(/\|/g, '_') + '.json'), JSON.stringify({ result, diff: diff(root), transcript }, null, 1));
    fs.appendFileSync(resultsPath, JSON.stringify(result) + '\n');
    fs.rmSync(root, { recursive: true, force: true });
    n++;
    console.log(
      `[${n}/${todo.length + n}] ${result.fixed ? 'FIXED ' : 'BROKEN'} ${job.model.padEnd(6)} ${job.note.padEnd(5)} ${job.bug.id.padEnd(24)} ${job.condition.padEnd(10)} ${String(result.turns ?? 0).padStart(2)} turns $${result.cost.toFixed(3)}  total $${spent.toFixed(2)}${result.fixed ? '' : '  (' + (result.why ?? result.end) + ')'}`,
    );
  }
}

try {
  await Promise.all(Array.from({ length: concurrency }, worker));
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`Done. Spent $${spent.toFixed(2)}. Now: node summarize.mjs ${path.relative(process.cwd(), outDir)}`);
