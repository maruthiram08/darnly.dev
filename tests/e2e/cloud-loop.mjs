// End-to-end check of the cloud inbox: capture -> upload to a local Darnly cloud -> agent marks it fixed -> panel shows it.
// Run with `npm run e2e:cloud`. It starts the cloud Worker locally (wrangler dev) with dev sign-in switched on.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ext = path.join(root, '.output-e2e/chrome-mv3');
const cloudDir = path.join(root, 'cloud');
const port = 8790 + Math.floor(Math.random() * 100);
const cloud = `http://127.0.0.1:${port}`;
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'darnly-cloud-'));
const run = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn('npx', ['wrangler', ...args], { cwd: cloudDir, env, stdio: 'ignore' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`wrangler ${args[0]} exited ${code}`))));
  });
await run(['d1', 'migrations', 'apply', 'darnly', '--local', '--persist-to', persist]);
const worker = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist, '--var', 'ALLOW_DEV_LOGIN:true'], { cwd: cloudDir, env, stdio: 'ignore', detached: true });
for (let i = 0; i < 60; i++) {
  const ok = await fetch(`${cloud}/v1/health`).then((r) => r.ok, () => false);
  if (ok) break;
  await new Promise((r) => setTimeout(r, 500));
}

const page_ = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(fs.readFileSync(path.join(root, 'tests/fixtures/checkout.html')));
});
await new Promise((r) => page_.listen(0, r));
const url = `http://localhost:${page_.address().port}/checkout`;

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  viewport: { width: 1200, height: 800 },
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const id = new URL(sw.url()).host;
  const panel = await ctx.newPage();
  const errors = [];
  panel.on('pageerror', (e) => errors.push(e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);

  // Cloud project, pointed at the local Worker. Sign in the way the real button does, minus Google.
  const token = await panel.evaluate(async (cloud) => {
    await chrome.storage.local.set({ cloudProject: true, cloudUrl: cloud });
    const r = await fetch(`${cloud}/v1/auth/google`, { method: 'POST', body: JSON.stringify({ devEmail: 'maruthi@example.com' }) });
    const s = await r.json();
    await chrome.storage.local.set({ cloudSession: { token: s.token, email: s.email } });
    return s.token;
  }, cloud);
  await panel.reload();
  await panel.getByText('Sending bugs to your Darnly inbox').waitFor({ timeout: 5000 }).catch(() => fail('signed-in header missing'));
  await panel.getByText('Connect your agent (once)').waitFor({ timeout: 3000 }).catch(() => fail('connect-agent card missing'));
  if (!(await panel.getByText(`${cloud}/mcp`).count())) fail('MCP address missing');

  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(300);
  await page.bringToFront();
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
  await panel.getByLabel('What did you expect?').fill('Pay now should open the payment form');
  await panel.getByLabel('What did you expect?').press('Enter');
  await panel.getByText('Sent to your Darnly inbox').waitFor({ timeout: 8000 }).catch(() => fail('not sent to the cloud'));

  // What the agent would see.
  const list = await (await fetch(`${cloud}/v1/bugs`, { headers: { authorization: `Bearer ${token}` } })).json();
  const bug = list.bugs?.[0];
  if (!bug) fail('bug not in the cloud inbox');
  else {
    const full = await (await fetch(`${cloud}/v1/bugs/${bug.id}`, { headers: { authorization: `Bearer ${token}` } })).json();
    if (!full.report.includes('**Expected:** Pay now should open the payment form')) fail('report missing the note');
    if (!full.report.includes('the screenshot returned with this bug')) fail('report not written for the cloud');
    if (full.report.includes('.darnly/')) fail('cloud report mentions local folders');
    const pic = await fetch(`${cloud}/v1/bugs/${bug.id}/picture`, { headers: { authorization: `Bearer ${token}` } });
    if (pic.status !== 200 || (await pic.arrayBuffer()).byteLength < 1000) fail('picture missing');
    if (bug.title !== 'Pay now should open the payment form') fail('title wrong: ' + bug.title);

    await panel.getByText('1 waiting, 0 fixed').waitFor({ timeout: 10000 }).catch(() => fail('cloud list missing'));
    // The agent marks it fixed through the API (MCP does the same call).
    await fetch(`${cloud}/v1/bugs/${bug.id}/fixed`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ note: 'wired Pay now to openPaymentForm()' }) });
    await panel.getByText('1 bug fixed. Take a look.').waitFor({ timeout: 12000 }).catch(() => fail('fixed nudge missing'));
    await panel.getByText('wired Pay now to openPaymentForm()').waitFor({ timeout: 3000 }).catch(() => fail('fix note missing'));
  }

  // Delete everything: two steps.
  await panel.getByRole('button', { name: 'Delete all my cloud bugs' }).click();
  await panel.getByRole('button', { name: 'Yes, delete' }).click();
  await panel.getByText('Deleted 1 bug from your Darnly inbox.').waitFor({ timeout: 5000 }).catch(() => fail('delete all failed'));
  const after = await (await fetch(`${cloud}/v1/bugs`, { headers: { authorization: `Bearer ${token}` } })).json();
  if (after.bugs?.length !== 0) fail('bugs still in the cloud after delete');

  if (errors.length) fail('panel errors: ' + errors.join('; '));
  if (process.exitCode) console.log('FAILED'); else console.log('PASS: cloud inbox works end to end');
} finally {
  await ctx.close();
  page_.close();
  try { process.kill(-worker.pid); } catch {}
  fs.rmSync(persist, { recursive: true, force: true });
}
