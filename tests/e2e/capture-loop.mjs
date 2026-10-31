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
  await page.mouse.click(box.x + 20, box.y + 10);

  await panel.getByLabel('What did you expect?').waitFor({ timeout: 5000 });
  await panel.getByLabel('What did you expect?').fill('Pay now should be clickable and open the payment form');
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
  if (!md.includes('pointer-events: none')) fail('styles missing');
  if (!md.includes('**Expected:** Pay now should be clickable')) fail('note missing');
  if (!(png > 1000)) fail('screenshot missing or empty');
  const logsName = names.find((n) => n.endsWith('.logs.json'));
  const all = md + (logsName ? out[logsName] : '');
  for (const secret of ['hunter2', '4242424242424242', ['sk', 'live', '51HqLyjWDarjtT1zdp7dcXYZ'].join('_'), 'abc12345', 's3cr3tsessionvalue']) {
    if (all.includes(secret)) fail('secret leaked: ' + secret);
  }
  if (!logsName) fail('logs.json missing');
  if (!md.includes('## Errors (last 60s)')) fail('errors section missing');
  if (!/console\.error: Payment init failed/.test(md)) fail('console error missing');
  if (!/uncaught error: .*TypeError/.test(md)) fail('uncaught error missing');
  if (!md.includes('POST /api/cart?token=[hidden]&page=2 500')) fail('failed fetch missing or not redacted');
  if (!/GET \/missing-logo\.png 404 .*\[image\]/.test(md)) fail('missing image (browser-only failure) missing');
  if (errors.length) fail('panel errors: ' + errors.join('; '));
  if (process.exitCode) console.log("FAILED"); else console.log('PASS: capture loop works end to end');
} finally {
  await ctx.close();
  server.close();
}
