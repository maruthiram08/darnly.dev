// Secret generator page: everything runs in the visitor's browser. Nothing is sent, stored or logged.
import { DEFAULTS, generate, bits, strength, cleanPrefix, envValue, envName, type Kind, type Encoding, type Settings } from './secret-generator-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const KINDS: Kind[] = ['auth', 'jwt', 'webhook', 'apikey', 'uuid', 'password'];

const INFO: Record<Kind, { name: string; label: string; tip: string; on: boolean }> = {
  auth: {
    name: 'AUTH_SECRET',
    label: 'Auth',
    on: true,
    tip: 'For Auth.js v5 (<code>AUTH_SECRET</code>), NextAuth v4 (<code>NEXTAUTH_SECRET</code>), Better Auth (<code>BETTER_AUTH_SECRET</code>) and cookie or session signing. Same as <code>npx auth secret</code>.',
  },
  jwt: {
    name: 'JWT_SECRET',
    label: 'JWT',
    on: true,
    tip: 'For signing your own tokens with HS256 or HS512. 32 bytes is the minimum for HS256; 64 bytes covers both. Check a token you made with the <a href="/tools/jwt-decoder/">JWT decoder</a>.',
  },
  webhook: {
    name: 'WEBHOOK_SECRET',
    label: 'Webhook',
    on: true,
    tip: 'For checking that a webhook really came from the sender (an HMAC signature). <code>whsec_</code> is the style Stripe, Svix and Clerk use. If the service gives you its own secret, use that one instead.',
  },
  apikey: {
    name: 'API_KEY',
    label: 'API key',
    on: false,
    tip: 'For keys you hand out to your own users or services. The prefix shows what a key is at a glance and helps leak scanners spot it. Store only a hash of it in your database, like a password.',
  },
  uuid: {
    name: 'APP_ID',
    label: 'UUID',
    on: false,
    tip: 'A unique ID, not a secret: anyone can see it without harm. Use v7 for database primary keys, because new rows sort in order.',
  },
  password: {
    name: 'ADMIN_PASSWORD',
    label: 'Password',
    on: false,
    tip: 'For a database, admin or seed-user password. The symbols leave out <code>$ # " \'</code> and spaces, which break .env files and shell commands. Save it in a password manager.',
  },
};

const BYTES: Partial<Record<Kind, number[]>> = { auth: [32, 48, 64], jwt: [32, 64, 128], webhook: [24, 32, 48] };

const s: Settings = structuredClone(DEFAULTS);
const values = {} as Record<Kind, string>;
const rows = KINDS.map((k) => ({ kind: k, name: INFO[k].name, on: INFO[k].on }));
let current: Kind = 'auth';
let masked = false;

function regen(k: Kind) {
  values[k] = generate(k, s);
}

async function copyText(text: string, btn: HTMLButtonElement) {
  const label = btn.innerHTML;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.innerHTML = label), 1400);
}

function rowFor(k: Kind) {
  return rows.find((r) => r.kind === k)!;
}

// ---- The big card ----

function prefixOf(k: Kind): string {
  if (k === 'apikey') return cleanPrefix(s.apiPrefix);
  if (k === 'webhook') return cleanPrefix(s.webhookPrefix);
  return '';
}

function renderHero(flash = false) {
  const v = values[current];
  const out = $('sg-value');
  out.textContent = '';
  const pre = prefixOf(current);
  if (pre && v.startsWith(pre)) {
    const p = document.createElement('span');
    p.className = 'pre';
    p.textContent = pre;
    out.append(p, v.slice(pre.length));
  } else out.textContent = v;
  out.classList.toggle('masked', masked);
  if (flash) {
    out.classList.add('flash');
    setTimeout(() => out.classList.remove('flash'), 250);
  }

  $('sg-name').textContent = envName(rowFor(current).name);
  const b = bits(current, s);
  $('sg-meta').textContent = `${v.length} characters · ${Math.round(b)} bits of randomness`;

  const meter = $('sg-meter');
  if (current === 'uuid') {
    meter.dataset.level = 'id';
    $('sg-level').textContent = 'An ID, not a secret.';
    $('sg-crack').textContent = s.uuidVersion === 7 ? 'Starts with today’s time, so it sorts in order.' : 'Fully random, so two will never clash.';
  } else {
    const st = strength(b);
    meter.dataset.level = String(st.level);
    $('sg-level').textContent = st.label + '.';
    $('sg-crack').textContent = `A fast guessing rig would need ${st.crack} to find it.`;
  }
}

function renderOpts() {
  for (const o of document.querySelectorAll<HTMLElement>('#sg-opts .opt')) {
    o.hidden = !(o.dataset.for || '').split(' ').includes(current);
  }
  const bytes = BYTES[current];
  if (bytes) {
    const now = current === 'auth' ? s.authBytes : current === 'jwt' ? s.jwtBytes : s.webhookBytes;
    const seg = $('sg-bytes');
    seg.textContent = '';
    for (const n of bytes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.v = String(n);
      b.textContent = `${n} bytes`;
      b.setAttribute('aria-pressed', String(n === now));
      seg.append(b);
    }
  }
  const enc = current === 'jwt' ? s.jwtEnc : s.authEnc;
  pressed('sg-enc', enc);
  pressed('sg-apilen', String(s.apiLength));
  pressed('sg-uuidv', String(s.uuidVersion));
  $('sg-tip').innerHTML = INFO[current].tip;
}

function pressed(id: string, v: string) {
  for (const b of $(id).querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.v === v));
}

function select(k: Kind) {
  current = k;
  for (const t of document.querySelectorAll<HTMLButtonElement>('#sg-kinds [data-kind]')) t.setAttribute('aria-selected', String(t.dataset.kind === k));
  renderOpts();
  renderHero();
}

// After a setting changes: make a new value of this kind and redraw everything that shows it.
function changed() {
  regen(current);
  renderOpts();
  renderHero(true);
  renderEnv();
}

// ---- The .env block ----

function envLines(): string[] {
  return rows.filter((r) => r.on).map((r) => `${envName(r.name)}=${envValue(values[r.kind])}`);
}

function renderRows() {
  const ul = $('sg-rows');
  ul.textContent = '';
  for (const r of rows) {
    const li = document.createElement('li');
    li.classList.toggle('off', !r.on);
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = r.on;
    cb.setAttribute('aria-label', `Include ${INFO[r.kind].label}`);
    cb.addEventListener('change', () => {
      r.on = cb.checked;
      li.classList.toggle('off', !r.on);
      renderEnv();
    });
    const name = document.createElement('input');
    name.type = 'text';
    name.value = r.name;
    name.spellcheck = false;
    name.autocomplete = 'off';
    name.setAttribute('aria-label', `Variable name for ${INFO[r.kind].label}`);
    name.addEventListener('input', () => {
      r.name = name.value;
      renderEnv();
      if (r.kind === current) renderHero();
    });
    name.addEventListener('blur', () => {
      r.name = envName(name.value);
      name.value = r.name;
      renderEnv();
      if (r.kind === current) renderHero();
    });
    const tag = document.createElement('span');
    tag.className = 'kind';
    tag.textContent = INFO[r.kind].label;
    li.append(cb, name, tag);
    ul.append(li);
  }
}

function renderEnv() {
  const pre = $('sg-env');
  pre.textContent = '';
  const lines = envLines();
  const head = document.createElement('span');
  head.className = 'c';
  head.textContent = '# Made with darnly.dev/tools/secret-generator. Never commit this file.\n';
  pre.append(head);
  if (!lines.length) {
    const c = document.createElement('span');
    c.className = 'c';
    c.textContent = '# Tick a line above to add it.';
    pre.append(c);
  }
  for (const l of lines) {
    const i = l.indexOf('=');
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = l.slice(0, i);
    pre.append(k, l.slice(i) + '\n');
  }
  $('sg-count').textContent = `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`;
}

function envText(): string {
  return `# Made with darnly.dev/tools/secret-generator. Never commit this file.\n${envLines().join('\n')}\n`;
}

function promptText(): string {
  const names = rows.filter((r) => r.on).map((r) => envName(r.name));
  const list = names.length ? names.join(', ') : 'my secrets';
  return [
    `I added these variables to .env.local myself: ${list}. Don't ask me for their values and don't print them.`,
    '',
    '1. Make sure .env, .env.local and other .env files are in .gitignore and not tracked by git (if one is tracked, untrack it with git rm --cached and tell me, so I can rotate the keys).',
    `2. Add the names (with empty values) to .env.example so others know what to set.`,
    '3. Read them from process.env on the server only. None of them should start with NEXT_PUBLIC_ or VITE_, or end up in browser code.',
    '4. Remind me to add the same variables in my hosting dashboard (Vercel, Netlify or Cloudflare) for production, with new values there.',
  ].join('\n');
}

function status(msg: string) {
  $('sg-status').textContent = msg;
  setTimeout(() => {
    if ($('sg-status').textContent === msg) $('sg-status').textContent = '';
  }, 3000);
}

// ---- Wiring ----

for (const t of document.querySelectorAll<HTMLButtonElement>('#sg-kinds [data-kind]')) {
  t.addEventListener('click', () => select(t.dataset.kind as Kind));
}

$('sg-regen').addEventListener('click', () => {
  regen(current);
  renderHero(true);
  renderEnv();
});
$('sg-copy').addEventListener('click', (e) => copyText(values[current], e.currentTarget as HTMLButtonElement));
$('sg-copy-env').addEventListener('click', (e) =>
  copyText(`${envName(rowFor(current).name)}=${envValue(values[current])}`, e.currentTarget as HTMLButtonElement),
);
$('sg-value').addEventListener('click', () => copyText(values[current], $('sg-copy')));
$('sg-eye').addEventListener('click', () => {
  masked = !masked;
  $('sg-eye').setAttribute('aria-pressed', String(masked));
  $('sg-eye').textContent = masked ? 'Show' : 'Hide';
  renderHero();
});

$('sg-bytes').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.v;
  if (!v) return;
  const n = Number(v);
  if (current === 'auth') s.authBytes = n;
  else if (current === 'jwt') s.jwtBytes = n;
  else s.webhookBytes = n;
  changed();
});
$('sg-enc').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.v as Encoding | undefined;
  if (!v) return;
  if (current === 'jwt') s.jwtEnc = v;
  else s.authEnc = v;
  changed();
});
$('sg-apilen').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.v;
  if (!v) return;
  s.apiLength = Number(v);
  changed();
});
$('sg-uuidv').addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.v;
  if (!v) return;
  s.uuidVersion = v === '7' ? 7 : 4;
  changed();
});

const prefix = $<HTMLInputElement>('sg-prefix');
prefix.addEventListener('input', () => {
  s.apiPrefix = prefix.value;
  changed();
});
prefix.addEventListener('blur', () => (prefix.value = cleanPrefix(prefix.value)));
$('sg-prefix-chips').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  prefix.value = s.apiPrefix = b.dataset.v || '';
  changed();
});
const whprefix = $<HTMLInputElement>('sg-whprefix');
whprefix.addEventListener('input', () => {
  s.webhookPrefix = whprefix.value;
  changed();
});
whprefix.addEventListener('blur', () => (whprefix.value = cleanPrefix(whprefix.value)));

const pwlen = $<HTMLInputElement>('sg-pwlen');
pwlen.addEventListener('input', () => {
  s.pw.length = Number(pwlen.value);
  $('sg-pwlen-v').textContent = pwlen.value;
  changed();
});
const pwBoxes: [string, 'lower' | 'upper' | 'digits' | 'symbols' | 'noLookalikes'][] = [
  ['sg-pw-lower', 'lower'],
  ['sg-pw-upper', 'upper'],
  ['sg-pw-digits', 'digits'],
  ['sg-pw-symbols', 'symbols'],
  ['sg-pw-look', 'noLookalikes'],
];
for (const [id, key] of pwBoxes) {
  const box = $<HTMLInputElement>(id);
  box.addEventListener('change', () => {
    s.pw[key] = box.checked;
    // Keep at least one kind of character.
    if (!s.pw.lower && !s.pw.upper && !s.pw.digits && !s.pw.symbols) {
      s.pw.lower = true;
      $<HTMLInputElement>('sg-pw-lower').checked = true;
    }
    changed();
  });
}

$('sg-regen-all').addEventListener('click', () => {
  for (const k of KINDS) regen(k);
  renderHero(true);
  renderEnv();
  status('Made a new value for every line.');
});
$('sg-env-copy').addEventListener('click', (e) => copyText(envText(), e.currentTarget as HTMLButtonElement));
$('sg-env-download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([envText()], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = '.env.local';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('Saved. Some computers hide files that start with a dot: rename it to .env.local in your project folder if needed.');
});
$('sg-prompt').addEventListener('click', (e) => copyText(promptText(), e.currentTarget as HTMLButtonElement));

// ---- Start ----

for (const k of KINDS) regen(k);
const fromHash = location.hash.slice(1) as Kind;
renderRows();
renderEnv();
select(KINDS.includes(fromHash) ? fromHash : 'auth');
