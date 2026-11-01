import type { Env } from './env';
import { HttpError, clip, newId } from './util';
import { CAPS, countUpload, deleteOldUsage } from './limits';

export const LIMITS = {
  pictureBytes: 5 * 1024 * 1024,
  reportBytes: 200 * 1024,
  logsBytes: 1024 * 1024,
  perHour: 120,
  waiting: 500,
  fixedNote: 500,
  keepFixedDays: 30,
};

export interface BugSummary {
  id: string;
  title: string;
  pageUrl: string;
  site: string;
  status: 'waiting' | 'fixed';
  fixedNote: string | null;
  hasLogs: boolean;
  createdAt: number;
  fixedAt: number | null;
}

interface BugRow {
  id: string;
  title: string;
  page_url: string;
  site: string;
  status: 'waiting' | 'fixed';
  fixed_note: string | null;
  has_logs: number;
  files_prefix: string;
  created_at: number;
  fixed_at: number | null;
}

const COLUMNS = 'id, title, page_url, site, status, fixed_note, has_logs, files_prefix, created_at, fixed_at';

function summary(row: BugRow): BugSummary {
  return {
    id: row.id,
    title: row.title,
    pageUrl: row.page_url,
    site: row.site,
    status: row.status,
    fixedNote: row.fixed_note,
    hasLogs: row.has_logs === 1,
    createdAt: row.created_at,
    fixedAt: row.fixed_at,
  };
}

function siteOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).host || 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface NewBug {
  title: string;
  pageUrl: string;
  report: string;
  /** Missing when the browser couldn't take a screenshot (for example on a protected page). */
  picture?: ArrayBuffer;
  logs?: string;
  /** Random id the extension makes once per capture, so a repeated upload isn't saved twice. */
  clientId?: string;
}

/** Reads the multipart upload from the extension: meta (JSON), report (markdown), picture (PNG), logs (JSON, optional). */
export async function parseUpload(req: Request): Promise<NewBug> {
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > LIMITS.pictureBytes + LIMITS.reportBytes + LIMITS.logsBytes + 64_000) throw new HttpError(413, 'too_large');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'bad_form');
  }
  const meta = form.get('meta');
  const report = form.get('report');
  const picture = form.get('picture');
  const logs = form.get('logs');
  if (typeof meta !== 'string' || !(report instanceof File || typeof report === 'string') || (picture != null && !(picture instanceof File))) {
    throw new HttpError(400, 'missing_parts');
  }
  let parsed: { title?: unknown; pageUrl?: unknown; clientId?: unknown };
  try {
    parsed = JSON.parse(meta);
  } catch {
    throw new HttpError(400, 'bad_meta');
  }
  const reportText = typeof report === 'string' ? report : await report.text();
  if (reportText.length > LIMITS.reportBytes) throw new HttpError(413, 'report_too_large');
  let bytes: ArrayBuffer | undefined;
  if (picture instanceof File) {
    if (picture.size > LIMITS.pictureBytes) throw new HttpError(413, 'picture_too_large');
    bytes = await picture.arrayBuffer();
    const head = new Uint8Array(bytes.slice(0, 8));
    const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    if (!isPng) throw new HttpError(415, 'picture_not_png');
  }
  let logsText: string | undefined;
  if (logs != null) {
    logsText = typeof logs === 'string' ? logs : await logs.text();
    if (logsText.length > LIMITS.logsBytes) throw new HttpError(413, 'logs_too_large');
  }
  const pageUrl = clip(parsed.pageUrl, 2000);
  return {
    title: clip(parsed.title, 300) || 'Bug',
    pageUrl,
    report: reportText,
    picture: bytes,
    logs: logsText,
    clientId: typeof parsed.clientId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(parsed.clientId) ? parsed.clientId : undefined,
  };
}

async function bugByClientId(env: Env, userId: string, clientId: string): Promise<BugRow | null> {
  return env.DB.prepare(`SELECT ${COLUMNS} FROM bugs WHERE user_id = ? AND client_id = ?`).bind(userId, clientId).first<BugRow>();
}

export async function saveBug(env: Env, userId: string, bug: NewBug): Promise<BugSummary> {
  if (bug.clientId) {
    const seen = await bugByClientId(env, userId, bug.clientId);
    if (seen) return summary(seen);
  }
  const now = Date.now();
  const bytes = bug.report.length + (bug.picture?.byteLength ?? 0) + (bug.logs?.length ?? 0);
  const counts = await env.DB.prepare(
    "SELECT SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS hour, SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting, SUM(bytes) AS stored FROM bugs WHERE user_id = ?",
  )
    .bind(now - 3_600_000, userId)
    .first<{ hour: number | null; waiting: number | null; stored: number | null }>();
  if ((counts?.hour ?? 0) >= LIMITS.perHour) throw new HttpError(429, 'too_many_this_hour');
  if ((counts?.waiting ?? 0) >= LIMITS.waiting) throw new HttpError(429, 'inbox_full');
  if ((counts?.stored ?? 0) + bytes > CAPS.userStoredBytes) throw new HttpError(429, 'storage_full');
  // Daily counters live in their own table, so deleting bugs doesn't reset them.
  await countUpload(env, userId, bytes, now);

  const id = newId('b');
  const prefix = `u/${userId}/${id}/`;
  await Promise.all([
    env.FILES.put(prefix + 'report.md', bug.report, { httpMetadata: { contentType: 'text/markdown; charset=utf-8' } }),
    bug.picture ? env.FILES.put(prefix + 'picture.png', bug.picture, { httpMetadata: { contentType: 'image/png' } }) : null,
    bug.logs ? env.FILES.put(prefix + 'logs.json', bug.logs, { httpMetadata: { contentType: 'application/json' } }) : null,
  ]);
  const row: BugRow = {
    id,
    title: bug.title,
    page_url: bug.pageUrl,
    site: siteOf(bug.pageUrl),
    status: 'waiting',
    fixed_note: null,
    has_logs: bug.logs ? 1 : 0,
    files_prefix: prefix,
    created_at: now,
    fixed_at: null,
  };
  try {
    await env.DB.prepare(
      `INSERT INTO bugs (${COLUMNS}, user_id, client_id, bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(row.id, row.title, row.page_url, row.site, row.status, row.fixed_note, row.has_logs, row.files_prefix, row.created_at, row.fixed_at, userId, bug.clientId ?? null, bytes)
      .run();
  } catch (e) {
    // Two copies of the same capture arrived at once: keep the first, drop this one's files.
    const seen = bug.clientId ? await bugByClientId(env, userId, bug.clientId) : null;
    if (!seen) throw e;
    await env.FILES.delete([prefix + 'report.md', prefix + 'picture.png', prefix + 'logs.json']);
    return summary(seen);
  }
  return summary(row);
}

export async function listBugs(env: Env, userId: string, status: 'waiting' | 'fixed' | 'all' = 'all', limit = 100): Promise<BugSummary[]> {
  const n = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 100;
  const stmt =
    status === 'all'
      ? env.DB.prepare(`SELECT ${COLUMNS} FROM bugs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).bind(userId, n)
      : env.DB.prepare(`SELECT ${COLUMNS} FROM bugs WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?`).bind(userId, status, n);
  const { results } = await stmt.all<BugRow>();
  return results.map(summary);
}

/** Finds a bug that belongs to this user. Someone else's bug looks the same as a missing one. */
async function ownBug(env: Env, userId: string, bugId: string): Promise<BugRow> {
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM bugs WHERE id = ? AND user_id = ?`).bind(bugId, userId).first<BugRow>();
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}

export async function getBug(env: Env, userId: string, bugId: string): Promise<BugSummary & { report: string; logs: string | null }> {
  const row = await ownBug(env, userId, bugId);
  const [report, logs] = await Promise.all([
    env.FILES.get(row.files_prefix + 'report.md'),
    row.has_logs ? env.FILES.get(row.files_prefix + 'logs.json') : null,
  ]);
  return { ...summary(row), report: report ? await report.text() : '', logs: logs ? await logs.text() : null };
}

export async function getPicture(env: Env, userId: string, bugId: string): Promise<ArrayBuffer> {
  const row = await ownBug(env, userId, bugId);
  const obj = await env.FILES.get(row.files_prefix + 'picture.png');
  if (!obj) throw new HttpError(404, 'not_found');
  return obj.arrayBuffer();
}

export async function markFixed(env: Env, userId: string, bugId: string, note: unknown): Promise<BugSummary> {
  const row = await ownBug(env, userId, bugId);
  const fixedNote = clip(note, LIMITS.fixedNote) || null;
  const now = Date.now();
  await env.DB.prepare("UPDATE bugs SET status = 'fixed', fixed_note = ?, fixed_at = ? WHERE id = ? AND user_id = ?")
    .bind(fixedNote, now, bugId, userId)
    .run();
  return summary({ ...row, status: 'fixed', fixed_note: fixedNote, fixed_at: now });
}

async function deleteRows(env: Env, rows: { id: string; files_prefix: string }[]): Promise<void> {
  if (!rows.length) return;
  const keys = rows.flatMap((r) => ['report.md', 'picture.png', 'logs.json'].map((f) => r.files_prefix + f));
  for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000));
  for (let i = 0; i < rows.length; i += 50) {
    const ids = rows.slice(i, i + 50).map((r) => r.id);
    await env.DB.prepare(`DELETE FROM bugs WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).run();
  }
}

export async function deleteAllBugs(env: Env, userId: string): Promise<number> {
  const { results } = await env.DB.prepare('SELECT id, files_prefix FROM bugs WHERE user_id = ?').bind(userId).all<{ id: string; files_prefix: string }>();
  await deleteRows(env, results);
  return results.length;
}

export async function deleteAccount(env: Env, userId: string): Promise<void> {
  await deleteAllBugs(env, userId);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
}

/** Daily job: fixed bugs are kept for 30 days, then deleted with their files. Runs in batches until none are left (or 20 batches). */
export async function cleanup(env: Env, now = Date.now()): Promise<number> {
  const cutoff = now - LIMITS.keepFixedDays * 86_400_000;
  let total = 0;
  for (let batch = 0; batch < 20; batch++) {
    const { results } = await env.DB.prepare("SELECT id, files_prefix FROM bugs WHERE status = 'fixed' AND fixed_at < ? LIMIT 1000")
      .bind(cutoff)
      .all<{ id: string; files_prefix: string }>();
    await deleteRows(env, results);
    total += results.length;
    if (results.length < 1000) break;
  }
  await deleteOldUsage(env, now);
  return total;
}
