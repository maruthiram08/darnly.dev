/**
 * The number on the Darnly toolbar icon: bugs still waiting for a fix, across the user's inboxes
 * (each linked project folder, and the cloud inbox when signed in).
 *
 * Whoever looks at an inbox (the panel, the hidden keepalive page, the background) reports its
 * waiting count here. The background keeps one count per inbox and sets the icon's badge.
 */

export interface InboxCount {
  /** Bugs waiting in this inbox. */
  n: number;
  /** When it was counted (ms). */
  at: number;
}
export type OpenCounts = Record<string, InboxCount>;

/** An inbox nobody has looked at for this long stops counting, so an old, forgotten project can't leave a number up forever. */
export const STALE_AFTER = 14 * 24 * 60 * 60_000;
export const COUNTS_KEY = 'openCounts';

export function waitingCount(list: { status: 'waiting' | 'fixed' }[]): number {
  return list.filter((c) => c.status === 'waiting').length;
}

export function totalOpen(counts: OpenCounts, { now = Date.now(), signedIn = true } = {}): number {
  let total = 0;
  for (const [inbox, c] of Object.entries(counts)) {
    if (!c || typeof c.n !== 'number' || c.n <= 0) continue;
    if (now - c.at > STALE_AFTER) continue;
    if (inbox.startsWith('cloud:') && !signedIn) continue;
    total += Math.floor(c.n);
  }
  return total;
}

/** What the badge shows: nothing at zero, and "99+" past 99 (the badge has room for about four characters). */
export function badgeText(total: number): string {
  if (!(total > 0)) return '';
  return total > 99 ? '99+' : String(total);
}

export function badgeTitle(total: number, name: string): string {
  if (!(total > 0)) return `Open ${name}`;
  return `Open ${name}: ${total} ${total === 1 ? 'bug is' : 'bugs are'} waiting for a fix`;
}

/** Tells the background how many bugs wait in one inbox. Never throws: the badge is a nicety. */
export function reportOpen(inbox: string, list: { status: 'waiting' | 'fixed' }[]): void {
  try {
    chrome.runtime.sendMessage({ type: 'open-count', inbox, n: waitingCount(list) }).catch(() => {});
  } catch {
    /* no background to tell */
  }
}
