// Re-runs the browser checks on a finished run's saved diffs, without calling the API. Use it when a
// check in bugs.mjs was wrong (too strict, or flaky): every run's diff is replayed onto a fresh copy of
// its buggy app and graded again.
// Usage: node regrade.mjs <runs dir> <out dir> [bug id ...]   (no bug ids = regrade every run)
// Writes <out dir>/results.jsonl and settings.json; then run summarize.mjs on <out dir>.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BUGS } from './bugs.mjs';
import { makeWorkspace } from './workspace.mjs';
import { loadPlaywright } from '../lib/playwright.mjs';
import { startApp } from '../lib/devserver.mjs';

const [src, out, ...only] = process.argv.slice(2);
if (!src || !out) throw new Error('Usage: node regrade.mjs <runs dir> <out dir> [bug id ...]');
fs.mkdirSync(out, { recursive: true });
const settings = JSON.parse(fs.readFileSync(path.join(src, 'settings.json'), 'utf8').toString() || '{}');
fs.writeFileSync(path.join(out, 'settings.json'), JSON.stringify({ ...settings, regradedFrom: src, regradedBugs: only }, null, 2));

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darnly-regrade-'));

async function grade(root, bug) {
  const app = await startApp(root);
  try {
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
        return { fixed: true };
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

const lines = [];
let changed = 0;
for (const f of fs.readdirSync(path.join(src, 'transcripts')).sort()) {
  const t = JSON.parse(fs.readFileSync(path.join(src, 'transcripts', f), 'utf8'));
  const r = t.result;
  if (only.length && only.includes(r.bug)) {
    const bug = BUGS.find((b) => b.id === r.bug);
    const root = makeWorkspace(path.join(tmp, 'w'), bug.id);
    if (t.diff.trim()) {
      fs.writeFileSync(path.join(tmp, 'p.diff'), t.diff);
      execFileSync('git', ['apply', path.join(tmp, 'p.diff')], { cwd: root });
    }
    const g = await grade(root, bug);
    if (g.fixed !== r.fixed) {
      changed++;
      console.log(`${r.key}: ${r.fixed ? 'fixed' : 'not fixed'} -> ${g.fixed ? 'fixed' : 'not fixed'}${g.why ? ' (' + g.why + ')' : ''}`);
    }
    Object.assign(r, { fixed: g.fixed, why: g.why ?? null, wrongScope: !!g.wrongScope });
  }
  lines.push(JSON.stringify(r));
}
fs.writeFileSync(path.join(out, 'results.jsonl'), lines.join('\n') + '\n');
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${lines.length} runs, ${changed} changed. Now: node summarize.mjs ${out}`);
