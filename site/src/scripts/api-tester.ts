// API tester: builds a request in the browser and sends it through /api/request (site/worker/request.ts),
// which passes it on from darnly.dev's server, so there are no CORS errors. Nothing is stored.

export {};

type Pair = [string, string];
type Result = {
  method: string;
  url: string;
  redirects: { status: number; url: string }[];
  status: number;
  statusText: string;
  ms: number;
  ttfb: number;
  size: number;
  truncated: boolean;
  contentType: string;
  headers: Pair[];
  body: string | null;
  binary: boolean;
  dropped: string[];
};
type Tone = 'ok' | 'warn' | 'bad' | 'idle';
type BodyType = 'none' | 'json' | 'text' | 'form';
type AuthType = 'none' | 'bearer' | 'basic' | 'key';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const methodSel = $<HTMLSelectElement>('at-method');
const urlInput = $<HTMLInputElement>('at-url');
const form = $<HTMLFormElement>('at-form');
const sendBtn = $<HTMLButtonElement>('at-send');
const headerRows = $<HTMLDivElement>('at-header-rows');
const addHeader = $<HTMLButtonElement>('at-add-header');
const headerCount = $<HTMLElement>('at-header-count');
const headerNote = $<HTMLElement>('at-header-note');
const bodyInput = $<HTMLTextAreaElement>('at-body');
const bodyCheck = $<HTMLElement>('at-body-check');
const bodyFormat = $<HTMLButtonElement>('at-body-format');
const bodyNote = $<HTMLElement>('at-body-note');
const bodyWrap = $<HTMLElement>('at-body-wrap');
const authUser = $<HTMLInputElement>('at-auth-user');
const authPass = $<HTMLInputElement>('at-auth-pass');
const authToken = $<HTMLInputElement>('at-auth-token');
const authKeyName = $<HTMLInputElement>('at-auth-keyname');
const authKeyValue = $<HTMLInputElement>('at-auth-keyvalue');
const stage = $<HTMLDivElement>('at-stage');
const statusCode = $<HTMLElement>('at-code');
const statusText = $<HTMLElement>('at-status-text');
const meaning = $<HTMLElement>('at-meaning');
const tip = $<HTMLElement>('at-tip');
const cards = $<HTMLDivElement>('at-cards');
const viewer = $<HTMLElement>('at-viewer');
const viewerBar = $<HTMLElement>('at-viewer-bar');
const viewPretty = $<HTMLButtonElement>('at-view-pretty');
const viewRaw = $<HTMLButtonElement>('at-view-raw');
const resHeaders = $<HTMLElement>('at-res-headers');
const resHeadersCount = $<HTMLElement>('at-res-headers-count');
const sentList = $<HTMLElement>('at-sent');
const copyCurl = $<HTMLButtonElement>('at-copy-curl');
const copyFetch = $<HTMLButtonElement>('at-copy-fetch');
const copyBody = $<HTMLButtonElement>('at-copy-body');
const copyPrompt = $<HTMLButtonElement>('at-copy-prompt');
const copyStatus = $<HTMLElement>('at-copy-status');
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tab]'));
const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-panel]'));
const bodyTypes = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="at-body-type"]'));
const authTypes = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="at-auth-type"]'));
const authPanels = Array.from(document.querySelectorAll<HTMLElement>('[data-auth]'));

let last: Result | null = null;
let view: 'pretty' | 'raw' = 'pretty';
let busy = false;

// ---------- Plain-words meanings of status codes ----------

const STATUS: Record<number, [string, string, string?]> = {
  // code: [short name, what it means, what to do]
  100: ['Continue', 'The server is ready for the rest of the request.'],
  101: ['Switching Protocols', 'The server is switching to another protocol, like WebSockets.'],
  200: ['OK', 'It worked. The server understood the request and sent back what you asked for.'],
  201: ['Created', 'It worked, and something new was created, like a new row or user.'],
  202: ['Accepted', 'The server took the job and will finish it later, in the background.'],
  204: ['No Content', 'It worked. There’s simply nothing to send back, which is normal for deletes and updates.'],
  206: ['Partial Content', 'The server sent back one part of the file, as asked.'],
  301: ['Moved Permanently', 'This address has moved for good.', 'Use the new address from the Location header in your code.'],
  302: ['Found', 'This address points somewhere else for now.', 'Look at the Location header to see where.'],
  303: ['See Other', 'The answer is at another address.'],
  304: ['Not Modified', 'Nothing changed since your last copy, so the server sent no body.'],
  307: ['Temporary Redirect', 'Send the same request to another address for now.'],
  308: ['Permanent Redirect', 'This address has moved for good. Send the same request to the new one.'],
  400: ['Bad Request', 'The server didn’t accept what you sent.', 'Usually the body is missing a field, has a wrong type, or isn’t valid JSON. Read the response body below: most APIs say which field is wrong.'],
  401: ['Unauthorized', 'You’re not signed in. The token or API key is missing, wrong or expired.', 'Add it in the Auth tab. If you already did, check it hasn’t expired and that it’s the right kind of key (for example, not a test key on a live API).'],
  402: ['Payment Required', 'This needs a paid plan or more credits.', 'Check billing in the API provider’s dashboard.'],
  403: ['Forbidden', 'The server knows who you are, but you aren’t allowed to do this.', 'Check the key’s permissions or scopes. With Supabase, this is often a Row Level Security policy that blocks the row.'],
  404: ['Not Found', 'There’s nothing at this address.', 'Check the path for typos, that the id exists, and that you’re on the right version (/v1/ or /v2/).'],
  405: ['Method Not Allowed', 'This address exists, but it doesn’t accept this method.', 'Try another method, like POST instead of GET. The Allow header (if any) lists the ones it takes.'],
  406: ['Not Acceptable', 'The server can’t answer in the format you asked for.', 'Remove or change the Accept header.'],
  408: ['Request Timeout', 'The server got tired of waiting for your request.'],
  409: ['Conflict', 'This clashes with what’s already there, like a duplicate email or an old version.', 'Use a different value, or fetch the latest version and try again.'],
  410: ['Gone', 'This used to exist but was removed for good.'],
  411: ['Length Required', 'The server wants to know the size of the body first.'],
  413: ['Content Too Large', 'What you sent is too big for this server.', 'Send less data, or upload big files another way (like a signed upload URL).'],
  414: ['URI Too Long', 'The address is too long.', 'Move the data from the query string into a POST body.'],
  415: ['Unsupported Media Type', 'The server doesn’t accept this kind of body.', 'Most APIs want JSON: pick JSON in the Body tab, which adds Content-Type: application/json.'],
  418: ['I’m a teapot', 'A joke status from 1998. Some servers use it to turn away bots.'],
  422: ['Unprocessable Content', 'The body has the right shape, but some values fail validation.', 'Read the response body for which field is wrong, like an email that isn’t an email.'],
  425: ['Too Early', 'The server won’t risk handling this request yet.'],
  426: ['Upgrade Required', 'The server wants a newer protocol, often https instead of http.'],
  428: ['Precondition Required', 'The server wants an If-Match header so you don’t overwrite someone else’s change.'],
  429: ['Too Many Requests', 'You’re rate limited: too many requests in a short time.', 'Wait and try again. A Retry-After header, if there is one, says how many seconds to wait. In code, retry with a growing pause.'],
  431: ['Request Header Fields Too Large', 'The headers are too big, often because of a huge cookie or token.'],
  451: ['Unavailable For Legal Reasons', 'This is blocked for legal reasons, often in some countries only.'],
  500: ['Internal Server Error', 'The server crashed while handling this. The bug is in the server code, not in your request.', 'Look at the server’s logs (Vercel, Supabase, Railway…) for the error and line. The copied prompt below gives your AI agent everything it needs.'],
  501: ['Not Implemented', 'The server doesn’t support this method at all.'],
  502: ['Bad Gateway', 'Something in front of the app (a proxy or host) got no good answer from it.', 'The app may have crashed or be starting up. Check its logs and try again in a minute.'],
  503: ['Service Unavailable', 'The server is down, overloaded or under maintenance.', 'Try again shortly. If it’s your app, check it’s running and not over its limits.'],
  504: ['Gateway Timeout', 'The app took too long to answer, so the host gave up.', 'A slow database query or an outside API call is the usual cause. Serverless functions often stop at 10 to 60 seconds.'],
  520: ['Unknown Error (Cloudflare)', 'Cloudflare got an empty or odd answer from the server behind it.'],
  521: ['Web Server Is Down (Cloudflare)', 'Cloudflare couldn’t connect to the server behind it.'],
  522: ['Connection Timed Out (Cloudflare)', 'Cloudflare couldn’t reach the server behind it in time.'],
  524: ['A Timeout Occurred (Cloudflare)', 'The server behind Cloudflare took over 100 seconds to answer.'],
};

function describe(code: number): { name: string; text: string; tip: string; tone: Tone } {
  const known = STATUS[code];
  const tone: Tone = code >= 200 && code < 300 ? 'ok' : code >= 400 ? 'bad' : 'warn';
  if (known) return { name: known[0], text: known[1], tip: known[2] ?? '', tone };
  const cls =
    code < 200 ? 'An informational answer.' :
    code < 300 ? 'It worked.' :
    code < 400 ? 'The answer is somewhere else.' :
    code < 500 ? 'The server didn’t accept the request. Something in what you sent needs fixing.' :
    'The server failed while handling this. The problem is on the server side.';
  return { name: '', text: cls, tip: '', tone };
}

// ---------- Small helpers ----------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function bytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} KB`;
  return `${(n / 1_000_000).toFixed(2)} MB`;
}

function speed(ms: number): { label: string; cls: Tone } {
  if (ms < 300) return { label: 'Fast', cls: 'ok' };
  if (ms < 1000) return { label: 'OK', cls: 'ok' };
  if (ms < 3000) return { label: 'Slow', cls: 'warn' };
  return { label: 'Very slow', cls: 'bad' };
}

function header(list: Pair[], name: string): string | null {
  const hit = list.find(([k]) => k.toLowerCase() === name);
  return hit ? hit[1] : null;
}

function utf8btoa(s: string): string {
  let bin = '';
  new TextEncoder().encode(s).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

// JSON with colors. Big bodies are shown plain so the page stays quick.
function highlight(json: string): string {
  if (json.length > 300_000) return esc(json);
  return esc(json).replace(
    /(&quot;(?:\\.|[^\\&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (m, str, colon, bool) => {
      if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
      if (bool) return `<span class="b">${m}</span>`;
      if (m === 'null') return `<span class="n">${m}</span>`;
      return `<span class="d">${m}</span>`;
    },
  );
}

// Where a JSON.parse error is, as a line and column, with the line itself.
function jsonError(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const pos = Number(msg.match(/position (\d+)/)?.[1] ?? NaN);
    const lc = msg.match(/line (\d+) column (\d+)/);
    let line = lc ? Number(lc[1]) : NaN;
    let col = lc ? Number(lc[2]) : NaN;
    if (!lc && !Number.isNaN(pos)) {
      const before = text.slice(0, pos).split('\n');
      line = before.length;
      col = before[before.length - 1].length + 1;
    }
    let hint = '';
    if (/'/.test(text) && !/"/.test(text)) hint = ' JSON needs double quotes ("), not single quotes.';
    else if (/,\s*[}\]]/.test(text)) hint = ' There’s a comma right before a closing bracket. JSON doesn’t allow that.';
    else if (/{\s*[A-Za-z_]\w*\s*:/.test(text)) hint = ' Names need double quotes in JSON, like "name": "Ada".';
    return Number.isNaN(line) ? `This isn’t valid JSON yet.${hint}` : `This isn’t valid JSON: check line ${line}, column ${col}.${hint}`;
  }
}

// ---------- Building the request ----------

function bodyType(): BodyType {
  return (bodyTypes.find((r) => r.checked)?.value as BodyType) ?? 'none';
}
function authType(): AuthType {
  return (authTypes.find((r) => r.checked)?.value as AuthType) ?? 'none';
}

function userHeaders(): Pair[] {
  return Array.from(headerRows.querySelectorAll<HTMLElement>('.hrow'))
    .map((row) => {
      const [k, v] = Array.from(row.querySelectorAll<HTMLInputElement>('input[type="text"]'));
      const on = row.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked ?? true;
      return on ? ([k.value.trim(), v.value] as Pair) : null;
    })
    .filter((p): p is Pair => !!p && !!p[0]);
}

// Everything that gets sent: the headers you typed, plus auth and Content-Type when you chose them.
function built(maskSecrets = false): { method: string; url: string; headers: Pair[]; body: string } {
  const method = methodSel.value;
  const headers = userHeaders();
  const has = (n: string) => headers.some(([k]) => k.toLowerCase() === n);
  const secret = (v: string, label: string) => (maskSecrets ? `<${label}>` : v);
  const auth = authType();
  if (auth === 'bearer' && authToken.value.trim() && !has('authorization')) {
    headers.push(['Authorization', `Bearer ${secret(authToken.value.trim().replace(/^Bearer\s+/i, ''), 'YOUR_TOKEN')}`]);
  } else if (auth === 'basic' && (authUser.value || authPass.value) && !has('authorization')) {
    headers.push(['Authorization', `Basic ${maskSecrets ? '<BASE64_USER_AND_PASSWORD>' : utf8btoa(`${authUser.value}:${authPass.value}`)}`]);
  } else if (auth === 'key' && authKeyName.value.trim() && authKeyValue.value && !has(authKeyName.value.trim().toLowerCase())) {
    headers.push([authKeyName.value.trim(), secret(authKeyValue.value, 'YOUR_API_KEY')]);
  }
  const sendsBody = method !== 'GET' && method !== 'HEAD';
  const type = bodyType();
  let body = sendsBody && type !== 'none' ? bodyInput.value : '';
  if (body && !has('content-type')) {
    const ct = type === 'json' ? 'application/json' : type === 'form' ? 'application/x-www-form-urlencoded' : 'text/plain';
    headers.push(['Content-Type', ct]);
  }
  if (maskSecrets) {
    headers.forEach((h) => {
      if (/^(authorization|x-api-key|api-key|apikey|x-auth-token)$/i.test(h[0]) && !h[1].startsWith('<') && !/<[A-Z_]+>/.test(h[1])) {
        h[1] = h[1].replace(/^(Bearer|Basic|Token)\s+.*/i, '$1 <SECRET>').replace(/^(?!Bearer|Basic|Token).*/i, '<SECRET>');
      }
    });
  }
  let url = urlInput.value.trim();
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  return { method, url, headers, body };
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function curl(mask = false): string {
  const r = built(mask);
  const parts = [`curl${r.method === 'GET' ? '' : r.method === 'HEAD' ? ' -I' : ` -X ${r.method}`} ${shq(r.url)}`];
  r.headers.forEach(([k, v]) => parts.push(`-H ${shq(`${k}: ${v}`)}`));
  if (r.body) parts.push(`--data-raw ${shq(r.body)}`);
  return parts.join(' \\\n  ');
}

function fetchCode(): string {
  const r = built();
  const opts: string[] = [];
  if (r.method !== 'GET') opts.push(`  method: '${r.method}',`);
  if (r.headers.length) {
    opts.push('  headers: {');
    r.headers.forEach(([k, v]) => opts.push(`    ${JSON.stringify(k)}: ${JSON.stringify(v)},`));
    opts.push('  },');
  }
  if (r.body) {
    let asJson: unknown = undefined;
    if (bodyType() === 'json') {
      try {
        asJson = JSON.parse(r.body);
      } catch {
        /* fall back to the raw text */
      }
    }
    if (asJson !== undefined) {
      const inner = JSON.stringify(asJson, null, 2).split('\n').join('\n  ');
      opts.push(`  body: JSON.stringify(${inner}),`);
    } else opts.push(`  body: ${JSON.stringify(r.body)},`);
  }
  const call = opts.length ? `fetch(${JSON.stringify(r.url)}, {\n${opts.join('\n')}\n})` : `fetch(${JSON.stringify(r.url)})`;
  const isJson = last ? /json/i.test(last.contentType) : true;
  return [
    `const res = await ${call};`,
    `if (!res.ok) throw new Error(\`Request failed: \${res.status}\`);`,
    `const data = await res.${isJson ? 'json' : 'text'}();`,
  ].join('\n');
}

// ---------- The form ----------

function addRow(k = '', v = '', on = true): void {
  const row = document.createElement('div');
  row.className = 'hrow';
  row.innerHTML = `
    <input type="checkbox" aria-label="Send this header" ${on ? 'checked' : ''} />
    <input type="text" placeholder="Header name" aria-label="Header name" spellcheck="false" autocomplete="off" />
    <input type="text" placeholder="Value" aria-label="Header value" spellcheck="false" autocomplete="off" />
    <button type="button" class="x" aria-label="Remove header">×</button>`;
  const [kIn, vIn] = Array.from(row.querySelectorAll<HTMLInputElement>('input[type="text"]'));
  kIn.value = k;
  vIn.value = v;
  row.querySelector('.x')!.addEventListener('click', () => {
    row.remove();
    if (!headerRows.children.length) addRow();
    refreshForm();
  });
  row.addEventListener('input', refreshForm);
  row.addEventListener('change', refreshForm);
  headerRows.append(row);
}

function setRows(list: Pair[]): void {
  headerRows.innerHTML = '';
  list.forEach(([k, v]) => addRow(k, v));
  addRow();
}

function setRadio(list: HTMLInputElement[], value: string): void {
  list.forEach((r) => (r.checked = r.value === value));
}

function refreshForm(): void {
  const hs = userHeaders();
  headerCount.textContent = hs.length ? String(hs.length) : '';
  const dropped = hs.filter(([k]) => /^(cookie|cookie2|host|content-length)$/i.test(k)).map(([k]) => k);
  headerNote.textContent = dropped.length
    ? `${dropped.join(', ')} won’t be sent: cookies never go through this tool, and the size and host are set for you.`
    : '';

  const type = bodyType();
  const method = methodSel.value;
  bodyWrap.hidden = type === 'none';
  bodyFormat.hidden = type !== 'json';
  bodyNote.textContent = (method === 'GET' || method === 'HEAD') && type !== 'none' ? `${method} requests don’t send a body. Switch to POST, PUT or PATCH to send it.` : '';
  if (type === 'json' && bodyInput.value.trim()) {
    const err = jsonError(bodyInput.value);
    bodyCheck.textContent = err ?? '✓ Valid JSON';
    bodyCheck.className = `check ${err ? 'bad' : 'ok'}`;
  } else {
    bodyCheck.textContent = '';
    bodyCheck.className = 'check';
  }
  bodyInput.placeholder = type === 'form' ? 'name=Ada&email=ada%40example.com' : type === 'json' ? '{ "name": "Ada" }' : 'Any text';

  const auth = authType();
  authPanels.forEach((p) => (p.hidden = p.dataset.auth !== auth));
  const authTab = tabs.find((t) => t.dataset.tab === 'auth');
  if (authTab) authTab.querySelector('.count')!.textContent = auth === 'none' ? '' : '✓';
  const bodyTab = tabs.find((t) => t.dataset.tab === 'body');
  if (bodyTab) bodyTab.querySelector('.count')!.textContent = type === 'none' ? '' : type.toUpperCase();
  methodSel.dataset.m = method;
}

function openTab(name: string): void {
  tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  panels.forEach((p) => (p.hidden = p.dataset.panel !== name));
}

// ---------- Showing the response ----------

function setStage(tone: Tone): void {
  stage.dataset.tone = tone;
}

function card(label: string, value: string, note = '', cls = ''): string {
  return `<div class="card ${cls}"><span class="label">${esc(label)}</span><strong>${esc(value)}</strong>${note ? `<span class="note">${esc(note)}</span>` : ''}</div>`;
}

function showError(title: string, text: string, tipText = ''): void {
  last = null;
  setStage('bad');
  statusCode.textContent = '✕';
  statusText.textContent = title;
  meaning.textContent = text;
  tip.textContent = tipText;
  tip.hidden = !tipText;
  cards.innerHTML = '';
  viewer.innerHTML = '';
  viewerBar.hidden = true;
  resHeaders.innerHTML = '';
  resHeadersCount.textContent = '';
  sentList.innerHTML = '';
  copyBody.disabled = true;
}

function renderBody(): void {
  if (!last) return;
  if (last.binary) {
    viewer.innerHTML = `<p class="empty">This is a ${esc(last.contentType.split(';')[0] || 'binary')} file (${bytes(last.size)}), not text. Open the address in your browser to see it.</p>`;
    viewerBar.hidden = true;
    return;
  }
  const text = last.body ?? '';
  if (!text) {
    viewer.innerHTML = `<p class="empty">${last.method === 'HEAD' ? 'HEAD requests never get a body. Only the headers below.' : 'The response has no body.'}</p>`;
    viewerBar.hidden = true;
    return;
  }
  let parsed: unknown = undefined;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  viewerBar.hidden = parsed === undefined;
  viewPretty.setAttribute('aria-pressed', String(view === 'pretty'));
  viewRaw.setAttribute('aria-pressed', String(view === 'raw'));
  const cut = last.truncated ? `<p class="empty">Only the first 1 MB is shown.</p>` : '';
  if (parsed !== undefined && view === 'pretty') viewer.innerHTML = `<pre class="code">${highlight(JSON.stringify(parsed, null, 2))}</pre>${cut}`;
  else viewer.innerHTML = `<pre class="code">${esc(text.length > 300_000 ? text.slice(0, 300_000) + '\n…' : text)}</pre>${cut}`;
}

const HEADER_NOTES: Record<string, string> = {
  'content-type': 'What kind of data the body is.',
  'content-length': 'Size of the body in bytes.',
  'cache-control': 'How long browsers and CDNs may keep a copy.',
  'access-control-allow-origin': 'Which websites may read this from the browser (CORS).',
  'access-control-allow-methods': 'Methods other websites may use (CORS).',
  'access-control-allow-headers': 'Headers other websites may send (CORS).',
  'set-cookie': 'The server wants to save a cookie. This tool never keeps it.',
  'retry-after': 'How long to wait before trying again.',
  'www-authenticate': 'How the server wants you to sign in.',
  location: 'Where the redirect points.',
  server: 'The software or host answering.',
  etag: 'A fingerprint of this version, for caching.',
  'last-modified': 'When this last changed.',
  'x-ratelimit-limit': 'How many requests you get per time window.',
  'x-ratelimit-remaining': 'How many requests you have left in this window.',
  'x-ratelimit-reset': 'When your request count resets.',
  'ratelimit-remaining': 'How many requests you have left in this window.',
  'strict-transport-security': 'Browsers must always use https here.',
  'content-encoding': 'How the body was compressed.',
  vary: 'Which request headers change the answer.',
  allow: 'The methods this address accepts.',
  'x-powered-by': 'The framework behind the server.',
  'cf-ray': 'Cloudflare’s id for this request.',
  'x-vercel-id': 'Vercel’s id for this request.',
};

function show(r: Result): void {
  last = r;
  const d = describe(r.status);
  setStage(d.tone);
  statusCode.textContent = String(r.status);
  statusText.textContent = d.name || r.statusText || '';
  meaning.textContent = d.text;
  tip.textContent = d.tip ? `What to do: ${d.tip}` : '';
  tip.hidden = !d.tip;

  const sp = speed(r.ms);
  const type = r.contentType.split(';')[0].trim();
  const acao = header(r.headers, 'access-control-allow-origin');
  const remaining = header(r.headers, 'x-ratelimit-remaining') ?? header(r.headers, 'ratelimit-remaining');
  const out = [
    card('Time', `${r.ms.toLocaleString()} ms`, `${sp.label}. First byte after ${r.ttfb.toLocaleString()} ms, from our server.`, sp.cls === 'ok' ? 'ok' : sp.cls === 'warn' ? 'warn' : 'bad'),
    card('Size', bytes(r.size), r.truncated ? 'Bigger than 1 MB, so only the start is shown.' : type ? type : 'No content type', r.truncated ? 'warn' : ''),
    acao
      ? card('Browser apps (CORS)', acao === '*' ? 'Any site can call it' : 'Only some sites', acao === '*' ? 'A fetch from your web app will work.' : `Allowed: ${acao}`, 'ok')
      : card('Browser apps (CORS)', 'Blocked in browsers', 'It works here, but fetch from a web app on another domain fails with a CORS error. Call it from your server, or add Access-Control-Allow-Origin.', 'warn'),
  ];
  if (remaining !== null) out.push(card('Rate limit left', remaining, header(r.headers, 'x-ratelimit-limit') ? `of ${header(r.headers, 'x-ratelimit-limit')} per window` : 'requests in this window', Number(remaining) < 5 ? 'warn' : ''));
  if (r.redirects.length) out.push(card('Redirected', `${r.redirects.length}×`, `Ended at ${r.url}`, 'warn'));
  if (r.dropped.length) out.push(card('Not sent', r.dropped.join(', '), 'Cookies and forwarding headers never go through this tool.', 'warn'));
  cards.innerHTML = out.join('');

  renderBody();

  resHeadersCount.textContent = String(r.headers.length);
  resHeaders.innerHTML = r.headers
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}${HEADER_NOTES[k] ? `<span class="hn">${esc(HEADER_NOTES[k])}</span>` : ''}</td></tr>`)
    .join('');

  const sent = built(true);
  sentList.innerHTML =
    `<tr><th>${esc(sent.method)}</th><td>${esc(sent.url)}</td></tr>` +
    r.redirects.map((x) => `<tr><th>${x.status}</th><td>Redirected from ${esc(x.url)}</td></tr>`).join('') +
    sent.headers.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('') +
    (sent.headers.some(([k]) => k.toLowerCase() === 'user-agent') ? '' : `<tr><th>User-Agent</th><td>DarnlyAPITester/1.0 (added for you)</td></tr>`);
  copyBody.disabled = !r.body;
}

async function send(): Promise<void> {
  if (busy) return;
  const r = built();
  if (!r.url) {
    urlInput.focus();
    return;
  }
  if (bodyType() === 'json' && r.body && jsonError(r.body)) {
    openTab('body');
    showError('Fix the JSON first', jsonError(r.body)!, 'The body is checked as you type. Click “Tidy JSON” once it’s valid to lay it out neatly.');
    return;
  }
  busy = true;
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending…';
  stage.classList.add('loading');
  try {
    const res = await fetch('/api/request', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: r.method, url: r.url, headers: r.headers, body: r.body }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data.status !== 'number') {
      const msg = (data && data.error) || 'Something went wrong on our side. Try again in a moment.';
      if (data?.kind === 'timeout') showError('No answer', msg, 'The API may be down or very slow. If it’s your own app, check that it’s running and look at its logs.');
      else if (data?.kind === 'network') showError('Couldn’t connect', msg, 'Common causes: a typo in the domain, an app that isn’t deployed yet, or an address that only works on your computer (localhost).');
      else showError(res.status === 429 ? 'Slow down a little' : 'Can’t send that', msg);
    } else show(data as Result);
  } catch {
    showError('No connection', 'We couldn’t reach darnly.dev. Check your internet connection and try again.');
  } finally {
    busy = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    stage.classList.remove('loading');
  }
}

// ---------- Copy ----------

async function copy(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    copyStatus.textContent = done;
  } catch {
    copyStatus.textContent = 'Your browser blocked copying. Select the text and copy it by hand.';
  }
  window.setTimeout(() => (copyStatus.textContent = ''), 4000);
}

function prompt(): string {
  const r = last;
  const lines = ['I’m calling an API and need help with the result.', '', 'The request (secrets replaced):', '```sh', curl(true), '```', ''];
  if (!r) {
    lines.push(`It didn’t get a response: ${statusText.textContent} — ${meaning.textContent}`);
  } else {
    const d = describe(r.status);
    lines.push(`The response: ${r.status} ${d.name || r.statusText} after ${r.ms} ms.`);
    const keep = r.headers.filter(([k]) => /^(content-type|www-authenticate|retry-after|location|allow|access-control-|x-ratelimit|ratelimit)/i.test(k));
    if (keep.length) lines.push('', 'Response headers:', ...keep.map(([k, v]) => `${k}: ${v}`));
    if (r.body) {
      const body = r.body.length > 3000 ? `${r.body.slice(0, 3000)}\n… (cut)` : r.body;
      lines.push('', 'Response body:', '```', body, '```');
    }
    lines.push(
      '',
      r.status >= 400
        ? 'Explain in plain words why this fails, then find the code in my project that makes this call (or the server code that handles it) and fix it.'
        : 'Find the code in my project that makes this call and check it handles this response correctly, including errors and an empty body.',
    );
  }
  return lines.join('\n');
}

copyCurl.addEventListener('click', () => copy(curl(), 'curl command copied. It includes your token, so don’t share it.'));
copyFetch.addEventListener('click', () => copy(fetchCode(), 'JavaScript fetch code copied.'));
copyBody.addEventListener('click', () => last?.body && copy(last.body, 'Response body copied.'));
copyPrompt.addEventListener('click', () => copy(prompt(), 'Prompt copied, with your secrets replaced. Paste it into Claude Code, Cursor or Codex.'));

// ---------- Examples ----------

const EXAMPLES: Record<string, { method: string; url: string; headers?: Pair[]; body?: string; type?: BodyType; auth?: AuthType; token?: string }> = {
  get: { method: 'GET', url: 'https://jsonplaceholder.typicode.com/posts/1' },
  post: {
    method: 'POST',
    url: 'https://jsonplaceholder.typicode.com/posts',
    type: 'json',
    body: JSON.stringify({ title: 'Hello from Darnly', body: 'Testing my API', userId: 1 }, null, 2),
  },
  notfound: { method: 'GET', url: 'https://jsonplaceholder.typicode.com/posts/999999' },
  auth: { method: 'GET', url: 'https://api.github.com/user', headers: [['Accept', 'application/vnd.github+json']], auth: 'bearer', token: 'not-a-real-token' },
  dog: { method: 'GET', url: 'https://dog.ceo/api/breeds/image/random' },
};

function loadExample(name: string): void {
  const ex = EXAMPLES[name];
  if (!ex) return;
  methodSel.value = ex.method;
  urlInput.value = ex.url;
  setRows(ex.headers ?? []);
  bodyInput.value = ex.body ?? '';
  setRadio(bodyTypes, ex.type ?? 'none');
  setRadio(authTypes, ex.auth ?? 'none');
  authToken.value = ex.token ?? '';
  authUser.value = authPass.value = authKeyValue.value = '';
  openTab(ex.type ? 'body' : ex.auth ? 'auth' : 'headers');
  refreshForm();
  void send();
}

// ---------- Wiring ----------

form.addEventListener('submit', (e) => {
  e.preventDefault();
  void send();
});
addHeader.addEventListener('click', () => {
  addRow();
  (headerRows.lastElementChild?.querySelector('input[type="text"]') as HTMLInputElement | null)?.focus();
});
tabs.forEach((t) => t.addEventListener('click', () => openTab(t.dataset.tab!)));
methodSel.addEventListener('change', () => {
  const m = methodSel.value;
  if ((m === 'POST' || m === 'PUT' || m === 'PATCH') && bodyType() === 'none') {
    setRadio(bodyTypes, 'json');
    if (!bodyInput.value.trim()) bodyInput.value = '{\n  \n}';
    openTab('body');
  }
  refreshForm();
});
[...bodyTypes, ...authTypes].forEach((r) => r.addEventListener('change', refreshForm));
bodyInput.addEventListener('input', refreshForm);
[authToken, authUser, authPass, authKeyName, authKeyValue].forEach((i) => i.addEventListener('input', refreshForm));
bodyFormat.addEventListener('click', () => {
  try {
    bodyInput.value = JSON.stringify(JSON.parse(bodyInput.value), null, 2);
    refreshForm();
  } catch {
    /* the check line already says what's wrong */
  }
});
viewPretty.addEventListener('click', () => {
  view = 'pretty';
  renderBody();
});
viewRaw.addEventListener('click', () => {
  view = 'raw';
  renderBody();
});
document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((b) => b.addEventListener('click', () => loadExample(b.dataset.example!)));

// Paste a curl command into the address box and it fills in the whole form.
urlInput.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text') ?? '';
  if (!/^\s*curl\s/i.test(text)) return;
  const parsed = parseCurl(text);
  if (!parsed) return;
  e.preventDefault();
  methodSel.value = parsed.method;
  urlInput.value = parsed.url;
  const auth = parsed.headers.find(([k, v]) => k.toLowerCase() === 'authorization' && /^bearer\s/i.test(v));
  setRows(parsed.headers.filter((h) => h !== auth));
  setRadio(authTypes, auth ? 'bearer' : 'none');
  authToken.value = auth ? auth[1].replace(/^bearer\s+/i, '') : '';
  bodyInput.value = parsed.body;
  const ct = parsed.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  setRadio(bodyTypes, !parsed.body ? 'none' : /json/i.test(ct) || /^\s*[{[]/.test(parsed.body) ? 'json' : /urlencoded/i.test(ct) ? 'form' : 'text');
  refreshForm();
  copyStatus.textContent = 'Filled in from your curl command. Press Send.';
});

function parseCurl(text: string): { method: string; url: string; headers: Pair[]; body: string } | null {
  const tokens: string[] = [];
  const src = text.replace(/\\\r?\n/g, ' ');
  const re = /'((?:[^']|'\\'')*)'|"((?:\\.|[^"\\])*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) tokens.push(m[1] !== undefined ? m[1].replace(/'\\''/g, "'") : m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3]);
  let method = '';
  let url = '';
  const headers: Pair[] = [];
  let body = '';
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-X' || t === '--request') method = (tokens[++i] ?? '').toUpperCase();
    else if (t === '-H' || t === '--header') {
      const h = tokens[++i] ?? '';
      const at = h.indexOf(':');
      if (at > 0) headers.push([h.slice(0, at).trim(), h.slice(at + 1).trim()]);
    } else if (/^(-d|--data|--data-raw|--data-binary|--json)$/.test(t)) {
      body = tokens[++i] ?? '';
      if (t === '--json' && !headers.some(([k]) => k.toLowerCase() === 'content-type')) headers.push(['Content-Type', 'application/json']);
    } else if (t === '-I' || t === '--head') method = 'HEAD';
    else if (t === '--url') url = tokens[++i] ?? '';
    else if (/^-u$|^--user$/.test(t)) headers.push(['Authorization', `Basic ${utf8btoa(tokens[++i] ?? '')}`]);
    else if (!t.startsWith('-') && !url) url = t;
  }
  if (!url) return null;
  if (!method) method = body ? 'POST' : 'GET';
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) method = 'GET';
  return { method, url, headers, body };
}

setRows([]);
openTab('headers');
refreshForm();
loadExample('get');
