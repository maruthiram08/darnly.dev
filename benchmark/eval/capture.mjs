// Captures, for every bug, what each condition of the eval gets:
// - screenshot.png: a plain screenshot of the window, as a user would paste one (the "screenshot" condition).
// - clear/ and short/: a real Darnly report made with the actual extension, once with each note
//   (the .md, the .png with the red box, and .logs.json when there were logs).
// The user's steps are the same as in real use: open the page, reproduce the bug, press the hotkey,
// click the broken element, type the note, press Enter.
// Run from the repo root: `DARNLY_E2E=1 npx wxt build`, then `node benchmark/eval/capture.mjs [bug id ...]`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUGS } from './bugs.mjs';
import { makeWorkspace } from './workspace.mjs';
import { loadPlaywright } from '../lib/playwright.mjs';
import { startApp } from '../lib/devserver.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const ext = path.resolve(here, '../../.output-e2e/chrome-mv3');
// DARNLY_EVAL_CAPTURES=captures-v2 writes a second set (for example, to test a change in report wording).
const outDir = path.join(here, process.env.DARNLY_EVAL_CAPTURES || 'captures');
if (!fs.existsSync(ext)) throw new Error('Build the extension first: DARNLY_E2E=1 npx wxt build (from the repo root)');

const only = process.argv.slice(2);
const { chromium } = loadPlaywright();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darnly-eval-capture-'));
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  viewport: { width: 1280, height: 860 },
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

async function inboxFiles(panel) {
  return panel.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const files = {};
    let inbox;
    try {
      inbox = await (await root.getDirectoryHandle('.darnly')).getDirectoryHandle('inbox');
    } catch {
      return files;
    }
    for await (const [name, h] of inbox.entries()) {
      const f = await h.getFile();
      files[name] = name.endsWith('.png') ? Array.from(new Uint8Array(await f.arrayBuffer())) : await f.text();
    }
    return files;
  });
}

async function readFile(panel, p) {
  return panel.evaluate(async (p) => {
    const parts = p.split('/');
    const name = parts.pop();
    let d = await navigator.storage.getDirectory();
    for (const part of parts) d = await d.getDirectoryHandle(part);
    return (await (await d.getFileHandle(name)).getFile()).text();
  }, p);
}

try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const id = new URL(sw.url()).host;
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  // Link the browser's private sandbox folder as the "project folder" (the real folder picker can't be automated).
  await panel.evaluate(async () => {
    const handle = await navigator.storage.getDirectory();
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('darnly-folders', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => {
        const tx = req.result.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, 'project');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await panel.reload();
  await panel.getByText('Saving to').waitFor({ timeout: 5000 });

  let setupDone = false;
  for (const bug of BUGS.filter((b) => !only.length || only.includes(b.id))) {
    const dir = makeWorkspace(path.join(tmp, bug.id), bug.id, { git: false });
    const app = await startApp(dir);
    const bugDir = path.join(outDir, bug.id);
    fs.rmSync(bugDir, { recursive: true, force: true });
    fs.mkdirSync(bugDir, { recursive: true });
    try {
      for (const variant of ['clear', 'short']) {
        const page = await ctx.newPage();
        await page.goto(app.base + bug.path);
        await page.waitForLoadState('networkidle');
        if (bug.setup) await bug.setup(page);
        await page.waitForTimeout(500);
        await page.bringToFront();
        if (variant === 'clear') await page.screenshot({ path: path.join(bugDir, 'screenshot.png') });
        const before = new Set(Object.keys(await inboxFiles(panel)));

        // Same call the hotkey makes.
        await sw.evaluate(async (u) => {
          const [tab] = await chrome.tabs.query({ url: u });
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/picker.js'] });
        }, page.url());
        await page.waitForTimeout(300);
        const box = await bug.pick(page).first().boundingBox();
        if (!box) throw new Error(`${bug.id}: element to pick not found`);
        const x = box.x + Math.min(box.width / 2, 40);
        const y = box.y + Math.min(box.height / 2, 30);
        await page.mouse.move(x, y);
        await page.waitForTimeout(100);
        await page.mouse.click(x, y);

        const noteBox = panel.getByLabel('What did you expect?');
        await noteBox.waitFor({ timeout: 5000 });
        await noteBox.fill(variant === 'clear' ? bug.note : bug.short);
        await noteBox.press('Enter');
        await panel.getByText('Saved to').waitFor({ timeout: 5000 });
        await panel.waitForTimeout(300);

        const after = await inboxFiles(panel);
        const fresh = Object.keys(after).filter((n) => !before.has(n));
        if (!fresh.some((n) => n.endsWith('.md'))) throw new Error(`${bug.id}: no report saved`);
        const vdir = path.join(bugDir, variant);
        fs.mkdirSync(vdir, { recursive: true });
        for (const name of fresh) fs.writeFileSync(path.join(vdir, name), Array.isArray(after[name]) ? Buffer.from(after[name]) : after[name]);
        console.log(`${bug.id} ${variant}: ${fresh.join(', ')}`);

        if (!setupDone && (await panel.getByRole('button', { name: 'See what it adds' }).count())) {
          await panel.getByRole('button', { name: 'See what it adds' }).click();
          await panel.getByRole('button', { name: 'Add these' }).click();
          await panel.getByText('Project set up').waitFor({ timeout: 5000 });
          const setupDir = path.join(outDir, '_setup');
          for (const p of ['AGENTS.md', '.claude/skills/darnly/SKILL.md']) {
            fs.mkdirSync(path.dirname(path.join(setupDir, p)), { recursive: true });
            fs.writeFileSync(path.join(setupDir, p), await readFile(panel, p));
          }
          setupDone = true;
        }
        await page.close();
      }
    } finally {
      app.stop();
    }
  }
} finally {
  await ctx.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
