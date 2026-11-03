/**
 * After Chrome updates Darnly, open the release notes once, at the new version's section.
 * Chrome tells the background script itself (runtime.onInstalled, reason "update"), so no package or server is needed.
 */
export const CHANGELOG_URL = 'https://darnly.dev/changelog/';

function parts(v: string): number[] {
  return v.split('.').map((n) => Number.parseInt(n, 10) || 0);
}

/** True when `a` is a later version than `b`. */
export function isNewer(a: string, b: string): boolean {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/**
 * The page to open after an update, or null when there is nothing to show:
 * a fresh install, a reload of the same version while developing, a downgrade, or a Chrome update.
 */
export function whatsNewUrl(reason: string, previous: string | undefined, current: string): string | null {
  if (reason !== 'update' || !previous || !isNewer(current, previous)) return null;
  return `${CHANGELOG_URL}#v${current.replace(/\./g, '-')}`;
}
