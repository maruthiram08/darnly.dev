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
const cloudRequire = createRequire(new URL('../../cloud/package.json', import.meta.url));
const { Client } = cloudRequire('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = cloudRequire('@modelcontextprotocol/sdk/client/streamableHttp.js');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ext = path.join(root, '.output-e2e/chrome-mv3');
const cloudDir = path.join(root, 'cloud');
const port = 8790 + Math.floor(Math.random() * 100);
const cloud = `http://127.0.0.1:${port}`;
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };

// Connector sign-in, the way Claude or Cursor does it: register, consent page, approve, swap the code for a token.
async function connectAgent(email) {
  const redirect = 'http://127.0.0.1:7777/callback';
  const reg = await (await fetch(`${cloud}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [redirect], client_name: 'E2E Agent', token_endpoint_auth_method: 'none' }) })).json();
  const b64 = (b) => Buffer.from(b).toString('base64url');
  const verifier = b64(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 's' });
  const consent = await fetch(`${cloud}/authorize?${q}`);
  const tx = /name="tx" value="([^"]+)"/.exec(await consent.text())[1];
  const cookie = consent.headers.get('set-cookie').split(';')[0];
  const approved = await fetch(`${cloud}/authorize`, { method: 'POST', headers: { cookie }, body: new URLSearchParams({ tx, devEmail: email }), redirect: 'manual' });
  const code = new URL(approved.headers.get('location')).searchParams.get('code');
  const tok = await (await fetch(`${cloud}/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier }) })).json();
  return tok.access_token;
}

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'darnly-cloud-'));
const run = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn('npx', ['wrangler', ...args], { cwd: cloudDir, env, stdio: 'ignore' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`wrangler ${args[0]} exited ${code}`))));
  });
await run(['d1', 'migrations', 'apply', 'darnly', '--local', '--persist-to', persist]);
const worker = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist, '--var', 'ALLOW_DEV_LOGIN:true', '--var', `PUBLIC_URL:${cloud}`, '--local-upstream', `127.0.0.1:${port}`], { cwd: cloudDir, env, stdio: 'ignore', detached: true });
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
  // Paste a picture of what it should look like (a 1x1 PNG), the way Cmd+V with a screenshot would.
  await panel.getByLabel('What did you expect?').evaluate((el) => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'want.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await panel.getByText('Picture of what you want added').waitFor({ timeout: 3000 }).catch(() => fail('pasted picture not shown'));
  // Impatient double press: still one bug.
  await Promise.all([panel.getByLabel('What did you expect?').press('Enter'), panel.getByLabel('What did you expect?').press('Enter').catch(() => {})]);
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
    // The agent connects through MCP (OAuth sign-in like Claude or Cursor), reads the bug and marks it fixed.
    const agentToken = await connectAgent('maruthi@example.com');
    const client = new Client({ name: 'e2e-agent', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${cloud}/mcp`), { requestInit: { headers: { authorization: `Bearer ${agentToken}` } } }));
    const tools = (await client.listTools()).tools.map((t) => t.name).join(',');
    if (tools !== 'list_bugs,get_bug,mark_fixed') fail('MCP tools wrong: ' + tools);
    const listed = await client.callTool({ name: 'list_bugs', arguments: {} });
    if (!listed.content[0].text.includes(bug.id)) fail('MCP list_bugs missing the bug');
    const got = await client.callTool({ name: 'get_bug', arguments: { id: bug.id } });
    if (!got.content[0].text.includes('Pay now should open the payment form')) fail('MCP get_bug missing the note');
    if (got.content[1]?.type !== 'image') fail('MCP get_bug missing the picture');
    if (got.content[3]?.type !== 'image' || !String(got.content[2]?.text).includes('What it should look like')) fail('MCP get_bug missing the picture of what it should look like');
    if (!got.content[0].text.includes('the second picture returned with this bug')) fail('report does not mention the reference picture');
    await client.callTool({ name: 'mark_fixed', arguments: { id: bug.id, note: 'wired Pay now to openPaymentForm()' } });
    await client.close();
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
