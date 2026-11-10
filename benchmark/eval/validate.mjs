// Proves the eval is fair before spending money: for every bug, its check must FAIL on the app with that
// bug planted and PASS on the clean app. Run: node eval/validate.mjs [bug id ...]
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { BUGS } from './bugs.mjs';
import { makeWorkspace } from './workspace.mjs';
import { loadPlaywright } from '../lib/playwright.mjs';
import { startApp } from '../lib/devserver.mjs';

const only = process.argv.slice(2);
const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darnly-eval-validate-'));

async function run(dir, bug) {
  const app = await startApp(dir);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  try {
    await bug.check(page, app.base);
    return { fixed: true };
  } catch (e) {
    return { fixed: false, why: String(e.message).split('\n')[0].slice(0, 160) };
  } finally {
    await ctx.close();
    app.stop();
  }
}

let bad = 0;
const clean = makeWorkspace(path.join(tmp, 'clean'), null, { git: false });
for (const bug of BUGS.filter((b) => !only.length || only.includes(b.id))) {
  const buggy = makeWorkspace(path.join(tmp, bug.id), bug.id, { git: false });
  const a = await run(buggy, bug);
  const b = await run(clean, bug);
  const ok = !a.fixed && b.fixed;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'BAD '} ${bug.id.padEnd(24)} planted: ${a.fixed ? 'PASSES (should fail)' : 'fails (' + a.why + ')'} | clean: ${b.fixed ? 'passes' : 'FAILS: ' + b.why}`);
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} bug(s) not valid` : `\nAll ${BUGS.length} bugs valid`);
process.exit(bad ? 1 : 0);
