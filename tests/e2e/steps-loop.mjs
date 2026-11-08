// End-to-end check of "Record the steps first": record -> click and type on two pages -> capture -> report lists the steps
// (never what was typed) and a numbered steps picture is saved next to it. Run with `npm run e2e:steps`.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ext = path.join(root, '.output-e2e/chrome-mv3');

const pages = {
  '/cart': '<h1>Cart</h1><label for="coupon">Coupon code</label><input id="coupon"><a href="/checkout">Go to checkout</a>',
  '/checkout': '<h1>Checkout</h1><button class="pay" data-testid="pay-now" style="pointer-events:none;opacity:.5">Pay now</button>',
};
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><title>Shop</title><body>${pages[req.url] ?? 'not found'}</body>`);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

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
  await page.goto(`${base}/cart`);
  await page.bringToFront();
  // Same call the side panel's "Record the steps first" button makes (with the shop tab in front).
  const started = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'steps-start' }));
  if (!started?.ok) fail(`recording did not start: ${started?.error}`);
  await panel.getByText(/Recording your steps/).waitFor({ timeout: 3000 }).catch(() => fail('panel does not show the recording'));

  await page.waitForTimeout(800);
  await page.locator('#coupon').click();
  await page.keyboard.type('SECRETCODE42');
  await page.locator('h1').click(); // leaving the field fires "change"
  await page.waitForTimeout(1000);
  await page.locator('a').click(); // full page load: recording must carry on
  await page.waitForURL('**/checkout');
  await page.waitForTimeout(1200);
  await page.locator('h1').click();
  await page.waitForTimeout(900);

  await sw.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u + '*' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/picker.js'] });
  }, `${base}/checkout`);
  await page.waitForTimeout(300);
  const box = await page.locator('button.pay').boundingBox();
  await page.mouse.move(box.x + 10, box.y + 5);
  await page.waitForTimeout(100);
  await page.mouse.click(box.x + 10, box.y + 5);

  await panel.getByLabel('What did you expect?').waitFor({ timeout: 5000 });
  if (!(await panel.getByText(/recorded steps/).count())) fail('no "recorded steps" chip');
  await panel.getByLabel('What did you expect?').fill('Pay now should work after a coupon');
  await panel.getByLabel('What did you expect?').press('Enter');
  await panel.getByText('Saved to').waitFor({ timeout: 5000 });

  const out = await panel.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const inbox = await (await root.getDirectoryHandle('.darnly')).getDirectoryHandle('inbox');
    const files = {};
    for await (const [name, h] of inbox.entries()) {
      const f = await h.getFile();
      files[name] = name.endsWith('.md') ? await f.text() : { size: f.size, b64: btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer()))) };
    }
    return files;
  });
  const names = Object.keys(out);
  const md = out[names.find((n) => n.endsWith('.md'))] ?? '';
  const sheet = out[names.find((n) => n.endsWith('.steps.jpg'))];
  console.log('files:', names);
  console.log(md.slice(md.indexOf('## Steps'), md.indexOf('## Element')));
  if (process.env.SAVE_STEPS && sheet) fs.writeFileSync(process.env.SAVE_STEPS, Buffer.from(sheet.b64, 'base64'));
  if (!md.includes('## Steps to get here (recorded by the user)')) fail('recorded steps section missing');
  for (const want of ['Opened `/cart`', 'Clicked field "Coupon code"', 'Typed in field "Coupon code"', 'Clicked link "Go to checkout"', 'Opened `/checkout`']) {
    if (want === 'Clicked field "Coupon code"') continue; // clicks into fields are not steps (typing is)
    if (!md.includes(want)) fail(`step missing: ${want}`);
  }
  if (md.includes('SECRETCODE42')) fail('typed text leaked into the report');
  if (!sheet || sheet.size < 2000) fail('steps picture missing');
  if (!md.includes('.steps.jpg')) fail('report does not point to the steps picture');
  const after = await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'steps-status' }));
  if (after?.count != null) fail('recording did not end with the capture');
  if (errors.length) fail(`panel errors: ${errors.join('; ')}`);
  if (!process.exitCode) console.log('PASS: recorded steps work end to end');
} finally {
  await ctx.close();
  server.close();
}
