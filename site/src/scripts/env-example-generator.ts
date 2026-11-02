// .env.example generator: runs only in the visitor's browser. The pasted .env is never uploaded
// and never saved (no localStorage), because it holds real secrets.

export {};

type Kind = 'secret' | 'public' | 'config' | 'unknown';
type Info = { kind: Kind; what: string; where?: string };
type Var = { key: string; value: string; line: number; commented: boolean };
type Entry = { t: 'blank' } | { t: 'comment'; text: string } | { t: 'var'; v: Var } | { t: 'bad'; text: string; line: number };
type Row = Var & Info & { bare: string; prefix: string; framework: string; leak: boolean; check: boolean; dup: boolean; kept: boolean };
type Out = { text: string; cls: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('ee-input');
const stage = $<HTMLDivElement>('ee-stage');
const icon = $<HTMLElement>('ee-icon');
const headline = $<HTMLElement>('ee-headline');
const subline = $<HTMLElement>('ee-subline');
const stats = $<HTMLDivElement>('ee-stats');
const leaks = $<HTMLDivElement>('ee-leaks');
const output = $<HTMLElement>('ee-output');
const outCount = $<HTMLElement>('ee-out-count');
const table = $<HTMLElement>('ee-table');
const problems = $<HTMLDivElement>('ee-problems');
const optNotes = $<HTMLInputElement>('ee-notes');
const optKeep = $<HTMLInputElement>('ee-keep');
const optUser = $<HTMLInputElement>('ee-comments');
const copyOut = $<HTMLButtonElement>('ee-copy');
const download = $<HTMLButtonElement>('ee-download');
const copyPrompt = $<HTMLButtonElement>('ee-copy-prompt');
const pasteBtn = $<HTMLButtonElement>('ee-paste');
const clearBtn = $<HTMLButtonElement>('ee-clear');
const status = $<HTMLElement>('ee-status');

// ---------- Public prefixes: anything starting with these is bundled into browser code ----------

const PREFIXES: [string, string][] = [
  ['NEXT_PUBLIC_', 'Next.js'],
  ['EXPO_PUBLIC_', 'Expo'],
  ['NUXT_PUBLIC_', 'Nuxt'],
  ['REACT_APP_', 'Create React App'],
  ['VITE_', 'Vite'],
  ['VUE_APP_', 'Vue CLI'],
  ['GATSBY_', 'Gatsby'],
  ['PUBLIC_', 'Astro or SvelteKit'],
];

// ---------- Naming the key in plain words ----------

const WORDS: Record<string, string> = {
  API: 'API', URL: 'URL', URI: 'URI', ID: 'ID', JWT: 'JWT', DB: 'database', AWS: 'AWS', SMTP: 'SMTP', DSN: 'DSN', SID: 'SID',
  OAUTH: 'OAuth', S3: 'S3', AI: 'AI', GA: 'Google Analytics', GTM: 'Google Tag Manager', CDN: 'CDN', R2: 'R2', KV: 'KV',
  VAPID: 'VAPID', CSRF: 'CSRF', OPENAI: 'OpenAI', NEXTAUTH: 'NextAuth', POSTHOG: 'PostHog', GITHUB: 'GitHub',
  SENDGRID: 'SendGrid', MONGODB: 'MongoDB', MONGO: 'MongoDB', LEMONSQUEEZY: 'Lemon Squeezy', UPLOADTHING: 'UploadThing',
  ELEVENLABS: 'ElevenLabs', OPENROUTER: 'OpenRouter', DEEPSEEK: 'DeepSeek', XAI: 'xAI', HUGGINGFACE: 'Hugging Face',
  HF: 'Hugging Face', POSTGRES: 'Postgres', POSTGRESQL: 'Postgres', PG: 'Postgres', MYSQL: 'MySQL', PAYPAL: 'PayPal',
  RECAPTCHA: 'reCAPTCHA', HCAPTCHA: 'hCaptcha', LIVEKIT: 'LiveKit', PLANETSCALE: 'PlanetScale', TURSO: 'Turso',
  SUPABASE: 'Supabase', STRIPE: 'Stripe', CLERK: 'Clerk', FIREBASE: 'Firebase', GOOGLE: 'Google', ANTHROPIC: 'Anthropic',
  GEMINI: 'Gemini', GROQ: 'Groq', RESEND: 'Resend', VERCEL: 'Vercel', CLOUDFLARE: 'Cloudflare', SENTRY: 'Sentry',
  RAZORPAY: 'Razorpay', TWILIO: 'Twilio', ALGOLIA: 'Algolia', PUSHER: 'Pusher', CONVEX: 'Convex', MAPBOX: 'Mapbox',
  CLOUDINARY: 'Cloudinary', UPSTASH: 'Upstash', REDIS: 'Redis', NEON: 'Neon', PINECONE: 'Pinecone', MISTRAL: 'Mistral',
  REPLICATE: 'Replicate', COHERE: 'Cohere', PERPLEXITY: 'Perplexity', DISCORD: 'Discord', SLACK: 'Slack',
  MAILGUN: 'Mailgun', POSTMARK: 'Postmark', NODE: 'Node', ENV: 'environment', TURNSTILE: 'Turnstile',
};

function humanize(bare: string): string {
  const parts = bare.split(/[_.-]+/).filter(Boolean);
  const words = parts.map((p, i) => {
    const w = WORDS[p.toUpperCase()];
    if (w) return w;
    const low = p.toLowerCase();
    return i === 0 ? low.charAt(0).toUpperCase() + low.slice(1) : low;
  });
  const s = words.join(' ') || bare;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- What each key is, from its name (without the public prefix) ----------

const SERVER = 'Server only. Never put it in browser code.';
const BROWSER = 'Safe in the browser.';
const AI = /^(OPENAI|ANTHROPIC|CLAUDE|GEMINI|GOOGLE_GENERATIVE_AI|GOOGLE_AI|GROQ|MISTRAL|COHERE|REPLICATE|HUGGINGFACE|HF|ELEVENLABS|PERPLEXITY|OPENROUTER|DEEPSEEK|XAI|GROK|TOGETHER|FIREWORKS|FAL|AZURE_OPENAI)_/;

const RULES: [RegExp, Kind, string?, string?][] = [
  [/^NODE_ENV$/, 'config', 'Which mode the app runs in (development or production)'],
  [/^PORT$/, 'config', 'Port the server listens on'],
  [/SUPABASE_SERVICE_ROLE(_KEY)?$|SUPABASE_SECRET(_KEY)?$/, 'secret', 'Supabase service role key', 'Server only. It skips every database security rule.'],
  [/SUPABASE_JWT_SECRET$/, 'secret', 'Supabase JWT secret'],
  [/SUPABASE_(ANON|PUBLISHABLE)(_KEY)?$/, 'public', 'Supabase anon key', 'Safe in the browser when Row Level Security is on.'],
  [/SUPABASE_URL$/, 'public', 'Supabase project URL'],
  [/STRIPE_WEBHOOK_SECRET$/, 'secret', 'Stripe webhook signing secret'],
  [/STRIPE_(SECRET|RESTRICTED)(_API)?_KEY$|^STRIPE_(API_KEY|SK|KEY)$/, 'secret', 'Stripe secret key', 'Server only. Anyone who has it can charge and refund your customers.'],
  [/STRIPE_(PUBLISHABLE(_API)?|PUBLIC)_KEY$|^STRIPE_PK$/, 'public', 'Stripe publishable key'],
  [/CLERK_PUBLISHABLE_KEY$/, 'public', 'Clerk publishable key'],
  [/CLERK_SECRET_KEY$/, 'secret', 'Clerk secret key'],
  [/^FIREBASE_(PRIVATE_KEY|SERVICE_ACCOUNT\w*|ADMIN\w*)$/, 'secret', 'Firebase Admin credentials'],
  [/^FIREBASE_CLIENT_EMAIL$/, 'config', 'Firebase Admin service account email', 'Not secret, but only the server needs it.'],
  [/^FIREBASE_(API_KEY|AUTH_DOMAIN|PROJECT_ID|STORAGE_BUCKET|MESSAGING_SENDER_ID|APP_ID|MEASUREMENT_ID|DATABASE_URL)$/, 'public', 'Firebase web config', 'Safe in the browser. Protect your data with Firebase Security Rules.'],
  [/^UPSTASH_REDIS_REST_URL$|^KV_REST_API_URL$/, 'config', 'Upstash Redis REST URL'],
  [/(DATABASE|POSTGRES|POSTGRESQL|MYSQL|MONGO|MONGODB|REDIS|DIRECT|SHADOW_DATABASE|TURSO_DATABASE|NEON|PG|DB)_(URL|URI|DSN|CONNECTION_STRING|PRISMA_URL|URL_NON_POOLING|URL_UNPOOLED)$|^(DATABASE|DIRECT|MONGO|MONGODB|REDIS|DB)$/, 'secret', 'Database connection string', 'Server only. It has your database password in it.'],
  [/SENTRY_DSN$/, 'public', 'Sentry DSN', 'Safe in the browser. It only lets apps send errors to your Sentry.'],
  [/POSTHOG_PERSONAL_API_KEY$/, 'secret', 'PostHog personal API key'],
  [/POSTHOG_(KEY|API_KEY|PROJECT_API_KEY|TOKEN)$/, 'public', 'PostHog project key'],
  [/^(GA|GA4|GOOGLE_ANALYTICS|GA_MEASUREMENT|GTM)(_MEASUREMENT|_TRACKING|_CONTAINER)?_ID$/, 'public', 'Google Analytics ID'],
  [/^MIXPANEL_(TOKEN|PROJECT_TOKEN)$|^AMPLITUDE_API_KEY$/, 'public', 'Analytics project key'],
  [/(RECAPTCHA|TURNSTILE|HCAPTCHA)_SITE_?KEY$/, 'public', 'Captcha site key'],
  [/GOOGLE_MAPS(_API)?_KEY$/, 'public', 'Google Maps key', 'Fine in the browser if you limit it to your domain in Google Cloud.'],
  [/^MAPBOX(_ACCESS|_PUBLIC)?_TOKEN$/, 'public', 'Mapbox public token', 'Fine in the browser if you limit it to your domain in Mapbox.'],
  [/^ALGOLIA_(SEARCH|SEARCH_ONLY)(_API)?_KEY$|^ALGOLIA_APP(LICATION)?_ID$/, 'public', 'Algolia search key'],
  [/^ALGOLIA_ADMIN(_API)?_KEY$/, 'secret', 'Algolia admin key'],
  [/^PUSHER_(APP_)?KEY$|^PUSHER_(APP_)?CLUSTER$/, 'public', 'Pusher app key'],
  [/^RAZORPAY_KEY_ID$/, 'public', 'Razorpay key ID', 'Safe in the browser checkout. The key secret is what you protect.'],
  [/^TWILIO_ACCOUNT_SID$/, 'config', 'Twilio account SID', 'Not secret on its own, but only the server needs it.'],
  [/^CONVEX_URL$/, 'public', 'Convex deployment URL'],
  [/^AWS_ACCESS_KEY_ID$/, 'secret', 'AWS access key ID', 'Server only. It pairs with the secret access key.'],
  [/_CLIENT_ID$/, 'public', '', 'Fine in the browser. The client secret is what you protect.'],
  [/^VAPID_PUBLIC_KEY$|_PUBLIC_KEY$/, 'public', '', 'A public key, safe to share.'],
];

const SECRET_WORDS = /(SECRET|PRIVATE|PASSWORD|PASSWD|PWD|_PASS$|^PASS$|CREDENTIAL|SALT|SIGNING|HMAC|ENCRYPTION_KEY|MASTER_KEY|COOKIE_KEY)/;
const PUBLIC_WORDS = /(PUBLISHABLE|ANON_KEY|SITE_KEY|SITEKEY|MEASUREMENT_ID)/;
const KEY_WORDS = /(TOKEN|API_KEY|APIKEY|ACCESS_KEY|AUTH_KEY|_KEY$|^KEY$|_PAT$|WEBHOOK|AUTH$)/;
const CONFIG_WORDS = /(URL|URI|HOST|HOSTNAME|PORT|DOMAIN|REGION|_ID$|NAME|_ENV$|MODE|LEVEL|BUCKET|PROJECT|ORG|EMAIL|FROM|VERSION|ENABLED|DISABLED|DEBUG|TIMEOUT|LOCALE|LANG|TZ|ZONE|PATH|DIR|BASE|ENDPOINT|CLUSTER|SENDER|USER$|USERNAME|LIMIT|SIZE|COUNT|TTL|FLAG|FEATURE|CURRENCY|COUNTRY|PLAN|PRICE)/;

function byName(bare: string): Info {
  const k = bare.toUpperCase();
  const what = humanize(bare);
  for (const [re, kind, w, where] of RULES) {
    if (re.test(k)) return { kind, what: w || what, where };
  }
  if (AI.test(k) && /(KEY|TOKEN|SECRET)/.test(k)) return { kind: 'secret', what, where: 'Server only. Anyone who has it can run up your AI bill.' };
  if (SECRET_WORDS.test(k)) return { kind: 'secret', what };
  if (PUBLIC_WORDS.test(k)) return { kind: 'public', what };
  if (KEY_WORDS.test(k)) return { kind: 'secret', what };
  if (CONFIG_WORDS.test(k)) return { kind: 'config', what };
  return { kind: 'unknown', what };
}

// ---------- What a value looks like (wins over the name when it is clearly a secret) ----------

function jwtRole(v: string): string {
  const m = /^eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]*$/.exec(v);
  if (!m) return '';
  try {
    const b = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4)));
    return typeof json.role === 'string' ? json.role : 'jwt';
  } catch {
    return '';
  }
}

const SECRET_VALUES: [RegExp, string][] = [
  [/^(sk|rk)_live_/, 'Live secret key'],
  [/^(sk|rk)_test_/, 'Test secret key'],
  [/^whsec_/, 'Webhook signing secret'],
  [/^sk-ant-/, 'Anthropic API key'],
  [/^sk-[\w-]{16,}/, 'AI API key'],
  [/^(gh[pousr]_|github_pat_)/, 'GitHub token'],
  [/^glpat-/, 'GitLab token'],
  [/^xox[abprs]-/, 'Slack token'],
  [/^AKIA[0-9A-Z]{16}$/, 'AWS access key ID'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY/, 'Private key'],
  [/^SG\.[\w-]{10,}\.[\w-]{10,}/, 'SendGrid API key'],
  [/^npm_[A-Za-z0-9]{20,}/, 'npm token'],
  [/^hf_[A-Za-z0-9]{20,}/, 'Hugging Face token'],
  [/^gsk_[A-Za-z0-9]{20,}/, 'Groq API key'],
  [/^r8_[A-Za-z0-9]{20,}/, 'Replicate token'],
  [/^xai-[A-Za-z0-9]{20,}/, 'xAI API key'],
  [/^sk\.eyJ/, 'Mapbox secret token'],
  [/^[a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:[^@\s]+@/i, 'Connection string with a password'],
];

function classify(bare: string, value: string): Info {
  const info = byName(bare);
  const role = jwtRole(value);
  if (role === 'service_role') return { kind: 'secret', what: 'Supabase service role key', where: 'Server only. It skips every database security rule.' };
  if (role === 'anon' && info.kind !== 'secret') return { kind: 'public', what: info.kind === 'public' ? info.what : 'Supabase anon key', where: 'Safe in the browser when Row Level Security is on.' };
  for (const [re, label] of SECRET_VALUES) {
    if (re.test(value)) {
      if (info.kind === 'secret') return info;
      return { kind: 'secret', what: info.kind === 'unknown' ? label : `${info.what} (looks like a ${label.toLowerCase()})`, where: SERVER };
    }
  }
  if (info.kind === 'unknown' && /^pk_(live|test)_|^pk\.eyJ|^phc_/.test(value)) return { kind: 'public', what: info.what };
  return info;
}

// Secret-looking text inside comments (old keys people commented out), replaced before output.
const SCRUB = /\b((sk|rk)_(live|test)_\w+|whsec_\w+|sk-[\w-]{16,}|gh[pousr]_\w{20,}|github_pat_\w+|xox[abprs]-[\w-]+|AKIA[0-9A-Z]{16}|SG\.[\w-]{10,}\.[\w-]{10,}|eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*|[a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:[^@\s]+@\S+)/gi;

// ---------- Parsing the .env ----------

const ASSIGN = /^(export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s?(.*)$/;

function unquote(rest: string, lines: string[], i: number): { value: string; next: number } {
  const q = rest.charAt(0);
  if (q === '"' || q === "'" || q === '`') {
    let buf = rest.slice(1);
    let j = i;
    for (;;) {
      let end = -1;
      for (let p = 0; p < buf.length; p++) {
        if (buf[p] === '\\' && q === '"') { p++; continue; }
        if (buf[p] === q) { end = p; break; }
      }
      if (end >= 0) return { value: buf.slice(0, end), next: j };
      if (j + 1 >= lines.length) return { value: buf, next: j };
      j++;
      buf += '\n' + lines[j];
    }
  }
  const hash = rest.search(/\s#/);
  return { value: (hash >= 0 ? rest.slice(0, hash) : rest).trim(), next: i };
}

function parse(text: string): Entry[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: Entry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { out.push({ t: 'blank' }); continue; }
    if (line.startsWith('#')) {
      const inner = line.replace(/^#+\s*/, '');
      const m = ASSIGN.exec(inner);
      if (m && !/\s/.test(m[2])) {
        out.push({ t: 'var', v: { key: m[2], value: unquote(m[3].trim(), [inner], 0).value, line: i + 1, commented: true } });
      } else {
        out.push({ t: 'comment', text: line });
      }
      continue;
    }
    const m = ASSIGN.exec(line);
    if (!m) { out.push({ t: 'bad', text: line, line: i + 1 }); continue; }
    const { value, next } = unquote(m[3].trim(), lines.map((l) => l), i);
    out.push({ t: 'var', v: { key: m[2], value, line: i + 1, commented: false } });
    i = next;
  }
  while (out.length && out[out.length - 1].t === 'blank') out.pop();
  return out;
}

const HARMLESS = /^(\d{1,6}|true|false|yes|no|on|off|development|production|staging|test|preview|local|debug|info|warn|warning|error|silent|en|en-US|UTC|https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/[^\s@]*)?|localhost|127\.0\.0\.1|0\.0\.0\.0)$/i;

function analyse(entries: Entry[]): Row[] {
  const seen = new Map<string, number>();
  const rows: Row[] = [];
  for (const e of entries) {
    if (e.t !== 'var') continue;
    const v = e.v;
    const pre = PREFIXES.find(([p]) => v.key.toUpperCase().startsWith(p));
    const prefix = pre ? v.key.slice(0, pre[0].length) : '';
    const bare = v.key.slice(prefix.length) || v.key;
    const info = classify(bare, v.value);
    const n = v.commented ? 0 : (seen.get(v.key) || 0) + 1;
    if (!v.commented) seen.set(v.key, n);
    const leak = !!prefix && info.kind === 'secret';
    rows.push({
      ...v,
      ...info,
      bare,
      prefix,
      framework: pre ? pre[1] : '',
      leak,
      check: !!prefix && info.kind === 'unknown',
      dup: n > 1,
      kept: false,
    });
  }
  return rows;
}

function where(r: Row): string {
  if (r.leak) return `SECRET, but ${r.prefix} sends it to every visitor. Rename it to ${r.bare} and use it only on the server.`;
  if (r.check) return `${r.prefix} sends it to every visitor. Make sure it’s not a secret.`;
  if (r.where) return r.where;
  if (r.kind === 'secret') return SERVER;
  if (r.kind === 'public') return BROWSER;
  if (r.kind === 'config') return 'Not secret.';
  return 'Not sure what this is, so keep it private.';
}

function build(entries: Entry[], rows: Row[]): Out[] {
  const out: Out[] = [
    { text: '# Copy this file to .env and fill in your own values.', cls: 'c' },
    { text: '# Never commit .env itself. Made with darnly.dev/tools/env-example-generator', cls: 'c' },
    { text: '', cls: '' },
  ];
  let ri = 0;
  for (const e of entries) {
    if (e.t === 'blank') { if (out[out.length - 1]?.text !== '') out.push({ text: '', cls: '' }); continue; }
    if (e.t === 'bad') continue;
    if (e.t === 'comment') {
      if (optUser.checked) out.push({ text: e.text.replace(SCRUB, '<removed>'), cls: 'c' });
      continue;
    }
    const r = rows[ri++];
    if (r.dup) continue;
    const keep = optKeep.checked && r.kind === 'config' && HARMLESS.test(r.value);
    r.kept = !r.commented && keep;
    const cls = r.leak ? 'leak' : r.check ? 'warn' : r.kind === 'secret' ? 'secret' : '';
    if (optNotes.checked && !r.commented) out.push({ text: `# ${r.what}. ${where(r)}`, cls: r.leak ? 'note leak-note' : 'note' });
    const val = r.kept ? (/[\s#"']/.test(r.value) ? `"${r.value}"` : r.value) : '';
    out.push({ text: `${r.commented ? '# ' : ''}${r.key}=${val}`, cls: r.commented ? 'c' : `key ${cls}` });
  }
  while (out.length && out[out.length - 1].text === '') out.pop();
  return out;
}

// ---------- Rendering ----------

let current = { text: '', rows: [] as Row[], entries: [] as Entry[] };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

function setTone(tone: 'ok' | 'warn' | 'bad' | 'idle', mark: string, head: string, sub: string) {
  stage.dataset.tone = tone;
  icon.textContent = mark;
  headline.textContent = head;
  subline.innerHTML = sub;
}

function render() {
  const entries = parse(input.value);
  const rows = analyse(entries);
  const lines = build(entries, rows);
  const live = rows.filter((r) => !r.commented && !r.dup);
  current = { text: lines.map((l) => l.text).join('\n') + '\n', rows: live, entries };

  output.innerHTML = lines
    .map((l) => {
      const html = esc(l.text) || ' ';
      if (l.cls.startsWith('key')) {
        const [k, v] = [l.text.slice(0, l.text.indexOf('=')), l.text.slice(l.text.indexOf('=') + 1)];
        return `<span class="ln ${l.cls}"><span class="k">${esc(k)}</span>=<span class="v">${esc(v)}</span></span>`;
      }
      return `<span class="ln ${l.cls}">${html}</span>`;
    })
    .join('');
  outCount.textContent = live.length ? plural(live.length, 'key') : '';

  const leaked = live.filter((r) => r.leak);
  const checks = live.filter((r) => r.check);
  const secrets = live.filter((r) => r.kind === 'secret');
  const pub = live.filter((r) => r.kind === 'public');
  const bad = entries.filter((e): e is Extract<Entry, { t: 'bad' }> => e.t === 'bad');
  const dups = rows.filter((r) => r.dup);

  if (!live.length) {
    setTone('idle', '•', input.value.trim() ? 'No keys found yet' : 'Paste your .env to start', 'Lines look like <code>KEY=value</code>. Your file stays in this browser tab.');
  } else if (leaked.length) {
    const fw = leaked[0].framework;
    setTone(
      'bad',
      '!',
      `${plural(leaked.length, 'secret')} would be shipped to the browser`,
      `${fw} puts every key starting with <code>${esc(leaked[0].prefix)}</code> into your site’s JavaScript, where anyone can read it. The <code>.env.example</code> below is still safe to commit.`,
    );
  } else if (checks.length) {
    setTone('warn', '?', `Your .env.example is ready. Check ${plural(checks.length, 'key')}`, `${plural(checks.length, 'key')} with a public prefix will be visible in the browser, and we can’t tell what ${checks.length === 1 ? 'it is' : 'they are'}.`);
  } else {
    setTone('ok', '✓', `Your .env.example is ready: ${plural(live.length, 'key')}, no values`, `${plural(secrets.length, 'secret')} marked server only, ${pub.length} safe in the browser. Nothing leaks to the browser.`);
  }

  stats.innerHTML = live.length
    ? [
        ['Keys', String(live.length), ''],
        ['Server only', String(secrets.length), ''],
        ['Safe in browser', String(pub.length), ''],
        ['Shipped by mistake', String(leaked.length), leaked.length ? 'bad' : 'ok'],
      ]
        .map(([l, n, c]) => `<div class="stat ${c}"><strong>${n}</strong><span>${l}</span></div>`)
        .join('')
    : '';

  leaks.innerHTML = [...leaked, ...checks]
    .map(
      (r) =>
        `<div class="leak-card ${r.leak ? 'bad' : 'warn'}"><code>${esc(r.key)}</code><p>${
          r.leak
            ? `${esc(r.what)}. Every visitor can read it. Rename it to <code>${esc(r.bare)}</code>, use it only in server code, and get a new key if this site is already live.`
            : `${esc(r.what)}. Visible to every visitor. If it’s a secret, drop the <code>${esc(r.prefix)}</code> and use it only on the server.`
        }</p></div>`,
    )
    .join('');

  const msgs: string[] = [];
  if (dups.length) msgs.push(`<strong>Listed twice:</strong> ${dups.map((r) => `<code>${esc(r.key)}</code>`).join(', ')}. Your app uses only one of them, usually the last. We kept the first.`);
  if (bad.length) msgs.push(`<strong>Skipped ${plural(bad.length, 'line')} that ${bad.length === 1 ? 'isn’t' : 'aren’t'} <code>KEY=value</code>:</strong> line ${bad.slice(0, 6).map((b) => b.line).join(', ')}${bad.length > 6 ? '…' : ''}.`);
  problems.innerHTML = msgs.map((m) => `<p>${m}</p>`).join('');

  const LABEL: Record<Kind, string> = { secret: 'Server only', public: 'Safe in browser', config: 'Plain setting', unknown: 'Not sure' };
  table.innerHTML = live
    .map((r) => {
      const tag = r.leak ? ['bad', 'Leaks to browser'] : r.check ? ['warn', 'Check'] : [r.kind, LABEL[r.kind]];
      return `<tr><td><code>${esc(r.key)}</code></td><td>${esc(r.what)}</td><td><span class="tag ${tag[0]}">${tag[1]}</span></td><td>${esc(where(r))}</td></tr>`;
    })
    .join('');

  const empty = !live.length;
  copyOut.disabled = empty;
  download.disabled = empty;
  copyPrompt.disabled = empty;
  copyPrompt.textContent = leaked.length ? 'Copy prompt: move these secrets to the server' : 'Copy prompt for your AI agent';
}

function prompt(): string {
  const leaked = current.rows.filter((r) => r.leak);
  const secrets = current.rows.filter((r) => r.kind === 'secret' && !r.leak);
  const list = (rs: Row[]) => rs.map((r) => `- ${r.key} (${r.what})`).join('\n');
  const parts: string[] = [];
  if (leaked.length) {
    parts.push(
      `These environment variables in my project hold secrets, but their names start with a public prefix, so ${leaked[0].framework} bundles them into the JavaScript every visitor downloads:\n${list(leaked)}\n\nPlease move these secrets to server-only code:\n` +
        `1. Rename each one without the public prefix (for example ${leaked[0].key} becomes ${leaked[0].bare}) in .env, .env.example and every place the code reads it.\n` +
        `2. Move every piece of code that uses them out of browser components into server-only code (an API route, server action, or edge/serverless function), and have the browser call that instead.\n` +
        `3. Search the codebase to confirm no browser code still reads them.\n` +
        `4. Remind me to rotate these keys in each provider’s dashboard, because they may already be public.`,
    );
  } else {
    parts.push('Please check my project’s environment variables are set up safely.');
  }
  if (secrets.length) parts.push(`These must stay server-only. Check that no client component, browser bundle or public file imports or prints them:\n${list(secrets)}`);
  parts.push('Also make sure .env (and .env.local, .env.*.local) is in .gitignore and was never committed, and add this .env.example at the project root:\n\n```\n' + current.text.trim() + '\n```');
  return parts.join('\n\n');
}

// ---------- Examples (fake values, built at runtime) ----------

function fakeJwt(role: string): string {
  const enc = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ iss: 'supabase', ref: 'abcdefghijklmnop', role, iat: 1735689600, exp: 2051222400 })}.EXAMPLEsignatureNotReal0000000000000000000`;
}
const fake = (pre: string, n = 32) => pre + 'EXAMPLE' + 'x0'.repeat(Math.ceil((n - 7) / 2)).slice(0, n - 7);

const EXAMPLES: Record<string, () => string> = {
  next: () =>
    [
      '# Supabase',
      'NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnop.supabase.co',
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${fakeJwt('anon')}`,
      `SUPABASE_SERVICE_ROLE_KEY=${fakeJwt('service_role')}`,
      '',
      '# Payments',
      `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${fake('pk_' + 'test_')}`,
      `STRIPE_SECRET_KEY=${fake('sk_' + 'test_')}`,
      `STRIPE_WEBHOOK_SECRET=${fake('wh' + 'sec_')}`,
      '',
      '# AI',
      `NEXT_PUBLIC_OPENAI_API_KEY=${fake('sk-' + 'proj-', 40)}`,
      '',
      '# Database',
      'DATABASE_URL="postgresql://postgres:hunter2-not-real@db.abcdefghijklmnop.supabase.co:5432/postgres"',
      '',
      '# App',
      'NEXTAUTH_SECRET=EXAMPLEnotARealSecretJustForTheDemo1234',
      'NEXTAUTH_URL=http://localhost:3000',
      'NODE_ENV=development',
    ].join('\n'),
  vite: () =>
    [
      '# Firebase',
      `VITE_FIREBASE_API_KEY=${fake('AI' + 'za', 39)}`,
      'VITE_FIREBASE_AUTH_DOMAIN=my-app.firebaseapp.com',
      'VITE_FIREBASE_PROJECT_ID=my-app',
      '',
      'VITE_SENTRY_DSN=https://abc123@o0.ingest.sentry.io/0',
      `VITE_STRIPE_SECRET_KEY=${fake('sk_' + 'test_')}`,
      `RESEND_API_KEY=${fake('re' + '_', 30)}`,
      `# OLD_KEY=${fake('sk_' + 'live_')}`,
      'PORT=5173',
    ].join('\n'),
  clean: () =>
    [
      `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${fake('pk_' + 'test_')}`,
      `CLERK_SECRET_KEY=${fake('sk_' + 'test_')}`,
      `ANTHROPIC_API_KEY=${fake('sk-' + 'ant-', 40)}`,
      'NEXT_PUBLIC_POSTHOG_KEY=phc_EXAMPLE000000000000000000',
      'NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com',
      'UPSTASH_REDIS_REST_URL=https://example-12345.upstash.io',
      'UPSTASH_REDIS_REST_TOKEN=EXAMPLEnotARealToken000000',
    ].join('\n'),
};

// ---------- Events ----------

let statusTimer = 0;
function say(msg: string) {
  status.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (status.textContent = ''), 4000);
}

async function copy(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    say(ok);
  } catch {
    say('Couldn’t copy. Select the text and copy it yourself.');
  }
}

let timer = 0;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = window.setTimeout(render, 80);
});
[optNotes, optKeep, optUser].forEach((o) => o.addEventListener('change', render));

document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((b) =>
  b.addEventListener('click', () => {
    input.value = EXAMPLES[b.dataset.example || 'next']();
    render();
  }),
);

pasteBtn.addEventListener('click', async () => {
  try {
    input.value = await navigator.clipboard.readText();
    render();
  } catch {
    input.focus();
    say('Press Ctrl+V (or ⌘V) to paste.');
  }
});
clearBtn.addEventListener('click', () => {
  input.value = '';
  render();
  input.focus();
});

copyOut.addEventListener('click', () => copy(current.text, 'Copied. Save it as .env.example in your project.'));
copyPrompt.addEventListener('click', () => copy(prompt(), 'Prompt copied. Paste it into Claude Code, Cursor or Codex.'));
download.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([current.text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = '.env.example';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say('Downloaded. If the dot went missing, rename the file to .env.example.');
});

input.value = EXAMPLES.next();
render();
