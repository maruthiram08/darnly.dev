// Privacy policy and terms generator: built from templates in the visitor's browser. Nothing is uploaded, no AI.

// ---------- What the visitor picked ----------

type Collect = 'account' | 'payments' | 'analytics' | 'cookies' | 'content';
type Region = 'eu' | 'us' | 'other';

type State = {
  app: string;
  owner: string;
  email: string;
  url: string;
  law: string;
  date: string; // yyyy-mm-dd
  web: boolean;
  mobile: boolean;
  collect: Set<Collect>;
  services: Set<string>;
  regions: Set<Region>;
  kids: boolean;
  refunds: 'none' | '14' | '30';
};

type Kind = 'auth' | 'db' | 'host' | 'pay' | 'analytics' | 'ai' | 'email' | 'errors';

type Service = { id: string; name: string; kind: Kind; does: string; data: string; privacy: string; implies: Collect[] };

// Each service: what it does for the app, what it receives, and its own privacy policy.
const SERVICES: Service[] = [
  { id: 'supabase', name: 'Supabase', kind: 'db', does: 'database, file storage and sign-in', data: 'your account details and the data you save in the app', privacy: 'https://supabase.com/privacy', implies: ['account'] },
  { id: 'firebase', name: 'Firebase (Google)', kind: 'db', does: 'database, sign-in and app infrastructure', data: 'your account details, the data you save in the app and device identifiers', privacy: 'https://firebase.google.com/support/privacy', implies: ['account'] },
  { id: 'clerk', name: 'Clerk', kind: 'auth', does: 'sign-in and account management', data: 'your email address, name and sign-in activity', privacy: 'https://clerk.com/legal/privacy', implies: ['account'] },
  { id: 'vercel', name: 'Vercel', kind: 'host', does: 'hosting', data: 'technical data such as IP addresses and request logs', privacy: 'https://vercel.com/legal/privacy-policy', implies: [] },
  { id: 'netlify', name: 'Netlify', kind: 'host', does: 'hosting', data: 'technical data such as IP addresses and request logs', privacy: 'https://www.netlify.com/privacy/', implies: [] },
  { id: 'cloudflare', name: 'Cloudflare', kind: 'host', does: 'hosting, speed and security', data: 'technical data such as IP addresses and request logs', privacy: 'https://www.cloudflare.com/privacypolicy/', implies: [] },
  { id: 'stripe', name: 'Stripe', kind: 'pay', does: 'payments', data: 'your payment details, billing name, email and country', privacy: 'https://stripe.com/privacy', implies: ['payments'] },
  { id: 'lemonsqueezy', name: 'Lemon Squeezy', kind: 'pay', does: 'payments and sales tax', data: 'your payment details, billing name, email and country', privacy: 'https://www.lemonsqueezy.com/privacy', implies: ['payments'] },
  { id: 'ga', name: 'Google Analytics', kind: 'analytics', does: 'usage analytics', data: 'pages you view, device and browser type, approximate location and cookie identifiers', privacy: 'https://policies.google.com/privacy', implies: ['analytics', 'cookies'] },
  { id: 'posthog', name: 'PostHog', kind: 'analytics', does: 'product analytics', data: 'pages or screens you view, actions you take, and device and browser type', privacy: 'https://posthog.com/privacy', implies: ['analytics'] },
  { id: 'plausible', name: 'Plausible', kind: 'analytics', does: 'privacy-friendly visitor counts, without cookies', data: 'pages you view, referring site, country and browser type, without identifying you', privacy: 'https://plausible.io/privacy', implies: ['analytics'] },
  { id: 'openai', name: 'OpenAI', kind: 'ai', does: 'AI features', data: 'the text, images or files you send to an AI feature', privacy: 'https://openai.com/policies/privacy-policy/', implies: ['content'] },
  { id: 'anthropic', name: 'Anthropic (Claude)', kind: 'ai', does: 'AI features', data: 'the text, images or files you send to an AI feature', privacy: 'https://www.anthropic.com/legal/privacy', implies: ['content'] },
  { id: 'resend', name: 'Resend', kind: 'email', does: 'sending emails', data: 'your email address and the emails we send you', privacy: 'https://resend.com/legal/privacy-policy', implies: ['account'] },
  { id: 'sentry', name: 'Sentry', kind: 'errors', does: 'error and crash reports', data: 'technical details about errors, your device and browser type, and sometimes your user ID', privacy: 'https://sentry.io/privacy/', implies: [] },
];

// ---------- A tiny document model, rendered to Markdown, HTML or the preview ----------
// Templates use **bold**, [label](url) and {{field}}. Field values are inserted as plain text, never as markup.

type Block = { t: 'h1' | 'h2' | 'h3' | 'p' | 'ul'; c: string | string[] };
type Mode = 'md' | 'html' | 'preview';

const FIELD_LABEL: Record<string, string> = {
  app: 'Your app name',
  owner: 'Your name or company',
  email: 'your contact email',
  url: 'your website address',
  law: 'your country or state',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const validEmail = (s: string) => /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(s);

function fieldValue(state: State, key: string): string {
  if (key === 'date') return formatDate(state.date);
  const v = oneLine(String((state as unknown as Record<string, unknown>)[key] ?? ''));
  return v;
}

function formatDate(iso: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T12:00:00') : new Date();
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function webUrl(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    return u.hostname.includes('.') ? u.toString() : null;
  } catch {
    return null;
  }
}

function inline(src: string, state: State, mode: Mode): string {
  const re = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)|\{\{(\w+)\}\}/g;
  let out = '';
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const text = src.slice(last, m.index);
    out += mode === 'md' ? text : esc(text);
    last = re.lastIndex;
    if (m[1] !== undefined) {
      const inner = inline(m[1], state, mode);
      out += mode === 'md' ? `**${inner}**` : `<strong>${inner}</strong>`;
    } else if (m[2] !== undefined) {
      const label = inline(m[2], state, mode);
      out += mode === 'md' ? `[${label}](${m[3]})` : `<a href="${esc(m[3])}">${label}</a>`;
    } else {
      out += field(m[4], state, mode);
    }
  }
  const rest = src.slice(last);
  return out + (mode === 'md' ? rest : esc(rest));
}

function field(key: string, state: State, mode: Mode): string {
  const v = fieldValue(state, key);
  if (!v) {
    const ph = `[${FIELD_LABEL[key] ?? key}]`;
    return mode === 'preview' ? `<mark class="ph">${esc(ph)}</mark>` : mode === 'html' ? esc(ph) : ph;
  }
  if (mode === 'md') return v.replace(/([\\`*_[\]<>])/g, '\\$1');
  if (key === 'email' && validEmail(v)) return `<a href="mailto:${esc(v)}">${esc(v)}</a>`;
  if (key === 'url') {
    const u = webUrl(v);
    if (u) return `<a href="${esc(u)}">${esc(v)}</a>`;
  }
  return esc(v);
}

function toMarkdown(doc: Block[], state: State): string {
  const lines: string[] = [];
  for (const b of doc) {
    if (b.t === 'ul') lines.push((b.c as string[]).map((li) => `- ${inline(li, state, 'md')}`).join('\n'));
    else {
      const text = inline(b.c as string, state, 'md');
      lines.push(b.t === 'h1' ? `# ${text}` : b.t === 'h2' ? `## ${text}` : b.t === 'h3' ? `### ${text}` : text);
    }
  }
  return lines.join('\n\n') + '\n';
}

function toHtml(doc: Block[], state: State, mode: Mode): string {
  return doc
    .map((b) => {
      if (b.t === 'ul') return `<ul>\n${(b.c as string[]).map((li) => `  <li>${inline(li, state, mode)}</li>`).join('\n')}\n</ul>`;
      return `<${b.t}>${inline(b.c as string, state, mode)}</${b.t}>`;
    })
    .join('\n');
}

// ---------- The two documents ----------

const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

function derived(s: State) {
  const picked = SERVICES.filter((x) => s.services.has(x.id));
  const has = (c: Collect) => s.collect.has(c) || picked.some((x) => x.implies.includes(c));
  const ai = picked.filter((x) => x.kind === 'ai');
  const pay = picked.filter((x) => x.kind === 'pay');
  const analytics = picked.filter((x) => x.kind === 'analytics');
  const cookieless = analytics.length > 0 && analytics.every((x) => x.id === 'plausible');
  const where = s.web && s.mobile ? 'our website and mobile app' : s.mobile ? 'our mobile app' : 'our website';
  return { picked, has, ai, pay, analytics, cookieless, where };
}

function privacyDoc(s: State): Block[] {
  const { picked, has, ai, pay, analytics, cookieless, where } = derived(s);
  const d: Block[] = [];
  const h2 = (c: string) => d.push({ t: 'h2', c });
  const p = (c: string) => d.push({ t: 'p', c });
  const ul = (c: string[]) => d.push({ t: 'ul', c });
  const cookies = s.web && (has('cookies') || (analytics.length > 0 && !cookieless));

  d.push({ t: 'h1', c: 'Privacy Policy for {{app}}' });
  p('**Last updated:** {{date}}');
  p(`{{app}} ("we", "us") is run by {{owner}}. This policy explains what information we collect when you use ${where}${s.web ? ' ({{url}})' : ''}, why we collect it, and the choices you have. If you have any questions, email us at {{email}}.`);

  h2('The short version');
  ul([
    'We collect only what we need to run {{app}}.',
    'We **do not sell** your personal information, and we do not use it for advertising.',
    picked.length ? 'We use a few trusted services to run the app. They are all listed below.' : 'We only share your information when it is needed to run the app or when the law requires it.',
    'You can ask us to see, change or delete your data at any time.',
  ]);

  h2('What we collect');
  const what: string[] = [];
  if (has('account')) what.push('**Account details:** your email address and, if you give it, your name, when you sign up or sign in.');
  if (has('payments')) what.push(`**Payment details:** when you pay, ${pay.length ? list(pay.map((x) => x.name)) : 'our payment provider'} handles your card details. We never see or store your full card number. We receive your billing name, email, country, the last 4 digits of your card and whether the payment worked.`);
  if (has('content')) what.push(`**What you add:** the text, files and other content you create or upload in {{app}}${ai.length ? ', including what you send to AI features' : ''}, so we can store it and show it back to you.`);
  if (has('analytics')) what.push(`**How you use ${s.mobile && !s.web ? 'the app' : '{{app}}'}:** ${s.web ? 'pages' : 'screens'} you view, features you use, your device and browser type, the site that sent you, and your approximate location (country or city) based on your IP address.`);
  what.push('**Technical data:** our servers automatically record things like your IP address, browser or device type and the time of each request. This keeps the service secure and working.');
  if (s.mobile) what.push('**Device data:** your device model, operating system version, app version and, if the app crashes, a crash report.');
  ul(what);
  p('We do not knowingly collect sensitive information such as health data, precise location or government ID numbers. Please don’t put that kind of information into {{app}}.');

  h2('How we use it');
  const use = ['To run {{app}} and give you the features you ask for.'];
  if (has('account')) use.push('To create and secure your account, and to send you important messages about it, like sign-in links, receipts and changes to these policies.');
  if (has('payments')) use.push('To take payments, send receipts and handle refunds.');
  if (has('analytics')) use.push('To understand which features are used, so we can fix problems and make the app better.');
  use.push('To keep the service safe, prevent fraud and abuse, and meet our legal obligations.');
  ul(use);

  if (cookies) {
    h2('Cookies');
    const c = ['**Essential cookies** keep you signed in and remember your settings. The site doesn’t work properly without them.'];
    if (analytics.length && !cookieless) c.push(`**Analytics cookies** from ${list(analytics.filter((x) => x.id !== 'plausible').map((x) => x.name))} help us count visits and see how the site is used.`);
    ul(c);
    p(`You can block or delete cookies in your browser settings.${s.regions.has('eu') ? ' Where the law requires it, such as in the EU and UK, we ask for your consent before setting cookies that are not essential, and you can change your choice at any time.' : ''}`);
  }

  if (ai.length) {
    h2('AI features');
    p(`When you use an AI feature, the text, images or files you send are passed to ${list(ai.map((x) => x.name))} to create a response. Under their business terms for API customers, ${ai.length > 1 ? 'these providers do' : 'this provider does'} not use that data to train ${ai.length > 1 ? 'their' : 'its'} models by default, and ${ai.length > 1 ? 'they keep' : 'it keeps'} it only for a limited time, for example to check for abuse.`);
    p('AI responses can be wrong. Please don’t send passwords, health details or other sensitive personal information to AI features.');
  }

  if (picked.length) {
    h2('Services we use');
    p('We use these companies to run {{app}}. They only get the information they need to do their job, and they are not allowed to use it for anything else.');
    ul(picked.map((x) => `**${x.name}**: ${x.does}. Receives ${x.data}. [Privacy policy](${x.privacy})`));
  }

  h2('Who we share it with');
  ul([
    picked.length ? 'The service providers listed above, only to run {{app}}.' : 'Service providers that help us run {{app}}, such as hosting, only for that purpose.',
    'Authorities, if the law requires it or to protect the rights and safety of our users.',
    'A buyer, if {{app}} is sold or merged. We will tell you before your information is moved and becomes subject to a different privacy policy.',
  ]);
  p('We never sell your personal information.');

  h2('How long we keep it');
  p(`We keep your information while your account is open${has('account') ? '' : ' or as long as we need it to run the service'}. When you delete your account, we delete your personal information within 30 days, except what we must keep by law${has('payments') ? ', such as invoices for tax records' : ''}. Backups are cleared on a rolling basis.`);

  h2('How we protect it');
  p('We use encryption in transit (HTTPS), access controls and reputable providers to protect your information. No service is perfectly secure, so if we learn of a breach that affects you, we will tell you as the law requires.');

  h2('Your choices and rights');
  ul([
    'See a copy of the personal information we hold about you.',
    'Correct anything that is wrong.',
    `Delete your account and your data${s.mobile && has('account') ? ', in the app or by emailing us' : ''}.`,
    'Get your data in a portable format.',
    ...(has('account') ? ['Unsubscribe from non-essential emails with the link at the bottom of each one.'] : []),
  ]);
  p('To do any of this, email {{email}}. We reply within 30 days. We may need to confirm it’s you before we act.');

  if (s.regions.has('eu')) {
    d.push({ t: 'h3', c: 'If you are in the EU, EEA or UK' });
    p('{{owner}} is the "controller" of your personal information under the GDPR and UK GDPR. We use your information on these legal bases:');
    const bases = ['**Contract:** to provide the service you signed up for.', '**Legitimate interests:** to keep the service secure and improve it, in ways you would reasonably expect.'];
    if (cookies || has('analytics')) bases.push('**Consent:** for non-essential cookies and analytics where the law requires it. You can withdraw consent at any time.');
    bases.push('**Legal obligation:** for example, keeping tax records.');
    ul(bases);
    p('You also have the right to object to or restrict how we use your information, and to complain to your local data protection authority. Some of our providers are based outside the EU and UK, including in the United States. When your information is transferred there, it is protected by safeguards such as the EU Standard Contractual Clauses or the EU-US Data Privacy Framework.');
  }

  if (s.regions.has('us')) {
    d.push({ t: 'h3', c: 'If you are in California or another US state with a privacy law' });
    p('Under the CCPA and similar state laws, you have the right to know what personal information we collect and how we use it, to ask us to delete or correct it, and not to be treated differently for using these rights. The categories we collect are listed in "What we collect" above. We do not sell your personal information or share it for cross-context behavioral advertising.');
  }

  if (s.mobile) {
    h2('App permissions');
    p('The app only asks for device permissions, such as notifications, camera or photos, when you use a feature that needs them. You can turn any permission off in your device settings at any time.');
  }

  h2('Children');
  if (s.kids) p('{{app}} may be used by children. [Write how you get parental consent and what you collect from children. This needs a lawyer: see the note in the generator.]');
  else p(`{{app}} is not meant for children under 13${s.regions.has('eu') ? ' (or under 16 where EU or UK law requires)' : ''}, and we do not knowingly collect their information. If you think a child has given us personal information, email {{email}} and we will delete it.`);

  h2('Changes to this policy');
  p('If we make important changes, we will update the date at the top and, if you have an account, tell you by email or in the app before the changes take effect.');

  h2('Contact');
  p('{{owner}}' + (s.web ? ', {{url}}' : '') + '. Email: {{email}}');
  return d;
}

function termsDoc(s: State): Block[] {
  const { has, ai, pay, where } = derived(s);
  const d: Block[] = [];
  let n = 0;
  const h2 = (c: string) => d.push({ t: 'h2', c: `${++n}. ${c}` });
  const p = (c: string) => d.push({ t: 'p', c });
  const ul = (c: string[]) => d.push({ t: 'ul', c });

  d.push({ t: 'h1', c: 'Terms of Service for {{app}}' });
  p('**Last updated:** {{date}}');
  p(`These terms are an agreement between you and {{owner}} ("we", "us") about your use of {{app}}, including ${where}${s.web ? ' ({{url}})' : ''}. Please read them. They are written to be clear, but they are still a contract.`);

  h2('Agreeing to these terms');
  p('By using {{app}}, you agree to these terms and to our Privacy Policy. If you don’t agree, please don’t use {{app}}. If you use {{app}} for a company, you confirm you are allowed to accept these terms for it.');

  h2('Who can use it');
  p(`You must be at least ${s.kids ? 'the age set out in our Privacy Policy, with a parent’s permission where needed' : `13 years old${s.regions.has('eu') ? ', or 16 where EU or UK law requires,' : ''} and old enough to agree to these terms where you live`}.`);

  if (has('account')) {
    h2('Your account');
    ul([
      'Give accurate information when you sign up and keep it up to date.',
      'Keep your sign-in details safe. You are responsible for what happens in your account.',
      'Tell us at {{email}} right away if you think someone else is using your account.',
    ]);
  }

  if (has('payments')) {
    h2('Payments and subscriptions');
    const refund =
      s.refunds === 'none'
        ? 'Payments are non-refundable, except where the law gives you a right to a refund.'
        : `If you’re not happy, email {{email}} within ${s.refunds} days of a payment and we will refund it in full.`;
    ul([
      `Prices are shown before you pay. Payments are handled by ${pay.length ? list(pay.map((x) => x.name)) : 'our payment provider'}${s.mobile ? ', or by Apple or Google when you buy in the mobile app' : ''}.`,
      'Subscriptions are billed in advance and renew automatically until you cancel. You can cancel at any time, and you keep access until the end of the period you paid for.',
      refund,
      'If we change a price, we will tell you before it applies to you, and you can cancel before then.',
      'Prices may not include taxes, which are added where required.',
    ]);
    if (s.regions.has('eu')) p('If you are a consumer in the EU or UK, you may have a legal right to cancel within 14 days. By starting to use a paid plan right away, you ask us to begin the service during that period.');
  }

  if (has('content')) {
    h2('Your content');
    ul([
      'You own what you create or upload in {{app}}.',
      'You give us permission to store, process and show your content only as needed to run {{app}} for you.',
      'You are responsible for your content, and you confirm you have the right to use it.',
      'We may remove content that breaks these terms or the law.',
    ]);
  }

  if (ai.length) {
    h2('AI features');
    ul([
      `Some features use AI from ${list(ai.map((x) => x.name))}. AI output can be wrong, incomplete or not unique. Check it before you rely on it.`,
      'Don’t use AI output as medical, legal, financial or other professional advice.',
      'You are responsible for how you use the output, and you must follow the AI providers’ usage policies.',
    ]);
  }

  h2('What you must not do');
  ul([
    'Break the law, or help anyone else break it.',
    'Harass, harm, spam or deceive other people.',
    'Try to hack, overload or get around the security of {{app}}.',
    'Copy, scrape, resell or reverse engineer {{app}} without our written permission.',
    'Upload anything you don’t have the rights to, or anything with viruses or harmful code.',
  ]);

  h2('Our app');
  p('{{app}}, its design, code and brand belong to {{owner}}. These terms give you permission to use {{app}}, not to own it. If you send us feedback or ideas, we may use them without owing you anything.');

  h2('Other services');
  p('{{app}} may link to or work with services run by other companies. Their own terms apply to them, and we are not responsible for them.');

  if (s.mobile) {
    h2('App stores');
    p('If you downloaded {{app}} from the Apple App Store or Google Play, these terms are between you and us, not Apple or Google. They are not responsible for {{app}} or for supporting it. The app store’s own terms also apply to your download.');
  }

  h2('Ending your use');
  p(`You can stop using {{app}} at any time${has('account') ? ' and delete your account' : ''}. We may suspend or close your access if you break these terms or if we need to for legal reasons. We may also change or stop {{app}}; if we stop it, we will try to give you reasonable notice${has('payments') ? ' and refund any time you paid for but could not use' : ''}.`);

  h2('No warranty');
  p('We work hard to keep {{app}} running well, but we provide it "as is" and "as available". We don’t promise it will always be available, error-free or right for your needs.');

  h2('Limit of liability');
  p(`To the extent the law allows, we are not liable for indirect or consequential losses, such as lost profits or data. Our total liability to you for any claim is limited to the greater of the amount you paid us in the 12 months before the claim and 100 US dollars. Nothing in these terms limits rights you have as a consumer that the law says cannot be limited.`);

  h2('Changes to these terms');
  p('We may update these terms. If a change is important, we will tell you before it takes effect. If you keep using {{app}} after that, you accept the new terms.');

  h2('Governing law');
  p('These terms are governed by the laws of {{law}}. If you are a consumer, you also keep the protection of the laws of the place you live.');

  h2('Contact');
  p('Questions about these terms? Email {{email}}.');
  return d;
}

// ---------- Page wiring ----------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('pp-form');
const paper = $<HTMLElement>('pp-paper');
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.pp [data-tab]'));
const chips = $<HTMLUListElement>('pp-chips');
const verdict = $<HTMLElement>('pp-verdict');
const kidsWarn = $<HTMLElement>('pp-kids-warn');
const refundsBox = $<HTMLElement>('pp-refunds');
const status = $<HTMLParagraphElement>('pp-status');
const serviceBox = $<HTMLElement>('pp-services');

let tab: 'privacy' | 'terms' = 'privacy';

// Build the service checkboxes from the list above, grouped by what they do.
const GROUPS: [string, Kind[]][] = [
  ['Database and sign-in', ['db', 'auth']],
  ['Hosting', ['host']],
  ['Payments', ['pay']],
  ['Analytics', ['analytics']],
  ['AI', ['ai']],
  ['Email and errors', ['email', 'errors']],
];
serviceBox.innerHTML = GROUPS.map(
  ([label, kinds]) =>
    `<div class="group"><span class="glabel">${esc(label)}</span><div class="pills">${SERVICES.filter((x) => kinds.includes(x.kind))
      .map((x) => `<label class="pill"><input type="checkbox" name="service" value="${x.id}"><span>${esc(x.name)}</span></label>`)
      .join('')}</div></div>`,
).join('');

const today = new Date();
const dateInput = form.elements.namedItem('date') as HTMLInputElement;
dateInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

function read(): State {
  const val = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value;
  const checked = (n: string) => Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${n}"]:checked`)).map((i) => i.value);
  const platform = checked('platform');
  return {
    app: val('app'),
    owner: val('owner'),
    email: val('email'),
    url: val('url'),
    law: val('law'),
    date: val('date'),
    web: platform.includes('web') || platform.length === 0,
    mobile: platform.includes('mobile'),
    collect: new Set(checked('collect') as Collect[]),
    services: new Set(checked('service')),
    regions: new Set(checked('region') as Region[]),
    kids: (form.elements.namedItem('kids') as HTMLInputElement).checked,
    refunds: val('refunds') as State['refunds'],
  };
}

// When a service is ticked, tick what it implies (Stripe means payments, Google Analytics means cookies...).
form.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.name === 'service' && t.checked) {
    const svc = SERVICES.find((x) => x.id === t.value);
    for (const c of svc?.implies ?? []) {
      const box = form.querySelector<HTMLInputElement>(`input[name="collect"][value="${c}"]`);
      if (box) box.checked = true;
    }
  }
  render();
});
form.addEventListener('input', render);
form.addEventListener('submit', (e) => e.preventDefault());

for (const b of tabs) {
  b.addEventListener('click', () => {
    tab = b.dataset.tab as typeof tab;
    for (const x of tabs) x.setAttribute('aria-selected', String(x === b));
    paper.scrollTop = 0;
    render();
  });
}

function blanks(s: State): string[] {
  const missing: string[] = [];
  if (!oneLine(s.app)) missing.push('app name');
  if (!oneLine(s.owner)) missing.push('your name or company');
  if (!validEmail(oneLine(s.email))) missing.push('contact email');
  if (s.web && !webUrl(s.url)) missing.push('website');
  if (!oneLine(s.law)) missing.push('governing law (terms)');
  return missing;
}

function render() {
  const s = read();
  const { picked, has, ai, analytics, cookieless } = derived(s);
  const doc = tab === 'privacy' ? privacyDoc(s) : termsDoc(s);
  paper.innerHTML = toHtml(doc, s, 'preview');

  kidsWarn.hidden = !s.kids;
  refundsBox.hidden = !has('payments');

  const missing = blanks(s);
  verdict.className = missing.length ? 'verdict todo' : 'verdict ok';
  verdict.textContent = missing.length
    ? `${missing.length} ${missing.length === 1 ? 'blank' : 'blanks'} to fill: ${missing.join(', ')}`
    : 'Ready to copy. Read it once before you publish.';

  const c: string[] = [];
  if (s.regions.has('eu')) c.push('EU and UK (GDPR)');
  if (s.regions.has('us')) c.push('California (CCPA)');
  if (picked.length) c.push(`${picked.length} ${picked.length === 1 ? 'service' : 'services'} named`);
  if (s.web && (has('cookies') || (analytics.length && !cookieless))) c.push('Cookies');
  if (has('payments')) c.push('Payments and refunds');
  if (ai.length) c.push('AI features');
  if (s.mobile) c.push('App Store and Play Store');
  chips.innerHTML = c.map((x) => `<li>${esc(x)}</li>`).join('');
}

// ---------- Copy and download ----------

function slug(s: State) {
  return (oneLine(s.app) || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';
}

const NOTE = 'Made with the free privacy policy generator at https://darnly.dev/tools/privacy-policy-generator/. This is a starting point, not legal advice.';

function current() {
  const s = read();
  const doc = tab === 'privacy' ? privacyDoc(s) : termsDoc(s);
  const name = tab === 'privacy' ? 'privacy-policy' : 'terms-of-service';
  return { s, doc, name, title: tab === 'privacy' ? 'Privacy Policy' : 'Terms of Service' };
}

function fullHtml(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body { max-width: 720px; margin: 0 auto; padding: 40px 20px 80px; font: 17px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a1a1a; background: #fff; }
  h1 { font-size: 32px; line-height: 1.2; } h2 { font-size: 22px; margin-top: 2em; } h3 { font-size: 18px; margin-top: 1.6em; }
  li { margin: 6px 0; } a { color: #0b62a4; }
</style>
</head>
<body>
<!-- ${NOTE} -->
${body}
</body>
</html>
`;
}

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = done;
  } catch {
    status.textContent = 'Your browser blocked copying. Try the download button instead.';
  }
}

function download(text: string, file: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = file;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  status.textContent = `Downloaded ${file}.`;
}

$('pp-copy-md').addEventListener('click', () => {
  const { s, doc, title } = current();
  copy(toMarkdown(doc, s), `${title} copied as Markdown.`);
});
$('pp-copy-html').addEventListener('click', () => {
  const { s, doc, title } = current();
  copy(toHtml(doc, s, 'html') + '\n', `${title} copied as HTML.`);
});
$('pp-dl-md').addEventListener('click', () => {
  const { s, doc, name } = current();
  download(`<!-- ${NOTE} -->\n\n` + toMarkdown(doc, s), `${slug(s)}-${name}.md`, 'text/markdown');
});
$('pp-dl-html').addEventListener('click', () => {
  const { s, doc, name, title } = current();
  download(fullHtml(`${title} · ${oneLine(s.app) || 'App'}`, toHtml(doc, s, 'html')), `${slug(s)}-${name}.html`, 'text/html');
});
$('pp-prompt').addEventListener('click', () => {
  const s = read();
  const pages = s.web
    ? 'Add two pages to my app: /privacy with the Privacy Policy below and /terms with the Terms of Service below. Use the text exactly as written, styled like the rest of the site. Link both pages from the footer, and from the sign-up screen if there is one.'
    : 'Add a Privacy Policy screen and a Terms of Service screen to my mobile app with the text below, exactly as written. Link both from the settings screen and the sign-up screen.';
  const extra = s.mobile
    ? ' The App Store and Google Play need a public web address for the privacy policy, so also tell me where to host it. Make sure users can delete their account from inside the app, because Apple requires it.'
    : '';
  const prompt = `${pages}${extra} Do not change the wording; tell me if anything in it doesn't match what the code actually does (for example, a service it names that the app doesn't use, or one it uses that isn't named).\n\n---\n\n${toMarkdown(privacyDoc(s), s)}\n---\n\n${toMarkdown(termsDoc(s), s)}`;
  copy(prompt, 'Prompt copied. Paste it into Claude Code, Cursor or Codex.');
});

render();
