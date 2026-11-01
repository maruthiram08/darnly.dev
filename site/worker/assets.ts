// Asset extractor: reads a page's HTML (and a few of its stylesheets) and lists the pictures it
// uses: <img> and srcset, <picture>, CSS backgrounds, inline and linked SVG, favicons, the
// web app manifest's icons and the share (Open Graph) image. Plain functions so they can be
// tested without a Worker. Nothing here downloads the pictures themselves; /api/asset does that.

export type Kind = 'image' | 'svg' | 'icon' | 'background' | 'share';

export type Asset = {
  url: string; // absolute http(s) address, or a data: address for small embedded pictures
  kind: Kind;
  type: string; // best guess from the address: png, jpg, webp, avif, gif, svg, ico…
  width?: number; // from the HTML attributes or sizes="…", when given
  height?: number;
  alt?: string;
  where: string; // short note on where it was found, e.g. "<img>", "srcset", "CSS background"
};

export type InlineSvg = { markup: string; width?: number; height?: number; label?: string };

export type AssetsResult = { assets: Asset[]; svgs: InlineSvg[]; sheets: number; sheetsFailed: number; capped: boolean };

type Fetch = (url: string) => Promise<string | null>;

const MAX_ASSETS = 200;
const MAX_SVGS = 60;
const MAX_SVG_BYTES = 60_000;
const MAX_DATA_URI = 200_000;
const MAX_SHEETS = 8;

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|apng|jfif)(?:$|[?#])/i;

export async function findAssets(html: string, base: string, fetchText: Fetch): Promise<AssetsResult> {
  const found = new Map<string, Asset>();
  let capped = false;
  const add = (raw: string | null | undefined, kind: Kind, where: string, extra: Partial<Asset> = {}) => {
    if (!raw) return;
    const url = absolute(raw.trim(), base);
    if (!url) return;
    const prev = found.get(url);
    if (prev) {
      // Keep the most specific label: a share image or icon beats a plain <img>.
      if (rank(kind) > rank(prev.kind)) prev.kind = kind;
      prev.width ??= extra.width;
      prev.height ??= extra.height;
      if (extra.alt) prev.alt ||= extra.alt;
      return;
    }
    if (found.size >= MAX_ASSETS) {
      capped = true;
      return;
    }
    const type = typeOf(url);
    found.set(url, { url, kind: kind === 'image' && type === 'svg' ? 'svg' : kind, type, where, ...clean(extra) });
  };

  // Drop comments and scripts so commented-out or JS-templated markup doesn't count.
  const page = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');

  // Share images first, so they keep their label if the same file is also an <img>.
  for (const tag of page.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') || attr(tag, 'name')).toLowerCase().trim();
    if (/^(og:image|og:image:url|og:image:secure_url|twitter:image|twitter:image:src)$/.test(key)) add(attr(tag, 'content'), 'share', key.startsWith('og') ? 'Open Graph image' : 'X (Twitter) image');
    else if (key === 'msapplication-tileimage') add(attr(tag, 'content'), 'icon', 'Windows tile');
  }

  let manifest: string | null = null;
  let declaredIcon = false;
  for (const tag of page.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel').toLowerCase().split(/\s+/);
    const href = attr(tag, 'href');
    if (!href) continue;
    if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed') || rel.includes('mask-icon')) {
      declaredIcon = true;
      const [w, h] = sizes(attr(tag, 'sizes'));
      add(href, 'icon', rel.includes('mask-icon') ? 'Safari pinned tab' : rel.includes('icon') ? 'Favicon' : 'Apple touch icon', { width: w, height: h });
    } else if (rel.includes('manifest') && !manifest) {
      manifest = absolute(href, base);
    } else if (rel.includes('preload') && attr(tag, 'as').toLowerCase() === 'image') {
      add(href, 'image', 'Preloaded image');
    }
  }

  for (const tag of page.match(/<img\b[^>]*>/gi) ?? []) {
    // Read size and alt from the tag without any embedded data: picture, which can hold "width=…" itself.
    const bare = tag.replace(/"data:[^"]*"|'data:[^']*'/g, '""');
    const extra = { width: num(attr(bare, 'width')), height: num(attr(bare, 'height')), alt: attr(bare, 'alt') };
    // Lazy-loading scripts keep the real picture in data-src while src holds a tiny placeholder.
    const lazy = attr(tag, 'data-src') || attr(tag, 'data-lazy-src') || attr(tag, 'data-original');
    const src = attr(tag, 'src');
    if (lazy) add(lazy, 'image', 'Image on the page', extra);
    if (src && !(lazy && src.startsWith('data:'))) add(src, 'image', 'Image on the page', extra);
    const set = attr(tag, 'srcset') || attr(tag, 'data-srcset');
    if (set) add(largest(set), 'image', 'Largest size (srcset)', { alt: extra.alt });
  }

  for (const tag of page.match(/<source\b[^>]*>/gi) ?? []) {
    const set = attr(tag, 'srcset') || attr(tag, 'data-srcset');
    // <source> inside <video>/<audio> uses src, not srcset; only take image types.
    if (set) add(largest(set), 'image', 'Picture source');
  }

  for (const tag of page.match(/<(?:video|input)\b[^>]*>/gi) ?? []) {
    if (/^<video/i.test(tag)) add(attr(tag, 'poster'), 'image', 'Video poster');
    else if (attr(tag, 'type').toLowerCase() === 'image') add(attr(tag, 'src'), 'image', 'Image button');
  }

  // <image href> and <use href> inside SVGs that point at files.
  for (const tag of page.match(/<image\b[^>]*>/gi) ?? []) add(attr(tag, 'href') || attr(tag, 'xlink:href'), 'image', 'Inside an SVG');
  for (const tag of page.match(/<(?:object|embed)\b[^>]*>/gi) ?? []) {
    const src = attr(tag, 'data') || attr(tag, 'src');
    if (src && typeOf(src) === 'svg') add(src, 'svg', 'Embedded SVG');
  }

  // Backgrounds: style="…" on elements, <style> blocks, and the first few stylesheets.
  for (const m of page.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    for (const u of cssImages(decodeEntities(m[2] ?? m[3] ?? ''))) add(u, 'background', 'CSS background');
  }
  for (const m of page.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) for (const u of cssImages(m[1])) add(u, 'background', 'CSS background');

  const sheetUrls: string[] = [];
  for (const tag of page.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel').toLowerCase().split(/\s+/);
    const href = absolute(attr(tag, 'href'), base);
    if (!href || href.startsWith('data:')) continue;
    if (rel.includes('stylesheet') || (rel.includes('preload') && attr(tag, 'as').toLowerCase() === 'style')) {
      if (!/fonts\.googleapis\.com|use\.typekit\.net/i.test(href) && !sheetUrls.includes(href)) sheetUrls.push(href);
    }
  }
  const wanted = sheetUrls.slice(0, MAX_SHEETS);
  let failed = 0;
  const [texts, manifestText] = await Promise.all([Promise.all(wanted.map((u) => fetchText(u))), manifest ? fetchText(manifest) : Promise.resolve(null)]);
  texts.forEach((css, i) => {
    if (css === null) failed++;
    else for (const u of cssImages(css)) add(absolute(u, wanted[i]), 'background', 'CSS background');
  });

  if (manifest && manifestText) {
    try {
      const icons = (JSON.parse(manifestText) as { icons?: { src?: string; sizes?: string }[] }).icons ?? [];
      for (const ic of icons.slice(0, 20)) {
        if (typeof ic.src !== 'string') continue;
        const [w, h] = sizes(ic.sizes ?? '');
        add(absolute(ic.src, manifest), 'icon', 'App manifest icon', { width: w, height: h });
      }
    } catch {
      /* not JSON; skip */
    }
  }

  // Browsers ask for /favicon.ico when a page names no icon, so most sites still have one.
  if (!declaredIcon) add('/favicon.ico', 'icon', 'Default favicon');

  return { assets: [...found.values()], svgs: inlineSvgs(page), sheets: wanted.length, sheetsFailed: failed, capped };
}

// Inline <svg> elements: logos and icons drawn right in the HTML. Sprite sheets (only <symbol>s)
// and icons that only point at a sprite (<use href="#id">) can't stand alone, so they're skipped.
export function inlineSvgs(page: string): InlineSvg[] {
  const out: InlineSvg[] = [];
  const seen = new Set<string>();
  const re = /<svg\b[\s\S]*?<\/svg>/gi;
  for (const m of page.matchAll(re)) {
    let markup = m[0];
    // A nested <svg> closes early; extend to the matching close tag.
    let depth = (markup.match(/<svg\b/gi) ?? []).length - (markup.match(/<\/svg>/gi) ?? []).length;
    let end = (m.index ?? 0) + markup.length;
    while (depth > 0) {
      const next = page.indexOf('</svg>', end);
      if (next < 0) break;
      const chunk = page.slice(end, next + 6);
      depth += (chunk.match(/<svg\b/gi) ?? []).length - 1;
      markup += chunk;
      end = next + 6;
    }
    re.lastIndex = end;
    if (markup.length > MAX_SVG_BYTES) continue;
    const drawable = /<(path|circle|rect|ellipse|line|polyline|polygon|text|image|g)\b/i.test(markup.replace(/<symbol\b[\s\S]*?<\/symbol>/gi, '').replace(/<defs\b[\s\S]*?<\/defs>/gi, ''));
    if (!drawable) continue;
    const open = markup.match(/^<svg\b[^>]*>/i)?.[0] ?? '';
    let svg = markup;
    if (!/\sxmlns\s*=/.test(open)) svg = svg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    if (/\sxlink:href\s*=/.test(svg) && !/\sxmlns:xlink\s*=/.test(open)) svg = svg.replace(/^<svg\b/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    const key = svg.replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    const vb = attr(open, 'viewBox').trim().split(/[\s,]+/).map(Number);
    const width = num(attr(open, 'width')) ?? (vb.length === 4 && vb[2] > 0 ? Math.round(vb[2]) : undefined);
    const height = num(attr(open, 'height')) ?? (vb.length === 4 && vb[3] > 0 ? Math.round(vb[3]) : undefined);
    const title = svg.match(/<title\b[^>]*>([^<]{1,80})<\/title>/i)?.[1];
    const label = attr(open, 'aria-label') || (title ? decodeEntities(title).trim() : '') || undefined;
    out.push(clean({ markup: svg, width, height, label }) as InlineSvg);
    if (out.length >= MAX_SVGS) break;
  }
  return out;
}

// Picture addresses inside CSS: url(…) and image-set(…), skipping fonts and #fragment filters.
export function cssImages(css: string): string[] {
  const out: string[] = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\s*\{[^}]*\}/gi, '');
  for (const m of body.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) {
    const u = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!u || u.startsWith('#') || /^about:/i.test(u)) continue;
    if (/\.(woff2?|ttf|otf|eot|css)(?:$|[?#])/i.test(u)) continue;
    if (u.startsWith('data:') ? !/^data:image\//i.test(u) : !IMG_EXT.test(u) && /\.\w{2,5}(?:$|[?#])/.test(u)) continue;
    out.push(u);
  }
  return out;
}

// The biggest candidate in a srcset ("a.jpg 480w, b.jpg 1080w" → b.jpg).
export function largest(srcset: string): string | null {
  let best: string | null = null;
  let bestScore = -1;
  // Commas also appear inside data: addresses, so split on ", " followed by a candidate.
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [u, d] = part.trim().split(/\s+/);
    if (!u) continue;
    const n = d ? parseFloat(d) * (d.endsWith('x') ? 1000 : 1) : 1;
    if (n > bestScore) {
      best = u.replace(/,$/, '');
      bestScore = n;
    }
  }
  return best;
}

export function typeOf(url: string): string {
  if (url.startsWith('data:')) {
    const t = url.slice(5, url.indexOf(/[;,]/.exec(url)?.[0] ?? ',')).toLowerCase();
    return t.replace(/^image\//, '').replace('svg+xml', 'svg').replace('jpeg', 'jpg').replace('x-icon', 'ico').replace('vnd.microsoft.icon', 'ico') || 'image';
  }
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* keep */
  }
  const ext = path.match(/\.([a-z0-9]{2,5})$/i)?.[1].toLowerCase();
  if (!ext) return 'image';
  return ext === 'jpeg' || ext === 'jfif' ? 'jpg' : ext === 'tif' ? 'tiff' : ext;
}

const rank = (k: Kind) => ({ image: 0, background: 0, svg: 1, icon: 2, share: 3 })[k];

function absolute(raw: string, base: string): string | null {
  if (!raw) return null;
  if (/^data:/i.test(raw)) return /^data:image\//i.test(raw) && raw.length <= MAX_DATA_URI ? raw : null;
  try {
    const u = new URL(raw, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

function sizes(s: string): [number | undefined, number | undefined] {
  const m = s.match(/(\d+)\s*x\s*(\d+)/i);
  return m ? [Number(m[1]), Number(m[2])] : [undefined, undefined];
}

function num(s: string): number | undefined {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 && n < 20000 ? n : undefined;
}

function clean<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>;
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name.replace(':', '\\:')}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : '';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
