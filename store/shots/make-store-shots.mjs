// Makes the Chrome Web Store screenshots (1280x800, 5 of them): a headline on the left, and a browser window with
// the demo page and the real Darnly panel on the right. Also refreshes docs/screenshot.png (the README picture).
// Run: DARNLY_E2E=1 npx wxt build && node store/shots/make-store-shots.mjs <outDir>
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '../..');
const out = process.argv[2] ?? path.join(root, '.output-shots');
fs.mkdirSync(path.join(out, 'raw'), { recursive: true });
const ext = path.join(root, '.output-e2e/chrome-mv3');
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(fs.readFileSync(path.join(here, 'demo.html'))); });
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/plan`;
const PAGE_W = 600, PANEL_W = 380, H = 800;

const ctx = await chromium.launchPersistentContext('', { headless: false, viewport: { width: PAGE_W, height: H }, deviceScaleFactor: Number(process.env.DSF ?? 2),
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const id = new URL(sw.url()).host;
const panel = await ctx.newPage();
await panel.setViewportSize({ width: PANEL_W, height: H });
// Headless Chrome has no shortcut keys; show the panel as a normal install would.
await panel.addInitScript(() => { chrome.commands.getAll = async () => [{ name: 'start-capture', shortcut: '⌥⇧B' }]; });
await panel.goto(`chrome-extension://${id}/sidepanel.html`);
await panel.addStyleTag({ content: '::-webkit-scrollbar{display:none}' });
// A linked project that already has two bugs: one waiting, one the agent fixed earlier.
await panel.evaluate(async () => {
  const sub = await (await navigator.storage.getDirectory()).getDirectoryHandle('acme-planner', { create: true });
  const d = await sub.getDirectoryHandle('.darnly', { create: true });
  const put = async (dir, name, text) => { const w = await (await (await d.getDirectoryHandle(dir, { create: true })).getFileHandle(name, { create: true })).createWritable(); await w.write(text); await w.close(); };
  await put('inbox', '2026-11-02-0910-share-should-open-the-share-sheet.md', '# Share\n\n**Expected:** Share should open the share sheet\n');
  await put('done', '2026-11-01-1702-tags-should-not-wrap-on-mobile.md', '# Tags\n\n**Expected:** Tags should not wrap on mobile\n**Fixed:** added flex-wrap: nowrap to .tag-row in src/styles/cards.css\n');
  await new Promise((resolve) => { const r = indexedDB.open('darnly-folders', 1); r.onupgradeneeded = () => r.result.createObjectStore('handles');
    r.onsuccess = () => { const tx = r.result.transaction('handles', 'readwrite'); tx.objectStore('handles').put(sub, 'project'); tx.oncomplete = resolve; }; });
});
await panel.reload();
await panel.addStyleTag({ content: '::-webkit-scrollbar{display:none}' });
await panel.getByText('Saving to').waitFor();
await panel.getByRole('button', { name: 'See what it adds' }).click();
await panel.getByRole('button', { name: 'Add these' }).click();
await panel.getByText('Project set up').waitFor();
const page = await ctx.newPage();
await page.setViewportSize({ width: PAGE_W, height: H });
await page.goto(url);
await page.waitForTimeout(400);
const raw = async (name) => {
  fs.writeFileSync(path.join(out, 'raw', `${name}-page.png`), await page.screenshot());
  fs.writeFileSync(path.join(out, 'raw', `${name}-panel.png`), await panel.screenshot());
};
const pick = async () => {
  await page.bringToFront();
  await sw.evaluate(async (u) => { const [t] = await chrome.tabs.query({ url: u + '*' }); await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['/content-scripts/picker.js'] }); }, url);
  await page.waitForTimeout(300);
};
const inboxEdit = (fn) => panel.evaluate(async (src) => {
  const edit = eval(src);
  const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('acme-planner')).getDirectoryHandle('.darnly');
  const inbox = await d.getDirectoryHandle('inbox'); const done = await d.getDirectoryHandle('done', { create: true });
  for await (const [name, h] of inbox.entries()) {
    if (!name.includes('save-plan')) continue;
    const f = await h.getFile();
    const r = await edit(name, f.type || name.endsWith('.md') ? await f.text() : null);
    if (r?.move) { const w = await (await done.getFileHandle(name, { create: true })).createWritable(); await w.write(name.endsWith('.md') ? r.text : f); await w.close(); await inbox.removeEntry(name); }
    else if (r?.text) { const w = await h.createWritable(); await w.write(r.text); await w.close(); }
  }
}, fn.toString());

// 1: picking the broken button
await pick();
await sw.evaluate(() => chrome.runtime.sendMessage({ type: 'picking' }).catch(() => {}));
const b = await page.locator('[data-testid="save-plan"]').boundingBox();
await page.mouse.move(b.x + 30, b.y + 15);
await page.waitForTimeout(200);
await raw('1');
// 2: the note, with the marked screenshot and the recorded error
await page.mouse.click(b.x + 30, b.y + 15);
const box = panel.getByLabel('What did you expect?');
await box.waitFor();
await box.fill('Save plan should be clickable and save my week');
await page.waitForTimeout(600);
await raw('2');
// 3: saved into the project
await box.press('Enter');
await panel.getByText('Saved to').waitFor();
await page.waitForTimeout(300);
await raw('3');
// Back to the resting panel (the saved card would crowd the next two shots).
await panel.getByRole('button', { name: 'Capture another' }).click();
await panel.getByRole('button', { name: 'Cancel' }).click();
await page.bringToFront();
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
// 4: the agent asks a question
await inboxEdit((name, text) => name.endsWith('.md') && { text: text.replace(/^(\*\*Expected:\*\*.*)$/m, '$1\n**Question:** Should Save plan also email the team?') });
await panel.getByText('Your agent is waiting for your input. Return to your agent.').waitFor({ timeout: 8000 });
await raw('4');
// 5: the agent fixed it
await inboxEdit((name, text) => ({ move: true, text: text && text.replace(/^\*\*Question:\*\*.*\n/m, '').replace(/^(\*\*Expected:\*\*.*)$/m, '$1\n**Fixed:** removed pointer-events: none from the Save plan button in src/components/PlanBar.tsx') }));
await panel.getByText('1 bug fixed. Take a look.').waitFor({ timeout: 8000 });
await page.evaluate(() => { const s = document.querySelector('.save'); s.style.opacity = '1'; s.style.pointerEvents = 'auto'; });
await raw('5');
await ctx.close(); server.close();

// Frame each pair into a 1280x800 store screenshot.
const copy = [
  ['Point at the bug', 'Click the broken part.', 'Press <kbd>⌥⇧B</kbd> on any page and click what looks wrong. Darnly boxes it for you.'],
  ['Add one line', 'Say what you expected.', 'The screenshot, the element and recent errors come along. Secrets are hidden.'],
  ['Straight to your agent', 'Your agent gets the whole bug.', 'Saved into your project for Claude Code, Codex or Cursor, or sent to your private Darnly inbox.'],
  ['Stay in the loop', 'Know when your agent needs you.', 'If your note is unclear, your agent asks. Darnly tells you to go back and answer.'],
  ['Close the loop', 'See what got fixed.', 'Darnly shows each fix and what changed, so you can check it in one click.'],
];
const browser = await chromium.launch();
const fp = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const dataUrl = (p) => `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
const tpl = fs.readFileSync(path.join(here, 'frame.html'), 'utf8');
for (let i = 0; i < copy.length; i++) {
  const [eyebrow, headline, sub] = copy[i];
  const html = tpl.replace('EYEBROW', eyebrow).replace('HEADLINE', headline).replace('SUB', sub)
    .replace('ICON', dataUrl(path.join(root, 'public/icon/128.png')))
    .replace('PAGE', dataUrl(path.join(out, 'raw', `${i + 1}-page.png`))).replace('PANEL', dataUrl(path.join(out, 'raw', `${i + 1}-panel.png`)));
  await fp.setContent(html, { waitUntil: 'networkidle' }).catch(() => {});
  await fp.evaluate(() => document.fonts.ready);
  await fp.screenshot({ path: path.join(out, `darnly-store-${i + 1}.png`) });
}
await browser.close();
fs.copyFileSync(path.join(out, 'darnly-store-1.png'), path.join(root, 'docs/screenshot.png'));
console.log('Wrote', out);
