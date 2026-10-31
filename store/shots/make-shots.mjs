// Makes the Chrome Web Store screenshots (1280x800): the demo page on the left, the Darnly panel on the right.
// Run after `DARNLY_E2E=1 npx wxt build`: node store/shots/make-shots.mjs <outDir>
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '../..');
const out = process.argv[2];
const ext = path.join(root, '.output-e2e/chrome-mv3');
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(fs.readFileSync(path.join(here, 'demo.html'))); });
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/plan`;
const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: 900, height: 800 }, deviceScaleFactor: 1,
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const id = new URL(sw.url()).host;
const panel = await ctx.newPage();
await panel.setViewportSize({ width: 380, height: 800 });
// Headless Chrome has no shortcut keys; show the panel as a normal install would.
await panel.addInitScript(() => { chrome.commands.getAll = async () => [{ name: 'start-capture', shortcut: '⌥⇧B' }]; });
await panel.goto(`chrome-extension://${id}/sidepanel.html`);
await panel.evaluate(async () => {
  const handle = await navigator.storage.getDirectory();
  const sub = await handle.getDirectoryHandle('acme-planner', { create: true });
  await new Promise((resolve) => { const r = indexedDB.open('darnly-folders', 1); r.onupgradeneeded = () => r.result.createObjectStore('handles');
    r.onsuccess = () => { const tx = r.result.transaction('handles', 'readwrite'); tx.objectStore('handles').put(sub, 'project'); tx.oncomplete = resolve; }; });
});
await panel.reload();
await panel.getByText('Saving to').waitFor();
await panel.getByRole('button', { name: 'See what it adds' }).click();
await panel.getByRole('button', { name: 'Add these' }).click();
await panel.getByText('Project set up').waitFor();
const page = await ctx.newPage();
await page.setViewportSize({ width: 900, height: 800 });
await page.goto(url);
await page.waitForTimeout(400);
const shot = async (name) => {
  const p = await page.screenshot(); const q = await panel.screenshot();
  fs.writeFileSync(path.join(out, `${name}-page.png`), p); fs.writeFileSync(path.join(out, `${name}-panel.png`), q);
};
const pick = async () => {
  await page.bringToFront();
  await sw.evaluate(async (u) => { const [t] = await chrome.tabs.query({ url: u + '*' }); await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['/content-scripts/picker.js'] }); }, url);
  await page.waitForTimeout(300);
};
// 1: picking the broken button
await pick();
await sw.evaluate(() => chrome.runtime.sendMessage({ type: 'picking' }).catch(() => {}));
const b = await page.locator('[data-testid="save-plan"]').boundingBox();
await page.mouse.move(b.x + 30, b.y + 15);
await page.waitForTimeout(200);
await shot('1');
// 2: note box with the marked screenshot
await page.mouse.click(b.x + 30, b.y + 15);
await panel.getByLabel('What did you expect?').waitFor();
await panel.getByLabel('What did you expect?').fill('Save plan should be clickable and save my week');
await page.waitForTimeout(600);
await shot('2');
// 3: saved, then the agent fixes it
await panel.getByLabel('What did you expect?').press('Enter');
await panel.getByText('Saved to').waitFor();
await panel.evaluate(async () => {
  const root = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('acme-planner')).getDirectoryHandle('.darnly');
  const inbox = await root.getDirectoryHandle('inbox'); const done = await root.getDirectoryHandle('done', { create: true });
  for await (const [name, h] of inbox.entries()) { const f = await h.getFile(); const w = await (await done.getFileHandle(name, { create: true })).createWritable();
    if (name.endsWith('.md')) await w.write((await f.text()).replace(/^(\*\*Expected:\*\*.*)$/m, '$1\n**Fixed:** removed pointer-events: none from the Save plan button in src/components/PlanBar.tsx'));
    else await w.write(f); await w.close(); await inbox.removeEntry(name); }
});
await panel.getByText('1 bug fixed. Take a look.').waitFor({ timeout: 8000 });
await shot('3');
await ctx.close(); server.close();
