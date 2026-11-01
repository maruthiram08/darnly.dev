// The app under test: Excalidraw (https://github.com/excalidraw/excalidraw, MIT), pinned to one commit.
// About 1,300 files in git, 770 of them .ts/.tsx/.scss, in a yarn monorepo (React 19 + Vite).
//
// setup.mjs clones it once into .cache/excalidraw and installs it. Each run gets a cheap git clone of that
// copy with the node_modules folders linked in, then the bug is planted and committed, so `git diff`
// afterwards shows only what the agent changed.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { freePort } from '../../lib/devserver.mjs';

export const NAME = 'excalidraw';
export const REPO = 'https://github.com/excalidraw/excalidraw';
export const COMMIT = '8bcdca4526867433f99fdfcb55a063668db0c9dc';
const here = path.dirname(new URL(import.meta.url).pathname);
export const BASE = path.resolve(here, '../.cache/excalidraw');
const NODE_MODULES = ['node_modules', 'excalidraw-app/node_modules', 'packages/excalidraw/node_modules', 'packages/fractional-indexing/node_modules', 'packages/utils/node_modules'];

const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).toString();

export function ensureBase() {
  if (!fs.existsSync(path.join(BASE, 'node_modules'))) throw new Error('Excalidraw is not set up yet. Run: node setup.mjs');
}

export function commitAll(dir, message) {
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.email=bench@example.com', '-c', 'user.name=bench', 'commit', '-qm', message, '--allow-empty');
}

// Plants one bug: a list of exact find/replace edits. Throws if a `find` text is missing, so a
// change upstream can't silently produce a run without the bug.
export function plant(dir, bug) {
  for (const { file, find, replace } of bug.plant) {
    const p = path.join(dir, file);
    const src = fs.readFileSync(p, 'utf8');
    if (!src.includes(find)) throw new Error(`${bug.id}: text to replace not found in ${file}`);
    fs.writeFileSync(p, src.replace(find, replace));
  }
}

export function prepareRun(bug, dir) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  execFileSync('git', ['clone', '-q', '--shared', BASE, dir]);
  for (const nm of NODE_MODULES) if (fs.existsSync(path.join(BASE, nm))) fs.symlinkSync(path.join(BASE, nm), path.join(dir, nm), 'dir');
  if (bug) plant(dir, bug);
  // One ordinary-looking commit, so the agent's own changes are the only diff.
  commitAll(dir, 'Work in progress');
  return dir;
}

export function changedFiles(dir) {
  return git(dir, 'status', '--porcelain').split('\n').map((l) => l.slice(3).trim()).filter((f) => f && !f.startsWith('.darnly'));
}

export function diff(dir) {
  try {
    git(dir, 'add', '-A', '--', '.', ':!.darnly');
    return git(dir, 'diff', '--cached', '--', '.', ':!.darnly');
  } catch {
    return '';
  }
}

// Starts Vite for excalidraw-app in a run folder. The app's own config runs a type checker and ESLint
// over the whole repo on every change; the harness drops that plugin (a wrapper config outside the run
// folder, so the agent never sees it) because it is slow and its overlay could cover the page.
export async function start(dir, port) {
  port ??= await freePort();
  const appDir = path.join(dir, 'excalidraw-app');
  const wrapperDir = path.join(path.dirname(dir), '_vite');
  fs.mkdirSync(wrapperDir, { recursive: true });
  const wrapper = path.join(wrapperDir, `${path.basename(dir)}.config.mts`);
  fs.writeFileSync(wrapper, `import base from ${JSON.stringify(path.join(appDir, 'vite.config.mts'))};
export default async (env) => {
  const c = typeof base === 'function' ? await base(env) : base;
  c.plugins = (c.plugins ?? []).flat(Infinity).filter((p) => p && !/checker/i.test(p.name ?? ''));
  c.server = { ...(c.server ?? {}), open: false };
  c.root = ${JSON.stringify(appDir)};
  return c;
};
`);
  const vite = path.join(BASE, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, '--config', wrapper, '--port', String(port), '--strictPort'], {
    cwd: appDir,
    env: { ...process.env, BROWSER: 'none', VITE_APP_ENABLE_ESLINT: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 300; i++) {
    if (child.exitCode != null) throw new Error('dev server exited:\n' + log);
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return { base, stop: () => child.kill(), log: () => log };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('dev server did not start:\n' + log);
}

// Opens the app on a clean canvas and waits until it is ready.
export async function open(page, base) {
  await page.goto(base + '/', { waitUntil: 'load', timeout: 120_000 });
  await page.locator('.excalidraw').waitFor({ timeout: 120_000 });
  await page.locator('.App-toolbar').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
}

// Runs a bug's checks in a fresh browser context. Returns { fixed, scopeOk, observations }:
// fixed = the reported symptom is gone; scopeOk = every scope check passed too (the fix reached
// the other places it should, and didn't change places it shouldn't). observations = what the user sees.
export async function check(browser, base, bug) {
  const out = { fixed: true, scopeOk: true, observations: [], failed: [] };
  for (const c of bug.checks) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    let ok = false;
    let why = '';
    try {
      await open(page, base);
      ok = (await c.test(page, base)) !== false;
    } catch (e) {
      why = String(e.message).split('\n')[0].slice(0, 160);
    } finally {
      await ctx.close();
    }
    if (!ok) {
      out.failed.push(`${c.name}${why ? ` (${why})` : ''}`);
      if (c.main) out.fixed = false;
      else out.scopeOk = false;
    }
    out.observations.push(ok ? c.seenWhenOk : c.seenWhenBroken);
  }
  return out;
}
