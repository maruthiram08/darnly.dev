// Structured data (JSON-LD) generator: everything runs in the visitor's browser. Nothing is sent anywhere.

type Pair = { a: string; b: string };
type Value = string | Pair[];
type Fields = Record<string, Value>;
type Kind = 'text' | 'url' | 'textarea' | 'date' | 'datetime' | 'number' | 'select' | 'lines' | 'pairs';
type Field = {
  key: string;
  label: string;
  kind: Kind;
  req?: boolean;
  ph?: string;
  hint?: string;
  opts?: [string, string][];
  pair?: [string, string, string, string]; // labels and placeholders for list rows
  min?: number;
};
type Issue = { level: 'bad' | 'tip'; text: string };
type TypeDef = {
  key: string;
  name: string;
  blurb: string;
  fields: Field[];
  example: Fields;
  build: (v: Fields) => Record<string, unknown>;
  check: (v: Fields) => Issue[];
  preview: (v: Fields) => HTMLElement;
  rich: string; // what Google can show
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Small DOM helper. Text is always set with textContent, so nothing typed is ever run as HTML.
function h(tag: string, cls?: string, text?: string, ...kids: (Node | null | false)[]): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  for (const k of kids) if (k) el.append(k);
  return el;
}

const str = (v: Value | undefined) => (typeof v === 'string' ? v.trim() : '');
const pairs = (v: Value | undefined) => (Array.isArray(v) ? v.filter((p) => p.a.trim() || p.b.trim()) : []);
const lines = (v: Value | undefined) => str(v).split('\n').map((s) => s.trim()).filter(Boolean);

// Adds https:// when someone types just "mysite.com".
function fullUrl(raw: string): string {
  if (!raw) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
}
function validUrl(raw: string): boolean {
  if (!raw) return true;
  try {
    const u = new URL(fullUrl(raw));
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}
function host(raw: string): string {
  try {
    return new URL(fullUrl(raw)).hostname.replace(/^www\./, '');
  } catch {
    return raw;
  }
}
function crumbUrl(raw: string): string {
  try {
    const u = new URL(fullUrl(raw));
    const parts = u.pathname.split('/').filter(Boolean);
    return [u.origin.replace(/^https?:\/\/(www\.)?/, 'https://'), ...parts].join(' › ');
  } catch {
    return raw;
  }
}

// Turns a datetime-local value into ISO 8601 with the visitor's time zone offset, which Google prefers.
function withOffset(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return local;
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  const base = local.length === 16 ? `${local}:00` : local;
  return `${base}${sign}${hh}:${mm}`;
}

// Removes empty strings, empty arrays and empty objects so the output only has what was filled in.
function prune(o: unknown): unknown {
  if (Array.isArray(o)) {
    const a = o.map(prune).filter((x) => x !== undefined);
    return a.length ? a : undefined;
  }
  if (o && typeof o === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      const p = prune(val);
      if (p !== undefined) out[k] = p;
    }
    const keys = Object.keys(out).filter((k) => k !== '@type' && k !== '@context');
    return keys.length ? out : undefined;
  }
  if (typeof o === 'string') return o.trim() ? o.trim() : undefined;
  if (typeof o === 'number') return Number.isFinite(o) ? o : undefined;
  return o ?? undefined;
}

const num = (s: string) => (s && !Number.isNaN(Number(s)) ? Number(s) : undefined);

const CURRENCIES: [string, string][] = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY', 'SGD', 'AED', 'BRL'].map((c) => [c, c]);
const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', INR: '₹', CAD: 'CA$', AUD: 'A$', JPY: '¥', SGD: 'S$', AED: 'AED ', BRL: 'R$' };
function money(price: string, cur: string): string {
  const n = Number(price);
  if (!price || Number.isNaN(n)) return '';
  if (n === 0) return 'Free';
  return `${SYMBOL[cur] ?? `${cur} `}${n.toFixed(n % 1 ? 2 : 0)}`;
}

// --- shared checks ---------------------------------------------------------------------------

function need(v: Fields, key: string, text: string, out: Issue[]) {
  if (!str(v[key])) out.push({ level: 'bad', text });
}
function tip(v: Fields, key: string, text: string, out: Issue[]) {
  if (!str(v[key])) out.push({ level: 'tip', text });
}
function urls(v: Fields, keys: [string, string][], out: Issue[]) {
  for (const [k, name] of keys) {
    if (!validUrl(str(v[k]))) out.push({ level: 'bad', text: `${name} doesn’t look like a link. Use a full one, like https://acme.com/logo.png` });
  }
}
function rating(v: Fields, out: Issue[]) {
  const r = str(v.ratingValue);
  const c = str(v.ratingCount);
  if (!r && !c) return;
  const rn = Number(r);
  if (!r) out.push({ level: 'bad', text: 'You gave a number of reviews but no rating. Add the average rating (like 4.7), or clear both.' });
  else if (Number.isNaN(rn) || rn < 1 || rn > 5) out.push({ level: 'bad', text: 'The rating should be a number from 1 to 5, like 4.7.' });
  if (!c) out.push({ level: 'bad', text: 'Add how many reviews the rating comes from. Google won’t show stars without it.' });
  else if (!/^\d+$/.test(c) || Number(c) < 1) out.push({ level: 'bad', text: 'The number of reviews should be a whole number, like 128.' });
}
function aggregate(v: Fields) {
  const r = num(str(v.ratingValue));
  const c = num(str(v.ratingCount));
  if (r === undefined && c === undefined) return undefined;
  return { '@type': 'AggregateRating', ratingValue: r, ratingCount: c, bestRating: 5 };
}

// --- preview pieces --------------------------------------------------------------------------

function stars(value: string, count: string, extra?: string): HTMLElement | null {
  const r = Number(value);
  if (!value || Number.isNaN(r)) return null;
  const pct = Math.max(0, Math.min(100, (r / 5) * 100));
  const bar = h('span', 'g-stars', '★★★★★');
  bar.style.setProperty('--fill', `${pct}%`);
  bar.setAttribute('aria-hidden', 'true');
  const label = [count && !Number.isNaN(Number(count)) ? `(${Number(count).toLocaleString('en-US')})` : '', extra ?? ''].filter(Boolean).join(' · ');
  return h('span', 'g-rating', '', h('span', 'g-rnum', r.toFixed(1)), bar, label ? h('span', '', label) : null);
}

function result(site: string, url: string, title: string, desc: string, ...extra: (Node | null | false)[]): HTMLElement {
  const name = site || host(url) || 'Your site';
  return h(
    'div',
    'g-result',
    '',
    h('div', 'g-head', '', h('span', 'g-fav', (name[0] || '?').toUpperCase()), h('span', 'g-src', '', h('span', 'g-site', name), h('span', 'g-url', url ? crumbUrl(url) : 'https://yoursite.com'))),
    h('span', 'g-title', title || 'Your page title'),
    ...extra,
    desc ? h('span', 'g-desc', desc) : null,
  );
}

function picture(src: string, cls: string, fallback: string): HTMLElement {
  const box = h('div', cls);
  // The examples point at made-up addresses, so they show the emoji instead of a broken request.
  if (src && validUrl(src) && !/^https:\/\/acme\.com\//.test(src)) {
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = fullUrl(src);
    img.onerror = () => {
      img.remove();
      box.textContent = fallback;
    };
    box.append(img);
  } else box.textContent = fallback;
  return box;
}

function shortDate(s: string): string {
  const d = new Date(s);
  if (!s || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// --- the nine types -------------------------------------------------------------------------

const rateFields: Field[] = [
  { key: 'ratingValue', label: 'Average rating (1–5)', kind: 'number', ph: '4.7' },
  { key: 'ratingCount', label: 'Number of reviews', kind: 'number', ph: '128' },
];

const TYPES: TypeDef[] = [
  {
    key: 'Organization',
    name: 'Organization',
    blurb: 'Your company or brand',
    rich: 'Your logo next to your results and in Google’s knowledge panel.',
    fields: [
      { key: 'name', label: 'Company or brand name', kind: 'text', req: true, ph: 'Acme' },
      { key: 'url', label: 'Website', kind: 'url', req: true, ph: 'https://acme.com' },
      { key: 'logo', label: 'Logo link', kind: 'url', ph: 'https://acme.com/logo.png', hint: 'A square PNG or SVG, at least 112 × 112 pixels.' },
      { key: 'description', label: 'One-line description', kind: 'textarea', ph: 'Invoices in 30 seconds for freelancers.' },
      { key: 'email', label: 'Contact email', kind: 'text', ph: 'hello@acme.com' },
      { key: 'telephone', label: 'Phone', kind: 'text', ph: '+1 415 555 0100' },
      { key: 'sameAs', label: 'Social profiles (one per line)', kind: 'lines', ph: 'https://x.com/acme\nhttps://www.linkedin.com/company/acme' },
    ],
    example: {
      name: 'Acme Invoices',
      url: 'https://acme.com',
      logo: '',
      description: 'Send a professional invoice in 30 seconds. Built for freelancers and small studios.',
      email: 'hello@acme.com',
      telephone: '',
      sameAs: 'https://x.com/acmeinvoices\nhttps://www.linkedin.com/company/acme-invoices\nhttps://github.com/acme',
    },
    build: (v) => ({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: str(v.name),
      url: fullUrl(str(v.url)),
      logo: fullUrl(str(v.logo)),
      description: str(v.description),
      email: str(v.email),
      telephone: str(v.telephone),
      sameAs: lines(v.sameAs).map(fullUrl),
    }),
    check: (v) => {
      const o: Issue[] = [];
      need(v, 'name', 'Add your company or brand name.', o);
      need(v, 'url', 'Add your website’s link so Google knows which site this is.', o);
      urls(v, [['url', 'The website'], ['logo', 'The logo link']], o);
      lines(v.sameAs).forEach((l) => validUrl(l) || o.push({ level: 'bad', text: `“${l}” doesn’t look like a profile link.` }));
      tip(v, 'logo', 'Add a logo link. It’s what Google shows next to your name.', o);
      if (!lines(v.sameAs).length) o.push({ level: 'tip', text: 'Add your social profiles. They help Google connect your brand to them.' });
      return o;
    },
    preview: (v) => {
      const name = str(v.name) || 'Your company';
      const profiles = lines(v.sameAs).map((l) => host(l).split('.').slice(-2, -1)[0] || host(l));
      return h(
        'div',
        'kp',
        '',
        h('div', 'kp-top', '', picture(str(v.logo), 'kp-logo', name[0]?.toUpperCase() || '?'), h('div', '', '', h('span', 'kp-name', name), h('span', 'kp-kind', 'Company'))),
        str(v.description) ? h('p', 'kp-desc', str(v.description)) : null,
        h('dl', 'kp-facts', '', str(v.url) ? h('div', '', '', h('dt', '', 'Website'), h('dd', 'g-link', host(str(v.url)))) : null, str(v.email) ? h('div', '', '', h('dt', '', 'Email'), h('dd', '', str(v.email))) : null, str(v.telephone) ? h('div', '', '', h('dt', '', 'Phone'), h('dd', '', str(v.telephone))) : null),
        profiles.length ? h('div', 'kp-profiles', '', h('span', 'kp-label', 'Profiles'), ...profiles.map((p) => h('span', 'kp-chip', p))) : null,
      );
    },
  },
  {
    key: 'WebSite',
    name: 'WebSite',
    blurb: 'Your site’s name in results',
    rich: 'Your site’s name above the result instead of just the domain.',
    fields: [
      { key: 'name', label: 'Site name', kind: 'text', req: true, ph: 'Acme' },
      { key: 'url', label: 'Home page link', kind: 'url', req: true, ph: 'https://acme.com', hint: 'Use your home page, not an inner page.' },
      { key: 'alternateName', label: 'Other name (optional)', kind: 'text', ph: 'Acme Invoices' },
      { key: 'title', label: 'Home page title (for the preview only)', kind: 'text', ph: 'Acme: invoices in 30 seconds' },
      { key: 'desc', label: 'Home page description (for the preview only)', kind: 'textarea', ph: 'Send your first invoice in under a minute.' },
    ],
    example: {
      name: 'Acme',
      url: 'https://acme.com',
      alternateName: 'Acme Invoices',
      title: 'Acme: invoices in 30 seconds',
      desc: 'Send your first invoice in under a minute. Free for your first 10 clients.',
    },
    build: (v) => ({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: str(v.name),
      alternateName: str(v.alternateName),
      url: fullUrl(str(v.url)),
    }),
    check: (v) => {
      const o: Issue[] = [];
      need(v, 'name', 'Add your site’s name. It’s the whole point of this one.', o);
      need(v, 'url', 'Add your home page link.', o);
      urls(v, [['url', 'The home page link']], o);
      try {
        if (str(v.url) && new URL(fullUrl(str(v.url))).pathname.length > 1) o.push({ level: 'tip', text: 'Google only reads this on your home page, so use the link to your home page.' });
      } catch {
        /* already flagged */
      }
      return o;
    },
    preview: (v) => result(str(v.name), str(v.url), str(v.title), str(v.desc)),
  },
  {
    key: 'SoftwareApplication',
    name: 'App',
    blurb: 'A web, mobile or desktop app',
    rich: 'Star rating, price and platform under your result.',
    fields: [
      { key: 'name', label: 'App name', kind: 'text', req: true, ph: 'Acme Invoices' },
      { key: 'url', label: 'App page link', kind: 'url', ph: 'https://acme.com' },
      { key: 'description', label: 'Short description', kind: 'textarea', ph: 'Invoices in 30 seconds.' },
      { key: 'operatingSystem', label: 'Runs on', kind: 'text', ph: 'Web, iOS, Android' },
      {
        key: 'applicationCategory',
        label: 'Category',
        kind: 'select',
        opts: [
          ['BusinessApplication', 'Business'],
          ['DeveloperApplication', 'Developer tools'],
          ['FinanceApplication', 'Finance'],
          ['DesignApplication', 'Design'],
          ['EducationalApplication', 'Education'],
          ['GameApplication', 'Game'],
          ['HealthApplication', 'Health'],
          ['LifestyleApplication', 'Lifestyle'],
          ['MultimediaApplication', 'Photo and video'],
          ['SocialNetworkingApplication', 'Social'],
          ['TravelApplication', 'Travel'],
          ['UtilitiesApplication', 'Utilities'],
        ],
      },
      { key: 'price', label: 'Price (0 if free)', kind: 'number', req: true, ph: '0' },
      { key: 'priceCurrency', label: 'Currency', kind: 'select', opts: CURRENCIES },
      ...rateFields,
    ],
    example: {
      name: 'Acme Invoices',
      url: 'https://acme.com',
      description: 'Send a professional invoice in 30 seconds and get paid by card or bank transfer.',
      operatingSystem: 'Web, iOS, Android',
      applicationCategory: 'BusinessApplication',
      price: '0',
      priceCurrency: 'USD',
      ratingValue: '4.8',
      ratingCount: '312',
    },
    build: (v) => ({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: str(v.name),
      url: fullUrl(str(v.url)),
      description: str(v.description),
      operatingSystem: str(v.operatingSystem),
      applicationCategory: str(v.applicationCategory),
      offers: { '@type': 'Offer', price: num(str(v.price)), priceCurrency: str(v.price) ? str(v.priceCurrency) : '' },
      aggregateRating: aggregate(v),
    }),
    check: (v) => {
      const o: Issue[] = [];
      need(v, 'name', 'Add your app’s name.', o);
      need(v, 'price', 'Add a price. Type 0 if your app is free. Google needs it to show app details.', o);
      if (str(v.price) && Number.isNaN(Number(str(v.price)))) o.push({ level: 'bad', text: 'The price should be just a number, like 9.99 or 0.' });
      urls(v, [['url', 'The app page link']], o);
      rating(v, o);
      if (!str(v.ratingValue) && !str(v.ratingCount)) o.push({ level: 'bad', text: 'Google only shows app details when there’s a rating. Add your average rating and how many reviews it comes from.' });
      tip(v, 'operatingSystem', 'Say what it runs on (like Web, iOS, Android).', o);
      return o;
    },
    preview: (v) => {
      const price = money(str(v.price), str(v.priceCurrency) || 'USD');
      const cat = TYPES[2].fields.find((f) => f.key === 'applicationCategory')?.opts?.find(([k]) => k === str(v.applicationCategory))?.[1];
      const extra = [price, str(v.operatingSystem), cat].filter(Boolean).join(' · ');
      return result('', str(v.url), str(v.name), str(v.description), stars(str(v.ratingValue), str(v.ratingCount)), extra ? h('span', 'g-meta', extra) : null);
    },
  },
  {
    key: 'Product',
    name: 'Product',
    blurb: 'Something you sell',
    rich: 'Price, stock and star rating, plus a product picture.',
    fields: [
      { key: 'name', label: 'Product name', kind: 'text', req: true, ph: 'Trail Runner 2' },
      { key: 'url', label: 'Product page link', kind: 'url', ph: 'https://acme.com/shoes/trail-runner-2' },
      { key: 'image', label: 'Product picture link', kind: 'url', req: true, ph: 'https://acme.com/img/trail-runner-2.jpg' },
      { key: 'description', label: 'Description', kind: 'textarea', ph: 'Light, grippy trail shoe.' },
      { key: 'brand', label: 'Brand', kind: 'text', ph: 'Acme' },
      { key: 'sku', label: 'SKU or product code', kind: 'text', ph: 'TR2-BLK-42' },
      { key: 'price', label: 'Price', kind: 'number', ph: '129.00' },
      { key: 'priceCurrency', label: 'Currency', kind: 'select', opts: CURRENCIES },
      {
        key: 'availability',
        label: 'Stock',
        kind: 'select',
        opts: [
          ['InStock', 'In stock'],
          ['OutOfStock', 'Out of stock'],
          ['PreOrder', 'Pre-order'],
          ['BackOrder', 'Back order'],
          ['LimitedAvailability', 'Limited stock'],
        ],
      },
      ...rateFields,
    ],
    example: {
      name: 'Trail Runner 2 running shoe',
      url: 'https://acme.com/shoes/trail-runner-2',
      image: 'https://acme.com/img/trail-runner-2.jpg',
      description: 'A light trail shoe with a grippy sole and a wide toe box. Free returns for 30 days.',
      brand: 'Acme',
      sku: 'TR2-BLK',
      price: '129',
      priceCurrency: 'USD',
      availability: 'InStock',
      ratingValue: '4.6',
      ratingCount: '89',
    },
    build: (v) => ({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: str(v.name),
      image: fullUrl(str(v.image)),
      description: str(v.description),
      sku: str(v.sku),
      brand: { '@type': 'Brand', name: str(v.brand) },
      url: fullUrl(str(v.url)),
      offers: str(v.price)
        ? {
            '@type': 'Offer',
            url: fullUrl(str(v.url)),
            price: num(str(v.price)),
            priceCurrency: str(v.priceCurrency),
            availability: `https://schema.org/${str(v.availability) || 'InStock'}`,
          }
        : undefined,
      aggregateRating: aggregate(v),
    }),
    check: (v) => {
      const o: Issue[] = [];
      need(v, 'name', 'Add the product’s name.', o);
      need(v, 'image', 'Add a link to a product picture. Google wants one for product results.', o);
      urls(v, [['url', 'The product page link'], ['image', 'The picture link']], o);
      if (str(v.price) && Number.isNaN(Number(str(v.price)))) o.push({ level: 'bad', text: 'The price should be just a number, like 129.00.' });
      rating(v, o);
      if (!str(v.price) && !str(v.ratingValue)) o.push({ level: 'bad', text: 'Add a price or a rating. Google needs at least one of them to show a product result.' });
      tip(v, 'brand', 'Add the brand name.', o);
      return o;
    },
    preview: (v) => {
      const price = money(str(v.price), str(v.priceCurrency) || 'USD');
      const stock = TYPES[3].fields.find((f) => f.key === 'availability')?.opts?.find(([k]) => k === (str(v.availability) || 'InStock'))?.[1] ?? '';
      const r = result(str(v.brand), str(v.url), str(v.name), str(v.description), stars(str(v.ratingValue), str(v.ratingCount)), price ? h('span', 'g-meta', '', h('strong', '', price), document.createTextNode(` · ${stock}`)) : null);
      r.classList.add('with-thumb');
      r.append(picture(str(v.image), 'g-thumb', '👟'));
      return r;
    },
  },
  {
    key: 'Article',
    name: 'Article',
    blurb: 'A blog post or news story',
    rich: 'Headline, picture and date in Top stories and Discover.',
    fields: [
      { key: 'headline', label: 'Headline', kind: 'text', req: true, ph: 'How we cut our invoice time to 30 seconds' },
      { key: 'url', label: 'Article link', kind: 'url', ph: 'https://acme.com/blog/30-seconds' },
      { key: 'image', label: 'Main picture link', kind: 'url', ph: 'https://acme.com/blog/30-seconds.jpg', hint: 'At least 1200 pixels wide works best.' },
      { key: 'author', label: 'Author name', kind: 'text', ph: 'Priya Shah' },
      { key: 'authorUrl', label: 'Author page link', kind: 'url', ph: 'https://acme.com/team/priya' },
      { key: 'datePublished', label: 'Published on', kind: 'date' },
      { key: 'dateModified', label: 'Last updated on', kind: 'date' },
      { key: 'publisher', label: 'Publisher (your site)', kind: 'text', ph: 'Acme' },
      { key: 'publisherLogo', label: 'Publisher logo link', kind: 'url', ph: 'https://acme.com/logo.png' },
    ],
    example: {
      headline: 'How we cut our invoice time from 20 minutes to 30 seconds',
      url: 'https://acme.com/blog/30-second-invoices',
      image: 'https://acme.com/blog/30-second-invoices.jpg',
      author: 'Priya Shah',
      authorUrl: 'https://acme.com/team/priya',
      datePublished: '2026-10-28',
      dateModified: '',
      publisher: 'Acme Blog',
      publisherLogo: '',
    },
    build: (v) => ({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: str(v.headline),
      image: str(v.image) ? [fullUrl(str(v.image))] : undefined,
      datePublished: str(v.datePublished),
      dateModified: str(v.dateModified),
      author: { '@type': 'Person', name: str(v.author), url: fullUrl(str(v.authorUrl)) },
      publisher: { '@type': 'Organization', name: str(v.publisher), logo: { '@type': 'ImageObject', url: fullUrl(str(v.publisherLogo)) } },
      mainEntityOfPage: fullUrl(str(v.url)),
    }),
    check: (v) => {
      const o: Issue[] = [];
      need(v, 'headline', 'Add the headline.', o);
      if (str(v.headline).length > 110) o.push({ level: 'tip', text: 'Keep the headline short. Google may cut long ones off in Top stories.' });
      urls(v, [['url', 'The article link'], ['image', 'The picture link'], ['authorUrl', 'The author page link'], ['publisherLogo', 'The publisher logo link']], o);
      if (str(v.dateModified) && str(v.datePublished) && str(v.dateModified) < str(v.datePublished)) o.push({ level: 'bad', text: 'The “last updated” date is before the published date.' });
      tip(v, 'image', 'Add a main picture. Articles without one rarely get the big card.', o);
      tip(v, 'author', 'Add the author’s name. Google uses it to judge who wrote it.', o);
      tip(v, 'datePublished', 'Add the date it was published.', o);
      return o;
    },
    preview: (v) => {
      const pub = str(v.publisher) || host(str(v.url)) || 'Your site';
      const date = shortDate(str(v.dateModified) || str(v.datePublished));
      return h(
        'div',
        'story',
        '',
        h('span', 'story-label', 'Top stories'),
        h(
          'div',
          'story-card',
          '',
          picture(str(v.image), 'story-img', '📰'),
          h('div', 'story-body', '', h('span', 'story-pub', '', h('span', 'g-fav sm', pub[0]?.toUpperCase() || '?'), document.createTextNode(pub)), h('span', 'story-title', str(v.headline) || 'Your headline'), h('span', 'story-date', [date, str(v.author) ? `By ${str(v.author)}` : ''].filter(Boolean).join(' · '))),
        ),
      );
    },
  },
  {
    key: 'FAQPage',
    name: 'FAQ',
    blurb: 'Questions and answers',
    rich: 'Questions that open under your result (now mostly for well-known health and government sites).',
    fields: [
      { key: 'title', label: 'Page title (for the preview only)', kind: 'text', ph: 'Pricing: Acme' },
      { key: 'url', label: 'Page link (for the preview only)', kind: 'url', ph: 'https://acme.com/pricing' },
      { key: 'faq', label: 'Questions', kind: 'pairs', req: true, pair: ['Question', 'Is there a free plan?', 'Answer', 'Yes. Your first 10 clients are free, forever.'], min: 1 },
    ],
    example: {
      title: 'Pricing: Acme Invoices',
      url: 'https://acme.com/pricing',
      faq: [
        { a: 'Is there a free plan?', b: 'Yes. Your first 10 clients are free, forever. No card needed.' },
        { a: 'Can I cancel any time?', b: 'Yes. Cancel from Settings in two clicks and you won’t be charged again.' },
        { a: 'Do you take payments in other currencies?', b: 'Yes. Clients can pay in 30 currencies by card or bank transfer.' },
      ],
    },
    build: (v) => ({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: pairs(v.faq).map((p) => ({ '@type': 'Question', name: p.a.trim(), acceptedAnswer: { '@type': 'Answer', text: p.b.trim() } })),
    }),
    check: (v) => {
      const o: Issue[] = [];
      const list = pairs(v.faq);
      if (!list.length) o.push({ level: 'bad', text: 'Add at least one question and its answer.' });
      list.forEach((p, i) => {
        if (!p.a.trim()) o.push({ level: 'bad', text: `Question ${i + 1} has an answer but no question.` });
        if (!p.b.trim()) o.push({ level: 'bad', text: `Question ${i + 1} needs an answer.` });
      });
      o.push({ level: 'tip', text: 'Every question and answer must also be visible on the page itself, word for word.' });
      return o;
    },
    preview: (v) => {
      const qs = pairs(v.faq);
      return result('', str(v.url), str(v.title), '', qs.length ? h('div', 'g-faq', '', ...qs.slice(0, 4).map((p, i) => {
        const d = document.createElement('details');
        if (i === 0) d.open = true;
        d.append(h('summary', '', p.a.trim() || 'Your question'), h('p', '', p.b.trim() || 'Your answer'));
        return d;
      })) : null);
    },
  },
  {
    key: 'LocalBusiness',
    name: 'Local business',
    blurb: 'A shop, café, clinic or office',
    rich: 'Address, hours, phone and rating in Google Search and Maps.',
    fields: [
      {
        key: 'subtype',
        label: 'Kind of business',
        kind: 'select',
        opts: [
          ['LocalBusiness', 'Other'],
          ['Restaurant', 'Restaurant'],
          ['CafeOrCoffeeShop', 'Café'],
          ['Store', 'Shop'],
          ['BeautySalon', 'Salon'],
          ['Dentist', 'Dentist'],
          ['MedicalClinic', 'Clinic'],
          ['ExerciseGym', 'Gym'],
          ['ProfessionalService', 'Professional service'],
          ['AutoRepair', 'Car repair'],
        ],
      },
      { key: 'name', label: 'Business name', kind: 'text', req: true, ph: 'Bean There Café' },
      { key: 'street', label: 'Street address', kind: 'text', req: true, ph: '24 Market Street' },
      { key: 'city', label: 'City', kind: 'text', req: true, ph: 'San Francisco' },
      { key: 'region', label: 'State or region', kind: 'text', ph: 'CA' },
      { key: 'postal', label: 'Postcode', kind: 'text', ph: '94103' },
      { key: 'country', label: 'Country code', kind: 'text', ph: 'US', hint: 'Two letters, like US, GB or IN.' },
      { key: 'telephone', label: 'Phone', kind: 'text', ph: '+1 415 555 0123' },
      { key: 'url', label: 'Website', kind: 'url', ph: 'https://beanthere.cafe' },
      { key: 'image', label: 'Photo link', kind: 'url', ph: 'https://beanthere.cafe/front.jpg' },
      { key: 'priceRange', label: 'Price range', kind: 'select', opts: [['', 'Not set'], ['$', '$'], ['$$', '$$'], ['$$$', '$$$'], ['$$$$', '$$$$']] },
      { key: 'opens', label: 'Opens at (Mon–Fri)', kind: 'text', ph: '08:00' },
      { key: 'closes', label: 'Closes at (Mon–Fri)', kind: 'text', ph: '18:00' },
      ...rateFields,
    ],
    example: {
      subtype: 'CafeOrCoffeeShop',
      name: 'Bean There Café',
      street: '24 Market Street',
      city: 'San Francisco',
      region: 'CA',
      postal: '94103',
      country: 'US',
      telephone: '+1 415 555 0123',
      url: 'https://beanthere.cafe',
      image: '',
      priceRange: '$$',
      opens: '07:30',
      closes: '18:00',
      ratingValue: '4.7',
      ratingCount: '214',
    },
    build: (v) => ({
      '@context': 'https://schema.org',
      '@type': str(v.subtype) || 'LocalBusiness',
      name: str(v.name),
      image: fullUrl(str(v.image)),
      url: fullUrl(str(v.url)),
      telephone: str(v.telephone),
      priceRange: str(v.priceRange),
      address: {
        '@type': 'PostalAddress',
        streetAddress: str(v.street),
        addressLocality: str(v.city),
        addressRegion: str(v.region),
        postalCode: str(v.postal),
        addressCountry: str(v.country).toUpperCase(),
      },
      openingHoursSpecification:
        str(v.opens) && str(v.closes)
          ? [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: str(v.opens), closes: str(v.closes) }]
          : undefined,
      aggregateRating: aggregate(v),
    }),
    check: (v) => {
      const o: Issue[] = [];
      need(v, 'name', 'Add the business name.', o);
      need(v, 'street', 'Add the street address. Google needs it to place you on the map.', o);
      need(v, 'city', 'Add the city.', o);
      urls(v, [['url', 'The website'], ['image', 'The photo link']], o);
      if (str(v.country) && !/^[a-z]{2}$/i.test(str(v.country))) o.push({ level: 'bad', text: 'Use a two-letter country code, like US, GB or IN.' });
      for (const k of ['opens', 'closes']) if (str(v[k]) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(str(v[k]))) o.push({ level: 'bad', text: `Write opening times as 24-hour time, like 08:00 or 18:30.` });
      if (!!str(v.opens) !== !!str(v.closes)) o.push({ level: 'bad', text: 'Add both the opening and closing time, or neither.' });
      rating(v, o);
      tip(v, 'telephone', 'Add a phone number so people can call from the result.', o);
      tip(v, 'country', 'Add the country code.', o);
      return o;
    },
    preview: (v) => {
      const kind = TYPES[6].fields[0].opts?.find(([k]) => k === str(v.subtype))?.[1] ?? '';
      const addr = [str(v.street), str(v.city), [str(v.region), str(v.postal)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      const hours = str(v.opens) && str(v.closes) ? `Open · Closes ${str(v.closes)}` : '';
      return h(
        'div',
        'local',
        '',
        h('div', 'map', '', h('span', 'pin', '📍')),
        h(
          'div',
          'local-body',
          '',
          h('span', 'kp-name', str(v.name) || 'Your business'),
          stars(str(v.ratingValue), str(v.ratingCount)),
          h('span', 'g-meta', [str(v.priceRange), kind && kind !== 'Other' ? kind : ''].filter(Boolean).join(' · ')),
          h('dl', 'kp-facts', '', addr ? h('div', '', '', h('dt', '', 'Address'), h('dd', '', addr)) : null, hours ? h('div', '', '', h('dt', '', 'Hours'), h('dd', 'open', hours)) : null, str(v.telephone) ? h('div', '', '', h('dt', '', 'Phone'), h('dd', 'g-link', str(v.telephone))) : null),
          h('div', 'local-btns', '', h('span', '', 'Website'), h('span', '', 'Directions'), h('span', '', 'Call')),
        ),
      );
    },
  },
  {
    key: 'Event',
    name: 'Event',
    blurb: 'A meetup, class, gig or webinar',
    rich: 'Date, place and ticket price in Google’s event listings.',
    fields: [
      { key: 'name', label: 'Event name', kind: 'text', req: true, ph: 'Vibecoding meetup #4' },
      { key: 'startDate', label: 'Starts', kind: 'datetime', req: true },
      { key: 'endDate', label: 'Ends', kind: 'datetime' },
      { key: 'mode', label: 'Where', kind: 'select', opts: [['Offline', 'In person'], ['Online', 'Online'], ['Mixed', 'Both']] },
      { key: 'venue', label: 'Venue name', kind: 'text', ph: 'The Hall' },
      { key: 'address', label: 'Venue address', kind: 'text', ph: '24 Market Street, San Francisco, CA' },
      { key: 'onlineUrl', label: 'Online link', kind: 'url', ph: 'https://zoom.us/j/123' },
      { key: 'description', label: 'Description', kind: 'textarea', ph: 'Show what you built this month.' },
      { key: 'image', label: 'Picture link', kind: 'url', ph: 'https://acme.com/event.jpg' },
      { key: 'price', label: 'Ticket price (0 if free)', kind: 'number', ph: '0' },
      { key: 'priceCurrency', label: 'Currency', kind: 'select', opts: CURRENCIES },
      { key: 'ticketUrl', label: 'Ticket link', kind: 'url', ph: 'https://lu.ma/vibe4' },
      { key: 'organizer', label: 'Organizer', kind: 'text', ph: 'Acme' },
    ],
    example: {
      name: 'Vibecoding meetup #4: ship it live',
      startDate: '2026-12-10T18:30',
      endDate: '2026-12-10T21:00',
      mode: 'Offline',
      venue: 'The Hall',
      address: '24 Market Street, San Francisco, CA 94103',
      onlineUrl: '',
      description: 'Five people demo what they built this month with Claude Code, Cursor and Codex. Pizza after.',
      image: '',
      price: '0',
      priceCurrency: 'USD',
      ticketUrl: 'https://acme.com/meetup',
      organizer: 'Acme',
    },
    build: (v) => {
      const mode = str(v.mode) || 'Offline';
      const place = { '@type': 'Place', name: str(v.venue), address: str(v.address) };
      const virt = { '@type': 'VirtualLocation', url: fullUrl(str(v.onlineUrl)) };
      return {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: str(v.name),
        startDate: withOffset(str(v.startDate)),
        endDate: withOffset(str(v.endDate)),
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: `https://schema.org/${mode}EventAttendanceMode`,
        location: mode === 'Offline' ? place : mode === 'Online' ? virt : [place, virt],
        image: str(v.image) ? [fullUrl(str(v.image))] : undefined,
        description: str(v.description),
        offers: str(v.price)
          ? { '@type': 'Offer', price: num(str(v.price)), priceCurrency: str(v.priceCurrency), url: fullUrl(str(v.ticketUrl)), availability: 'https://schema.org/InStock' }
          : undefined,
        organizer: { '@type': 'Organization', name: str(v.organizer) },
      };
    },
    check: (v) => {
      const o: Issue[] = [];
      const mode = str(v.mode) || 'Offline';
      need(v, 'name', 'Add the event’s name.', o);
      need(v, 'startDate', 'Add when it starts. Google won’t list an event without a date.', o);
      if (mode !== 'Online') need(v, 'address', 'Add the venue address. Google needs it for in-person events.', o);
      if (mode !== 'Offline') need(v, 'onlineUrl', 'Add the online link (Zoom, Meet, YouTube…).', o);
      if (str(v.endDate) && str(v.startDate) && str(v.endDate) < str(v.startDate)) o.push({ level: 'bad', text: 'The event ends before it starts.' });
      urls(v, [['onlineUrl', 'The online link'], ['image', 'The picture link'], ['ticketUrl', 'The ticket link']], o);
      tip(v, 'image', 'Add a picture. Event listings look empty without one.', o);
      tip(v, 'price', 'Add a ticket price (0 if free).', o);
      return o;
    },
    preview: (v) => {
      const d = new Date(str(v.startDate));
      const ok = !Number.isNaN(d.getTime());
      const mode = str(v.mode) || 'Offline';
      const where = mode === 'Online' ? 'Online' : [str(v.venue), str(v.address)].filter(Boolean).join(', ') || 'Venue';
      const time = ok ? d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
      const price = money(str(v.price), str(v.priceCurrency) || 'USD');
      return h(
        'div',
        'event',
        '',
        h('span', 'story-label', 'Events'),
        h(
          'div',
          'event-card',
          '',
          h('div', 'cal', '', h('span', 'cal-m', ok ? d.toLocaleString('en-US', { month: 'short' }).toUpperCase() : 'MON'), h('span', 'cal-d', ok ? String(d.getDate()) : '--')),
          h('div', 'event-body', '', h('span', 'story-title', str(v.name) || 'Your event'), h('span', 'g-meta', [time, mode === 'Mixed' ? `${where} + online` : where].filter(Boolean).join(' · ')), price ? h('span', 'event-price', price === 'Free' ? 'Free' : `Tickets from ${price}`) : null),
          picture(str(v.image), 'event-img', '🎟️'),
        ),
      );
    },
  },
  {
    key: 'BreadcrumbList',
    name: 'Breadcrumbs',
    blurb: 'Where a page sits on your site',
    rich: 'A tidy path (Home › Shoes › Running) instead of a long link.',
    fields: [
      { key: 'title', label: 'Page title (for the preview only)', kind: 'text', ph: 'Trail Runner 2: Acme' },
      { key: 'crumbs', label: 'Path, from home to this page', kind: 'pairs', req: true, pair: ['Name', 'Shoes', 'Link', 'https://acme.com/shoes'], min: 2 },
    ],
    example: {
      title: 'Trail Runner 2 running shoe: Acme',
      crumbs: [
        { a: 'Home', b: 'https://acme.com' },
        { a: 'Shoes', b: 'https://acme.com/shoes' },
        { a: 'Running', b: 'https://acme.com/shoes/running' },
        { a: 'Trail Runner 2', b: 'https://acme.com/shoes/running/trail-runner-2' },
      ],
    },
    build: (v) => {
      const list = pairs(v.crumbs);
      return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: list.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.a.trim(), item: i === list.length - 1 && !p.b.trim() ? undefined : fullUrl(p.b.trim()) })),
      };
    },
    check: (v) => {
      const o: Issue[] = [];
      const list = pairs(v.crumbs);
      if (list.length < 2) o.push({ level: 'bad', text: 'Add at least two steps, like Home and the page you’re on.' });
      list.forEach((p, i) => {
        if (!p.a.trim()) o.push({ level: 'bad', text: `Step ${i + 1} needs a name.` });
        if (!p.b.trim() && i < list.length - 1) o.push({ level: 'bad', text: `Step ${i + 1} needs a link. Only the last step can skip it.` });
        if (p.b.trim() && !validUrl(p.b.trim())) o.push({ level: 'bad', text: `Step ${i + 1}’s link doesn’t look right. Use a full one, like https://acme.com/shoes` });
      });
      return o;
    },
    preview: (v) => {
      const list = pairs(v.crumbs);
      const first = list[0]?.b.trim() || '';
      const path = list.slice(1).map((p) => p.a.trim()).filter(Boolean);
      const r = result('', first, str(v.title), '');
      const urlEl = r.querySelector('.g-url');
      if (urlEl) urlEl.textContent = [first ? `https://${host(first)}` : 'https://yoursite.com', ...path].join(' › ');
      return r;
    },
  },
];

// --- page wiring ----------------------------------------------------------------------------

const picker = $<HTMLDivElement>('sg-types');
const form = $<HTMLDivElement>('sg-form');
const stage = $<HTMLDivElement>('sg-stage');
const verdict = $<HTMLDivElement>('sg-verdict');
const verdictText = $<HTMLSpanElement>('sg-verdict-text');
const issuesList = $<HTMLUListElement>('sg-issues');
const richNote = $<HTMLParagraphElement>('sg-rich');
const code = $<HTMLElement>('sg-code');
const copyBtn = $<HTMLButtonElement>('sg-copy');
const formats = $<HTMLDivElement>('sg-formats');
const formatNote = $<HTMLParagraphElement>('sg-format-note');
const blank = $<HTMLButtonElement>('sg-blank');
const example = $<HTMLButtonElement>('sg-example');

const state: Record<string, Fields> = {};
for (const t of TYPES) state[t.key] = structuredClone(t.example);
let current = TYPES[0];
let format = 'html';

function input(f: Field, v: Fields): HTMLElement {
  const id = `sg-f-${f.key}`;
  const wrap = h('label', 'field') as HTMLLabelElement;
  wrap.htmlFor = id;
  const lab = h('span', 'lab', f.label);
  if (f.req) lab.append(h('span', 'req', 'needed'));
  wrap.append(lab);
  let el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (f.kind === 'textarea' || f.kind === 'lines') {
    el = document.createElement('textarea');
    el.rows = f.kind === 'lines' ? 3 : 2;
  } else if (f.kind === 'select') {
    el = document.createElement('select');
    for (const [val, text] of f.opts ?? []) el.append(new Option(text, val));
  } else {
    el = document.createElement('input');
    el.type = f.kind === 'date' ? 'date' : f.kind === 'datetime' ? 'datetime-local' : f.kind === 'number' ? 'text' : 'text';
    if (f.kind === 'number') el.inputMode = 'decimal';
    if (f.kind === 'url') el.inputMode = 'url';
    el.autocomplete = 'off';
    el.spellcheck = f.kind === 'text';
  }
  el.id = id;
  if (f.ph && 'placeholder' in el) el.placeholder = f.ph;
  el.value = str(v[f.key]) || (f.kind === 'select' ? f.opts?.[0]?.[0] ?? '' : '');
  if (f.kind === 'select' && !str(v[f.key])) v[f.key] = el.value;
  el.addEventListener('input', () => {
    v[f.key] = el.value;
    update();
  });
  wrap.append(el);
  if (f.hint) wrap.append(h('span', 'hint', f.hint));
  return wrap;
}

function pairList(f: Field, v: Fields): HTMLElement {
  const [la, pa, lb, pb] = f.pair ?? ['', '', '', ''];
  if (!Array.isArray(v[f.key])) v[f.key] = [];
  const list = v[f.key] as Pair[];
  while (list.length < (f.min ?? 1)) list.push({ a: '', b: '' });
  const box = h('div', 'pairs');
  box.append(h('span', 'lab', f.label, h('span', 'req', 'needed')));
  list.forEach((p, i) => {
    const row = h('div', 'pair');
    const num = h('span', 'pair-n', String(i + 1));
    const a = document.createElement('input');
    a.type = 'text';
    a.placeholder = pa;
    a.value = p.a;
    a.setAttribute('aria-label', `${la} ${i + 1}`);
    a.addEventListener('input', () => {
      p.a = a.value;
      update();
    });
    const b = f.key === 'faq' ? document.createElement('textarea') : document.createElement('input');
    if (b instanceof HTMLTextAreaElement) b.rows = 2;
    else b.type = 'text';
    b.placeholder = pb;
    b.value = p.b;
    b.setAttribute('aria-label', `${lb} ${i + 1}`);
    b.addEventListener('input', () => {
      p.b = b.value;
      update();
    });
    const del = h('button', 'pair-del', '×') as HTMLButtonElement;
    del.type = 'button';
    del.setAttribute('aria-label', `Remove ${la.toLowerCase()} ${i + 1}`);
    del.disabled = list.length <= (f.min ?? 1);
    del.addEventListener('click', () => {
      list.splice(i, 1);
      renderForm();
    });
    row.append(num, h('div', 'pair-fields', '', a, b), del);
    box.append(row);
  });
  const add = h('button', 'pair-add', `+ Add ${la.toLowerCase()}`) as HTMLButtonElement;
  add.type = 'button';
  add.addEventListener('click', () => {
    list.push({ a: '', b: '' });
    renderForm();
    const inputs = box.ownerDocument.querySelectorAll<HTMLInputElement>('#sg-form .pair input');
    inputs[inputs.length - 1]?.focus();
  });
  box.append(add);
  return box;
}

function renderForm() {
  const v = state[current.key];
  form.replaceChildren(...current.fields.map((f) => (f.kind === 'pairs' ? pairList(f, v) : input(f, v))));
  update();
}

function renderPicker() {
  picker.replaceChildren(
    ...TYPES.map((t) => {
      const b = h('button', 'type', '', h('strong', '', t.name), h('span', '', t.blurb)) as HTMLButtonElement;
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(t === current));
      b.addEventListener('click', () => {
        current = t;
        renderPicker();
        renderForm();
      });
      return b;
    }),
  );
}

// Keeps "</script>" typed into a field from ending the script tag early.
const safeJson = (o: unknown, indent = 2) => JSON.stringify(o, null, indent).replace(/<\//g, '<\\/');

function snippet(obj: unknown): { text: string; note: string } {
  const json = safeJson(obj);
  const pageName = current.key === 'Organization' || current.key === 'WebSite' ? 'my home page' : 'the page it describes';
  switch (format) {
    case 'next':
      return {
        note: 'Put this in the page.tsx (or layout.tsx) of the page it describes. It works in the App Router and Pages Router.',
        text: `const jsonLd = ${json};\n\n// Inside your page's JSX, anywhere:\n<script\n  type="application/ld+json"\n  dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\\\u003c') }}\n/>`,
      };
    case 'astro':
      return {
        note: 'Put the first part in the --- block at the top of the .astro page, and the script tag in its <head> (or anywhere in the page).',
        text: `---\nconst jsonLd = ${json};\n---\n\n<script type="application/ld+json" set:html={JSON.stringify(jsonLd)} />`,
      };
    case 'prompt':
      return {
        note: 'Paste this into Claude Code, Cursor or Codex. It knows where the tag goes in your project.',
        text: `Add this JSON-LD structured data to ${pageName} in my project, inside a <script type="application/ld+json"> tag in the <head>. Use the right pattern for my framework (for example, a script tag with dangerouslySetInnerHTML in Next.js, or set:html in Astro). Don't change the data. If ${pageName} already has a ${current.key} JSON-LD block, replace it instead of adding a second one.\n\n${json}`,
      };
    default:
      return {
        note: 'Paste this into the <head> of the page it describes. Plain HTML, Vite, WordPress (in a header plugin), Webflow or Framer custom code all work.',
        text: `<script type="application/ld+json">\n${json}\n</script>`,
      };
  }
}

function update() {
  const v = state[current.key];
  const issues = current.check(v);
  const bad = issues.filter((i) => i.level === 'bad');
  const tips = issues.filter((i) => i.level === 'tip');

  stage.replaceChildren(current.preview(v));
  verdict.dataset.state = bad.length ? 'bad' : 'good';
  verdictText.textContent = bad.length
    ? `${bad.length} ${bad.length === 1 ? 'thing' : 'things'} to fix before Google can use this`
    : tips.length
      ? `Ready for Google. ${tips.length === 1 ? 'One extra' : 'A few extras'} would make it better`
      : 'Ready for Google';
  issuesList.replaceChildren(...[...bad, ...tips].map((i) => h('li', i.level, i.text)));
  issuesList.hidden = issues.length === 0;
  const noun: Record<string, string> = { Organization: 'a company', WebSite: 'a website', SoftwareApplication: 'an app', Product: 'a product', Article: 'an article', FAQPage: 'an FAQ page', LocalBusiness: 'a local business', Event: 'an event', BreadcrumbList: 'breadcrumbs' };
  richNote.textContent = `What Google can show for ${noun[current.key]}: ${current.rich}`;

  const obj = prune(current.build(v)) ?? { '@context': 'https://schema.org', '@type': current.key };
  const out = snippet(obj);
  code.textContent = out.text;
  formatNote.textContent = out.note;
}

formats.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-format]');
  if (!b) return;
  format = b.dataset.format ?? 'html';
  for (const x of formats.querySelectorAll('button')) x.setAttribute('aria-selected', String(x === b));
  update();
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(code.textContent ?? '');
    copyBtn.textContent = 'Copied';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(code);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    copyBtn.textContent = 'Press Ctrl+C';
  }
  setTimeout(() => (copyBtn.textContent = 'Copy'), 1600);
});

blank.addEventListener('click', () => {
  const fresh: Fields = {};
  for (const f of current.fields) if (f.kind === 'select') fresh[f.key] = str(state[current.key][f.key]);
  state[current.key] = fresh;
  renderForm();
  form.querySelector<HTMLElement>('input, textarea')?.focus();
});
example.addEventListener('click', () => {
  state[current.key] = structuredClone(current.example);
  renderForm();
});

renderPicker();
renderForm();
