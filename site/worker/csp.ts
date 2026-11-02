// CSP generator: reads a page, its stylesheets and its own JavaScript, and lists every place the
// page loads things from, grouped by Content-Security-Policy directive. Inline scripts are
// returned with their sha256 hashes so the page can offer "allow these exact scripts".
// Plain functions so they can be tested without a Worker.

export type Source = { value: string; why: string; guess?: boolean };
export type Directive = { name: string; sources: Source[] };
export type Inline = {
  scripts: { hash: string; preview: string }[];
  scriptCount: number;
  handlers: { attr: string; preview: string }[];
  handlerCount: number;
  jsUrls: number;
  styleBlocks: number;
  styleAttrs: number;
};
export type CspResult = {
  https: boolean;
  framework: string | null;
  existing: { header: string | null; reportOnly: string | null; meta: string | null };
  directives: Directive[];
  inline: Inline;
  notes: string[];
  files: { url: string; ok: boolean; kind: 'script' | 'style' }[];
};

type Fetch = (url: string) => Promise<string | null>;

const MAX_SCRIPTS = 12;
const MAX_STYLES = 6;
const MAX_HASHES = 30;

// Known services: what else they load once their script, stylesheet or frame is on the page.
const SERVICES: { match: RegExp; name: string; add: Record<string, string[]>; note?: string }[] = [
  {
    match: /^www\.googletagmanager\.com$/,
    name: 'Google Analytics / Tag Manager',
    add: {
      'connect-src': ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com'],
      'img-src': ['https://*.google-analytics.com', 'https://www.googletagmanager.com'],
    },
    note: 'Google Tag Manager can load other tools you set up inside it, which we can’t see from here. Run the policy as Report-Only for a few days and add anything it reports.',
  },
  { match: /^www\.google-analytics\.com$/, name: 'Google Analytics', add: { 'connect-src': ['https://*.google-analytics.com', 'https://*.analytics.google.com'] } },
  { match: /^js\.stripe\.com$/, name: 'Stripe', add: { 'frame-src': ['https://js.stripe.com', 'https://hooks.stripe.com'], 'connect-src': ['https://api.stripe.com'] } },
  { match: /^static\.cloudflareinsights\.com$/, name: 'Cloudflare Web Analytics', add: { 'connect-src': ['https://cloudflareinsights.com'] } },
  { match: /^challenges\.cloudflare\.com$/, name: 'Cloudflare Turnstile', add: { 'frame-src': ['https://challenges.cloudflare.com'], 'script-src': ['https://challenges.cloudflare.com'] } },
  { match: /^(plausible\.io)$/, name: 'Plausible', add: { 'connect-src': ['https://plausible.io'] } },
  { match: /^(.+)-assets\.i\.posthog\.com$/, name: 'PostHog', add: { 'connect-src': ['https://*.i.posthog.com'] } },
  { match: /^va\.vercel-scripts\.com$/, name: 'Vercel Analytics', add: { 'connect-src': ['https://vitals.vercel-insights.com'] } },
  { match: /^fonts\.googleapis\.com$/, name: 'Google Fonts', add: { 'font-src': ['https://fonts.gstatic.com'] } },
  { match: /^use\.typekit\.net$/, name: 'Adobe Fonts', add: { 'font-src': ['https://use.typekit.net'], 'img-src': ['https://p.typekit.net'] } },
  { match: /^www\.google\.com$/, name: 'Google reCAPTCHA', add: { 'frame-src': ['https://www.google.com'], 'script-src': ['https://www.gstatic.com'] } },
  { match: /^client\.crisp\.chat$/, name: 'Crisp chat', add: { 'connect-src': ['https://client.relay.crisp.chat', 'wss://client.relay.crisp.chat'], 'img-src': ['https://image.crisp.chat', 'https://client.crisp.chat'], 'font-src': ['https://client.crisp.chat'], 'style-src': ['https://client.crisp.chat'] } },
  { match: /^widget\.intercom\.io$/, name: 'Intercom', add: { 'connect-src': ['https://*.intercom.io', 'wss://*.intercom.io'], 'script-src': ['https://js.intercomcdn.com'], 'img-src': ['https://*.intercomcdn.com'], 'font-src': ['https://js.intercomcdn.com'], 'frame-src': ['https://intercom-sheets.com'] } },
  { match: /^js\.sentry-cdn\.com$/, name: 'Sentry', add: { 'connect-src': ['https://*.ingest.sentry.io', 'https://*.ingest.us.sentry.io'] } },
  { match: /^(www\.)?youtube(-nocookie)?\.com$/, name: 'YouTube', add: {} },
  { match: /^static\.hotjar\.com$/, name: 'Hotjar', add: { 'connect-src': ['https://*.hotjar.com', 'https://*.hotjar.io', 'wss://*.hotjar.com'], 'script-src': ['https://script.hotjar.com'], 'img-src': ['https://*.hotjar.com'] } },
];

// Hosts that show up in JavaScript bundles as docs links or XML namespaces, never as real requests.
const NOT_REQUESTS =
  /(^|\.)(w3\.org|reactjs\.org|react\.dev|github\.com|githubusercontent\.com|npmjs\.(com|org)|mozilla\.org|schema\.org|fb\.me|nextjs\.org|vercel\.com|vuejs\.org|svelte\.dev|example\.(com|org)|localhost|mui\.com|tailwindcss\.com|ogp\.me|purl\.org|xml\.org|xmlns\.com|adobe\.com|apple\.com|microsoft\.com|wikipedia\.org|stackoverflow\.com|jquery\.com|lodash\.com|feross\.org|opensource\.org|creativecommons\.org|json-schema\.org|tc39\.es|ecma-international\.org|whatwg\.org|google\.com|goo\.gl|bit\.ly|twitter\.com|x\.com|facebook\.com|linkedin\.com|instagram\.com|youtube\.com|discord\.(gg|com)|t\.me|wa\.me|mailto|sentry\.io|astro\.build|vitejs\.dev|webpack\.js\.org|babeljs\.io|polyfill\.io|momentjs\.com|day\.js\.org|zod\.dev|supabase\.com|stripe\.com|firebase\.google\.com|radix-ui\.com|shadcn\.com|framer\.com|motion\.dev|unpkg\.com|jsdelivr\.net|esm\.sh)$/i;

export async function buildCsp(html: string, base: string, headers: Headers, fetchText: Fetch): Promise<CspResult> {
  const page = new URL(base);
  const self = page.origin;
  const dirs = new Map<string, Map<string, Source>>();
  const notes: string[] = [];
  const files: CspResult['files'] = [];
  const seenServices = new Set<string>();

  const add = (dir: string, value: string, why: string, guess = false) => {
    const m = dirs.get(dir) ?? new Map<string, Source>();
    dirs.set(dir, m);
    const had = m.get(value);
    if (had) {
      if (!guess && had.guess) m.set(value, { value, why });
      return;
    }
    m.set(value, guess ? { value, why, guess } : { value, why });
  };

  // An address → the CSP source for it, or null when it's this site ('self' covers it).
  const sourceFor = (raw: string, from: string = base): string | null => {
    const r = raw.trim().replace(/&amp;/g, '&');
    if (!r) return null;
    if (/^data:/i.test(r)) return 'data:';
    if (/^blob:/i.test(r)) return 'blob:';
    if (/^(javascript|about|mailto|tel|#)/i.test(r)) return null;
    let u: URL;
    try {
      u = new URL(r, from);
    } catch {
      return null;
    }
    if (!/^(https?|wss?):$/.test(u.protocol)) return null;
    if (u.origin === self) return null;
    return `${u.protocol}//${u.host}`;
  };

  const service = (src: string) => {
    let host: string;
    try {
      host = new URL(src).hostname;
    } catch {
      return;
    }
    for (const s of SERVICES) {
      if (!s.match.test(host) || seenServices.has(s.name)) continue;
      seenServices.add(s.name);
      for (const [d, list] of Object.entries(s.add)) for (const v of list) add(d, v, `needed by ${s.name}`);
      if (s.note) notes.push(s.note);
    }
  };

  const use = (dir: string, raw: string, why: string, from?: string) => {
    const s = sourceFor(raw, from);
    if (!s) return;
    add(dir, s, why);
    if (s !== 'data:' && s !== 'blob:') service(s);
  };

  // Drop comments so commented-out tags don't count.
  const doc = html.replace(/<!--[\s\S]*?-->/g, '');
  const attr = (tag: string, name: string) => {
    const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
  };
  const srcset = (v: string) => v.split(',').map((p) => p.trim().split(/\s+/)[0]).filter(Boolean);

  // Scripts: external ones are sources; inline ones get hashed.
  const sameOriginScripts: string[] = [];
  const inlineScripts: { hash: string; preview: string }[] = [];
  let scriptCount = 0;
  const jsTexts: string[] = [];
  for (const m of doc.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const open = `<script ${m[1]}>`;
    const type = (attr(open, 'type') ?? '').toLowerCase().trim();
    const runs = !type || type === 'module' || /javascript|ecmascript/.test(type);
    const src = attr(open, 'src');
    if (src !== null) {
      if (!runs) continue;
      use('script-src', src, 'script file');
      try {
        const abs = new URL(src.replace(/&amp;/g, '&'), base);
        if (abs.origin === self) sameOriginScripts.push(abs.href);
      } catch {
        // bad address
      }
      continue;
    }
    if (!runs) continue; // JSON-LD, JSON data and templates are never run, so CSP doesn't block them.
    const body = m[2];
    if (!body.trim()) continue;
    scriptCount++;
    jsTexts.push(body);
    if (inlineScripts.length < MAX_HASHES) inlineScripts.push({ hash: await sha256(body), preview: preview(body) });
  }
  for (const tag of doc.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    const href = attr(tag, 'href');
    if (!href) continue;
    if (/\bstylesheet\b/.test(rel)) use('style-src', href, 'stylesheet');
    else if (/\bmodulepreload\b/.test(rel)) use('script-src', href, 'script file');
    else if (/\bpreload\b/.test(rel)) {
      const as = (attr(tag, 'as') ?? '').toLowerCase();
      const d = { script: 'script-src', style: 'style-src', font: 'font-src', image: 'img-src', fetch: 'connect-src' }[as];
      if (d) use(d, href, `preloaded ${as}`);
    } else if (/\b(icon|apple-touch-icon)\b/.test(rel)) use('img-src', href, 'icon');
    else if (/\bmanifest\b/.test(rel)) use('manifest-src', href, 'app manifest');
  }
  for (const tag of doc.match(/<(img|source|video|audio|track|input|image|use)\b[^>]*>/gi) ?? []) {
    const name = tag.match(/^<(\w+)/)![1].toLowerCase();
    const src = attr(tag, 'src');
    const set = attr(tag, 'srcset');
    if (name === 'img' || name === 'input' || (name === 'source' && set)) {
      if (src) use('img-src', src, 'image');
      if (set) for (const s of srcset(set)) use('img-src', s, 'image');
    } else if (name === 'video' || name === 'audio' || name === 'source' || name === 'track') {
      if (src) use('media-src', src, name === 'track' ? 'captions' : 'video or audio');
      const poster = attr(tag, 'poster');
      if (poster) use('img-src', poster, 'video poster');
    } else {
      const href = attr(tag, 'href') ?? attr(tag, 'xlink:href');
      if (href && !href.startsWith('#')) use('img-src', href, 'SVG image');
    }
  }
  for (const tag of doc.match(/<(iframe|frame|embed|object)\b[^>]*>/gi) ?? []) {
    const src = attr(tag, 'src') ?? attr(tag, 'data');
    if (src) use(/^<(embed|object)/i.test(tag) ? 'object-src' : 'frame-src', src, 'embedded frame');
  }
  for (const tag of doc.match(/<form\b[^>]*>/gi) ?? []) {
    const action = attr(tag, 'action');
    if (action) use('form-action', action, 'form');
  }

  // Inline event handlers (onclick="…") and javascript: links need 'unsafe-inline' or a rewrite.
  const handlers: Inline['handlers'] = [];
  let handlerCount = 0;
  for (const m of doc.matchAll(/<[a-z][\w-]*\b[^>]*?\s(on[a-z]+)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    handlerCount++;
    if (handlers.length < 5) handlers.push({ attr: m[1].toLowerCase(), preview: preview(m[3] ?? m[4] ?? '') });
  }
  const jsUrls = (doc.match(/\shref\s*=\s*["']\s*javascript:(?!\s*(void\s*\(?0\)?\s*;?|;)?\s*["'])/gi) ?? []).length;

  // Inline styles.
  const styleBlocks: string[] = [];
  for (const m of doc.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) if (m[1].trim()) styleBlocks.push(m[1]);
  const styleAttrs = (doc.match(/<[a-z][\w-]*\b[^>]*\sstyle\s*=\s*["'][^"']+["']/gi) ?? []).length;

  // Stylesheets: fonts, images and @imports they load.
  const sheetUrls: string[] = [];
  for (const tag of doc.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\bstylesheet\b/i.test(attr(tag, 'rel') ?? '')) continue;
    const href = attr(tag, 'href');
    if (!href) continue;
    try {
      const u = new URL(href.replace(/&amp;/g, '&'), base);
      if (/^https?:$/.test(u.protocol)) sheetUrls.push(u.href);
    } catch {
      // bad address
    }
  }
  const css = (text: string, from: string) => {
    for (const m of text.matchAll(/@font-face\s*{[^}]*}/gi)) {
      for (const u of m[0].matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) use('font-src', u[1], 'font', from);
    }
    const noFonts = text.replace(/@font-face\s*{[^}]*}/gi, '');
    for (const u of noFonts.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      if (/^#/.test(u[1])) continue;
      use('img-src', u[1], 'background image', from);
    }
    for (const u of text.matchAll(/@import\s+(?:url\(\s*)?["']?([^"');\s]+)/gi)) {
      use('style-src', u[1], 'imported stylesheet', from);
      try {
        const abs = new URL(u[1], from).href;
        if (!sheetUrls.includes(abs)) sheetUrls.push(abs);
      } catch {
        // bad address
      }
    }
  };
  for (const s of styleBlocks) css(s, base);
  for (const m of doc.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)) css(m[1].replace(/&quot;/g, '"'), base);
  for (let i = 0; i < sheetUrls.length && i < MAX_STYLES; i += 3) {
    const batch = sheetUrls.slice(i, Math.min(i + 3, MAX_STYLES));
    const texts = await Promise.all(batch.map((u) => fetchText(u)));
    texts.forEach((t, j) => {
      files.push({ url: batch[j], ok: t !== null, kind: 'style' });
      if (t) css(t, batch[j]);
    });
  }

  // Same-origin JavaScript: look for the APIs it calls (connect-src).
  const scripts = [...new Set(sameOriginScripts)].slice(0, MAX_SCRIPTS);
  for (let i = 0; i < scripts.length; i += 4) {
    const batch = scripts.slice(i, i + 4);
    const texts = await Promise.all(batch.map((u) => fetchText(u)));
    texts.forEach((t, j) => {
      files.push({ url: batch[j], ok: t !== null, kind: 'script' });
      if (t) jsTexts.push(t);
    });
  }
  for (const js of jsTexts) {
    for (const m of js.matchAll(/["'`](https?|wss?):\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(:\d+)?(?=[/"'`?#$])/gi)) {
      const host = m[2].toLowerCase();
      const scheme = m[1].toLowerCase();
      const value = `${scheme}://${host}${m[3] ?? ''}`;
      if (value === self || !/\.[a-z]{2,}$/.test(host)) continue;
      if (/(^|\.)ingest(\.\w+)?\.sentry\.io$/.test(host)) {
        add('connect-src', `https://${host}`, 'Sentry');
        continue;
      }
      if (NOT_REQUESTS.test(host)) continue;
      if (/\.supabase\.co$/.test(host)) {
        add('connect-src', `https://${host}`, 'Supabase');
        add('connect-src', `wss://${host}`, 'Supabase realtime');
        add('img-src', `https://${host}`, 'Supabase storage');
        continue;
      }
      if (/\.firebaseio\.com$/.test(host)) add('connect-src', `wss://${host}`, 'Firebase realtime');
      add('connect-src', value, 'seen in your JavaScript', true);
      service(value);
    }
  }
  if (seenServices.has('Google Fonts') || dirs.get('style-src')?.has('https://fonts.googleapis.com')) add('font-src', 'https://fonts.gstatic.com', 'needed by Google Fonts');

  // Framework, for the inline-script advice.
  let framework: string | null = null;
  if (/\/_next\/|__next_f|__NEXT_DATA__/.test(html)) framework = 'Next.js';
  else if (/__NUXT__|\/_nuxt\//.test(html)) framework = 'Nuxt';
  else if (/__sveltekit|\/_app\/immutable\//.test(html)) framework = 'SvelteKit';
  else if (/<astro-island|\/_astro\//.test(html)) framework = 'Astro';
  else if (/___gatsby/.test(html)) framework = 'Gatsby';
  else if (/<div id="root">\s*<\/div>|\/assets\/index-[\w-]+\.js/.test(html)) framework = 'Vite';

  const metaCsp = doc.match(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/i)?.[0];
  const existing = {
    header: headers.get('content-security-policy'),
    reportOnly: headers.get('content-security-policy-report-only'),
    meta: metaCsp ? attr(metaCsp, 'content') : null,
  };

  const order = ['script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'frame-src', 'media-src', 'object-src', 'manifest-src', 'form-action'];
  const directives: Directive[] = order.filter((d) => dirs.has(d)).map((d) => ({ name: d, sources: [...dirs.get(d)!.values()] }));

  return {
    https: page.protocol === 'https:',
    framework,
    existing,
    directives,
    inline: {
      scripts: inlineScripts,
      scriptCount,
      handlers,
      handlerCount,
      jsUrls,
      styleBlocks: styleBlocks.length,
      styleAttrs,
    },
    notes,
    files,
  };
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return `'sha256-${btoa(bin)}'`;
}

function preview(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 90 ? `${one.slice(0, 87)}…` : one;
}
