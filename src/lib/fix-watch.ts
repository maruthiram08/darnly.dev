import type { CaptureSummary } from '@/lib/project-folder';

/** What the panel last saw in one inbox (a project folder or the cloud), kept across panel opens. */
export interface SeenState {
  /** When the panel last looked (ms). */
  at: number;
  status: Record<string, 'waiting' | 'fixed'>;
}

/**
 * Bugs fixed since the panel last looked: ones it saw waiting that are now fixed,
 * plus ones it never saw (say, captured by the Mac app) that were fixed after it last looked.
 * With no saved state (first run), nothing counts, so old fixes don't flood the panel.
 */
export function fixedSince(before: SeenState | null, list: CaptureSummary[]): CaptureSummary[] {
  if (!before) return [];
  return list.filter((c) => {
    if (c.status !== 'fixed') return false;
    const was = before.status[c.id];
    return was === 'waiting' || (was === undefined && c.modified > before.at);
  });
}

export function seenFrom(list: CaptureSummary[], at = Date.now()): SeenState {
  return { at, status: Object.fromEntries(list.map((c) => [c.id, c.status])) };
}

/** Adds newly fixed bugs to the top of the "take a look" list, without repeats. */
export function mergeFixed(prev: CaptureSummary[], fixedNow: CaptureSummary[]): CaptureSummary[] {
  if (!fixedNow.length) return prev;
  return [...fixedNow, ...prev.filter((p) => !fixedNow.some((n) => n.id === p.id))].slice(0, 20);
}

const FIXED_KEY = 'justFixed';
// One key per inbox, so the folder and cloud checks never overwrite each other.
const seenKey = (inbox: string) => `seen:${inbox}`;

export async function loadSeen(inbox: string): Promise<SeenState | null> {
  try {
    const r = await chrome.storage.local.get(seenKey(inbox));
    return (r[seenKey(inbox)] as SeenState | undefined) ?? null;
  } catch {
    return null;
  }
}

export function saveSeen(inbox: string, state: SeenState): void {
  // The nudge is a nicety; never block the panel on it.
  chrome.storage.local.set({ [seenKey(inbox)]: state }).catch(() => {});
}

/**
 * Compares the inbox with what the panel saw last time (even in an earlier session),
 * remembers what it sees now, and returns the bugs fixed in between.
 */
export async function checkFixes(inbox: string, list: CaptureSummary[]): Promise<CaptureSummary[]> {
  const fixedNow = fixedSince(await loadSeen(inbox), list);
  saveSeen(inbox, seenFrom(list));
  return fixedNow;
}

/** The "take a look" card survives closing the panel until the user presses Done. */
export async function loadJustFixed(): Promise<CaptureSummary[]> {
  try {
    const r = await chrome.storage.local.get(FIXED_KEY);
    return Array.isArray(r[FIXED_KEY]) ? r[FIXED_KEY] : [];
  } catch {
    return [];
  }
}

export function saveJustFixed(list: CaptureSummary[]): void {
  chrome.storage.local.set({ [FIXED_KEY]: list }).catch(() => {});
}
