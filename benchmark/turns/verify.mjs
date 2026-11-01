// Proves each planted bug is real and each check is fair: on a clean copy every check passes,
// and with the bug planted the main check fails. Run after setup.mjs, and after changing bugs.mjs.
// Usage: node verify.mjs [bug id ...]
import fs from 'node:fs';
import path from 'node:path';
import * as app from './app/excalidraw.mjs';
import { BUGS } from './app/bugs.mjs';
import { loadPlaywright } from '../lib/playwright.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const only = process.argv.slice(2);
app.ensureBase();
const work = path.join(here, 'runs', '_verify');
fs.rmSync(work, { recursive: true, force: true });
const { chromium } = loadPlaywright();
const browser = await chromium.launch();
let bad = 0;
try {
  const clean = app.prepareRun(null, path.join(work, 'clean'));
  const server = await app.start(clean);
  for (const bug of BUGS.filter((b) => !only.length || only.includes(b.id))) {
    const r = await app.check(browser, server.base, bug);
    const ok = r.fixed && r.scopeOk;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} clean   ${bug.id}${ok ? '' : '  ' + r.failed.join('; ')}`);
  }
  server.stop();
  for (const bug of BUGS.filter((b) => !only.length || only.includes(b.id))) {
    const dir = app.prepareRun(bug, path.join(work, bug.id));
    const s = await app.start(dir);
    const r = await app.check(browser, s.base, bug);
    s.stop();
    if (r.fixed) bad++;
    console.log(`${r.fixed ? 'FAIL' : 'ok  '} planted ${bug.id}  fails: ${r.failed.join('; ')}`);
  }
} finally {
  await browser.close();
}
fs.rmSync(work, { recursive: true, force: true });
console.log(bad ? `\n${bad} problem(s).` : '\nAll bugs verified.');
process.exit(bad ? 1 : 0);
