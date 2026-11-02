// PWA checker, browser side: turns what /api/pwa found into a complete manifest and an agent prompt.

export type Level = 'pass' | 'warn' | 'fail';
export type Check = { id: string; label: string; level: Level; detail: string; fix?: string; tool?: { href: string; name: string } };
export type Icon = { src: string; sizes: string; type: string; purpose: string; max: number; ok: boolean | null };
export type Result = {
  url: string;
  finalUrl: string;
  status: number;
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
    icon: string | null;
    maskable: string | null;
    themeColor: string | null;
    backgroundColor: string | null;
    display: string | null;
    startUrl: string | null;
  };
  serviceWorker: { found: boolean; url: string | null; where: string | null; scanned: number };
  checks: Check[];
  error?: string;
};

// The checks that stop Chrome from offering "Install app".
export const BLOCKERS = ['https', 'manifest', 'name', 'icons', 'start', 'display'];

export function host(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
}

// A readable app name from a page title like "Acme – Plan your week | Home".
export function nameFromTitle(title: string | null, fallback: string): string {
  const t = (title ?? '').split(/\s+[|·–—-]\s+|:\s+/)[0].trim();
  return t && t.length <= 45 ? t : fallback;
}

export function shortName(name: string): string {
  if (name.length <= 12) return name;
  const first = name.split(/\s+/)[0];
  return first.length <= 12 ? first : first.slice(0, 12);
}

const DISPLAYS = ['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay'];
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// The site's manifest with every missing or broken install field filled in. `added` names what changed.
export function buildManifest(r: Result): { manifest: Record<string, unknown>; added: string[]; newIcons: boolean } {
  const old = r.manifest ?? {};
  const added: string[] = [];
  const page = new URL(r.finalUrl);
  const name = str(old.name) ?? str(old.short_name) ?? nameFromTitle(r.title, host(r.finalUrl));
  if (!str(old.name)) added.push('name');
  let short = str(old.short_name);
  if (!short || short.length > 12) {
    short = shortName(name);
    added.push('short_name');
  }

  let start = str(old.start_url);
  let startOk = false;
  if (start) {
    try {
      startOk = new URL(start, r.manifestUrl ?? r.finalUrl).origin === page.origin;
    } catch {
      startOk = false;
    }
  }
  if (!startOk) {
    start = '/';
    added.push('start_url');
  }
  let display = str(old.display);
  if (!display || !DISPLAYS.includes(display)) {
    display = 'standalone';
    added.push('display');
  }
  let theme = str(old.theme_color);
  if (!theme) {
    theme = r.metaThemeColor ?? '#ffffff';
    added.push('theme_color');
  }
  let bg = str(old.background_color);
  if (!bg) {
    bg = '#ffffff';
    added.push('background_color');
  }

  const icons: Record<string, unknown>[] = Array.isArray(old.icons) ? (old.icons as Record<string, unknown>[]).filter((i) => i && typeof i === 'object') : [];
  const good = r.icons.filter((i) => i.ok !== false);
  const has = (n: number, purpose: string) => good.some((i) => i.max >= n && i.purpose.split(/\s+/).includes(purpose));
  const wanted: Record<string, string>[] = [];
  if (!has(192, 'any')) wanted.push({ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' });
  if (!has(512, 'any')) wanted.push({ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' });
  if (!has(192, 'maskable')) wanted.push({ src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' });
  // Drop listed icons that don't load, so the file doesn't keep pointing at missing files.
  const broken = new Set(r.icons.filter((i) => i.ok === false).map((i) => i.src));
  const kept = icons.filter((i) => {
    try {
      return !broken.has(new URL(String(i.src), r.manifestUrl ?? r.finalUrl).href);
    } catch {
      return false;
    }
  });
  if (wanted.length) added.push(`${wanted.length} icon${wanted.length === 1 ? '' : 's'}`);

  const rest = { ...old };
  for (const k of ['name', 'short_name', 'description', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'icons']) delete rest[k];
  if (rest.prefer_related_applications === true) {
    delete rest.prefer_related_applications;
    delete rest.related_applications;
    added.push('removed prefer_related_applications');
  }

  const description = str(old.description) ?? r.description ?? undefined;
  const manifest: Record<string, unknown> = {
    name,
    short_name: short,
    ...(description ? { description } : {}),
    start_url: start,
    ...(str(old.scope) ? { scope: str(old.scope) } : {}),
    display,
    background_color: bg,
    theme_color: theme,
    icons: [...kept, ...wanted],
    ...rest,
  };
  return { manifest, added, newIcons: wanted.length > 0 };
}

// The lines the page head needs. Paths are what the generated manifest assumes.
export function headTags(r: Result, theme: string): string {
  const lines = ['<link rel="manifest" href="/manifest.webmanifest">', `<meta name="theme-color" content="${theme.replace(/"/g, '')}">`];
  if (!r.appleTouchIcon) lines.push('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
  return lines.join('\n');
}

export function agentPrompt(r: Result, manifest: Record<string, unknown>, newIcons: boolean): string {
  const todo = r.checks.filter((c) => c.level !== 'pass');
  const name = host(r.finalUrl);
  const lines = [`Make my site ${name} installable as an app (a PWA that people can add to their phone’s home screen). A PWA check found:`, ''];
  todo.forEach((c, i) => lines.push(`${i + 1}. ${c.label}. ${c.detail}${c.fix ? ` Fix: ${c.fix}` : ''}`));
  lines.push(
    '',
    `Use this web app manifest. Put it in the folder this project serves as-is (usually public/) as manifest.webmanifest${r.manifestUrl ? `, replacing the current one at ${new URL(r.manifestUrl).pathname}` : ''}:`,
    '',
    '```json',
    JSON.stringify(manifest, null, 2),
    '```',
    '',
    'Make sure every page’s <head> has:',
    '',
    '```html',
    headTags(r, String(manifest.theme_color ?? '#ffffff')),
    '```',
  );
  if (newIcons || !r.appleTouchIcon) {
    const files = [
      ...(newIcons ? [`the new icons listed in the manifest (${(manifest.icons as { src?: string }[]).filter((i) => String(i.src).startsWith('/icons/icon-')).map((i) => i.src).join(', ')}; a maskable icon keeps the logo inside the middle 80% on a solid background)`] : []),
      ...(!r.appleTouchIcon ? ['a 180×180 /apple-touch-icon.png'] : []),
    ];
    lines.push('', `Create ${files.join(', and ')} from my existing logo. If there’s no logo in the project, ask me for one rather than inventing it.`);
  }
  if (!r.serviceWorker.found) {
    lines.push('', 'Add a service worker the way that fits this project (vite-plugin-pwa for Vite, Serwist for Next.js, or a small public/sw.js registered from the main script). Keep it simple: cache the app shell, use the network first for pages, and show a friendly offline page. Only register it in production builds.');
  }
  lines.push('', 'Don’t change anything else, and tell me about any step I have to do myself, like a setting at my host.');
  return lines.join('\n');
}
