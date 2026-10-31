import { redactText, redactUrl } from './redact';

/** One console error, page error or failed request, from the page recorder or the background. */
export interface LogEntry {
  t: number;
  kind: 'console' | 'error' | 'rejection' | 'request';
  level?: 'error' | 'warn';
  message?: string;
  stack?: string;
  method?: string;
  url?: string;
  status?: number;
  ms?: number;
  snippet?: string;
  /** 'page' = seen by the page recorder, 'browser' = only the browser saw it (blocked image, CORS). */
  source?: 'page' | 'browser';
  resourceType?: string;
  /** Read from the browser's request history (any site, no recorder); the HTTP method isn't known. */
  fromHistory?: boolean;
}

/** Page-supplied entries can hold anything, so keep only short strings and plain numbers. */
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function redactLog(e: LogEntry): LogEntry {
  const message = str(e.message, 1000);
  const stack = str(e.stack, 2000);
  const url = str(e.url, 1000);
  const snippet = str(e.snippet, 300);
  return {
    t: num(e.t) ?? Date.now(),
    kind: (['console', 'error', 'rejection', 'request'] as const).includes(e.kind) ? e.kind : 'error',
    ...((e.level === 'error' || e.level === 'warn') && { level: e.level }),
    ...(str(e.method, 10) && { method: str(e.method, 10) }),
    ...(num(e.status) !== undefined && { status: num(e.status) }),
    ...(num(e.ms) !== undefined && { ms: num(e.ms) }),
    ...(str(e.resourceType, 30) && { resourceType: str(e.resourceType, 30) }),
    ...((e.source === 'page' || e.source === 'browser') && { source: e.source }),
    ...(e.fromHistory === true && { fromHistory: true }),
    ...(message && { message: redactText(message) }),
    ...(stack && { stack: redactText(stack) }),
    ...(url && { url: redactUrl(url) }),
    ...(snippet && { snippet: redactText(snippet) }),
  } as LogEntry;
}

/** Keeps the last 60 seconds, drops duplicates of the same failed request seen by both page and browser. */
export function mergeLogs(page: LogEntry[], browser: LogEntry[], now = Date.now()): LogEntry[] {
  const cutoff = now - 60_000;
  const sig = (e: LogEntry) => `${e.url} ${e.status}`;
  const seen = new Set(page.filter((e) => e.kind === 'request').map(sig));
  const extra = browser.filter((e) => !seen.has(sig(e)) && (seen.add(sig(e)), true));
  return [...page.map((e) => ({ ...e, source: 'page' as const })), ...extra.map((e) => ({ ...e, source: 'browser' as const }))]
    // Request history covers the whole page visit, not just the last minute.
    .filter((e) => e.t >= cutoff || e.fromHistory)
    .sort((a, b) => a.t - b.t);
}

function short(url = ''): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

export function errorLines(logs: LogEntry[], max = 10): string[] {
  return logs
    .filter((e) => e.kind !== 'request')
    .slice(-max)
    .map((e) => {
      const where = e.stack?.split('\n').find((l) => /\.(t|j)sx?:\d+/.test(l))?.trim();
      const lead = e.kind === 'console' ? `console.${e.level}` : e.kind === 'rejection' ? 'unhandled rejection' : 'uncaught error';
      return `- ${lead}: ${(e.message ?? '').split('\n')[0]?.slice(0, 300)}${where ? ` (${where.replace(/^at\s+/, '')})` : ''}`;
    });
}

export function requestLines(logs: LogEntry[], max = 10): string[] {
  return logs
    .filter((e) => e.kind === 'request')
    .slice(-max)
    .map((e) => {
      const status = e.status ? String(e.status) : `failed${e.message ? ` (${e.message})` : ''}`;
      const snippet = e.snippet ? ` — ${e.snippet.replace(/\s+/g, ' ').slice(0, 120)}` : '';
      const type = e.resourceType && e.resourceType !== 'xmlhttprequest' ? ` [${e.resourceType}]` : '';
      return `- ${e.method ? `${e.method} ` : ''}${short(e.url)} ${status}${e.ms != null ? ` (${e.ms} ms)` : ''}${type}${snippet}`;
    });
}
