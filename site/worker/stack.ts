// Tech stack finder: reads a page's HTML, response headers and script addresses (plus a few of the
// site's own stylesheets and scripts) and matches them against a small list of signatures.
// Plain functions so they can be tested without a Worker.

export type Category = 'Built with' | 'Hosting' | 'UI and styling' | 'Analytics' | 'Services';
export const CATEGORIES: Category[] = ['Built with', 'Hosting', 'UI and styling', 'Analytics', 'Services'];

export type Tech = { name: string; category: Category; evidence: string };
export type StackResult = { tech: Tech[]; read: number; readFailed: number };

type Fetch = (url: string) => Promise<string | null>;

type Ctx = {
  html: string;
  host: string;
  headers: Record<string, string>;
  urls: string[]; // script src, link href and img src addresses
  generator: string;
  css: string; // inline <style> plus the site's own stylesheets
  js: string; // inline <script> plus the site's own scripts
};

type Sig = {
  name: string;
  cat: Category;
  h?: [string, RegExp][]; // response header and the value it must match
  u?: RegExp; // a script, stylesheet or image address
  p?: RegExp; // the page's HTML
  g?: RegExp; // <meta name="generator">
  host?: RegExp; // the site's own address
  j?: RegExp; // the site's JavaScript
  c?: RegExp; // the site's CSS
  implies?: string[];
};

const any = /./;

// Order inside each category is the order results are shown in.
const SIGS: Sig[] = [
  // AI app builders and site builders first: they are the answer people usually want.
  { name: 'Lovable', cat: 'Built with', host: /\.lovable\.app$/, p: /lovable\.dev\/|gptengineer\.js|<meta[^>]+content=["']Lovable["']/i, implies: ['Vite', 'React'] },
  { name: 'Bolt', cat: 'Built with', host: /\.bolt\.(new|host)$/, p: /bolt\.new/i, implies: ['Vite'] },
  { name: 'v0', cat: 'Built with', g: /\bv0(\.app|\.dev)?\b/i, host: /\.v0\.(app|dev)$/, implies: ['Next.js'] },
  { name: 'Replit', cat: 'Built with', host: /\.(replit\.app|repl\.co|replit\.dev)$/, u: /replit\.com\/public\/js\/replit-badge/ },
  { name: 'Base44', cat: 'Built with', host: /\.base44\.app$/, p: /base44\.(app|com)\//i },
  { name: 'Framer', cat: 'Built with', g: /^Framer/i, u: /framerusercontent\.com/, p: /data-framer-/ },
  { name: 'Webflow', cat: 'Built with', g: /Webflow/i, p: /data-wf-(page|site)=/, u: /website-files\.com/ },
  { name: 'Wix', cat: 'Built with', h: [['x-wix-request-id', any]], g: /Wix\.com/i, u: /(static\.wixstatic\.com|parastorage\.com)/ },
  { name: 'Squarespace', cat: 'Built with', g: /Squarespace/i, u: /(static1\.squarespace\.com|squarespace-cdn\.com)/ },
  { name: 'Shopify', cat: 'Built with', h: [['x-shopid', any], ['x-shopify-stage', any], ['powered-by', /Shopify/i]], u: /cdn\.shopify\.com/, p: /Shopify\.theme/ },
  { name: 'WordPress', cat: 'Built with', g: /WordPress/i, u: /\/wp-(content|includes)\//, p: /https:\/\/api\.w\.org\// },
  { name: 'Ghost', cat: 'Built with', g: /^Ghost/i },
  { name: 'Drupal', cat: 'Built with', g: /Drupal/i, h: [['x-generator', /Drupal/i], ['x-drupal-cache', any]] },
  { name: 'Joomla', cat: 'Built with', g: /Joomla/i },
  { name: 'Carrd', cat: 'Built with', host: /\.carrd\.co$/, p: /carrd\.co\//i },
  { name: 'Bubble', cat: 'Built with', host: /\.bubbleapps\.io$/, p: /_bubble_page_load_data|bubble_page_load/ },
  { name: 'Notion', cat: 'Built with', host: /\.notion\.site$/ },
  { name: 'Docusaurus', cat: 'Built with', g: /Docusaurus/i, implies: ['React'] },
  { name: 'Hugo', cat: 'Built with', g: /Hugo/i },
  { name: 'Jekyll', cat: 'Built with', g: /Jekyll/i },
  { name: 'Eleventy', cat: 'Built with', g: /Eleventy/i },
  { name: 'Mintlify', cat: 'Built with', u: /mintlify/i },

  // JavaScript frameworks.
  { name: 'Next.js', cat: 'Built with', h: [['x-powered-by', /Next\.js/i], ['x-nextjs-cache', any], ['x-nextjs-prerender', any], ['x-nextjs-stale-time', any]], u: /\/_next\/static\//, p: /__NEXT_DATA__|self\.__next_f/, implies: ['React'] },
  { name: 'Nuxt', cat: 'Built with', u: /\/_nuxt\//, p: /__NUXT__|id="__nuxt"/, h: [['x-powered-by', /Nuxt/i]], implies: ['Vue'] },
  { name: 'Remix', cat: 'Built with', p: /__remixContext/, implies: ['React'] },
  { name: 'React Router', cat: 'Built with', p: /__reactRouterContext/, implies: ['React'] },
  { name: 'Gatsby', cat: 'Built with', g: /Gatsby/i, p: /id="___gatsby"/, implies: ['React'] },
  { name: 'SvelteKit', cat: 'Built with', u: /\/_app\/immutable\//, p: /__sveltekit|data-sveltekit-/, implies: ['Svelte'] },
  { name: 'Astro', cat: 'Built with', g: /^Astro/i, u: /\/_astro\//, p: /<astro-island|data-astro-cid-/ },
  { name: 'Angular', cat: 'Built with', p: /\sng-version="|\sng-app[=\s>]/ },
  { name: 'Vite', cat: 'Built with', u: /\/assets\/index-[\w-]{8}\.js|\/@vite\/client/ },
  { name: 'React', cat: 'Built with', p: /data-reactroot/, j: /react\.(production|development)\.min|react-dom|__reactContainer|Symbol\.for\(["']react\.(transitional\.)?element["']\)/ },
  { name: 'Vue', cat: 'Built with', p: /\sdata-v-[0-9a-f]{8}[\s=>]/, j: /__vue_app__|__VUE_PROD_DEVTOOLS__|__VUE_OPTIONS_API__/ },
  { name: 'Svelte', cat: 'Built with', p: /class="[^"]*\bsvelte-[a-z0-9]{5,8}\b/ },
  { name: 'Alpine.js', cat: 'Built with', u: /alpine(js)?[@./-]/i, p: /\sx-data[=\s>]/ },
  { name: 'htmx', cat: 'Built with', u: /htmx(\.org)?[@./]/i, p: /\shx-(get|post|target|swap)=/ },
  { name: 'jQuery', cat: 'Built with', u: /jquery[\w.-]*\.js/i },

  // Hosting, mostly from response headers.
  { name: 'Vercel', cat: 'Hosting', h: [['server', /^Vercel/i], ['x-vercel-id', any], ['x-vercel-cache', any]], host: /\.vercel\.app$/ },
  { name: 'Netlify', cat: 'Hosting', h: [['server', /^Netlify/i], ['x-nf-request-id', any]], host: /\.netlify\.app$/ },
  { name: 'Cloudflare Pages', cat: 'Hosting', host: /\.pages\.dev$/ },
  { name: 'Cloudflare Workers', cat: 'Hosting', host: /\.workers\.dev$/ },
  { name: 'Cloudflare', cat: 'Hosting', h: [['server', /^cloudflare/i], ['cf-ray', any]] },
  { name: 'GitHub Pages', cat: 'Hosting', h: [['server', /^GitHub\.com/i]], host: /\.github\.io$/ },
  { name: 'Firebase Hosting', cat: 'Hosting', host: /\.(web\.app|firebaseapp\.com)$/ },
  { name: 'AWS Amplify', cat: 'Hosting', host: /\.amplifyapp\.com$/ },
  { name: 'Amazon CloudFront', cat: 'Hosting', h: [['x-amz-cf-id', any], ['via', /CloudFront/i]] },
  { name: 'Amazon S3', cat: 'Hosting', h: [['server', /^AmazonS3/i]] },
  { name: 'Google Cloud', cat: 'Hosting', h: [['server', /^Google Frontend/i]] },
  { name: 'Fly.io', cat: 'Hosting', h: [['fly-request-id', any], ['server', /^Fly\//i]], host: /\.fly\.dev$/ },
  { name: 'Render', cat: 'Hosting', h: [['x-render-origin-server', any], ['rndr-id', any]], host: /\.onrender\.com$/ },
  { name: 'Railway', cat: 'Hosting', h: [['x-railway-edge', any], ['server', /railway/i]], host: /\.up\.railway\.app$/ },
  { name: 'Heroku', cat: 'Hosting', h: [['via', /vegur/i]], host: /\.herokuapp\.com$/ },
  { name: 'Deno Deploy', cat: 'Hosting', h: [['server', /^deno/i]], host: /\.deno\.dev$/ },
  { name: 'Fastly', cat: 'Hosting', h: [['x-fastly-request-id', any], ['x-served-by', /^cache-/]] },
  { name: 'Azure', cat: 'Hosting', h: [['x-azure-ref', any]] },
  { name: 'Akamai', cat: 'Hosting', h: [['x-akamai-transformed', any], ['server', /AkamaiGHost/i]] },
  { name: 'Hostinger', cat: 'Hosting', h: [['platform', /hostinger/i]] },
  { name: 'nginx', cat: 'Hosting', h: [['server', /^nginx/i]] },
  { name: 'Apache', cat: 'Hosting', h: [['server', /^Apache/i]] },
  { name: 'LiteSpeed', cat: 'Hosting', h: [['server', /LiteSpeed/i]] },

  // UI libraries and styling.
  { name: 'Tailwind CSS', cat: 'UI and styling', u: /cdn\.tailwindcss\.com|tailwindcss/i, c: /--tw-(?=[a-z])|tailwindcss v\d/ },
  { name: 'shadcn/ui', cat: 'UI and styling', p: /\sdata-slot="(button|card|input|badge|separator|dialog|sheet|navigation-menu)"/ },
  { name: 'Radix UI', cat: 'UI and styling', p: /\sdata-radix-|aria-controls="radix-/ },
  { name: 'Material UI', cat: 'UI and styling', p: /class="[^"]*\bMui[A-Z]\w+-root/ },
  { name: 'Chakra UI', cat: 'UI and styling', p: /class="[^"]*\bchakra-[a-z]/ },
  { name: 'Mantine', cat: 'UI and styling', p: /class="[^"]*\bmantine-[A-Za-z]|data-mantine-/ },
  { name: 'Ant Design', cat: 'UI and styling', p: /class="[^"]*\bant-(btn|layout|menu|row|col)\b/ },
  { name: 'Bootstrap', cat: 'UI and styling', u: /bootstrap(\.bundle)?(\.min)?\.(css|js)/i, c: /Bootstrap\s+v\d/ },
  { name: 'Bulma', cat: 'UI and styling', u: /bulma(\.min)?\.css/i },
  { name: 'DaisyUI', cat: 'UI and styling', c: /daisyUI/ },
  { name: 'styled-components', cat: 'UI and styling', p: /\sdata-styled(-version)?=/ },
  { name: 'Emotion', cat: 'UI and styling', p: /\sdata-emotion=/ },
  { name: 'Font Awesome', cat: 'UI and styling', u: /font-?awesome|kit\.fontawesome\.com/i },
  { name: 'Google Fonts', cat: 'UI and styling', u: /fonts\.(googleapis|gstatic)\.com/ },
  { name: 'Adobe Fonts', cat: 'UI and styling', u: /use\.typekit\.net|p\.typekit\.net/ },
  { name: 'GSAP', cat: 'UI and styling', u: /gsap(\.min)?\.js|\/gsap@/i },
  { name: 'Lottie', cat: 'UI and styling', u: /lottie/i },

  // Analytics and tracking.
  { name: 'Google Analytics', cat: 'Analytics', u: /googletagmanager\.com\/gtag\/js|google-analytics\.com\/(analytics|ga)\.js/, p: /gtag\(['"]config['"],\s*['"]G-/ },
  { name: 'Google Tag Manager', cat: 'Analytics', u: /googletagmanager\.com\/gtm\.js/, p: /googletagmanager\.com\/ns\.html|['"]GTM-[A-Z0-9]+['"]/ },
  { name: 'Vercel Analytics', cat: 'Analytics', u: /\/_vercel\/insights\/script\.js|va\.vercel-scripts\.com/ },
  { name: 'Vercel Speed Insights', cat: 'Analytics', u: /\/_vercel\/speed-insights\// },
  { name: 'Cloudflare Web Analytics', cat: 'Analytics', u: /static\.cloudflareinsights\.com\/beacon/ },
  { name: 'Plausible', cat: 'Analytics', u: /plausible\.io\/js\// },
  { name: 'Fathom', cat: 'Analytics', u: /cdn\.usefathom\.com/ },
  { name: 'Umami', cat: 'Analytics', u: /umami/i },
  { name: 'Simple Analytics', cat: 'Analytics', u: /simpleanalyticscdn\.com/ },
  { name: 'PostHog', cat: 'Analytics', u: /posthog/i, p: /posthog\.init\(|i\.posthog\.com/, j: /i\.posthog\.com/ },
  { name: 'Mixpanel', cat: 'Analytics', u: /cdn\.mxpnl\.com/, p: /mixpanel\.init\(/ },
  { name: 'Amplitude', cat: 'Analytics', u: /cdn\.amplitude\.com/ },
  { name: 'Segment', cat: 'Analytics', u: /cdn\.segment\.com/ },
  { name: 'Heap', cat: 'Analytics', u: /cdn\.heapanalytics\.com/ },
  { name: 'Hotjar', cat: 'Analytics', u: /static\.hotjar\.com/, p: /static\.hotjar\.com/ },
  { name: 'Microsoft Clarity', cat: 'Analytics', u: /clarity\.ms\//, p: /clarity\.ms\/tag/ },
  { name: 'Matomo', cat: 'Analytics', u: /(matomo|piwik)\.js/ },
  { name: 'Meta Pixel', cat: 'Analytics', u: /connect\.facebook\.net\/[^/]+\/fbevents\.js/, p: /connect\.facebook\.net\/[^/]+\/fbevents\.js/ },
  { name: 'LinkedIn Insight', cat: 'Analytics', u: /snap\.licdn\.com/, p: /snap\.licdn\.com/ },
  { name: 'X (Twitter) Pixel', cat: 'Analytics', u: /static\.ads-twitter\.com/, p: /static\.ads-twitter\.com/ },
  { name: 'TikTok Pixel', cat: 'Analytics', p: /analytics\.tiktok\.com/ },

  // Services the site talks to: payments, sign-in, data, chat, forms.
  { name: 'Stripe', cat: 'Services', u: /js\.stripe\.com/, j: /js\.stripe\.com/ },
  { name: 'Paddle', cat: 'Services', u: /cdn\.paddle\.com/ },
  { name: 'Lemon Squeezy', cat: 'Services', u: /lemonsqueezy\.com/ },
  { name: 'Gumroad', cat: 'Services', u: /gumroad\.com\/js/ },
  { name: 'Supabase', cat: 'Services', p: /\.supabase\.co\b/, j: /\.supabase\.co\b/ },
  { name: 'Firebase', cat: 'Services', u: /firebase/i, j: /firebaseapp\.com|firebaseio\.com/ },
  { name: 'Clerk', cat: 'Services', u: /clerk\.[\w.-]+\/npm\/@clerk|\/clerk\.browser\.js/, p: /data-clerk-publishable-key|__clerk_/ },
  { name: 'Auth0', cat: 'Services', u: /auth0/i, j: /\.auth0\.com/ },
  { name: 'Sentry', cat: 'Services', u: /sentry-cdn\.com|sentry/i, j: /ingest(\.[a-z]+)?\.sentry\.io/ },
  { name: 'Intercom', cat: 'Services', u: /widget\.intercom\.io/, p: /widget\.intercom\.io/ },
  { name: 'Crisp', cat: 'Services', u: /client\.crisp\.chat/, p: /client\.crisp\.chat/ },
  { name: 'HubSpot', cat: 'Services', u: /js\.hs-scripts\.com|js\.hsforms\.net/ },
  { name: 'Calendly', cat: 'Services', u: /assets\.calendly\.com/ },
  { name: 'Cal.com', cat: 'Services', u: /app\.cal\.com\/embed/, p: /app\.cal\.com\/embed/ },
  { name: 'Tally', cat: 'Services', u: /tally\.so\/widgets/ },
  { name: 'Typeform', cat: 'Services', u: /embed\.typeform\.com/ },
  { name: 'Sanity', cat: 'Services', u: /cdn\.sanity\.io/ },
  { name: 'Contentful', cat: 'Services', u: /ctfassets\.net/ },
  { name: 'Storyblok', cat: 'Services', u: /a\.storyblok\.com/ },
  { name: 'Prismic', cat: 'Services', u: /images\.prismic\.io/ },
  { name: 'Cloudflare Turnstile', cat: 'Services', u: /challenges\.cloudflare\.com\/turnstile/ },
  { name: 'reCAPTCHA', cat: 'Services', u: /google\.com\/recaptcha|recaptcha\.net/ },
  { name: 'hCaptcha', cat: 'Services', u: /hcaptcha\.com/ },
  { name: 'Cookiebot', cat: 'Services', u: /consent\.cookiebot\.com/ },
  { name: 'OneTrust', cat: 'Services', u: /cdn\.cookielaw\.org/ },
];

const BY_NAME = new Map(SIGS.map((s) => [s.name, s]));

const MAX_CSS = 3;
const MAX_JS = 2;

export async function findStack(html: string, base: string, headers: Headers, fetchText: Fetch): Promise<StackResult> {
  const page = new URL(base);
  const hdrs: Record<string, string> = {};
  headers.forEach((v, k) => (hdrs[k.toLowerCase()] = v));

  const urls: string[] = [];
  const ownCss: string[] = [];
  const ownJs: string[] = [];
  const same = (u: string) => {
    try {
      return new URL(u).hostname === page.hostname;
    } catch {
      return false;
    }
  };

  for (const tag of html.match(/<(script|link|img|iframe)\b[^>]*>/gi) ?? []) {
    const name = tag.slice(1, tag.search(/[\s>]/)).toLowerCase();
    const raw = attr(tag, name === 'link' ? 'href' : 'src');
    if (!raw) continue;
    const abs = resolve(raw, base);
    if (!abs) continue;
    urls.push(abs);
    if (!same(abs)) continue;
    if (name === 'link') {
      const rel = attr(tag, 'rel').toLowerCase().split(/\s+/);
      if (rel.includes('stylesheet') || (rel.includes('preload') && attr(tag, 'as').toLowerCase() === 'style')) ownCss.push(abs);
      else if (rel.includes('modulepreload')) ownJs.push(abs);
    } else if (name === 'script') {
      ownJs.unshift(abs); // page scripts before module preloads
    }
  }

  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const js = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const generator = (html.match(/<meta\b[^>]*name=["']generator["'][^>]*>/i)?.[0] ?? '').match(/content=["']([^"']*)["']/i)?.[1] ?? '';

  const c: Ctx = { html, host: page.hostname.toLowerCase(), headers: hdrs, urls, generator: decode(generator), css, js };
  let found = match(c);

  // A page that is mostly JavaScript (Lovable, Bolt and most vibe-coded apps) shows little in its HTML,
  // so read a few of the site's own files. Skipped when the HTML already answers the question.
  let read = 0;
  let readFailed = 0;
  const has = (n: string) => found.some((t) => t.name === n);
  const wantCss = !has('Tailwind CSS') && !has('Bootstrap') ? uniq(ownCss).slice(0, MAX_CSS) : [];
  // Scripts are always worth a look: they show the framework and services like Supabase or Stripe.
  const wantJs = uniq(ownJs).slice(0, MAX_JS);
  const files = [...wantCss, ...wantJs];
  if (files.length) {
    const texts = await Promise.all(files.map((u) => fetchText(u)));
    texts.forEach((t, i) => {
      if (t === null) return void readFailed++;
      read++;
      if (i < wantCss.length) c.css += '\n' + t;
      else c.js += '\n' + t;
    });
    found = match(c);
  }

  // Tailwind's utility classes are a strong sign even when its CSS isn't readable.
  if (!found.some((t) => t.name === 'Tailwind CSS')) {
    const n = tailwindClasses(html);
    if (n >= 12) found.push({ name: 'Tailwind CSS', category: 'UI and styling', evidence: `The page uses ${n} Tailwind-style classes, like “flex”, “px-4” and “text-sm”` });
  }

  return { tech: sortTech(found), read, readFailed };
}

function match(c: Ctx): Tech[] {
  const out: Tech[] = [];
  const seen = new Set<string>();
  const add = (name: string, evidence: string) => {
    if (seen.has(name)) return;
    const s = BY_NAME.get(name);
    if (!s) return;
    seen.add(name);
    out.push({ name, category: s.cat, evidence });
  };

  // Direct evidence first, so "built on" only fills in what the page itself doesn't show.
  for (const s of SIGS) {
    const ev = evidence(s, c);
    if (ev) add(s.name, ev);
  }
  for (let i = 0; i < out.length; i++) {
    for (const imp of BY_NAME.get(out[i].name)?.implies ?? []) add(imp, `${out[i].name} is built on ${imp}`);
  }
  // Plain "Cloudflare" is redundant next to Cloudflare Pages or Workers.
  return out.filter((t) => !(t.name === 'Cloudflare' && seen.has('Cloudflare Pages')) && !(t.name === 'Cloudflare' && seen.has('Cloudflare Workers')));
}

function evidence(s: Sig, c: Ctx): string | null {
  if (s.host && s.host.test(c.host)) return `The address is on ${c.host.split('.').slice(-2).join('.')}`;
  for (const [k, re] of s.h ?? []) {
    const v = c.headers[k];
    if (v !== undefined && re.test(v)) return `The server answers with “${k}: ${short(v, 40)}”`;
  }
  if (s.g && c.generator && s.g.test(c.generator)) return `The page’s generator tag says “${short(c.generator, 40)}”`;
  if (s.u) {
    const u = c.urls.find((x) => s.u!.test(x));
    if (u) return `The page loads ${shortUrl(u)}`;
  }
  if (s.p) {
    const m = c.html.match(s.p);
    if (m) return `The page’s code contains “${short(m[0].trim(), 40)}”`;
  }
  if (s.c) {
    const m = c.css.match(s.c);
    if (m) return `The site’s CSS contains “${short(m[0], 40)}”`;
  }
  if (s.j) {
    const m = c.js.match(s.j);
    if (m) return `The site’s JavaScript contains “${short(m[0], 40)}”`;
  }
  return null;
}

// Counts distinct class names that look like Tailwind utilities.
const TW = /^(?:[a-z0-9]+:)*-?(?:(?:p|m)[trblxyse]?-(?:\d|px|auto)|(?:w|h|min-w|max-w|min-h|size)-(?:\d|full|screen|px|\[)|flex|inline-flex|grid|hidden|block|items-(?:center|start|end|baseline|stretch)|justify-(?:center|between|start|end|around|evenly)|gap(?:-[xy])?-\d|space-[xy]-\d|text-(?:xs|sm|base|lg|[2-9]?xl|left|center|right|white|black|[a-z]+-\d{2,3})|font-(?:thin|light|normal|medium|semibold|bold|extrabold|black|sans|serif|mono)|bg-(?:white|black|transparent|[a-z]+-\d{2,3})|rounded(?:-(?:sm|md|lg|xl|2xl|3xl|full|none))?|border(?:-[a-z]+-\d{2,3})?|shadow(?:-(?:sm|md|lg|xl|2xl|none))?|grid-cols-\d+|col-span-\d+|leading-(?:none|tight|snug|normal|relaxed|loose|\d)|tracking-(?:tight|tighter|wide|wider|widest|normal)|z-\d+|opacity-\d+|transition(?:-[a-z]+)?|duration-\d+|overflow-(?:hidden|auto|scroll|x-auto|y-auto)|relative|absolute|fixed|sticky|inset-\d|top-\d|left-\d|right-\d|bottom-\d)$/;
function tailwindClasses(html: string): number {
  const set = new Set<string>();
  for (const m of html.matchAll(/\sclass(?:Name)?="([^"]{1,2000})"/g)) {
    for (const cls of m[1].split(/\s+/)) if (cls && TW.test(cls)) set.add(cls);
  }
  return set.size;
}

function sortTech(list: Tech[]): Tech[] {
  const order = new Map(SIGS.map((s, i) => [s.name, i]));
  return [...list].sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : '';
}

function resolve(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

const uniq = (a: string[]) => [...new Set(a)];
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function shortUrl(u: string): string {
  try {
    const x = new URL(u);
    return short(x.hostname.replace(/^www\./, '') + x.pathname, 60);
  } catch {
    return short(u, 60);
  }
}

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
