// API key leak checker: reads a page and its own JavaScript files and looks for secret keys
// that anyone visiting the site can copy. Full secrets never leave this file: every finding
// carries only a masked preview like "sk-ab…9f2".
// Plain functions so they can be tested without a Worker.

export type Level = 'leak' | 'check' | 'ok';
export type Finding = {
  kind: string;
  name: string;
  level: Level;
  preview: string;
  files: string[];
  risk: string;
  rotate: { href: string; label: string } | null;
  fix: string;
  prompt: string;
};
export type FileRead = { url: string; ok: boolean };
export type LeakResult = { findings: Finding[]; files: FileRead[]; capped: boolean };

type Fetch = (url: string) => Promise<string | null>;

export const MAX_FILES = 20;
const BATCH = 5;

type Info = {
  name: string;
  level: Level;
  risk: string;
  rotate?: { href: string; label: string };
  fix?: string;
  prompt?: string;
};

const SERVER_FIX =
  'Call this service from your server (an API route, edge function or serverless function), keep the key in a server-only environment variable, and have the browser call your server instead.';

const KINDS: Record<string, Info> = {
  anthropic: {
    name: 'Anthropic (Claude) API key',
    level: 'leak',
    risk: 'Anyone can copy it and run Claude on your account until your credit or limit runs out.',
    rotate: { href: 'https://console.anthropic.com/settings/keys', label: 'Open Anthropic API keys' },
  },
  openai: {
    name: 'OpenAI API key',
    level: 'leak',
    risk: 'Anyone can copy it and run ChatGPT models on your bill. Leaked OpenAI keys are found and abused within hours.',
    rotate: { href: 'https://platform.openai.com/api-keys', label: 'Open OpenAI API keys' },
  },
  openrouter: {
    name: 'OpenRouter API key',
    level: 'leak',
    risk: 'Anyone can copy it and use any model on OpenRouter with your credits.',
    rotate: { href: 'https://openrouter.ai/settings/keys', label: 'Open OpenRouter keys' },
  },
  groq: {
    name: 'Groq API key',
    level: 'leak',
    risk: 'Anyone can copy it and run models on your Groq account.',
    rotate: { href: 'https://console.groq.com/keys', label: 'Open Groq API keys' },
  },
  xai: {
    name: 'xAI (Grok) API key',
    level: 'leak',
    risk: 'Anyone can copy it and run Grok models on your bill.',
    rotate: { href: 'https://console.x.ai/', label: 'Open the xAI console' },
  },
  replicate: {
    name: 'Replicate API token',
    level: 'leak',
    risk: 'Anyone can copy it and run models on Replicate on your bill.',
    rotate: { href: 'https://replicate.com/account/api-tokens', label: 'Open Replicate API tokens' },
  },
  huggingface: {
    name: 'Hugging Face token',
    level: 'leak',
    risk: 'Anyone can copy it and act as you on Hugging Face, including your private models and paid inference.',
    rotate: { href: 'https://huggingface.co/settings/tokens', label: 'Open Hugging Face tokens' },
  },
  stripe: {
    name: 'Stripe secret key',
    level: 'leak',
    risk: 'Anyone can copy it and issue refunds, read your customers’ details and payments, and change your Stripe account.',
    rotate: { href: 'https://dashboard.stripe.com/apikeys', label: 'Open Stripe API keys' },
  },
  'stripe-or-clerk': {
    name: 'Live secret key (Stripe or Clerk)',
    level: 'leak',
    risk: 'Keys that start with sk_live_ belong to Stripe or Clerk. With either, anyone can copy it and control your payments or your users’ accounts.',
    rotate: { href: 'https://dashboard.stripe.com/apikeys', label: 'Open Stripe API keys' },
    fix: `${SERVER_FIX} If it’s a Clerk key, rotate it under API keys in the Clerk dashboard.`,
  },
  'test-secret': {
    name: 'Test-mode secret key (Stripe or Clerk)',
    level: 'check',
    risk: 'Test keys can’t charge real cards, but anyone can read and change your test data. It usually means the live key will end up in the same place.',
    rotate: { href: 'https://dashboard.stripe.com/test/apikeys', label: 'Open Stripe test keys' },
  },
  'supabase-service': {
    name: 'Supabase service_role key',
    level: 'leak',
    risk: 'This key skips Row Level Security. Anyone can copy it and read, change or delete every row in your database, and every file in storage.',
    rotate: { href: 'https://supabase.com/dashboard/project/_/settings/api-keys', label: 'Open Supabase API keys' },
    fix: 'Use only the anon or publishable key in the browser, protect your tables with Row Level Security, and move anything that needs admin access into a Supabase Edge Function or your own server.',
    prompt:
      'Remove it from all browser code. Use the anon (publishable) key in the browser instead, make sure Row Level Security is on for every table with policies that match how the app works, and move every action that really needs admin access into a Supabase Edge Function (or this project’s existing server code) that reads the service_role key from a server-only secret.',
  },
  'supabase-secret': {
    name: 'Supabase secret key',
    level: 'leak',
    risk: 'This key skips Row Level Security. Anyone can copy it and read, change or delete every row in your database.',
    rotate: { href: 'https://supabase.com/dashboard/project/_/settings/api-keys', label: 'Open Supabase API keys' },
    fix: 'Use only the publishable key in the browser, protect your tables with Row Level Security, and move admin actions into a Supabase Edge Function or your own server.',
  },
  aws: {
    name: 'AWS access key',
    level: 'leak',
    risk: 'AWS access keys are never meant to be public. With the secret that usually sits next to it, anyone can use your AWS account, from reading your files to starting servers on your bill.',
    rotate: { href: 'https://console.aws.amazon.com/iam/home#/security_credentials', label: 'Open AWS security credentials' },
  },
  github: {
    name: 'GitHub token',
    level: 'leak',
    risk: 'Anyone can copy it and act as you on GitHub: read your private code, push changes, or delete repositories, depending on what the token allows.',
    rotate: { href: 'https://github.com/settings/tokens', label: 'Open GitHub tokens' },
  },
  resend: {
    name: 'Resend API key',
    level: 'leak',
    risk: 'Anyone can copy it and send email from your domain, which can get it flagged as spam.',
    rotate: { href: 'https://resend.com/api-keys', label: 'Open Resend API keys' },
  },
  sendgrid: {
    name: 'SendGrid API key',
    level: 'leak',
    risk: 'Anyone can copy it and send email from your account, which can get your domain flagged as spam.',
    rotate: { href: 'https://app.sendgrid.com/settings/api_keys', label: 'Open SendGrid API keys' },
  },
  twilio: {
    name: 'Twilio API key',
    level: 'leak',
    risk: 'Anyone can use it to send texts and make calls on your Twilio bill.',
    rotate: { href: 'https://console.twilio.com/us1/account/keys-credentials/api-keys', label: 'Open Twilio API keys' },
  },
  'twilio-token': {
    name: 'Twilio account ID and auth token',
    level: 'leak',
    risk: 'Together these give full control of your Twilio account: anyone can send texts and make calls on your bill.',
    rotate: { href: 'https://console.twilio.com/', label: 'Open the Twilio console' },
  },
  slack: {
    name: 'Slack token',
    level: 'leak',
    risk: 'Anyone can copy it and read or post messages in your Slack workspace as your app or bot.',
    rotate: { href: 'https://api.slack.com/apps', label: 'Open your Slack apps' },
  },
  'firebase-admin': {
    name: 'Firebase or Google service account key',
    level: 'leak',
    risk: 'This is an admin key. Anyone can copy it and read, change or delete everything in your Firebase project, skipping your security rules.',
    rotate: { href: 'https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk', label: 'Open Firebase service accounts' },
    fix: 'Delete this service account key, make a new one, and use it only in server code (Cloud Functions or your own server). The browser should use the normal Firebase web config.',
  },
  'private-key': {
    name: 'Private key',
    level: 'leak',
    risk: 'A private key is the password for whatever it signs or unlocks. Anyone can copy it and pretend to be your server.',
    fix: 'Make a new key wherever this one came from, remove the old one, and keep private keys only on your server.',
  },
  google: {
    name: 'Google API key',
    level: 'check',
    risk: 'Keys starting with AIza are often meant to be in the browser (Maps, Firebase). But unless you restrict it, anyone can copy it and use paid Google APIs on your bill.',
    rotate: { href: 'https://console.cloud.google.com/apis/credentials', label: 'Open Google Cloud credentials' },
    fix: 'If the key is used for Gemini or another paid Google API, call it from your server and keep the key in a server-only environment variable. Firebase and Maps keys can stay in the browser once they’re restricted.',
    prompt:
      'If this key is used for Gemini or another paid Google API that isn’t meant for browsers, move that call to server-side code that reads the key from a server-only environment variable. If it’s a Firebase or Maps key that has to stay in the browser, leave it, and tell me exactly how to restrict it in Google Cloud to my website’s address and the APIs it uses.',
  },
  'stripe-public': {
    name: 'Publishable key (Stripe or Clerk)',
    level: 'ok',
    risk: 'Keys that start with pk_ are meant to be in the browser, so this one is fine.',
  },
  'supabase-anon': {
    name: 'Supabase anon key',
    level: 'ok',
    risk: 'The anon key is meant to be public. It’s only safe if Row Level Security is on for every table.',
  },
  'supabase-public': {
    name: 'Supabase publishable key',
    level: 'ok',
    risk: 'The publishable key is meant to be public. It’s only safe if Row Level Security is on for every table.',
  },
};

type Rule = { kind: string | ((secret: string, around: string) => string | null); re: RegExp };

// Order matters: longer, more specific prefixes come before the ones they contain (sk-ant- before sk-).
const RULES: Rule[] = [
  { kind: 'anthropic', re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,}/g },
  { kind: 'openrouter', re: /\bsk-or-v1-[a-f0-9]{64}\b/g },
  { kind: 'openai', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}|\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b|\bsk-[A-Za-z0-9]{48}\b/g },
  { kind: (s) => (/^sk_live_5/.test(s) || s.length >= 90 || s.startsWith('rk_') ? 'stripe' : 'stripe-or-clerk'), re: /\b[sr]k_live_[A-Za-z0-9]{20,}/g },
  { kind: 'test-secret', re: /\b[sr]k_test_[A-Za-z0-9]{20,}/g },
  { kind: 'stripe-public', re: /\bpk_live_[A-Za-z0-9]{20,}/g },
  { kind: 'supabase-secret', re: /\bsb_secret_[A-Za-z0-9_-]{20,}/g },
  { kind: 'supabase-public', re: /\bsb_publishable_[A-Za-z0-9_-]{20,}/g },
  { kind: jwtKind, re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g },
  { kind: 'aws', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'github', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/g },
  { kind: 'google', re: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g },
  { kind: 'resend', re: /\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,}\b/g },
  { kind: 'sendgrid', re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g },
  { kind: 'twilio', re: /\bSK[0-9a-f]{32}\b/g },
  { kind: 'groq', re: /\bgsk_[A-Za-z0-9]{48,}\b/g },
  { kind: 'replicate', re: /\br8_[A-Za-z0-9]{37}\b/g },
  { kind: 'huggingface', re: /\bhf_[A-Za-z0-9]{34,}\b/g },
  { kind: 'xai', re: /\bxai-[A-Za-z0-9]{70,}\b/g },
  { kind: 'slack', re: /\bxox[baprs]-[0-9]{6,}-[A-Za-z0-9-]{10,}/g },
  { kind: privateKeyKind, re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g },
];

// Supabase keys are JWTs: the role inside says whether it's the public anon key or the admin one.
function jwtKind(token: string): string | null {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4)));
    if (payload?.role === 'service_role') return 'supabase-service';
    if (payload?.role === 'anon' && String(payload?.iss ?? '').includes('supabase')) return 'supabase-anon';
  } catch {
    // not a JWT we understand
  }
  return null;
}

// A private key inside a service account file (it has client_email next to it) is a Firebase admin key.
function privateKeyKind(_: string, around: string): string {
  return /service_account|client_email|firebase-adminsdk/.test(around) ? 'firebase-admin' : 'private-key';
}

// Docs and templates are full of fake keys; skip anything that looks like a placeholder.
const PLACEHOLDER = /(x{6,}|X{6,}|EXAMPLE|example|your[_-]?(api[_-]?)?key|\*{4,}|0{12,}|(.)\3{9,}|1234567890|abcdef(ghij)?|ABCDEF)/;

const PREFIX =
  /^(sk-ant-(?:api|admin)\d{2}-|sk-or-v1-|sk-(?:proj|svcacct|admin)-|sk-|[sr]k_(?:live|test)_|pk_live_|sb_(?:secret|publishable)_|eyJ|AKIA|ASIA|gh[pousr]_|github_pat_|AIza|re_|SG\.|SK|AC|gsk_|r8_|hf_|xai-|xox[baprs]-)/;

// "sk-ab…9f2": the known prefix, two characters, and the last three. Never the whole secret.
export function mask(secret: string): string {
  if (secret.startsWith('-----BEGIN')) return `${secret}…`;
  const prefix = secret.match(PREFIX)?.[0] ?? '';
  const rest = secret.slice(prefix.length);
  if (rest.length < 10) return `${prefix}…`;
  return `${prefix}${rest.slice(0, 2)}…${rest.slice(-3)}`;
}

type Hit = { kind: string; secret: string };

// Every secret-looking string in one file. Exported for tests.
export function scan(text: string): Hit[] {
  const hits: Hit[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      const s = m[0];
      if (!s.startsWith('-----') && (PLACEHOLDER.test(s) || !/\d/.test(s.slice(4)) || !/[A-Za-z]/.test(s.slice(4)))) continue;
      const around = typeof rule.kind === 'string' ? '' : text.slice(Math.max(0, m.index! - 2000), m.index! + 3000);
      const kind = typeof rule.kind === 'string' ? rule.kind : rule.kind(s, around);
      if (kind) hits.push({ kind, secret: s });
    }
  }
  // A Twilio account ID only matters with its auth token, a 32 character hex string next to it.
  for (const m of text.matchAll(/\bAC[0-9a-f]{32}\b/g)) {
    const around = text.slice(Math.max(0, m.index! - 300), m.index! + 334);
    if (/(auth_?token|authToken)["'`\s:=]+["'`]?[0-9a-f]{32}\b/i.test(around)) hits.push({ kind: 'twilio-token', secret: m[0] });
  }
  // One hit per secret, even if two rules match it.
  const seen = new Set<string>();
  return hits.filter((h) => !seen.has(h.secret) && seen.add(h.secret));
}

// Same-origin script addresses mentioned inside a script: lazy-loaded chunks that may hold more code.
export function scriptRefs(js: string, fileUrl: string, page: URL): string[] {
  const out: string[] = [];
  for (const m of js.matchAll(/["'`]((?:\.{1,2}\/|\/)?(?:[\w-]+\/)+[\w.-]+\.m?js|\.\/[\w.-]+\.m?js)["'`]/g)) {
    const p = m[1];
    // Only built chunks with a hash in the name (index-B2x9kQ1a.js), not library names.
    const hash = p.match(/[-.]([\w]{6,})\.m?js$/)?.[1];
    if (!hash || !/\d/.test(hash)) continue;
    let abs: URL;
    try {
      if (p.startsWith('./') || p.startsWith('../')) abs = new URL(p, fileUrl);
      else if (p.startsWith('/')) abs = new URL(p, page.origin);
      else if (p.startsWith('static/chunks/')) abs = new URL(`/_next/${p}`, page.origin);
      else abs = new URL(`/${p}`, page.origin);
    } catch {
      continue;
    }
    if (abs.hostname === page.hostname) out.push(abs.href);
  }
  return out;
}

function pageScripts(html: string, base: string, page: URL): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<(script|link)\b[^>]*>/gi) ?? []) {
    const isLink = /^<link/i.test(tag);
    if (isLink && !/\brel=["']?[^"'>]*\b(modulepreload|preload)\b/i.test(tag)) continue;
    if (isLink && /\bas=["']?(style|font|image|fetch)\b/i.test(tag)) continue;
    const raw = tag.match(isLink ? /\bhref=["']?([^"'\s>]+)/i : /\bsrc=["']?([^"'\s>]+)/i)?.[1];
    if (!raw) continue;
    try {
      const abs = new URL(raw.replace(/&amp;/g, '&'), base);
      if (abs.hostname === page.hostname && (abs.protocol === 'https:' || abs.protocol === 'http:')) out.push(abs.href);
    } catch {
      // bad address, skip
    }
  }
  return out;
}

function prompt(info: Info, preview: string, files: string[]): string {
  const where = files.map((f) => `- ${f}`).join('\n');
  const how =
    info.prompt ??
    'Move every call that uses this key out of browser code and into server-side code (an API route, edge function or serverless function, whichever this project already uses). Read the key there from an environment variable that is not exposed to the browser (no NEXT_PUBLIC_, VITE_, PUBLIC_ or EXPO_PUBLIC_ prefix), and have the browser call that server code instead.';
  return [
    `My live site’s public JavaScript contains my ${info.name} (it starts with ${preview}). It was found in:`,
    where,
    '',
    how,
    '',
    info.level === 'leak'
      ? 'Then search the whole project, including .env files and config, for any other place the key is sent to the browser, and remove it. Don’t paste the key into any file that gets committed. When you’re done, tell me which environment variable to set at my host, and remind me to rotate the old key because it has already been public.'
      : 'Don’t paste the key into any file that gets committed. When you’re done, tell me exactly what I have to do myself, step by step.',
  ].join('\n');
}

export async function findLeaks(html: string, base: string, fetchText: Fetch): Promise<LeakResult> {
  const page = new URL(base);
  const files: FileRead[] = [{ url: base, ok: true }];
  const where = new Map<string, { kind: string; files: Set<string> }>();
  const add = (text: string, file: string) => {
    for (const h of scan(text)) {
      const e = where.get(h.secret) ?? { kind: h.kind, files: new Set<string>() };
      e.files.add(file);
      where.set(h.secret, e);
    }
  };

  add(html, base);

  // The page's own scripts first, then chunks those scripts load, until MAX_FILES.
  const queue = [...new Set(pageScripts(html, base, page))];
  const queued = new Set(queue);
  let capped = false;
  while (queue.length && files.length - 1 < MAX_FILES) {
    const batch = queue.splice(0, Math.min(BATCH, MAX_FILES - (files.length - 1)));
    const texts = await Promise.all(batch.map((u) => fetchText(u)));
    texts.forEach((t, i) => {
      files.push({ url: batch[i], ok: t !== null });
      if (t === null) return;
      add(t, batch[i]);
      for (const ref of scriptRefs(t, batch[i], page)) {
        if (!queued.has(ref)) {
          queued.add(ref);
          queue.push(ref);
        }
      }
    });
  }
  if (queue.length) capped = true;

  const order: Record<Level, number> = { leak: 0, check: 1, ok: 2 };
  const findings: Finding[] = [];
  const okShown = new Set<string>();
  for (const [secret, e] of where) {
    const info = KINDS[e.kind];
    if (!info) continue;
    if (info.level === 'ok') {
      if (okShown.has(e.kind)) continue; // one note per public key type is enough
      okShown.add(e.kind);
    }
    const preview = mask(secret);
    const list = [...e.files];
    findings.push({
      kind: e.kind,
      name: info.name,
      level: info.level,
      preview,
      files: list,
      risk: info.risk,
      rotate: info.rotate ?? null,
      fix: info.fix ?? SERVER_FIX,
      prompt: info.level === 'ok' ? '' : prompt(info, preview, list),
    });
  }
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return { findings, files, capped };
}
