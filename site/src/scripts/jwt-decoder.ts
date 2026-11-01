// JWT decoder: everything runs in the visitor's browser. The token is never uploaded.
// Only a key set address (JWKS URL) is sent to /api/jwks when someone checks a signature with one.

export {};

type Json = Record<string, unknown>;
type Decoded = { header: Json; payload: Json; parts: string[]; signingInput: string; signature: Uint8Array<ArrayBuffer> };
type Tone = 'ok' | 'warn' | 'bad';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('jd-input');
const stage = $<HTMLDivElement>('jd-stage');
const icon = $<HTMLElement>('jd-icon');
const headline = $<HTMLElement>('jd-headline');
const subline = $<HTMLElement>('jd-subline');
const alertBox = $<HTMLDivElement>('jd-alert');
const cards = $<HTMLDivElement>('jd-cards');
const errorBox = $<HTMLDivElement>('jd-error');
const colored = $<HTMLElement>('jd-colored');
const headerOut = $<HTMLElement>('jd-header');
const payloadOut = $<HTMLElement>('jd-payload');
const claimsList = $<HTMLElement>('jd-claims');
const details = $<HTMLDivElement>('jd-details');
const verifyBox = $<HTMLDetailsElement>('jd-verify');
const keyInput = $<HTMLTextAreaElement>('jd-key');
const keyLabel = $<HTMLElement>('jd-key-label');
const keyHint = $<HTMLElement>('jd-key-hint');
const b64Row = $<HTMLElement>('jd-b64-row');
const b64 = $<HTMLInputElement>('jd-b64');
const suggestBtn = $<HTMLButtonElement>('jd-suggest');
const verifyBtn = $<HTMLButtonElement>('jd-verify-btn');
const verifyResult = $<HTMLElement>('jd-verify-result');
const pasteBtn = $<HTMLButtonElement>('jd-paste');
const clearBtn = $<HTMLButtonElement>('jd-clear');
const copyPayload = $<HTMLButtonElement>('jd-copy-payload');
const copyPrompt = $<HTMLButtonElement>('jd-copy-prompt');
const status = $<HTMLElement>('jd-status');

let current: Decoded | null = null;
let sigState: 'none' | 'ok' | 'bad' = 'none';
let exampleSecret = '';

// ---------- Decoding ----------

function b64urlBytes(s: string): Uint8Array<ArrayBuffer> {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (/[^A-Za-z0-9+/]/.test(clean)) throw new Error('bad base64');
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64urlEncode(bytes: Uint8Array | string): string {
  const b = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let bin = '';
  b.forEach((x) => (bin += String.fromCharCode(x)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function partJson(part: string, name: string): Json {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b64urlBytes(part));
  } catch {
    throw new Error(`The ${name} part isn’t readable. Part of the token may be missing, or it has extra characters in it.`);
  }
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {
    /* fall through */
  }
  throw new Error(`The ${name} part decodes, but it isn’t JSON. This may not be a JWT.`);
}

// Strips what people paste around a token: "Bearer ", quotes, spaces, a header name.
function clean(raw: string): string {
  return raw
    .trim()
    .replace(/^authorization\s*:\s*/i, '')
    .replace(/^bearer\s+/i, '')
    .replace(/^["'`]+|["'`,;]+$/g, '')
    .replace(/\s+/g, '');
}

function decode(raw: string): Decoded {
  const t = clean(raw);
  if (!t) throw new Error('empty');
  if (/^sb_(publishable|secret)_/.test(t)) {
    throw new Error(
      t.startsWith('sb_secret_')
        ? 'This is a Supabase secret key, not a JWT, so there is nothing to decode. It has full access to your database: keep it on your server only, and never put it in browser code.'
        : 'This is a Supabase publishable key, not a JWT, so there is nothing to decode. It’s meant for browser code, as long as Row Level Security is on for your tables.',
    );
  }
  const parts = t.split('.');
  if (parts.length === 5) throw new Error('This token has 5 parts, so it’s an encrypted JWT (JWE). Only the server that holds the key can read what’s inside.');
  if (parts.length !== 3) {
    throw new Error(
      t.startsWith('eyJ')
        ? `A JWT has 3 parts separated by dots, and this one has ${parts.length}. It may have been cut off when you copied it.`
        : 'This doesn’t look like a JWT. A JWT starts with “eyJ” and has 3 parts separated by dots.',
    );
  }
  const header = partJson(parts[0], 'header (first)');
  const payload = partJson(parts[1], 'payload (middle)');
  let signature = new Uint8Array();
  try {
    signature = b64urlBytes(parts[2]);
  } catch {
    throw new Error('The signature (last) part has characters that don’t belong in a JWT.');
  }
  return { header, payload, parts, signingInput: `${parts[0]}.${parts[1]}`, signature };
}

// ---------- Plain-English helpers ----------

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function relative(sec: number): string {
  const abs = Math.abs(sec);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [u, s] of units) if (abs >= s) return rtf.format(Math.round(sec / s), u);
  return abs < 5 ? 'just now' : rtf.format(Math.round(sec), 'second');
}

function when(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e11;

type Issuer = { name: string; detail?: string; note: string; jwks?: string };

function knownIssuer(p: Json, h: Json): Issuer | null {
  const iss = typeof p.iss === 'string' ? p.iss : '';
  let m: RegExpMatchArray | null;
  if (iss === 'supabase' || (typeof p.ref === 'string' && iss.includes('supabase'))) {
    return { name: 'Supabase API key', detail: typeof p.ref === 'string' ? `Project ${p.ref}` : undefined, note: 'A project API key (anon or service_role), not a signed-in user.' };
  }
  if ((m = iss.match(/^https:\/\/([a-z0-9]+)\.supabase\.(co|in)\/auth\/v1\/?$/))) {
    return { name: 'Supabase Auth', detail: `Project ${m[1]}`, note: 'A session token for a signed-in user of this Supabase project.', jwks: `${iss.replace(/\/$/, '')}/.well-known/jwks.json` };
  }
  if ((m = iss.match(/^https:\/\/securetoken\.google\.com\/(.+)$/))) {
    return { name: 'Firebase Auth', detail: `Project ${m[1]}`, note: 'A Firebase ID token for a signed-in user. It lasts one hour, and the Firebase SDK refreshes it for you.', jwks: 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com' };
  }
  if (iss === 'https://accounts.google.com' || iss === 'accounts.google.com') {
    return { name: 'Google Sign-In', note: 'A Google ID token that says who signed in with Google.', jwks: 'https://www.googleapis.com/oauth2/v3/certs' };
  }
  if (/clerk\./.test(iss) || /\.clerk\.accounts\.dev/.test(iss) || (typeof p.sub === 'string' && p.sub.startsWith('user_') && 'sid' in p && 'azp' in p)) {
    return { name: 'Clerk', detail: iss.replace(/^https:\/\//, ''), note: 'A Clerk session token. It is short lived (about a minute) and Clerk refreshes it in the background.', jwks: iss ? `${iss.replace(/\/$/, '')}/.well-known/jwks.json` : undefined };
  }
  if ((m = iss.match(/^https:\/\/([^/]+\.auth0\.com)\/?$/))) {
    return { name: 'Auth0', detail: m[1], note: 'A token from Auth0. If it has an audience (aud) it’s an access token for your API, otherwise an ID token.', jwks: `https://${m[1]}/.well-known/jwks.json` };
  }
  if ((m = iss.match(/^https:\/\/cognito-idp\.([a-z0-9-]+)\.amazonaws\.com\/(.+)$/))) {
    return { name: 'AWS Cognito', detail: m[2], note: p.token_use === 'access' ? 'A Cognito access token.' : 'A Cognito ID token for a signed-in user.', jwks: `${iss}/.well-known/jwks.json` };
  }
  if (/login\.microsoftonline\.com|sts\.windows\.net/.test(iss)) {
    return { name: 'Microsoft Entra ID', note: 'A token from Microsoft sign-in (Azure AD).', jwks: iss.includes('login.microsoftonline.com') ? `${iss.replace(/\/$/, '')}/.well-known/openid-configuration` : undefined };
  }
  if (/\.kinde\.com/.test(iss)) return { name: 'Kinde', detail: iss.replace(/^https:\/\//, ''), note: 'A token from Kinde auth.', jwks: `${iss.replace(/\/$/, '')}/.well-known/jwks.json` };
  if (/okta\.com|oktapreview\.com/.test(iss)) return { name: 'Okta', detail: iss.replace(/^https:\/\//, ''), note: 'A token from Okta.', jwks: `${iss.replace(/\/$/, '')}/.well-known/openid-configuration` };
  if (/api\.workos\.com/.test(iss)) return { name: 'WorkOS', note: 'A token from WorkOS AuthKit.' };
  if (iss.startsWith('https://')) return { name: iss.replace(/^https:\/\//, '').replace(/\/$/, ''), note: 'The service that made this token.', jwks: `${iss.replace(/\/$/, '')}/.well-known/jwks.json` };
  if (iss) return { name: iss, note: 'The service that made this token.' };
  void h;
  return null;
}

function roleOf(p: Json): string | null {
  if (typeof p.role === 'string') return p.role;
  const meta = p.app_metadata as Json | undefined;
  if (meta && typeof meta.role === 'string') return meta.role;
  for (const k of ['roles', 'cognito:groups', 'groups', 'permissions']) {
    const v = p[k];
    if (Array.isArray(v) && v.length) return v.slice(0, 4).join(', ') + (v.length > 4 ? '…' : '');
  }
  if (typeof p.scope === 'string') return p.scope;
  return null;
}

function roleNote(role: string, p: Json): string {
  if (role === 'service_role') return 'Full access. Skips Row Level Security.';
  if (role === 'anon') return 'Public key for logged-out visitors. Safe in the browser if Row Level Security is on.';
  if (role === 'authenticated') return 'A signed-in user. Row Level Security rules for “authenticated” apply.';
  if (typeof p.scope === 'string' && role === p.scope) return 'What this token is allowed to do (scopes).';
  return 'What this token is allowed to do.';
}

function who(p: Json): string | null {
  for (const k of ['email', 'preferred_username', 'name', 'username', 'phone']) if (typeof p[k] === 'string' && p[k]) return p[k] as string;
  if (typeof p.sub === 'string' && p.sub) return p.sub;
  return null;
}

const ALG: Record<string, string> = {
  HS256: 'Shared secret (HMAC)', HS384: 'Shared secret (HMAC)', HS512: 'Shared secret (HMAC)',
  RS256: 'Public key (RSA)', RS384: 'Public key (RSA)', RS512: 'Public key (RSA)',
  PS256: 'Public key (RSA-PSS)', PS384: 'Public key (RSA-PSS)', PS512: 'Public key (RSA-PSS)',
  ES256: 'Public key (elliptic curve)', ES384: 'Public key (elliptic curve)', ES512: 'Public key (elliptic curve)',
  EdDSA: 'Public key (Ed25519)', none: 'Not signed at all',
};

const CLAIMS: Record<string, string> = {
  iss: 'Issuer: who made the token',
  sub: 'Subject: the user or thing the token is about',
  aud: 'Audience: who the token is meant for',
  exp: 'Expires at',
  nbf: 'Not valid before',
  iat: 'Issued at',
  jti: 'Token ID, unique for each token',
  auth_time: 'When the user signed in',
  email: 'Email address',
  email_verified: 'Has the email been confirmed?',
  phone: 'Phone number',
  name: 'Name',
  picture: 'Profile picture',
  role: 'Role (Supabase uses this for Row Level Security)',
  scope: 'Scopes: what the token may do',
  permissions: 'Permissions',
  azp: 'Authorized party: the app that asked for the token',
  sid: 'Session ID',
  session_id: 'Session ID',
  aal: 'Assurance level: aal1 is password, aal2 is with two-factor',
  amr: 'How the user signed in',
  is_anonymous: 'Is this an anonymous (guest) user?',
  app_metadata: 'Data only your server can change',
  user_metadata: 'Data the user can change themselves',
  ref: 'Supabase project ID',
  user_id: 'User ID',
  firebase: 'Firebase sign-in details',
  token_use: 'ID token or access token',
  nonce: 'Random value that stops replay attacks',
};

// ---------- Rendering ----------

type Card = { label: string; value: string; note?: string; tone?: Tone; mono?: boolean; action?: string };

function render(): void {
  const raw = input.value;
  sigState = 'none';
  verifyResult.textContent = '';
  verifyResult.className = 'verify-result';
  if (!clean(raw)) {
    current = null;
    show('warn', '…', 'Paste a token to decode it', 'It starts with “eyJ”. You’ll find it in your browser’s Network tab, in the Authorization header.');
    cards.innerHTML = '';
    errorBox.hidden = true;
    details.hidden = true;
    alertBox.hidden = true;
    return;
  }
  try {
    current = decode(raw);
  } catch (e) {
    current = null;
    const msg = (e as Error).message;
    show('bad', '!', 'We can’t decode this', '');
    errorBox.textContent = msg;
    errorBox.hidden = false;
    cards.innerHTML = '';
    details.hidden = true;
    alertBox.hidden = true;
    return;
  }
  errorBox.hidden = true;
  details.hidden = false;
  paint();
  fillDetails(current);
  setupVerify(current);
}

function show(tone: Tone, mark: string, head: string, sub: string): void {
  stage.dataset.tone = tone;
  icon.textContent = mark;
  headline.textContent = head;
  subline.textContent = sub;
}

// Draws the verdict and cards. Called again every 30 seconds so "expires in" stays true.
function paint(): void {
  if (!current) return;
  const { header, payload: p } = current;
  const now = Date.now() / 1000;
  const alg = String(header.alg ?? '');
  const role = roleOf(p);
  const issuer = knownIssuer(p, header);
  const person = who(p);
  const exp = isTime(p.exp) ? p.exp : null;
  const nbf = isTime(p.nbf) ? p.nbf : null;
  const iat = isTime(p.iat) ? p.iat : null;

  // Verdict, worst first.
  alertBox.hidden = true;
  if (role === 'service_role') {
    show('bad', '!', 'Supabase service_role key: never put this in the browser', 'Anyone who sees it can read, change and delete everything in your database, skipping every Row Level Security rule.');
    alertBox.innerHTML = '<strong>Keep it on your server only.</strong> If it’s in your frontend code, a public repo or a <code>NEXT_PUBLIC_</code> or <code>VITE_</code> variable, rotate it now in Supabase → Project Settings → API, and use the anon key in the browser instead.';
    alertBox.hidden = false;
  } else if (alg.toLowerCase() === 'none') {
    show('bad', '!', 'This token isn’t signed', 'Its algorithm is “none”, so anyone could have written it. A server should never accept it.');
  } else if (exp && exp <= now) {
    show('bad', '✕', `Expired ${relative(exp - now)}`, `It stopped working on ${when(exp)}. Your app needs to refresh it or sign the user in again.`);
  } else if (nbf && nbf > now + 5) {
    show('warn', '…', `Not valid yet: starts ${relative(nbf - now)}`, `A server will reject it until ${when(nbf)}. If that’s unexpected, check the clock on the machine that made it.`);
  } else if (!exp) {
    show('warn', '∞', 'Valid, and it never expires', 'There is no expiry date (exp). If it leaks, it works forever unless you change the signing key.');
  } else {
    const left = exp - now;
    const head = left < 300 ? `Expires ${relative(left)}, so it’s about to stop working` : `Valid. Expires ${relative(left)}`;
    show(left < 300 ? 'warn' : 'ok', '✓', head, person ? `Belongs to ${person}` : issuer ? `Made by ${issuer.name}` : 'Not expired yet.');
  }
  if (sigState === 'bad') {
    show('bad', '✕', 'The signature doesn’t match', 'Either the key is wrong, or someone changed the token after it was signed. Don’t trust what’s inside.');
  }

  const list: Card[] = [];
  if (exp) list.push({ label: exp <= now ? 'Expired' : 'Expires', value: relative(exp - now), note: when(exp), tone: exp <= now ? 'bad' : exp - now < 300 ? 'warn' : 'ok' });
  else list.push({ label: 'Expires', value: 'Never', note: 'No exp claim', tone: 'warn' });
  if (iat) list.push({ label: 'Issued', value: relative(iat - now), note: when(iat) });
  if (nbf && Math.abs(nbf - (iat ?? 0)) > 1) list.push({ label: 'Valid from', value: relative(nbf - now), note: when(nbf), tone: nbf > now + 5 ? 'warn' : undefined });
  if (issuer) list.push({ label: 'Issuer', value: issuer.name, note: [issuer.detail, issuer.note].filter(Boolean).join(' · ') });
  if (role) list.push({ label: 'Role', value: role, note: roleNote(role, p), tone: role === 'service_role' ? 'bad' : undefined, mono: true });
  if (person) list.push({ label: 'User', value: person, note: typeof p.sub === 'string' && p.sub !== person ? `ID ${p.sub}` : undefined, mono: person === p.sub });
  if (p.aud !== undefined) list.push({ label: 'Audience', value: Array.isArray(p.aud) ? p.aud.join(', ') : String(p.aud), note: 'Who it’s meant for', mono: true });
  list.push({ label: 'Signed with', value: alg || 'unknown', note: ALG[alg] ?? 'Algorithm from the header', tone: alg.toLowerCase() === 'none' ? 'bad' : undefined, mono: true });
  list.push(
    sigState === 'ok'
      ? { label: 'Signature', value: 'Verified', note: 'It matches your key', tone: 'ok' }
      : sigState === 'bad'
        ? { label: 'Signature', value: 'Doesn’t match', note: 'Wrong key, or the token was changed', tone: 'bad' }
        : { label: 'Signature', value: 'Not checked', note: 'Check it with your secret or key', action: 'verify' },
  );

  cards.innerHTML = list
    .map(
      (c) => `<div class="card${c.tone ? ` ${c.tone}` : ''}"><span class="label">${esc(c.label)}</span><strong class="${c.mono ? 'mono' : ''}">${esc(c.value)}</strong>${
        c.note ? `<span class="note">${esc(c.note)}</span>` : ''
      }${c.action ? '<button type="button" class="link" data-action="verify">Check signature ↓</button>' : ''}</div>`,
    )
    .join('');
}

function jsonHtml(o: Json): string {
  return esc(JSON.stringify(o, null, 2));
}

function fillDetails(d: Decoded): void {
  colored.innerHTML = `<span class="h">${esc(d.parts[0])}</span>.<span class="p">${esc(d.parts[1])}</span>.<span class="s">${esc(d.parts[2])}</span>`;
  headerOut.innerHTML = jsonHtml(d.header);
  payloadOut.innerHTML = jsonHtml(d.payload);
  claimsList.innerHTML = Object.entries(d.payload)
    .map(([k, v]) => {
      let shown = typeof v === 'string' ? v : JSON.stringify(v);
      if (['exp', 'iat', 'nbf', 'auth_time'].includes(k) && isTime(v)) shown = `${v} → ${when(v)}`;
      if (shown.length > 160) shown = shown.slice(0, 157) + '…';
      return `<tr><th><code>${esc(k)}</code></th><td>${esc(CLAIMS[k] ?? '')}</td><td><code>${esc(shown)}</code></td></tr>`;
    })
    .join('');
}

// ---------- Signature check ----------

const HASH: Record<string, string> = { '256': 'SHA-256', '384': 'SHA-384', '512': 'SHA-512' };

function setupVerify(d: Decoded): void {
  const alg = String(d.header.alg ?? '');
  const hmac = alg.startsWith('HS');
  keyLabel.textContent = hmac ? 'Your JWT secret' : 'Key set address (JWKS URL), or paste a public key';
  keyHint.innerHTML = hmac
    ? 'In Supabase this is the <em>Legacy JWT secret</em> under Project Settings → JWT Keys. The secret stays in your browser.'
    : 'A JWKS URL, a JSON Web Key, or a PEM public key (<code>-----BEGIN PUBLIC KEY-----</code>). Only a URL is fetched, never your token.';
  keyInput.placeholder = hmac ? 'your-jwt-secret' : 'https://your-app.com/.well-known/jwks.json';
  b64Row.hidden = !hmac;
  const issuer = knownIssuer(d.payload, d.header);
  const suggestion = !hmac && issuer?.jwks ? issuer.jwks : '';
  suggestBtn.hidden = !suggestion || keyInput.value.trim() === suggestion;
  suggestBtn.dataset.url = suggestion;
  suggestBtn.textContent = suggestion ? `Use ${issuer!.name}’s keys` : '';
  if (keyInput.dataset.forAlg !== (hmac ? 'hs' : 'pk')) {
    if (keyInput.value !== exampleSecret) keyInput.value = '';
    keyInput.dataset.forAlg = hmac ? 'hs' : 'pk';
  }
}

async function importKeyFor(alg: string, keyText: string, jwk?: JsonWebKey): Promise<CryptoKey> {
  const bits = alg.slice(2);
  const hash = HASH[bits];
  const family = alg.slice(0, 2);
  if (family === 'HS') {
    const raw = b64.checked ? b64urlBytes(keyText.trim()) : new TextEncoder().encode(keyText);
    return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash }, false, ['verify']);
  }
  const algo: RsaHashedImportParams | EcKeyImportParams | Algorithm =
    family === 'RS' ? { name: 'RSASSA-PKCS1-v1_5', hash }
    : family === 'PS' ? { name: 'RSA-PSS', hash }
    : family === 'ES' ? { name: 'ECDSA', namedCurve: { '256': 'P-256', '384': 'P-384', '512': 'P-521' }[bits]! }
    : alg === 'EdDSA' || alg === 'Ed25519' ? { name: 'Ed25519' }
    : (() => { throw new Error(`We can’t check ${alg} signatures in the browser.`); })();
  if (jwk) {
    const { alg: _a, use: _u, key_ops: _k, ...bare } = jwk as JsonWebKey & { use?: string };
    void _a; void _u; void _k;
    return crypto.subtle.importKey('jwk', bare, algo, false, ['verify']);
  }
  const pem = keyText.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return crypto.subtle.importKey('spki', b64urlBytes(pem), algo, false, ['verify']);
}

async function verifyWith(d: Decoded, key: CryptoKey, alg: string): Promise<boolean> {
  const data = new TextEncoder().encode(d.signingInput);
  const bits = Number(alg.slice(2));
  const params: Algorithm | RsaPssParams | EcdsaParams =
    alg.startsWith('HS') ? { name: 'HMAC' }
    : alg.startsWith('RS') ? { name: 'RSASSA-PKCS1-v1_5' }
    : alg.startsWith('PS') ? { name: 'RSA-PSS', saltLength: bits / 8 }
    : alg.startsWith('ES') ? { name: 'ECDSA', hash: HASH[String(bits)] }
    : { name: 'Ed25519' };
  return crypto.subtle.verify(params, key, d.signature, data);
}

async function loadKeys(text: string): Promise<JsonWebKey[] | null> {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    const v = JSON.parse(t);
    if (Array.isArray(v)) return v;
    if (Array.isArray(v.keys)) return v.keys;
    return [v];
  }
  if (t.includes('BEGIN')) return null; // PEM
  const res = await fetch(`/api/jwks?url=${encodeURIComponent(t)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'We couldn’t read that key set.');
  return body.keys;
}

async function runVerify(): Promise<void> {
  if (!current) return;
  const d = current;
  const alg = String(d.header.alg ?? '');
  const keyText = keyInput.value;
  if (alg.toLowerCase() === 'none') return setVerify('bad', 'This token has no signature to check.');
  if (!keyText.trim()) return setVerify('', alg.startsWith('HS') ? 'Paste your JWT secret first.' : 'Paste a JWKS URL or a public key first.');
  if (!crypto?.subtle) return setVerify('', 'Your browser can only check signatures on a secure (https) page.');
  setVerify('', 'Checking…');
  verifyBtn.disabled = true;
  try {
    let ok = false;
    if (alg.startsWith('HS')) {
      ok = await verifyWith(d, await importKeyFor(alg, keyText), alg);
    } else {
      const keys = await loadKeys(keyText);
      if (keys === null) {
        ok = await verifyWith(d, await importKeyFor(alg, keyText), alg);
      } else {
        const kid = d.header.kid;
        const match = keys.filter((k) => (kid ? (k as { kid?: string }).kid === kid : true));
        if (!match.length) return setVerify('bad', `None of those keys has this token’s key ID (kid “${String(kid)}”). It was signed by a different key set, or the key was rotated.`);
        for (const k of match) {
          try {
            if (await verifyWith(d, await importKeyFor(alg, '', k), alg)) {
              ok = true;
              break;
            }
          } catch {
            /* try the next key */
          }
        }
      }
    }
    sigState = ok ? 'ok' : 'bad';
    setVerify(
      ok ? 'ok' : 'bad',
      ok
        ? '✓ Signature verified. This token was signed with that key and hasn’t been changed.'
        : alg.startsWith('HS')
          ? '✕ Doesn’t match. Check you copied the whole secret, and try the “base64” box if your provider shows it encoded.'
          : '✕ Doesn’t match. The token was signed with a different key, or it was changed after signing.',
    );
    paint();
  } catch (e) {
    setVerify('bad', (e as Error).message || 'We couldn’t use that key. Check it’s complete.');
  } finally {
    verifyBtn.disabled = false;
  }
}

function setVerify(tone: string, text: string): void {
  verifyResult.className = `verify-result ${tone}`;
  verifyResult.textContent = text;
}

// ---------- Examples ----------

const EXAMPLE_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';

async function sign(header: Json, payload: Json, secret: string): Promise<string> {
  const input = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(payload))}`;
  if (!crypto?.subtle) return `${input}.c2lnbmF0dXJl`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input)));
  return `${input}.${b64urlEncode(sig)}`;
}

async function example(kind: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ref = 'abcdefghijklmnopqrst';
  const h = { alg: 'HS256', typ: 'JWT' };
  if (kind === 'service') {
    return sign(h, { iss: 'supabase', ref, role: 'service_role', iat: now - 86400 * 40, exp: now + 86400 * 365 * 10 }, EXAMPLE_SECRET);
  }
  if (kind === 'expired') {
    return sign(h, { iss: `https://${ref}.supabase.co/auth/v1`, sub: '8f14e45f-ceea-467a-9a36-dedd4bea2543', aud: 'authenticated', exp: now - 86400 * 2, iat: now - 86400 * 2 - 3600, email: 'you@example.com', role: 'authenticated', aal: 'aal1', session_id: 'c9f0f895-fb98-4b91-9f4e-8b6c3a2d1e07', is_anonymous: false }, EXAMPLE_SECRET);
  }
  return sign(h, { iss: `https://${ref}.supabase.co/auth/v1`, sub: '8f14e45f-ceea-467a-9a36-dedd4bea2543', aud: 'authenticated', exp: now + 3 * 3600, iat: now - 60, email: 'you@example.com', phone: '', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { name: 'Ada' }, role: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: now - 60 }], session_id: 'c9f0f895-fb98-4b91-9f4e-8b6c3a2d1e07', is_anonymous: false }, EXAMPLE_SECRET);
}

async function loadExample(kind: string): Promise<void> {
  input.value = await example(kind);
  exampleSecret = EXAMPLE_SECRET;
  keyInput.value = EXAMPLE_SECRET;
  keyInput.dataset.forAlg = 'hs';
  b64.checked = false;
  render();
}

// ---------- Copy ----------

async function copy(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = done;
  } catch {
    status.textContent = 'Your browser blocked copying. Select the text and copy it by hand.';
  }
}

function prompt(d: Decoded): string {
  const now = Date.now() / 1000;
  const exp = isTime(d.payload.exp) ? d.payload.exp : null;
  const lines = [
    'I’m debugging auth in my app. Here is a decoded JWT from it (signature removed, so it can’t be used).',
    '',
    'Header:',
    JSON.stringify(d.header, null, 2),
    '',
    'Payload:',
    JSON.stringify(d.payload, null, 2),
    '',
    `Right now it is ${new Date().toISOString()}. ${exp ? (exp <= now ? `The token expired ${relative(exp - now)}.` : `The token expires ${relative(exp - now)}.`) : 'The token has no expiry.'}`,
  ];
  if (roleOf(d.payload) === 'service_role') lines.push('Warning: this is a Supabase service_role key. Find every place it is used in browser code and move it to the server.');
  lines.push('', 'Look at how my code creates, sends, refreshes and checks this token, explain what is wrong, and fix it.');
  return lines.join('\n');
}

// ---------- Wiring ----------

let timer = 0;
input.addEventListener('input', () => {
  if (exampleSecret && keyInput.value === exampleSecret) {
    keyInput.value = '';
    exampleSecret = '';
  }
  clearTimeout(timer);
  timer = window.setTimeout(render, 80);
});

document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((b) => b.addEventListener('click', () => loadExample(b.dataset.example!)));

cards.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-action="verify"]')) {
    verifyBox.open = true;
    verifyBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    keyInput.focus({ preventScroll: true });
  }
});

pasteBtn.addEventListener('click', async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (t) {
      input.value = t;
      input.dispatchEvent(new Event('input'));
    }
  } catch {
    input.focus();
    status.textContent = 'Press Ctrl+V (or ⌘V on a Mac) to paste into the box.';
  }
});

clearBtn.addEventListener('click', () => {
  input.value = '';
  keyInput.value = '';
  exampleSecret = '';
  render();
  input.focus();
});

suggestBtn.addEventListener('click', () => {
  keyInput.value = suggestBtn.dataset.url ?? '';
  suggestBtn.hidden = true;
  runVerify();
});
verifyBtn.addEventListener('click', runVerify);
keyInput.addEventListener('input', () => {
  if (sigState !== 'none') {
    sigState = 'none';
    paint();
  }
  setVerify('', '');
});
b64.addEventListener('change', () => setVerify('', ''));

copyPayload.addEventListener('click', () => current && copy(JSON.stringify(current.payload, null, 2), 'Payload copied.'));
copyPrompt.addEventListener('click', () => current && copy(prompt(current), 'Prompt copied. Paste it into Claude Code, Cursor or Codex.'));

window.setInterval(() => current && paint(), 30_000);

loadExample('user');
