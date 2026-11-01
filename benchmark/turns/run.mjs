// Turns-to-fix benchmark: how many messages does it take a person to get a UI bug fixed,
// (a) pasting a screenshot with a short description, vs (b) capturing it with Darnly and saying "fix my bugs"?
//
// Each run is a real, multi-turn Claude Code conversation. After every agent turn the harness reloads the
// app in a browser and checks the bug and its scope (did the fix reach every place it should, and nowhere
// else?). If it isn't right yet, a simulated user (a small model playing a non-technical person who can only
// see the app) answers the agent's question or says what they see. Up to --max-messages user messages.
//
// Usage (from benchmark/turns, after `node setup.mjs`):
//   node run.mjs                          every bug x screenshot,darnly x 1 repeat
//   node run.mjs --reps 3 --model sonnet
//   node run.mjs --bugs x01-primary-colour,x04-dialog-close --conditions screenshot,darnly,text
// Then: node summarize.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startSession } from './lib/session.mjs';
import { countTools, sumUsage, endsWithQuestion } from './lib/measure.mjs';
import { simulatedUserReply } from './lib/user.mjs';
import * as app from './app/excalidraw.mjs';
import { BUGS } from './app/bugs.mjs';
import { loadPlaywright } from '../lib/playwright.mjs';
import { freePort } from '../lib/devserver.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] == null ? 'true' : all[i + 1]]] : acc), []),
);
const reps = Number(args.reps ?? 1);
const bugIds = args.bugs ? args.bugs.split(',') : BUGS.map((b) => b.id);
const conditions = (args.conditions ?? 'screenshot,darnly').split(',');
const model = args.model;
const userModel = args['user-model'] ?? 'haiku';
const maxMessages = Number(args['max-messages'] ?? 4);
const claudeBin = args.claude ?? 'claude';

const DARNLY_PROMPT = 'fix my bugs';
// The agent may read, search, edit and type-check. It may not run the app or a browser: the user does that.
const ALLOWED = [
  'Read', 'Edit', 'MultiEdit', 'Write', 'Glob', 'Grep', 'Skill', 'TodoWrite',
  'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(grep:*)', 'Bash(rg:*)', 'Bash(find:*)', 'Bash(wc:*)',
  'Bash(mv:*)', 'Bash(mkdir:*)', 'Bash(sed:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git grep:*)',
  'Bash(npx tsc:*)', 'Bash(yarn tsc:*)',
];

for (const id of bugIds) if (!BUGS.find((b) => b.id === id)) throw new Error(`Unknown bug id: ${id}`);
for (const c of conditions) if (!['screenshot', 'darnly', 'text'].includes(c)) throw new Error(`Unknown way: ${c} (use screenshot, darnly, text)`);
for (const id of bugIds) {
  const cap = path.join(here, 'captures', id);
  if (!fs.existsSync(path.join(cap, 'screenshot.png'))) throw new Error(`No captures for ${id}. Run: node capture.mjs`);
}
app.ensureBase();

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const outDir = path.join(here, 'runs', stamp);
const workRoot = path.join(outDir, 'work');
fs.mkdirSync(path.join(outDir, 'transcripts'), { recursive: true });
const csvPath = path.join(outDir, 'results.csv');
const COLUMNS = [
  'bug', 'kind', 'scope', 'condition', 'rep', 'fixed', 'scope_ok', 'fixed_at_message', 'user_messages', 'questions',
  'wrong_scope_turns', 'files_changed', 'tool_calls', 'search_calls', 'file_reads', 'edits', 'failed_calls', 'darnly_calls',
  'model_turns', 'input_tokens', 'cache_write_tokens', 'cache_read_tokens', 'output_tokens', 'total_tokens', 'new_tokens',
  'cost_usd', 'user_cost_usd', 'seconds', 'final_state', 'error',
];
fs.writeFileSync(csvPath, COLUMNS.join(',') + '\n');
fs.writeFileSync(path.join(outDir, 'settings.json'), JSON.stringify({ app: app.NAME, commit: app.COMMIT, reps, bugIds, conditions, model: model ?? 'default', userModel, maxMessages, allowed: ALLOWED, started: new Date().toISOString() }, null, 2));
const csv = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function firstMessage(bug, condition) {
  if (condition === 'darnly') return DARNLY_PROMPT;
  if (condition === 'text') return bug.note;
  // What a person does in the terminal: paste a screenshot, type the sentence.
  const png = fs.readFileSync(path.join(here, 'captures', bug.id, 'screenshot.png')).toString('base64');
  return [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }, { type: 'text', text: bug.note }];
}

function prepare(bug, condition, rep, port) {
  const dir = path.join(workRoot, `${bug.id}-${condition}-r${rep}`);
  app.prepareRun(bug, dir);
  if (condition === 'darnly') {
    // What "Set up this project" adds (AGENTS.md section and the skill), committed like in a real project.
    const setup = path.join(here, 'captures', '_setup');
    for (const f of fs.readdirSync(setup, { recursive: true })) {
      const src = path.join(setup, f);
      if (fs.statSync(src).isDirectory()) continue;
      const dest = path.join(dir, f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (f === 'AGENTS.md' && fs.existsSync(dest)) fs.appendFileSync(dest, '\n' + fs.readFileSync(src, 'utf8'));
      else fs.copyFileSync(src, dest);
    }
    app.commitAll(dir, 'Set up Darnly');
    // The capture itself, gitignored like Darnly's own .darnly/.gitignore.
    const inbox = path.join(dir, '.darnly', 'inbox');
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(dir, '.darnly', '.gitignore'), '*\n');
    const rep = path.join(here, 'captures', bug.id, 'darnly');
    // The capture was made in another folder on another port. In real use the report names the user's own
    // project folder and dev server, so point those at this run's folder and port.
    const capturedIn = path.join(here, 'runs', '_capture', 'excalidraw');
    for (const f of fs.readdirSync(rep)) {
      if (f.endsWith('.png')) fs.copyFileSync(path.join(rep, f), path.join(inbox, f));
      else fs.writeFileSync(path.join(inbox, f), fs.readFileSync(path.join(rep, f), 'utf8').split(capturedIn).join(dir).replace(/localhost:\d+/g, `localhost:${port}`));
    }
  }
  return dir;
}

const jobs = [];
for (let rep = 1; rep <= reps; rep++) {
  const round = [];
  for (const id of bugIds) for (const c of conditions) round.push({ bug: BUGS.find((b) => b.id === id), condition: c, rep });
  round.sort(() => Math.random() - 0.5);
  jobs.push(...round);
}
console.log(`${jobs.length} runs, up to ${maxMessages} user messages each. Results: ${path.relative(process.cwd(), csvPath)}`);

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
let n = 0;
try {
  for (const { bug, condition, rep } of jobs) {
    n++;
    const label = `[${n}/${jobs.length}] ${bug.id} ${condition} #${rep}`;
    console.log(label);
    const port = await freePort();
    const dir = prepare(bug, condition, rep, port);
    const server = await app.start(dir, port);
    const transcript = path.join(outDir, 'transcripts', `${bug.id}-${condition}-r${rep}.jsonl`);
    const dialogue = [];
    const session = startSession({ cwd: dir, model, allowedTools: ALLOWED, transcriptPath: transcript, claudeBin });
    const results = [];
    let msg = firstMessage(bug, condition);
    let userMessages = 1;
    let questions = 0;
    let wrongScopeTurns = 0;
    let userCost = 0;
    let state = { fixed: false, scopeOk: false, observations: [] };
    let fixedAt = '';
    let error = '';
    try {
      for (;;) {
        dialogue.push({ who: 'user', text: typeof msg === 'string' ? msg : `[screenshot] ${bug.note}` });
        const turn = await session.send(msg);
        if (!turn.result) {
          error = turn.error ?? 'no result';
          break;
        }
        results.push(turn.result);
        const text = turn.result.result ?? '';
        dialogue.push({ who: 'agent', text });
        const editedNow = countTools(turn.events).edits > 0;
        if (!editedNow && endsWithQuestion(text)) questions++;
        state = await app.check(browser, server.base, bug, dir);
        if (state.fixed && !state.scopeOk) wrongScopeTurns++;
        console.log(`   message ${userMessages}: ${state.fixed ? (state.scopeOk ? 'fixed' : 'fixed, wrong scope') : 'not fixed'}${!editedNow && endsWithQuestion(text) ? ' (agent asked a question)' : ''}`);
        if (state.fixed && state.scopeOk) {
          fixedAt = userMessages;
          break;
        }
        if (userMessages >= maxMessages) break;
        const reply = await simulatedUserReply({ bug, agentText: text, observations: state.observations, model: userModel, claudeBin, cwd: dir });
        userCost += reply.cost;
        msg = reply.text;
        userMessages++;
        console.log(`   user: ${msg.replace(/\s+/g, ' ').slice(0, 160)}`);
      }
    } catch (e) {
      error = String(e.message).slice(0, 200);
    } finally {
      await session.close();
      server.stop();
    }
    const tools = countTools(session.events);
    const usage = sumUsage(results);
    const changed = app.changedFiles(dir);
    const row = {
      bug: bug.id, kind: bug.kind, scope: bug.scope, condition, rep,
      fixed: state.fixed ? 'yes' : 'no', scope_ok: state.fixed && state.scopeOk ? 'yes' : 'no', fixed_at_message: fixedAt,
      user_messages: userMessages, questions, wrong_scope_turns: wrongScopeTurns, files_changed: changed.join(' '),
      ...tools, ...usage, user_cost_usd: userCost.toFixed(4), final_state: state.observations.join(' | '), error,
    };
    fs.appendFileSync(csvPath, COLUMNS.map((c) => csv(row[c])).join(',') + '\n');
    fs.writeFileSync(path.join(outDir, 'transcripts', `${bug.id}-${condition}-r${rep}.dialogue.md`),
      dialogue.map((d) => `**${d.who}:** ${d.text}`).join('\n\n') + `\n\n---\n${state.observations.join('\n')}\n\nFiles changed: ${changed.join(', ')}\n\n\`\`\`diff\n${app.diff(dir).slice(0, 20000)}\n\`\`\`\n`);
    console.log(`   => ${fixedAt ? `fixed at message ${fixedAt}` : 'NOT fixed'}, ${questions} question(s), ${tools.search_calls} searches, ${usage.total_tokens} tokens, $${usage.cost_usd}${error ? `, error: ${error}` : ''}`);
    if (!args.keep) fs.rmSync(dir, { recursive: true, force: true });
  }
} finally {
  await browser.close();
}
console.log(`\nDone. Now run: node summarize.mjs ${path.relative(here, outDir)}`);
