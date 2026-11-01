// PWA checker: can this site be installed to a phone's home screen?
// Reads the page, its web app manifest, its icons and its own JavaScript (to find a service
// worker being registered), and grades each install requirement green, amber or red.
// Every extra address goes through `fetchText`, which the Worker wires to the shared page reader,
// so the address checks, timeouts and read limits from index.ts apply here too.

import { scriptRefs } from './secrets';

type Fetch = (url: string, accept: string, max?: number) => Promise<string | null>;
// True when the address loads as an image (not an error, and not a web page standing in for one).
type ImageCheck = (url: string) => Promise<boolean>;

export type Level = 'pass' | 'warn' | 'fail';
export type Check = {
  id: string;
  label: string;
  level: Level;
  detail: string;
  fix?: string;
  tool?: { href: string; name: string };
};

export type Icon = { src: string; sizes: string; type: string; purpose: string; max: number; ok: boolean | null };

export type PwaResult = {
  https: boolean;
  title: string | null;
  description: string | null;
  metaThemeColor: string | null;
  appleTouchIcon: string | null;
  favicon: string | null;
  manifestUrl: string | null;
  manifestError: string | null;
  manifest: Record<string, unknown> | null;
  icons: Icon[];
  app: {
    name: string | null;
    shortName: string | null;
    icon: string | null; // the icon Android would show
    maskable: string | null;
    themeColor: string | null;
    backgroundColor: string | null;
    display: string | null;
    startUrl: string | null;
  };
  serviceWorker: { found: boolean; url: string | null; where: string | null; scanned: number };
  checks: Check[];
};

const TOOLS = {
  appIcon: { href: '/tools/app-icon-generator/', name: 'App icon generator' },
  favicon: { href: '/tools/favicon-generator/', name: 'Favicon generator' },
};

const DISPLAYS = ['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay'];
const MAX_SCRIPTS = 20;

type Head = {
  title: string | null;
  description: string | null;
  themeColor: string | null;
  manifest: string | null;
  appleTouchIcon: string | null;
  favicon: string | null;
  scripts: string[];
  inline: string;
};

export async function checkPwa(html: string, pageUrl: string, fetchText: Fetch, loadsImage: ImageCheck): Promise<PwaResult> {
  const page = new URL(pageUrl);
  const head = readHead(html, pageUrl);

  // The manifest.
  let manifest: Record<string, unknown> | null = null;
  let manifestError: string | null = null;
  if (head.manifest) {
    const text = await fetchText(head.manifest, 'application/manifest+json,application/json,*/*;q=0.1', 200_000);
    if (text === null) manifestError = 'unreachable';
    else {
      try {
        const parsed = JSON.parse(text.replace(/^﻿/, ''));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) manifest = parsed as Record<string, unknown>;
        else manifestError = 'not-object';
      } catch {
        manifestError = /^\s*</.test(text) ? 'html' : 'invalid';
      }
    }
  }

  const base = head.manifest ?? pageUrl;
  const abs = (v: unknown, b = base): string | null => {
    if (typeof v !== 'string' || !v.trim()) return null;
    try {
      return new URL(v.trim(), b).href;
    } catch {
      return null;
    }
  };
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  // Icons, with a check that the ones we rely on actually load.
  const icons: Icon[] = [];
  if (manifest && Array.isArray(manifest.icons)) {
    for (const raw of manifest.icons.slice(0, 30)) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const src = abs(r.src);
      if (!src) continue;
      const sizes = str(r.sizes) ?? '';
      const type = str(r.type) ?? '';
      icons.push({ src, sizes, type, purpose: (str(r.purpose) ?? 'any').toLowerCase(), max: maxSize(sizes, type, src), ok: null });
    }
  }
  const anyIcons = icons.filter((i) => i.purpose.split(/\s+/).includes('any'));
  const maskIcons = icons.filter((i) => i.purpose.split(/\s+/).includes('maskable'));
  const big = (list: Icon[], n: number) => list.filter((i) => i.max >= n).sort((a, b) => a.max - b.max)[0] ?? null;
  const icon192 = big(anyIcons, 192);
  const icon512 = big(anyIcons, 512);
  const mask = big(maskIcons, 192);
  const toTest = [...new Set([icon192, icon512, mask].filter((i): i is Icon => !!i))];
  await Promise.all(
    toTest.map(async (i) => {
      const ok = await loadsImage(i.src);
      for (const same of icons) if (same.src === i.src) same.ok = ok;
    }),
  );

  // The service worker: a register() call in the page or in its own JavaScript.
  const sw = await findServiceWorker(html, head, page, fetchText);

  const name = manifest ? str(manifest.name) : null;
  const shortName = manifest ? str(manifest.short_name) : null;
  const display = manifest ? str(manifest.display) : null;
  const startUrl = manifest ? abs(manifest.start_url) : null;
  const themeColor = (manifest ? str(manifest.theme_color) : null) ?? head.themeColor;
  const backgroundColor = manifest ? str(manifest.background_color) : null;
  const https = page.protocol === 'https:';

  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  add(
    https
      ? { id: 'https', label: 'Served over https', level: 'pass', detail: 'Browsers only install apps from secure addresses, and yours is one.' }
      : {
          id: 'https',
          label: 'Not served over https',
          level: 'fail',
          detail: `${page.host} loads over plain http, and phones won’t install an app from an insecure address.`,
          fix: 'Turn on https at your host (Vercel, Netlify and Cloudflare do it for free) and redirect http to https.',
        },
  );

  if (!head.manifest) {
    add({
      id: 'manifest',
      label: 'No web app manifest',
      level: 'fail',
      detail: 'The page has no <link rel="manifest">, so browsers don’t know your app’s name, icon or colors, and won’t offer to install it.',
      fix: 'Download the manifest below, put it in your public folder, and add <link rel="manifest" href="/manifest.webmanifest"> to the page head.',
    });
  } else if (!manifest) {
    const why =
      manifestError === 'unreachable' ? 'we couldn’t load it (it may be missing or blocked)' :
      manifestError === 'html' ? 'it returns a web page instead of the manifest (usually a wrong path that falls back to your home page)' :
      'it isn’t valid JSON';
    add({
      id: 'manifest',
      label: 'The manifest is broken',
      level: 'fail',
      detail: `The page links to ${short(head.manifest)}, but ${why}.`,
      fix: 'Replace it with the manifest below and check the link’s path matches where the file lives.',
    });
  } else {
    add({ id: 'manifest', label: 'Web app manifest found', level: 'pass', detail: `Linked from the page at ${short(head.manifest)}.` });
  }

  if (manifest) {
    // Name.
    if (!name && !shortName) {
      add({ id: 'name', label: 'No app name', level: 'fail', detail: 'The manifest has neither name nor short_name, so there’s nothing to show under the icon.', fix: 'Add "name" (the full name) and "short_name" (12 characters or fewer).' });
    } else if (!shortName && (name?.length ?? 0) > 12) {
      add({ id: 'name', label: 'The name gets cut off on the home screen', level: 'warn', detail: `“${name}” is ${name!.length} characters, and home screens show about 12 under the icon.`, fix: 'Add a "short_name" of 12 characters or fewer.' });
    } else if (shortName && shortName.length > 12) {
      add({ id: 'name', label: 'The short name gets cut off', level: 'warn', detail: `short_name “${shortName}” is ${shortName.length} characters, and home screens show about 12.`, fix: 'Shorten "short_name" to 12 characters or fewer.' });
    } else {
      add({ id: 'name', label: 'App name set', level: 'pass', detail: `Shows as “${shortName ?? name}” under the icon${name && shortName && name !== shortName ? `, and “${name}” on the install prompt` : ''}.` });
    }

    // Icons.
    const iconFix = 'Make a 192×192 and a 512×512 PNG of your logo and list both in "icons".';
    if (!icon192 || !icon512) {
      const missing = [!icon192 && '192×192', !icon512 && '512×512'].filter(Boolean).join(' and ');
      add({ id: 'icons', label: `Missing a ${missing} icon`, level: 'fail', detail: icons.length ? `The manifest lists ${icons.length} icon${icons.length === 1 ? '' : 's'}, but none at ${missing} or larger. Chrome needs both sizes before it offers to install.` : 'The manifest lists no icons. Chrome needs a 192×192 and a 512×512 icon before it offers to install.', fix: iconFix, tool: TOOLS.appIcon });
    } else if (icon192.ok === false || icon512.ok === false) {
      const bad = [icon192, icon512].filter((i) => i.ok === false).map((i) => short(i.src));
      add({ id: 'icons', label: 'An icon doesn’t load', level: 'fail', detail: `${[...new Set(bad)].join(' and ')} ${bad.length > 1 ? 'are' : 'is'} listed but didn’t load.`, fix: 'Check the icon paths in the manifest match real files in your public folder.', tool: TOOLS.appIcon });
    } else {
      add({ id: 'icons', label: '192 and 512 icons found', level: 'pass', detail: 'Both sizes Chrome needs are listed and load.' });
    }

    if (!mask) {
      add({ id: 'maskable', label: 'No maskable icon', level: 'warn', detail: 'Android crops icons into a circle or squircle. Without a "maskable" icon, yours is shrunk onto a white background instead.', fix: 'Add a 512×512 icon with extra padding and "purpose": "maskable".', tool: TOOLS.appIcon });
    } else if (mask.ok === false) {
      add({ id: 'maskable', label: 'The maskable icon doesn’t load', level: 'warn', detail: `${short(mask.src)} is listed but didn’t load.`, fix: 'Fix the path of the maskable icon in the manifest.', tool: TOOLS.appIcon });
    } else {
      add({ id: 'maskable', label: 'Maskable icon found', level: 'pass', detail: 'Android can crop it to the phone’s icon shape without a white border.' });
    }

    // start_url and display.
    if (!startUrl) {
      add({ id: 'start', label: 'No start_url', level: 'fail', detail: 'The manifest doesn’t say which page opens when someone taps the icon.', fix: 'Add "start_url": "/".' });
    } else if (new URL(startUrl).origin !== page.origin) {
      add({ id: 'start', label: 'start_url is on another site', level: 'fail', detail: `start_url points to ${short(startUrl)}, which browsers ignore because it isn’t on ${page.host}.`, fix: 'Set "start_url" to "/" or another page on this site.' });
    } else {
      add({ id: 'start', label: 'start_url set', level: 'pass', detail: `Tapping the icon opens ${new URL(startUrl).pathname + new URL(startUrl).search}.` });
    }

    if (!display || !DISPLAYS.includes(display)) {
      add({ id: 'display', label: display === 'browser' ? 'Opens in a normal browser tab' : 'No display mode', level: 'fail', detail: display === 'browser' ? '"display": "browser" means it opens like a bookmark, so Chrome won’t offer to install it as an app.' : 'Without "display", the app opens in a browser tab with the address bar, and Chrome won’t offer to install it.', fix: 'Set "display": "standalone" so it opens full screen like an app.' });
    } else {
      add({ id: 'display', label: `Opens as an app (${display})`, level: 'pass', detail: display === 'minimal-ui' ? 'It opens in its own window with a small browser bar.' : 'It opens in its own window without the address bar.' });
    }

    if (manifest.prefer_related_applications === true) {
      add({ id: 'related', label: 'Points people to a store app instead', level: 'warn', detail: '"prefer_related_applications": true tells Chrome to offer your store app, not this web app.', fix: 'Remove "prefer_related_applications" unless you want people to install the store app.' });
    }
  }

  // Colors.
  if (!themeColor) {
    add({ id: 'theme', label: 'No theme color', level: 'warn', detail: 'The phone’s status bar and the app switcher use a plain default color.', fix: 'Add "theme_color" to the manifest and <meta name="theme-color" content="…"> to the page.' });
  } else if (manifest && !backgroundColor) {
    add({ id: 'theme', label: 'No background color', level: 'warn', detail: 'The splash screen shown while the app opens uses plain white.', fix: 'Add "background_color" to the manifest, usually your page’s background.' });
  } else {
    add({ id: 'theme', label: 'Theme color set', level: 'pass', detail: `The status bar uses ${themeColor}.` });
  }

  // iPhone.
  add(
    head.appleTouchIcon
      ? { id: 'apple', label: 'iPhone home-screen icon found', level: 'pass', detail: `iPhones use ${short(head.appleTouchIcon)} for the icon.` }
      : {
          id: 'apple',
          label: 'No iPhone home-screen icon',
          level: 'warn',
          detail: 'iPhones ignore the manifest icons and use a shrunken screenshot of the page instead.',
          fix: 'Add a 180×180 PNG and <link rel="apple-touch-icon" href="/apple-touch-icon.png"> to the page head.',
          tool: TOOLS.favicon,
        },
  );

  // Service worker.
  add(
    sw.found
      ? { id: 'sw', label: 'Service worker registered', level: 'pass', detail: sw.url ? `The page registers ${short(sw.url)}${sw.where ? ` (in ${short(sw.where)})` : ''}.` : `The page registers a service worker${sw.where ? ` (in ${short(sw.where)})` : ''}.` }
      : {
          id: 'sw',
          label: 'No service worker found',
          level: 'warn',
          detail: `We looked through the page${sw.scanned ? ` and ${sw.scanned} script file${sw.scanned === 1 ? '' : 's'} it loads` : ''}. Chrome can install without one now, but the app shows an error offline, and tools that turn a site into a Play Store app want one.`,
          fix: 'Add a small service worker (sw.js) and register it with navigator.serviceWorker.register("/sw.js").',
        },
  );

  // Pick the icon each platform would show.
  const fallback = head.appleTouchIcon ?? head.favicon;
  return {
    https,
    title: head.title,
    description: head.description,
    metaThemeColor: head.themeColor,
    appleTouchIcon: head.appleTouchIcon,
    favicon: head.favicon,
    manifestUrl: head.manifest,
    manifestError,
    manifest,
    icons,
    app: {
      name,
      shortName,
      icon: (icon192?.ok !== false ? icon192?.src : null) ?? (icon512?.ok !== false ? icon512?.src : null) ?? big(anyIcons, 0)?.src ?? fallback,
      maskable: mask && mask.ok !== false ? mask.src : null,
      themeColor,
      backgroundColor,
      display,
      startUrl,
    },
    serviceWorker: sw,
    checks,
  };
}

function readHead(html: string, base: string): Head {
  const h: Head = { title: null, description: null, themeColor: null, manifest: null, appleTouchIcon: null, favicon: null, scripts: [], inline: '' };
  const abs = (v: string) => {
    try {
      return new URL(decode(v), base).href;
    } catch {
      return null;
    }
  };
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'))?.slice(1).find((x) => x !== undefined) ?? null;

  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) h.title = decode(title.trim()) || null;

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    const href = attr(tag, 'href');
    if (!href) continue;
    if (rel.includes('manifest') && !h.manifest) h.manifest = abs(href);
    if ((rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) && !h.appleTouchIcon) h.appleTouchIcon = abs(href);
    if (rel.includes('icon') && !h.favicon) h.favicon = abs(href);
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'name') ?? attr(tag, 'property') ?? '').toLowerCase();
    const content = attr(tag, 'content');
    if (content === null) continue;
    if (key === 'description' && !h.description) h.description = decode(content.trim());
    if (key === 'theme-color' && !h.themeColor) h.themeColor = decode(content.trim());
  }
  const page = new URL(base);
  const sameSite = (src: string | null) => {
    const u = src ? abs(src) : null;
    if (u && new URL(u).hostname === page.hostname && /^https?:$/.test(new URL(u).protocol)) h.scripts.push(u);
  };
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const tag = `<script${m[1]}>`;
    const src = attr(tag, 'src');
    if (src) sameSite(src);
    else if (!/\btype\s*=\s*["']?(application\/(ld\+)?json|text\/template|importmap)/i.test(tag)) h.inline += `${m[2]}\n`;
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel=["']?[^"'>]*\b(modulepreload|preload)\b/i.test(tag) || /\bas=["']?(style|font|image|fetch)\b/i.test(tag)) continue;
    sameSite(attr(tag, 'href'));
  }
  h.scripts = [...new Set(h.scripts)];
  return h;
}

// A register() call: navigator.serviceWorker.register("/sw.js"), plus the common helpers that
// wrap it (vite-plugin-pwa, Workbox, next-pwa / Serwist, Create React App, Angular, Nuxt PWA).
const REGISTER = /serviceWorker["'`\]]*\s*\.\s*register\s*\(\s*(?:new\s+URL\s*\(\s*)?(["'`])([^"'`]{1,200})\1/;
const REGISTER_ANY = /serviceWorker["'`\]]*\s*\.\s*register\s*\(|\bnew\s+Workbox\s*\(|\bregisterSW\s*\(|ngsw-worker\.js|serviceWorkerRegistration|@serwist|workbox-window/;

async function findServiceWorker(html: string, head: Head, page: URL, fetchText: Fetch) {
  const look = (text: string, where: string | null) => {
    if (!REGISTER_ANY.test(text)) return null;
    const m = text.match(REGISTER);
    let url: string | null = null;
    if (m) {
      try {
        const u = new URL(m[2], where ?? page.href);
        if (u.origin === page.origin) url = u.href;
      } catch {
        // not an address
      }
    }
    return { found: true, url, where };
  };

  const inPage = look(head.inline, null);
  if (inPage) return { ...inPage, scanned: 0 };
  // vite-plugin-pwa adds <script id="vite-plugin-pwa:register-sw" src="/registerSW.js">.
  const helper = head.scripts.find((s) => /registerSW\.js(\?|$)/.test(s));

  const queue = [...(helper ? [helper] : []), ...head.scripts.filter((s) => s !== helper)];
  const seen = new Set<string>();
  let scanned = 0;
  while (queue.length && scanned < MAX_SCRIPTS) {
    const batch = queue.splice(0, 5).filter((u) => !seen.has(u));
    batch.forEach((u) => seen.add(u));
    if (!batch.length) continue;
    const texts = await Promise.all(batch.map((u) => fetchText(u, 'application/javascript,*/*;q=0.1', 2_000_000)));
    for (let i = 0; i < batch.length; i++) {
      const text = texts[i];
      if (text === null || /^\s*</.test(text)) continue;
      scanned++;
      const hit = look(text, batch[i]);
      if (hit) {
        // A register("/sw.js") path in a bundle is relative to the page, not to the script.
        if (hit.url) {
          const m = text.match(REGISTER);
          if (m && !/^\.\.?\//.test(m[2])) hit.url = new URL(m[2], page.href).href;
        }
        return { ...hit, scanned };
      }
      for (const ref of scriptRefs(text, batch[i], page)) if (!seen.has(ref) && queue.length < 60) queue.push(ref);
    }
  }
  return { found: false, url: null, where: null, scanned };
}

// The biggest side from "192x192 512x512", or "any" for SVG icons (which scale to any size).
function maxSize(sizes: string, type: string, src: string): number {
  let max = 0;
  for (const s of sizes.toLowerCase().split(/\s+/)) {
    if (s === 'any') max = Math.max(max, 1024);
    const m = s.match(/^(\d+)x(\d+)$/);
    if (m) max = Math.max(max, Math.min(Number(m[1]), Number(m[2])));
  }
  if (!max && (/svg/i.test(type) || /\.svg(\?|$)/i.test(src))) max = 1024;
  return max;
}

function short(u: string): string {
  try {
    const x = new URL(u);
    return x.host + (x.pathname === '/' ? '' : x.pathname);
  } catch {
    return u;
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
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
