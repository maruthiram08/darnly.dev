import { isLocalPage } from '@/lib/fix-watch';

/** A project name as the cloud stores it: lowercase letters, digits, dots, dashes and underscores. */
export function cleanProjectName(v: string): string {
  return v.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/**
 * A good first guess at which project a page belongs to, so the user never has to type one:
 * the site's name for live sites (www.counterdraft.com -> counterdraft), the page title on localhost.
 */
export function suggestProjectName(url: string | undefined, title?: string): string {
  let u: URL | null = null;
  try {
    u = url ? new URL(url) : null;
  } catch {
    u = null;
  }
  if (u && !isLocalPage(url)) {
    const parts = u.hostname.replace(/^www\./, '').split('.').filter(Boolean);
    if (parts.length >= 3 && parts[parts.length - 1]!.length <= 3 && parts[parts.length - 2]!.length <= 3) return cleanProjectName(parts[parts.length - 3]!);
    const name = cleanProjectName(parts.length >= 2 ? parts[parts.length - 2]! : parts[0] ?? '');
    if (name) return name;
  }
  const fromTitle = cleanProjectName((title ?? '').split(/\s[-–—|·:]\s|[|·]/)[0] ?? '');
  if (fromTitle) return fromTitle;
  return u?.port ? `localhost-${u.port}` : 'my-app';
}

/** The name the user's cloud bugs from this site go under: saved once, renamable in the panel. */
export async function cloudProjectName(origin: string | null, url?: string, title?: string): Promise<string> {
  const saved = origin ? ((await chrome.storage.local.get('siteProject').catch(() => ({}))) as { siteProject?: Record<string, string> }).siteProject?.[origin] : undefined;
  return saved || suggestProjectName(url ?? origin ?? undefined, title);
}

export async function saveCloudProjectName(origin: string | null, name: string): Promise<string> {
  const clean = cleanProjectName(name);
  if (!origin || !clean) return clean;
  const r = (await chrome.storage.local.get('siteProject').catch(() => ({}))) as { siteProject?: Record<string, string> };
  await chrome.storage.local.set({ siteProject: { ...(r.siteProject ?? {}), [origin]: clean } }).catch(() => {});
  return clean;
}
