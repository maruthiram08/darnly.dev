// Captures, for each planted bug, the two things a person would hand the agent:
// - captures/<bug>/screenshot.png: a plain screenshot of the page (what you'd paste into the terminal)
// - captures/<bug>/darnly/: the real Darnly report (.md, .png, sometimes .logs.json), made with the actual
//   extension the way a user does it: reproduce, press the hotkey, click the element, type the note, Enter.
// Also writes captures/_setup/: the files Darnly's "Set up this project" adds (AGENTS.md and the skill).
//
// Run once from the repo root: `DARNLY_E2E=1 npx wxt build`, then `node benchmark/turns/capture.mjs`.
// Needed only when the bugs or Darnly's report format change; the captures are committed.
import fs from 'node:fs';
import path from 'node:path';
import * as app from './app/excalidraw.mjs';
import { BUGS } from './app/bugs.mjs';
import { loadPlaywright } from '../lib/playwright.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const ext = path.resolve(here, '../../.output-e2e/chrome-mv3');
const outDir = path.join(here, 'captures');
if (!fs.existsSync(ext)) throw new Error('Build the extension first: DARNLY_E2E=1 npx wxt build (from the repo root)');
app.ensureBase();

const only = process.argv.slice(2);
const { chromium } = loadPlaywright();
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  viewport: { width: 1280, height: 860 },
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const work = path.join(here, 'runs', '_capture');
fs.rmSync(work, { recursive: true, force: true });

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
  await panel.getByText('Saving to').waitFor({ timeout: 10000 });

  let setupDone = false;
  for (const bug of BUGS.filter((b) => !only.length || only.includes(b.id))) {
    // Same neutral folder name for every bug, so file paths in the report don't hint at the bug.
    const dir = path.join(work, 'excalidraw');
    fs.rmSync(dir, { recursive: true, force: true });
    app.prepareRun(bug, dir);
    const server = await app.start(dir);
    const page = await ctx.newPage();
    try {
      await app.open(page, server.base);
      if (bug.capture.setup) await bug.capture.setup(page);
      await page.waitForTimeout(500);
      await page.bringToFront();
      const bugDir = path.join(outDir, bug.id);
      fs.rmSync(bugDir, { recursive: true, force: true });
      fs.mkdirSync(path.join(bugDir, 'darnly'), { recursive: true });
      // The plain screenshot, taken just before Darnly's capture, so both show the same moment.
      await page.screenshot({ path: path.join(bugDir, 'screenshot.png') });

      const before = new Set(Object.keys(await inboxFiles(panel)));
      // Same call the hotkey makes.
      await sw.evaluate(async (u) => {
        const [tab] = await chrome.tabs.query({ url: u });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/picker.js'] });
      }, page.url());
      await page.waitForTimeout(300);
      const box = await bug.capture.pick(page).first().boundingBox();
      if (!box) throw new Error(`${bug.id}: element to pick not found`);
      const x = box.x + Math.min(box.width / 2, 40);
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.waitForTimeout(100);
      await page.mouse.click(x, y);

      const noteBox = panel.getByLabel('What did you expect?');
      await noteBox.waitFor({ timeout: 5000 });
      await noteBox.fill(bug.note);
      await noteBox.press('Enter');
      await panel.getByText('Saved to').waitFor({ timeout: 5000 });
      await panel.waitForTimeout(300);

      const after = await inboxFiles(panel);
      const fresh = Object.keys(after).filter((n) => !before.has(n));
      if (!fresh.some((n) => n.endsWith('.md'))) throw new Error(`${bug.id}: no report saved`);
      for (const name of fresh) fs.writeFileSync(path.join(bugDir, 'darnly', name), Array.isArray(after[name]) ? Buffer.from(after[name]) : after[name]);
      console.log(`${bug.id}: screenshot.png + ${fresh.join(', ')}`);

      if (!setupDone && (await panel.getByRole('button', { name: 'See what it adds' }).count())) {
        await panel.getByRole('button', { name: 'See what it adds' }).click();
        await panel.getByRole('button', { name: 'Add these' }).click();
        await panel.getByText('Project set up').waitFor({ timeout: 5000 });
        const setupDir = path.join(outDir, '_setup');
        for (const p of ['AGENTS.md', '.claude/skills/darnly/SKILL.md', '.agents/skills/darnly/SKILL.md']) {
          fs.mkdirSync(path.dirname(path.join(setupDir, p)), { recursive: true });
          fs.writeFileSync(path.join(setupDir, p), await readFile(panel, p));
        }
        setupDone = true;
        console.log('setup files saved');
      }
    } finally {
      await page.close();
      server.stop();
    }
  }
} finally {
  await ctx.close();
  fs.rmSync(work, { recursive: true, force: true });
}
