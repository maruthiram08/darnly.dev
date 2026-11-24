// POST /api/send-link  { email, page?, website? }
//
// Phones can't install Chrome extensions, so a phone visitor can ask for one email with the
// Add to Chrome link, to open later on their computer (src/components/PhoneLink.astro).
//
// Privacy: the address is used to send that one email and is never stored or logged by us.
// To stop the same address being sent the link over and over, a one-way hash of it is kept in
// Cloudflare's cache for a day (not the address itself).
//
// Abuse guards: darnly.dev pages only (Origin check), a hidden honeypot field, 3 sends a minute
// per visitor and 30 a minute for the whole site, one email per address per day, and a fixed
// message (nothing the visitor types ends up in the email).
//
// Sent with Cloudflare Email Service (the EMAIL binding in wrangler.jsonc), from hello@darnly.dev.
// Until darnly.dev is onboarded for sending, sends fail and the page offers "Share the link" instead.

export type Limit = { limit(o: { key: string }): Promise<{ success: boolean }> };
export type Mailer = {
  send(m: { to: string; from: { email: string; name: string }; subject: string; html: string; text: string }): Promise<unknown>;
};
export type SendLinkDeps = {
  mailer?: Mailer;
  limit?: Limit;
  limitAll?: Limit;
  /** Was this address hash sent the link in the last day? */
  seen(hash: string): Promise<boolean>;
  remember(hash: string): Promise<void>;
  allowLocal?: boolean;
};

export const STORE = 'https://chromewebstore.google.com/detail/darnly/gognoljafcabnmbbpfoeeamcflpbgidj?utm_source=phone-email';
const FROM = { email: 'hello@darnly.dev', name: 'Darnly' };
const SUBJECT = 'Your Darnly link, for your computer';

// Deliberately plain: one @, a dot in the domain, no spaces, at most 254 characters.
export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (e.length < 6 || e.length > 254) return null;
  if (!/^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(e)) return null;
  if (!/\.[a-z]{2,}$/.test(e)) return null;
  return e;
}

export async function hashEmail(email: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`darnly-send-link:${email}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function okOrigin(req: Request, allowLocal: boolean): boolean {
  const o = req.headers.get('origin');
  if (!o) return false;
  if (o === 'https://darnly.dev' || o === 'https://www.darnly.dev') return true;
  if (/^https:\/\/[a-z0-9-]+-darnly-dev\.[a-z0-9-]+\.workers\.dev$/.test(o)) return true; // pull request previews
  return allowLocal && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
}

const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

export async function sendLink(req: Request, deps: SendLinkDeps): Promise<Response> {
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  if (!okOrigin(req, !!deps.allowLocal)) return reply({ error: 'Only from darnly.dev.' }, 403);
  const raw = await req.text();
  if (raw.length > 2000) return reply({ error: 'Too long.' }, 413);
  let body: { email?: unknown; website?: unknown };
  try { body = JSON.parse(raw); } catch { return reply({ error: 'Send JSON.' }, 400); }
  // Honeypot: people never see the "website" box, bots fill it. Pretend it worked.
  if (typeof body.website === 'string' && body.website !== '') return reply({ sent: true });
  const email = cleanEmail(body.email);
  if (!email) return reply({ error: 'That email address doesn’t look right.' }, 400);

  const who = req.headers.get('cf-connecting-ip') ?? 'unknown';
  if (deps.limit && !(await deps.limit.limit({ key: who })).success) return reply({ error: 'Too many tries. Wait a minute and try again.' }, 429);
  if (deps.limitAll && !(await deps.limitAll.limit({ key: 'all' })).success) return reply({ error: 'Busy right now. Try again in a minute, or share the link instead.' }, 429);
  if (!deps.mailer) return reply({ error: 'Email isn’t switched on yet. Share the link instead.' }, 503);

  const hash = await hashEmail(email);
  // Already sent today: say it worked, so this can't be used to check which addresses asked.
  if (await deps.seen(hash)) return reply({ sent: true });
  try {
    await deps.mailer.send({ to: email, from: FROM, subject: SUBJECT, html: emailHtml(), text: emailText() });
  } catch (e) {
    // Log the error code only, never the address.
    console.log('send-link failed', (e as { code?: string }).code ?? 'no code');
    return reply({ error: 'Couldn’t send right now. Share the link instead.' }, 502);
  }
  await deps.remember(hash);
  return reply({ sent: true });
}

const STEPS: [string, string][] = [
  ['Pin it', 'After adding it, click the puzzle piece in Chrome\u2019s toolbar and pin Darnly. It also works in Edge, Brave and Arc.'],
  ['Point at a bug', 'Open the app you’re building, press Option+Shift+B on a Mac (Windows is coming soon), click the broken part and type what you expected.'],
  ['Let your agent fix it', 'In Claude Code or Cursor, type /darnly. In Codex, say “fix my Darnly bugs”.'],
];

export function emailText(): string {
  return [
    'You asked for the Darnly link on your phone. Open this on your computer:',
    '',
    `Add Darnly to Chrome (free, no account): ${STORE}`,
    '',
    'Then:',
    ...STEPS.map(([h, p], i) => `${i + 1}. ${h}. ${p}`),
    '',
    'Set up your agent: https://darnly.dev/setup/',
    'Building a Mac, iOS or Android app? Get the Mac app: https://darnly.dev/#mac',
    '',
    'Questions? Just reply to this email.',
    '',
    'You’re getting this one email because this address was entered on darnly.dev. We don’t keep it or send anything else.',
  ].join('\n');
}

export function emailHtml(): string {
  const font = "font-family:'Figtree','Segoe UI',Helvetica,Arial,sans-serif";
  const steps = STEPS.map(
    ([h, p], i) => `<tr><td valign="top" style="padding:0 14px 16px 0;${font};font-size:13px;font-weight:700;color:#0593C6;font-family:Menlo,monospace">0${i + 1}</td><td style="padding:0 0 16px;${font};font-size:16px;line-height:1.5;color:#0B2230"><strong>${h}.</strong> ${p}</td></tr>`,
  ).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${SUBJECT}</title></head>
<body style="margin:0;padding:0;background:#EEF8FB">
<div style="display:none;max-height:0;overflow:hidden">Open this on your computer and add Darnly to Chrome. Free, no account.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF8FB"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 16px;${font};font-size:20px;font-weight:800;color:#0B2230"><img src="https://darnly.dev/icon.png" width="28" height="28" alt="" style="vertical-align:middle;border-radius:7px;margin-right:8px">Darnly</td></tr>
<tr><td style="background:#0593C6;border-radius:20px;padding:32px 28px">
<p style="margin:0 0 10px;font-family:Menlo,monospace;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#FCFFFF">Your link is here</p>
<h1 style="margin:0 0 14px;${font};font-size:30px;line-height:1.1;font-weight:800;color:#FCFFFF">Spot a bug. Point at it. Your agent fixes it.</h1>
<p style="margin:0 0 24px;${font};font-size:16px;line-height:1.55;color:#FCFFFF">You asked for the Darnly link on your phone. Open this email on your computer and add Darnly to Chrome. It’s free and needs no account.</p>
<a href="${STORE}" style="display:inline-block;background:#FCFFFF;color:#0B2230;${font};font-size:16px;font-weight:700;text-decoration:none;padding:14px 24px;border-radius:999px">Add to Chrome, free</a>
</td></tr>
<tr><td style="padding:28px 4px 4px">
<p style="margin:0 0 16px;${font};font-size:17px;font-weight:700;color:#0B2230">Then:</p>
<table role="presentation" cellpadding="0" cellspacing="0">${steps}</table>
<p style="margin:4px 0 0;${font};font-size:15px;line-height:1.5;color:#4A6472"><a href="https://darnly.dev/setup/" style="color:#0593C6">Set up your agent</a> · Building a Mac, iOS or Android app? <a href="https://darnly.dev/#mac" style="color:#0593C6">Get the Mac app</a></p>
</td></tr>
<tr><td style="padding:28px 4px 0;border-top:1px solid #D7E9F0">
<p style="margin:16px 0 8px;${font};font-size:13px;line-height:1.5;color:#4A6472">Questions? Just reply to this email.</p>
<p style="margin:0;${font};font-size:13px;line-height:1.5;color:#4A6472">You’re getting this one email because this address was entered on <a href="https://darnly.dev/" style="color:#4A6472">darnly.dev</a>. We don’t keep it or send anything else.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}
