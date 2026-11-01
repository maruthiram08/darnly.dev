// Page speed checker: turns a Google PageSpeed Insights result into plain words.
// The Worker calls PSI once for phones and once for laptops; summarize() keeps only what
// the page shows: the score, the loading filmstrip, three vitals and the top three fixes.

type Audit = {
  id?: string;
  title?: string;
  description?: string;
  score?: number | null;
  numericValue?: number;
  metricSavings?: Record<string, number>;
  details?: { type?: string; overallSavingsMs?: number; items?: unknown; data?: string };
};
export type Lhr = {
  finalUrl?: string;
  finalDisplayedUrl?: string;
  categories?: { performance?: { score?: number | null } };
  audits?: Record<string, Audit>;
};
type FieldMetric = { percentile?: number; category?: string };
export type Psi = {
  id?: string;
  lighthouseResult?: Lhr;
  loadingExperience?: { metrics?: Record<string, FieldMetric>; origin_fallback?: boolean };
  originLoadingExperience?: { metrics?: Record<string, FieldMetric> };
};

export type Grade = 'good' | 'ok' | 'poor';
export type Frame = { t: number; src: string };
export type Fix = { key: string; title: string; plain: string; savingsMs: number; files: string[]; prompt: string; tool?: { href: string; name: string } };
export type Report = {
  score: number;
  frames: Frame[];
  final: string | null;
  lcp: { ms: number; grade: Grade; kind: 'image' | 'text' | 'video' | 'block' | null; label: string | null };
  cls: { value: number; grade: Grade };
  tbt: { ms: number; grade: Grade };
  fcp: { ms: number };
  si: { ms: number };
  fixes: Fix[];
};
export type Field = {
  scope: 'page' | 'site';
  lcp: { ms: number; grade: Grade } | null;
  cls: { value: number; grade: Grade } | null;
  inp: { ms: number; grade: Grade } | null;
} | null;

const grade = (v: number, good: number, poor: number): Grade => (v <= good ? 'good' : v > poor ? 'poor' : 'ok');

// Each fix groups the Lighthouse audits that ask for the same change, in plain words.
type Plan = { title: string; plain: string; prompt: string; tool?: { href: string; name: string } };
const PLANS: Record<string, Plan> = {
  images: {
    title: 'Shrink and resize your images',
    plain: 'Some images are bigger than they’re shown, or in an old heavy format. Phones download every extra byte.',
    prompt: 'Make the images on this page lighter: serve them as WebP or AVIF, at the size they are actually displayed (use srcset/sizes for different screens), and lazy-load images below the fold. Keep the hero image eager.',
    tool: { href: '/tools/image-compressor/', name: 'image compressor' },
  },
  'lcp-image': {
    title: 'Load your biggest image first',
    plain: 'The browser finds your main image late, so it starts downloading it late.',
    prompt: 'Make the largest image above the fold load first: put it in the HTML (not set by JavaScript or CSS), remove loading="lazy" from it, add fetchpriority="high", and preload it if the framework supports that.',
  },
  'render-blocking': {
    title: 'Stop files from blocking the first paint',
    plain: 'The page waits for some CSS and JavaScript files before it shows anything at all.',
    prompt: 'Stop CSS and JavaScript from blocking the first paint: defer or async non-critical scripts, inline the small amount of CSS needed for the top of the page, and load the rest without blocking.',
  },
  js: {
    title: 'Send less JavaScript',
    plain: 'The page downloads and runs more JavaScript than it uses, which keeps the phone busy and slow to respond.',
    prompt: 'Reduce the JavaScript this page loads: remove unused code and libraries, split code so each page loads only what it needs, lazy-load heavy components below the fold, and stop shipping polyfills for old browsers.',
  },
  css: {
    title: 'Remove unused CSS',
    plain: 'The page loads styles it never uses.',
    prompt: 'Remove unused CSS from this page and minify what remains. If a CSS framework is used, make sure unused classes are purged in the production build.',
  },
  server: {
    title: 'Make the server answer faster',
    plain: 'Your server takes a while to send the first byte of the page, and everything else waits for it.',
    prompt: 'Make the first response of this page faster: cache the HTML at the edge or render it statically where possible, avoid slow database or API calls before the first byte, and remove redirects on the main address.',
  },
  cache: {
    title: 'Let browsers keep your files',
    plain: 'Returning visitors download the same files again because they aren’t cached for long.',
    prompt: 'Set long cache headers (Cache-Control: public, max-age=31536000, immutable) on hashed static files like JS, CSS, fonts and images, at my host or in the framework config.',
  },
  fonts: {
    title: 'Show text while fonts load',
    plain: 'Text stays invisible until the web font arrives.',
    prompt: 'Make text visible while web fonts load: use font-display: swap, preload the one or two fonts used above the fold, and self-host them if they come from a third party.',
  },
  'third-party': {
    title: 'Rein in third-party scripts',
    plain: 'Chat widgets, trackers and embeds from other sites slow the page down.',
    prompt: 'Reduce the cost of third-party scripts on this page: remove ones that aren’t needed, load the rest after the page is interactive (defer or on user interaction), and replace heavy embeds with a lightweight placeholder until clicked.',
  },
  shifts: {
    title: 'Stop the page from jumping',
    plain: 'Things move around while the page loads, so people tap the wrong thing.',
    prompt: 'Stop layout shifts on this page: give every image, video and iframe a width and height (or aspect-ratio), reserve space for anything loaded later like banners or ads, and avoid inserting content above existing content.',
  },
  weight: {
    title: 'Make the page lighter',
    plain: 'The page downloads a lot in total, and the files wait on each other in a chain.',
    prompt: 'Make this page download less and in fewer steps: find the largest files and shrink or remove them, and shorten chains of requests that wait on each other (preconnect to required origins, preload critical files).',
  },
  dom: {
    title: 'Simplify the page structure',
    plain: 'The page has a very large number of elements, which makes every update slow.',
    prompt: 'Reduce the number of DOM elements on this page: remove wrapper elements that aren’t needed, and render long lists virtually or paginate them.',
  },
  compression: {
    title: 'Turn on compression',
    plain: 'Text files are sent uncompressed.',
    prompt: 'Turn on gzip or Brotli compression for HTML, CSS and JavaScript at my host or server.',
  },
  main: {
    title: 'Keep the main thread free',
    plain: 'The phone spends a long time running scripts, so taps and scrolling feel stuck.',
    prompt: 'Reduce main-thread work on this page: break up long JavaScript tasks, move heavy work off the first load, and avoid running expensive code on every render.',
  },
};

const AUDIT_PLAN: Record<string, keyof typeof PLANS> = {
  'image-delivery-insight': 'images',
  'uses-optimized-images': 'images',
  'modern-image-formats': 'images',
  'uses-responsive-images': 'images',
  'offscreen-images': 'images',
  'efficient-animated-content': 'images',
  'lcp-discovery-insight': 'lcp-image',
  'prioritize-lcp-image': 'lcp-image',
  'lcp-lazy-loaded': 'lcp-image',
  'render-blocking-insight': 'render-blocking',
  'render-blocking-resources': 'render-blocking',
  'unused-javascript': 'js',
  'unminified-javascript': 'js',
  'legacy-javascript': 'js',
  'legacy-javascript-insight': 'js',
  'duplicated-javascript': 'js',
  'duplicated-javascript-insight': 'js',
  'unused-css-rules': 'css',
  'unminified-css': 'css',
  'document-latency-insight': 'server',
  'server-response-time': 'server',
  redirects: 'server',
  'cache-insight': 'cache',
  'uses-long-cache-ttl': 'cache',
  'font-display-insight': 'fonts',
  'font-display': 'fonts',
  'third-parties-insight': 'third-party',
  'third-party-summary': 'third-party',
  'cls-culprits-insight': 'shifts',
  'layout-shifts': 'shifts',
  'unsized-images': 'shifts',
  'network-dependency-tree-insight': 'weight',
  'total-byte-weight': 'weight',
  'critical-request-chains': 'weight',
  'dom-size-insight': 'dom',
  'dom-size': 'dom',
  'uses-text-compression': 'compression',
  'mainthread-work-breakdown': 'main',
  'bootup-time': 'main',
};

// How much an audit would help, in milliseconds. Layout shift counts as time so it can compete.
function savings(a: Audit): number {
  const m = a.metricSavings ?? {};
  const fromMetrics = (m.LCP ?? 0) + (m.FCP ?? 0) * 0.5 + (m.TBT ?? 0) + (m.INP ?? 0) + (m.CLS ?? 0) * 5000;
  return Math.max(fromMetrics, a.details?.overallSavingsMs ?? 0);
}

// Files named in an audit's table, so the agent knows where to look.
function files(a: Audit, page: string): string[] {
  const out: string[] = [];
  const visit = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const r = it as { url?: unknown; items?: unknown[]; type?: string };
      if (r.type === 'table' || r.type === 'list') visit(r.items);
      else if (typeof r.url === 'string' && /^https?:/.test(r.url) && r.url !== page && !out.includes(r.url)) out.push(r.url);
      if (out.length >= 5) return;
    }
  };
  visit(a.details?.items);
  return out.slice(0, 5);
}

type LcpNode = { snippet?: string; nodeLabel?: string };
function lcpNode(audits: Record<string, Audit>): LcpNode | null {
  const find = (items: unknown): LcpNode | null => {
    if (!Array.isArray(items)) return null;
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const r = it as { type?: string; items?: unknown[]; node?: LcpNode; snippet?: string };
      if (r.type === 'node' && r.snippet) return r as LcpNode;
      if (r.node?.snippet) return r.node;
      const inner = find(r.items);
      if (inner) return inner;
    }
    return null;
  };
  return find(audits['lcp-breakdown-insight']?.details?.items) ?? find(audits['largest-contentful-paint-element']?.details?.items);
}

function lcpKind(n: LcpNode | null): Report['lcp']['kind'] {
  if (!n?.snippet) return null;
  const tag = n.snippet.match(/^<\s*([a-z0-9-]+)/i)?.[1]?.toLowerCase() ?? '';
  if (tag === 'img' || tag === 'picture' || tag === 'svg' || tag === 'image' || /background-image:\s*url\(\s*['"]?[^'")\s]/i.test(n.snippet)) return 'image';
  if (tag === 'video') return 'video';
  if (/^(h[1-6]|p|span|a|li|blockquote|label|strong|em|b)$/.test(tag)) return 'text';
  return 'block';
}

export function summarize(psi: Psi): Report | null {
  const lhr = psi.lighthouseResult;
  const audits = lhr?.audits;
  const score = lhr?.categories?.performance?.score;
  if (!lhr || !audits || typeof score !== 'number') return null;
  const num = (id: string) => audits[id]?.numericValue ?? 0;
  const page = lhr.finalDisplayedUrl ?? lhr.finalUrl ?? '';

  const raw = audits['screenshot-thumbnails']?.details?.items;
  const thumbs = Array.isArray(raw) ? raw : [];
  const frames = (thumbs as { timing?: number; data?: string }[])
    .filter((f) => typeof f.data === 'string' && f.data.startsWith('data:image/'))
    .map((f) => ({ t: Math.round(f.timing ?? 0), src: f.data! }));
  const fin = audits['final-screenshot']?.details?.data;

  const node = lcpNode(audits);
  const lcpMs = num('largest-contentful-paint');
  const cls = num('cumulative-layout-shift');
  const tbt = num('total-blocking-time');

  const groups = new Map<string, { savings: number; files: string[]; fail: number }>();
  for (const [id, a] of Object.entries(audits)) {
    const key = AUDIT_PLAN[id];
    if (!key || a.score === null || a.score === undefined || a.score >= 0.9) continue;
    const g = groups.get(key) ?? { savings: 0, files: [], fail: 0 };
    g.savings = Math.max(g.savings, savings(a));
    g.fail = Math.max(g.fail, 1 - a.score);
    for (const f of files(a, page)) if (g.files.length < 5 && !g.files.includes(f)) g.files.push(f);
    groups.set(key, g);
  }
  // A failing layout shift score is worth fixing even when no single audit names savings.
  if (cls > 0.1 && !groups.has('shifts')) groups.set('shifts', { savings: cls * 5000, files: [], fail: 1 });
  const fixes = [...groups.entries()]
    .map(([key, g]) => ({ key, rank: g.savings + g.fail * 100, ...g }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3)
    .map(({ key, savings: s, files: f }) => {
      const p = PLANS[key];
      const list = f.length ? `\nFiles involved:\n${f.map((u) => `- ${u}`).join('\n')}` : '';
      return { key, title: p.title, plain: p.plain, savingsMs: Math.round(s), files: f, prompt: p.prompt + list, ...(p.tool ? { tool: p.tool } : {}) };
    });

  return {
    score: Math.round(score * 100),
    frames: frames.slice(0, 10),
    final: typeof fin === 'string' && fin.startsWith('data:image/') ? fin : null,
    lcp: { ms: Math.round(lcpMs), grade: grade(lcpMs, 2500, 4000), kind: lcpKind(node), label: node?.nodeLabel?.slice(0, 120) ?? null },
    cls: { value: Math.round(cls * 1000) / 1000, grade: grade(cls, 0.1, 0.25) },
    tbt: { ms: Math.round(tbt), grade: grade(tbt, 200, 600) },
    fcp: { ms: Math.round(num('first-contentful-paint')) },
    si: { ms: Math.round(num('speed-index')) },
    fixes,
  };
}

// Real visitors' numbers from Chrome (CrUX), when Google has enough of them.
export function field(psi: Psi): Field {
  const page = psi.loadingExperience;
  const usePage = page?.metrics && !page.origin_fallback;
  const m = usePage ? page!.metrics! : psi.originLoadingExperience?.metrics;
  if (!m) return null;
  const p = (k: string) => (typeof m[k]?.percentile === 'number' ? m[k].percentile! : null);
  const lcp = p('LARGEST_CONTENTFUL_PAINT_MS');
  const cls = p('CUMULATIVE_LAYOUT_SHIFT_SCORE');
  const inp = p('INTERACTION_TO_NEXT_PAINT');
  if (lcp === null && cls === null && inp === null) return null;
  return {
    scope: usePage ? 'page' : 'site',
    lcp: lcp === null ? null : { ms: lcp, grade: grade(lcp, 2500, 4000) },
    cls: cls === null ? null : { value: cls / 100, grade: grade(cls / 100, 0.1, 0.25) },
    inp: inp === null ? null : { ms: inp, grade: grade(inp, 200, 500) },
  };
}

// PSI's own errors, in words a visitor can act on.
export function psiError(status: number, body: string): string {
  if (status === 429 || /quota|rateLimit/i.test(body)) return 'Google’s speed test is busy right now. Try again in a few minutes.';
  if (/NO_FCP|NO_LCP/.test(body)) return 'Google loaded that page but nothing ever appeared on screen. Check that it shows content without logging in.';
  if (/FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS_FAILURE|NOT_HTML/.test(body)) {
    return 'Google couldn’t load that page. Check the address, and that the site is public.';
  }
  if (/timed out|TIMEOUT/i.test(body)) return 'That page took too long to load for Google to test it.';
  return 'Google’s speed test couldn’t check that page. Try again in a minute.';
}
