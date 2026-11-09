// End-to-end check of the capture loop: picker -> screenshot -> note -> files in .darnly/inbox/.
// Run with `npm run e2e` (builds a test copy with screenshot permission for every site). Uses the Playwright that is installed globally in Claude's sandbox.
// The real folder picker can't be automated, so the test links the browser's private sandbox folder (OPFS) instead.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ext = path.join(root, '.output-e2e/chrome-mv3');

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/cart')) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    return res.end('{"error":"cart is empty","session":"s3cr3tsessionvalue"}');
  }
  if (req.url.startsWith('/api/order')) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ order: { id: 'ord_9', button_label: 'Pay now', customer_email: 'buyer@shop.test', coupon: null, items: [1, 2, 3], created_at: '2025-01-01T00:00:00Z', access_token: 'zz-order-token-zz' } }));
  }
  if (req.url.startsWith('/frames')) {
    res.setHeader('content-type', 'text/html');
    return res.end(fs.readFileSync(path.join(root, 'tests/fixtures/frames.html')));
  }
  if (req.url.startsWith('/missing-logo.png')) {
    res.statusCode = 404;
    return res.end('not found');
  }
  res.setHeader('content-type', 'text/html');
  res.end(fs.readFileSync(path.join(root, 'tests/fixtures/checkout.html')));
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/checkout`;

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  viewport: { width: 1200, height: 800 },
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const id = new URL(sw.url()).host;


  const panel = await ctx.newPage();
  const errors = [];
  panel.on('pageerror', (e) => errors.push(e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  // Link the sandbox folder through the same IndexedDB store the app uses.
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

  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(500); // let the planted errors happen
  await page.bringToFront();

  // Same call the hotkey makes.
  await sw.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u + '*' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/picker.js'] });
  }, url);
  await page.waitForTimeout(300);

  const box = await page.locator('button.pay').boundingBox();
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.waitForTimeout(100);
  // Shift+click marks the button and keeps picking; a plain click on the heading adds it as element 2 and finishes.
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + 20, box.y + 10);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(100);
  const h1 = await page.locator('h1').boundingBox();
  await page.mouse.move(h1.x + 10, h1.y + 10);
  await page.waitForTimeout(100);
  await page.mouse.click(h1.x + 10, h1.y + 10);

  await panel.getByLabel('What did you expect?').waitFor({ timeout: 5000 });
  await panel.getByLabel('What did you expect?').fill('Pay now should be clickable and open the payment form');
  // "Change only this" chips: optional, one click each.
  await panel.getByRole('button', { name: 'Only this one' }).click();
  await panel.getByRole('button', { name: 'Size', exact: true }).click();
  if (process.env.PANEL_SHOT) {
    await panel.setViewportSize({ width: 400, height: 860 });
    await panel.waitForTimeout(300);
    await panel.screenshot({ path: process.env.PANEL_SHOT });
  }
  await panel.getByLabel('What did you expect?').press('Enter');
  await panel.getByText('Saved to').waitFor({ timeout: 5000 });

  const out = await panel.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const inbox = await (await root.getDirectoryHandle('.darnly')).getDirectoryHandle('inbox');
    const files = {};
    for await (const [name, h] of inbox.entries()) {
      const f = await h.getFile();
      if (!name.endsWith('.png')) files[name] = await f.text();
      else files[name] = { size: f.size, b64: btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer()))) };
    }
    return files;
  });
  const gitignore = await panel.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const d = await root.getDirectoryHandle('.darnly');
    return (await (await d.getFileHandle('.gitignore')).getFile()).text();
  });
  if (gitignore.trim() !== '*') fail('.darnly/.gitignore missing');
  const names = Object.keys(out);
  const md = out[names.find((n) => n.endsWith('.md'))] ?? '';
  const pngFile = out[names.find((n) => n.endsWith('.png'))];
  const png = pngFile?.size;
  if (process.env.SAVE_PNG && pngFile) fs.writeFileSync(process.env.SAVE_PNG, Buffer.from(pngFile.b64, 'base64'));
  console.log('files:', names);
  console.log(md);
  if (!md.includes('button[data-testid="pay-now"]')) fail('selector missing');
  if (!md.includes('**Change only this one:**')) fail('scope line missing');
  if (!md.includes('- current size (before the fix): width:')) fail('current size values missing');
  if (!md.includes("## How to check it's fixed")) fail('verify section missing');
  if (!md.includes('pointer-events: none')) fail('styles missing');
  if (!md.includes('**Expected:** Pay now should be clickable')) fail('note missing');
  if (!(png > 1000)) fail('screenshot missing or empty');
  if (!md.includes('- code: `src/components/PayButton.tsx:12` (start here)')) fail('source file missing');
  if (!md.includes('- `PayButton`: placed at `src/pages/CheckoutPage.tsx:20`')) fail('where the component is placed missing');
  if (!md.includes('- drawn by: `CheckoutPage` > `PayButton`')) fail('component chain missing');
  if (!md.includes('# Bug on /checkout: PayButton')) fail('heading missing');
  if (!md.includes('## Element 1 (red box 1)') || !md.includes('## Element 2 (red box 2)\n- selector: `h1`')) fail('second marked element missing');
  if (!md.includes('the user marked 2 elements for this one note')) fail('several-elements line missing');
  if (!md.includes('"Pay now"') || !md.includes('page route: `/checkout`')) fail('search hints missing');
  const logsName = names.find((n) => n.endsWith('.logs.json'));
  const all = md + (logsName ? out[logsName] : '');
  for (const secret of ['hunter2', '4242424242424242', ['sk', 'live', '51HqLyjWDarjtT1zdp7dcXYZ'].join('_'), 'abc12345', 's3cr3tsessionvalue']) {
    if (all.includes(secret)) fail('secret leaked: ' + secret);
  }
  if (!logsName) fail('logs.json missing');
  if (!md.includes('## The data behind this element')) fail('data shape section missing');
  if (!md.includes('record id ord_9')) fail('record id missing');
  if (!md.includes('- customer_email: <email>') || !md.includes('- items: <list, 3 items>') || !md.includes('- coupon: null')) fail('record shape wrong');
  for (const value of ['buyer@shop.test', 'zz-order-token-zz', 'access_token']) if (md.includes(value)) fail('record value leaked: ' + value);
  if (!md.includes('## Errors (last 60s)')) fail('errors section missing');
  if (!/console\.error: Payment init failed/.test(md)) fail('console error missing');
  if (!/uncaught error: .*TypeError/.test(md)) fail('uncaught error missing');
  if (!md.includes('POST /api/cart?token=[hidden]&page=2 500')) fail('failed fetch missing or not redacted');
  if (!/GET \/missing-logo\.png 404 .*\[image\]/.test(md)) fail('missing image (browser-only failure) missing');
  // Sprint 3: the inbox list and "Set up this project".
  await panel.getByText('1 waiting, 0 fixed').waitFor({ timeout: 7000 }).catch(() => fail('inbox list missing'));
  // The toolbar icon shows how many bugs are waiting.
  const badge = async () => sw.evaluate(async () => ({ text: await chrome.action.getBadgeText({}), title: await chrome.action.getTitle({}) }));
  {
    let b;
    for (let i = 0; i < 20 && (b = await badge()).text !== '1'; i++) await panel.waitForTimeout(200);
    if (b.text !== '1') fail(`toolbar badge should say 1, says "${b.text}"`);
    if (!b.title.includes('1 bug is waiting')) fail(`toolbar title missing the count: "${b.title}"`);
  }
  await panel.getByRole('button', { name: 'See what it adds' }).click();
  await panel.getByRole('button', { name: 'Add these' }).click();
  await panel.getByText('Project set up').waitFor({ timeout: 5000 }).catch(() => fail('setup did not finish'));
  const setup = await panel.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const read = async (path) => {
      const parts = path.split('/');
      const name = parts.pop();
      let d = root;
      for (const p of parts) d = await d.getDirectoryHandle(p);
      return (await (await d.getFileHandle(name)).getFile()).text();
    };
    return { agents: await read('AGENTS.md'), skill: await read('.agents/skills/darnly/SKILL.md'), claudeSkill: await read('.claude/skills/darnly/SKILL.md'), claudeSettings: await read('.claude/settings.json') };
  });
  if (!setup.agents.includes('.darnly/inbox/')) fail('AGENTS.md block missing');
  if (!setup.skill.startsWith('---\nname: darnly') || setup.skill !== setup.claudeSkill) fail('skill files wrong');
  if (await panel.getByText('Set up this project').count()) fail('setup card still showing after setup');
  if (!setup.claudeSettings.includes('darnly-inbox-check')) fail('Claude Code hooks missing');
  await panel.getByText('Claude Code will offer to fix').first().waitFor({ timeout: 3000 }).catch(() => fail('panel still says to tell the agent after hooks are set up'));
  // The agent needs the user: it writes a **Question:** line, and the panel sends the user back to the agent.
  await panel.evaluate(async () => {
    const inbox = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('.darnly')).getDirectoryHandle('inbox');
    for await (const [name, h] of inbox.entries()) {
      if (!name.endsWith('.md')) continue;
      const text = await (await h.getFile()).text();
      const w = await h.createWritable();
      await w.write(text.replace(/^(\*\*Expected:\*\*.*)$/m, '$1\n**Question:** Should Pay now also save the card?'));
      await w.close();
    }
  });
  await panel.getByText('Your agent is waiting for your input. Return to your agent.').waitFor({ timeout: 7000 }).catch(() => fail('waiting-for-input notice missing'));
  await panel.getByText('Should Pay now also save the card?').waitFor({ timeout: 3000 }).catch(() => fail('agent question missing'));
  // Pretend the agent fixed the bug while the panel was closed: leave the panel, move the bug to done/,
  // then open the panel again. It should still say the bug was fixed since it last looked.
  await panel.waitForTimeout(500);
  await panel.goto(`chrome-extension://${id}/keepalive.html`);
  await panel.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('.darnly');
    const inbox = await root.getDirectoryHandle('inbox');
    const done = await root.getDirectoryHandle('done', { create: true });
    for await (const [name, h] of inbox.entries()) {
      const f = await h.getFile();
      const w = await (await done.getFileHandle(name, { create: true })).createWritable();
      // Like the skill asks: one **Fixed:** line under **Expected**.
      if (name.endsWith('.md')) await w.write((await f.text()).replace(/^\*\*Question:\*\*.*\n/m, '').replace(/^(\*\*Expected:\*\*.*)$/m, '$1\n**Fixed:** made Pay now clickable in src/components/PayButton.tsx'));
      else await w.write(f);
      await w.close();
      await inbox.removeEntry(name);
    }
  });
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.getByText('0 waiting, 1 fixed').waitFor({ timeout: 7000 }).catch(() => fail('fixed bug not shown'));
  {
    let b;
    for (let i = 0; i < 20 && (b = await badge()).text !== ''; i++) await panel.waitForTimeout(200);
    if (b.text !== '') fail(`toolbar badge should clear once the bug is fixed, says "${b.text}"`);
  }
  await panel.getByText('1 bug fixed. Take a look.').waitFor({ timeout: 3000 }).catch(() => fail('fixed nudge missing'));
  await panel.getByText('made Pay now clickable in src/components/PayButton.tsx').waitFor({ timeout: 3000 }).catch(() => fail('agent fix note missing'));
  // The bug was on localhost, so reloading shows the fix (a live site would say to deploy instead).
  if (!(await panel.getByRole('button', { name: 'Reload the page' }).count())) fail('reload button missing for a localhost bug');
  if (await panel.getByText('Deploy it to see it').count()) fail('deploy hint shown for a localhost bug');
  // Sprint 4: picking a big container still records the card under the cursor.
  const framesUrl = url.replace('/checkout', '/frames');
  await page.goto(framesUrl);
  await page.bringToFront();
  await panel.getByRole('button', { name: 'Capture another' }).count(); // panel stays as is
  await sw.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u + '*' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/picker.js'] });
  }, framesUrl);
  await page.waitForTimeout(300);
  const card = await page.locator('[data-testid="card-2"]').boundingBox();
  await page.mouse.move(card.x + 60, card.y + 60);
  await page.waitForTimeout(100);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await panel.getByLabel('What did you expect?').waitFor({ timeout: 5000 });
  await panel.getByLabel('What did you expect?').fill('Q3 plan should be tagged as a Frame, not a Belief');
  await panel.getByLabel('What did you expect?').press('Enter');
  await panel.getByText('Saved to').waitFor({ timeout: 5000 });
  const md2 = await panel.evaluate(async () => {
    const inbox = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('.darnly')).getDirectoryHandle('inbox');
    for await (const [name, h] of inbox.entries()) if (name.endsWith('.md')) return (await h.getFile()).text();
  });
  if (!md2?.includes('## Exactly under the cursor')) fail('cursor element missing for a big box');
  if (!md2?.includes('article[data-testid="card-2"]')) fail('card under the cursor not identified');
  // Esc cancels the picker: the overlay goes away and nothing is captured.
  await sw.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u + '*' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/picker.js'] });
  }, framesUrl);
  await page.waitForTimeout(300);
  if (!(await page.evaluate(() => !!document.querySelector('darnly-picker')))) fail('picker did not start');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  if (await page.evaluate(() => !!document.querySelector('darnly-picker'))) fail('Esc did not cancel the picker');
  // Switching from a linked folder to the cloud inbox: "change" offers the cloud, and choosing it unlinks the folder.
  await panel.getByRole('button', { name: 'change' }).click();
  await panel.getByRole('button', { name: 'use the cloud instead' }).click().catch(() => fail('no way to switch from a folder to the cloud'));
  await panel.getByRole('button', { name: 'Sign in with Google' }).waitFor({ timeout: 3000 }).catch(() => fail('cloud sign-in not shown after switching'));
  if (await panel.getByText('Saving to').count()) fail('folder still linked after switching to the cloud');
  await panel.reload();
  await panel.getByRole('button', { name: 'Sign in with Google' }).waitFor({ timeout: 3000 }).catch(() => fail('switch to the cloud not remembered'));
  // Several projects: a site Darnly hasn't seen asks which project it is, then remembers the answer.
  await panel.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const a = await root.getDirectoryHandle('project-a', { create: true });
    const b = await root.getDirectoryHandle('project-b', { create: true });
    await chrome.storage.local.set({ siteCloud: {}, cloudProject: false });
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('darnly-folders', 1);
      req.onsuccess = () => {
        const tx = req.result.transaction('handles', 'readwrite');
        const store = tx.objectStore('handles');
        store.clear();
        store.put([a, b], 'recent');
        store.put(a, 'project');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.bringToFront();
  await panel.reload();
  await panel.getByText('Which project is').waitFor({ timeout: 5000 }).catch(() => fail('no project chooser for a new site with several projects'));
  await panel.getByRole('button', { name: 'project-b' }).click().catch(() => fail('recent project not offered'));
  await panel.getByText('Saving to project-b').waitFor({ timeout: 5000 }).catch(() => fail('picked project not used'));
  await panel.reload();
  await panel.getByText('Saving to project-b').waitFor({ timeout: 5000 }).catch(() => fail('site did not remember its project'));
  await panel.getByRole('button', { name: 'change' }).click();
  await panel.getByRole('button', { name: 'project-a' }).click().catch(() => fail('other recent project not offered under change'));
  await panel.getByText('Saving to project-a').waitFor({ timeout: 5000 }).catch(() => fail('switching to another recent project failed'));
  // Deleting one bug: × then Yes removes all of its files, and nothing else.
  await panel.evaluate(async () => {
    const a = await (await navigator.storage.getDirectory()).getDirectoryHandle('project-a');
    const inbox = await (await a.getDirectoryHandle('.darnly', { create: true })).getDirectoryHandle('inbox', { create: true });
    for (const [name, text] of [['bug-one.md', '**Expected:** delete me\n'], ['bug-one.png', 'x'], ['bug-two.md', '**Expected:** keep me\n']]) {
      const w = await (await inbox.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    }
  });
  await panel.getByText('2 waiting, 0 fixed').waitFor({ timeout: 7000 }).catch(() => fail('bugs to delete not listed'));
  await panel.getByRole('button', { name: 'Delete delete me' }).click();
  await panel.getByRole('button', { name: 'Yes' }).click();
  await panel.getByText('1 waiting, 0 fixed').waitFor({ timeout: 5000 }).catch(() => fail('deleted bug still listed'));
  const leftover = await panel.evaluate(async () => {
    const inbox = await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('project-a')).getDirectoryHandle('.darnly')).getDirectoryHandle('inbox');
    const names = [];
    for await (const [name] of inbox.entries()) names.push(name);
    return names.sort().join(',');
  });
  if (leftover !== 'bug-two.md') fail('delete removed the wrong files: ' + leftover);
  if (errors.length) fail('panel errors: ' + errors.join('; '));
  if (process.exitCode) console.log("FAILED"); else console.log('PASS: capture loop works end to end');
} finally {
  await ctx.close();
  server.close();
}
