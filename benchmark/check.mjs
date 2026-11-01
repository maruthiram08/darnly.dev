// Is a bug fixed? Starts the app in a folder and runs that bug's check.
// Usage: node check.mjs <app folder> [bug id ...]   (no bug ids = all 10)
// Exit code 0 when every check passed.
import path from 'node:path';
import { BUGS } from './bugs.mjs';
import { loadPlaywright } from './lib/playwright.mjs';
import { startApp } from './lib/devserver.mjs';

export async function runChecks(dir, ids, { browser } = {}) {
  const { chromium } = loadPlaywright();
  const app = await startApp(dir);
  const own = !browser;
  browser ??= await chromium.launch();
  const results = {};
  try {
    for (const bug of BUGS.filter((b) => !ids?.length || ids.includes(b.id))) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      const page = await ctx.newPage();
      try {
        await bug.check(page, app.base);
        results[bug.id] = { fixed: true };
      } catch (e) {
        results[bug.id] = { fixed: false, why: String(e.message).split('\n')[0].slice(0, 200) };
      } finally {
        await ctx.close();
      }
    }
  } finally {
    if (own) await browser.close();
    app.stop();
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, ...ids] = process.argv.slice(2);
  if (!dir) {
    console.error('Usage: node check.mjs <app folder> [bug id ...]');
    process.exit(2);
  }
  const results = await runChecks(path.resolve(dir), ids);
  for (const [id, r] of Object.entries(results)) console.log(`${r.fixed ? 'FIXED  ' : 'BROKEN '} ${id}${r.why ? `  (${r.why})` : ''}`);
  process.exit(Object.values(results).every((r) => r.fixed) ? 0 : 1);
}
