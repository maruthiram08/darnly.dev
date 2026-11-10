import type { Env } from './env';
import { HttpError, clip, newId, newToken, readBytes, sha256 } from './util';
import { CAPS, countUpload, deleteOldUsage } from './limits';

export const LIMITS = {
  pictureBytes: 5 * 1024 * 1024,
  reportBytes: 200 * 1024,
  logsBytes: 1024 * 1024,
  perHour: 120,
  waiting: 500,
  fixedNote: 500,
  question: 500,
  /** The agent's screenshot of the fixed page. */
  afterBytes: 3 * 1024 * 1024,
  /** How long the upload link from mark_fixed works. */
  afterLinkSeconds: 15 * 60,
  keepFixedDays: 30,
};

export interface BugSummary {
  id: string;
  /** The AI title when there is one (titles.ts), otherwise the first line of the user's note. */
  title: string;
  /** The first line of the user's own note, as they typed it. */
  noteTitle: string;
  /** One sentence Claude wrote about the bug (null when AI titles are off or not written yet). */
  aiSummary: string | null;
  pageUrl: string;
  site: string;
  status: 'waiting' | 'fixed';
  /** How a closed bug was closed: fixed, or won't fix (the reason is in fixedNote). Null while waiting. */
  outcome: 'fixed' | 'wont_fix' | null;
  /** The agent's note when fixed, or its reason when it closed the bug without a fix. */
  fixedNote: string | null;
  /** True when the agent uploaded a screenshot of the fixed page (GET /v1/bugs/:id/after). */
  hasAfter: boolean;
  hasLogs: boolean;
  createdAt: number;
  fixedAt: number | null;
  /** The agent working on it right now, if any (claims expire after CLAIM_TTL). */
  claimedBy: string | null;
  claimedName: string | null;
  claimedAt: number | null;
  /** What the agent asked the user and is waiting on (questions go stale after QUESTION_TTL). */
  question: string | null;
  /** The project name from the Darnly panel (null on older bugs). */
  project: string | null;
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
  claimed_by: string | null;
  claimed_name: string | null;
  claimed_at: number | null;
  question: string | null;
  question_at: number | null;
  project: string | null;
  ai_title: string | null;
  ai_summary: string | null;
  outcome: string | null;
  after_at: number | null;
}

const COLUMNS = 'id, title, page_url, site, status, fixed_note, has_logs, files_prefix, created_at, fixed_at, claimed_by, claimed_name, claimed_at, question, question_at, project, ai_title, ai_summary, outcome, after_at';

const INSERT_COLUMNS = 'id, title, page_url, site, status, fixed_note, has_logs, files_prefix, created_at, fixed_at, project';

/** How long an agent's claim on a bug lasts without being renewed. */
export const CLAIM_TTL = 20 * 60 * 1000;

/** After this long an unanswered question stops showing in the panel (the agent's chat has likely moved on). */
export const QUESTION_TTL = 24 * 60 * 60 * 1000;

/** A claim that still counts: on a waiting bug and not expired. */
function liveClaim(row: BugRow, now = Date.now()): boolean {
  return row.status === 'waiting' && !!row.claimed_by && !!row.claimed_at && now - row.claimed_at < CLAIM_TTL;
}

function summary(row: BugRow): BugSummary {
  return {
    id: row.id,
    title: row.ai_title || row.title,
    noteTitle: row.title,
    aiSummary: row.ai_title ? row.ai_summary : null,
    pageUrl: row.page_url,
    site: row.site,
    status: row.status,
    outcome: row.status === 'fixed' ? (row.outcome === 'wont_fix' ? 'wont_fix' : 'fixed') : null,
    fixedNote: row.fixed_note,
    hasAfter: row.status === 'fixed' && !!row.after_at,
    hasLogs: row.has_logs === 1,
    createdAt: row.created_at,
    fixedAt: row.fixed_at,
    claimedBy: liveClaim(row) ? row.claimed_by : null,
    claimedName: liveClaim(row) ? row.claimed_name : null,
    claimedAt: liveClaim(row) ? row.claimed_at : null,
    project: row.project ?? null,
    question: row.status === 'waiting' && row.question && row.question_at && Date.now() - row.question_at < QUESTION_TTL ? row.question : null,
  };
}

/** Bugs from the Mac app carry `macos://<app name>` instead of a web address. */
export function siteOf(pageUrl: string): string {
  const mac = /^macos:\/\/([^/?#]{1,200})/.exec(pageUrl);
  if (mac) {
    try {
      return `${decodeURIComponent(mac[1]!).slice(0, 80)} (Mac app)`;
    } catch {
      return 'Mac app';
    }
  }
  try {
    return new URL(pageUrl).host || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Every file a bug can have in R2, so deleting a bug removes them all. */
const FILE_NAMES = ['report.md', 'picture.png', 'reference.png', 'steps.jpg', 'logs.json', 'after.png'];

export interface NewBug {
  title: string;
  pageUrl: string;
  report: string;
  /** Missing when the browser couldn't take a screenshot (for example on a protected page). */
  picture?: ArrayBuffer;
  /** A picture the user added of what it should look like (optional). */
  reference?: ArrayBuffer;
  /** The steps the user recorded, as one JPEG of numbered screenshots (optional). */
  steps?: ArrayBuffer;
  logs?: string;
  /** Random id the extension makes once per capture, so a repeated upload isn't saved twice. */
  clientId?: string;
  /** The project name from the Darnly panel. */
  project?: string;
}

async function readPng(part: File, tooLarge: string): Promise<ArrayBuffer> {
  if (part.size > LIMITS.pictureBytes) throw new HttpError(413, tooLarge);
  const bytes = await part.arrayBuffer();
  const head = new Uint8Array(bytes.slice(0, 8));
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  if (!isPng) throw new HttpError(415, 'picture_not_png');
  return bytes;
}

async function readJpeg(part: File): Promise<ArrayBuffer> {
  if (part.size > LIMITS.pictureBytes) throw new HttpError(413, 'steps_too_large');
  const bytes = await part.arrayBuffer();
  const head = new Uint8Array(bytes.slice(0, 3));
  if (!(head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)) throw new HttpError(415, 'steps_not_jpeg');
  return bytes;
}

/** Reads the multipart upload from the extension: meta (JSON), report (markdown), picture (PNG), reference (PNG, optional), steps (JPEG, optional), logs (JSON, optional). */
export async function parseUpload(req: Request): Promise<NewBug> {
  // Without a declared size the body would be read before any limit applies; the extension always sends one.
  const declared = req.headers.get('content-length');
  if (declared == null || !/^\d+$/.test(declared)) throw new HttpError(411, 'length_required');
  const length = Number(declared);
  if (length > 3 * LIMITS.pictureBytes + LIMITS.reportBytes + LIMITS.logsBytes + 64_000) throw new HttpError(413, 'too_large');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'bad_form');
  }
  const meta = form.get('meta');
  const report = form.get('report');
  const picture = form.get('picture');
  const reference = form.get('reference');
  const steps = form.get('steps');
  const logs = form.get('logs');
  if (
    typeof meta !== 'string' ||
    !(report instanceof File || typeof report === 'string') ||
    (picture != null && !(picture instanceof File)) ||
    (reference != null && !(reference instanceof File)) ||
    (steps != null && !(steps instanceof File))
  ) {
    throw new HttpError(400, 'missing_parts');
  }
  let parsed: { title?: unknown; pageUrl?: unknown; clientId?: unknown; project?: unknown };
  try {
    parsed = JSON.parse(meta);
  } catch {
    throw new HttpError(400, 'bad_meta');
  }
  const reportText = typeof report === 'string' ? report : await report.text();
  if (reportText.length > LIMITS.reportBytes) throw new HttpError(413, 'report_too_large');
  const bytes = picture instanceof File ? await readPng(picture, 'picture_too_large') : undefined;
  const referenceBytes = reference instanceof File ? await readPng(reference, 'reference_too_large') : undefined;
  const stepsBytes = steps instanceof File ? await readJpeg(steps) : undefined;
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
    reference: referenceBytes,
    steps: stepsBytes,
    logs: logsText,
    project: projectName(parsed.project),
    clientId: typeof parsed.clientId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(parsed.clientId) ? parsed.clientId : undefined,
  };
}

async function bugByClientId(env: Env, userId: string, clientId: string): Promise<BugRow | null> {
  return env.DB.prepare(`SELECT ${COLUMNS} FROM bugs WHERE user_id = ? AND client_id = ?`).bind(userId, clientId).first<BugRow>();
}

export async function saveBug(env: Env, userId: string, bug: NewBug): Promise<BugSummary> {
  return (await saveNewBug(env, userId, bug)).bug;
}

/** Saves a bug. isNew is false when this capture was already saved (a repeated upload). */
export async function saveNewBug(env: Env, userId: string, bug: NewBug): Promise<{ bug: BugSummary; isNew: boolean }> {
  if (bug.clientId) {
    const seen = await bugByClientId(env, userId, bug.clientId);
    if (seen) return { bug: summary(seen), isNew: false };
  }
  const now = Date.now();
  const bytes = bug.report.length + (bug.picture?.byteLength ?? 0) + (bug.reference?.byteLength ?? 0) + (bug.steps?.byteLength ?? 0) + (bug.logs?.length ?? 0);
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
    bug.reference ? env.FILES.put(prefix + 'reference.png', bug.reference, { httpMetadata: { contentType: 'image/png' } }) : null,
    bug.steps ? env.FILES.put(prefix + 'steps.jpg', bug.steps, { httpMetadata: { contentType: 'image/jpeg' } }) : null,
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
    claimed_by: null,
    claimed_name: null,
    claimed_at: null,
    question: null,
    question_at: null,
    project: bug.project ?? null,
    ai_title: null,
    ai_summary: null,
    outcome: null,
    after_at: null,
  };
  try {
    await env.DB.prepare(
      `INSERT INTO bugs (${INSERT_COLUMNS}, user_id, client_id, bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(row.id, row.title, row.page_url, row.site, row.status, row.fixed_note, row.has_logs, row.files_prefix, row.created_at, row.fixed_at, row.project, userId, bug.clientId ?? null, bytes)
      .run();
  } catch (e) {
    // Two copies of the same capture arrived at once: keep the first, drop this one's files.
    const seen = bug.clientId ? await bugByClientId(env, userId, bug.clientId) : null;
    if (!seen) throw e;
    await env.FILES.delete(FILE_NAMES.map((f) => prefix + f));
    return { bug: summary(seen), isNew: false };
  }
  return { bug: summary(row), isNew: true };
}

/** A project name as the panel saves it: lowercase letters, digits, dots, dashes and underscores. */
export function projectName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const n = v.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return n || undefined;
}

/** Which bugs to list: waiting, fixed, won't fix, closed (fixed or won't fix), or all. */
export type ListStatus = 'waiting' | 'fixed' | 'wont_fix' | 'closed' | 'all';

export function listStatus(v: unknown, fallback: ListStatus): ListStatus {
  return v === 'waiting' || v === 'fixed' || v === 'wont_fix' || v === 'closed' || v === 'all' ? v : fallback;
}

/**
 * The user's bugs, newest first. With a project, only that project's bugs, plus older bugs saved before
 * projects had names whose site contains the name (so "counterdraft" still finds www.counterdraft.com bugs).
 */
export async function listBugs(
  env: Env,
  userId: string,
  status: ListStatus = 'all',
  limit = 100,
  project?: string,
): Promise<BugSummary[]> {
  const n = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 100;
  const where = ['user_id = ?'];
  const args: unknown[] = [userId];
  if (status === 'waiting') where.push("status = 'waiting'");
  else if (status === 'closed') where.push("status = 'fixed'");
  else if (status === 'fixed') where.push("status = 'fixed' AND (outcome IS NULL OR outcome = 'fixed')");
  else if (status === 'wont_fix') where.push("status = 'fixed' AND outcome = 'wont_fix'");
  const p = projectName(project);
  if (p) {
    where.push("(project = ? OR (project IS NULL AND site LIKE ? ESCAPE '\\'))");
    args.push(p, `%${p.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
  }
  const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM bugs WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .bind(...args, n)
    .all<BugRow>();
  return results.map(summary);
}

/** The project names the user has bugs under, so an agent can tell which one is its own. */
export async function listProjects(env: Env, userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT DISTINCT project FROM bugs WHERE user_id = ? AND project IS NOT NULL AND status = 'waiting' ORDER BY project")
    .bind(userId)
    .all<{ project: string }>();
  return results.map((r) => r.project);
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

/** The picture of what it should look like, if the user added one. */
export async function getReference(env: Env, userId: string, bugId: string): Promise<ArrayBuffer | null> {
  const row = await ownBug(env, userId, bugId);
  const obj = await env.FILES.get(row.files_prefix + 'reference.png');
  return obj ? obj.arrayBuffer() : null;
}

/** The recorded steps picture, if the user recorded steps. */
export async function getStepsPicture(env: Env, userId: string, bugId: string): Promise<ArrayBuffer | null> {
  const row = await ownBug(env, userId, bugId);
  const obj = await env.FILES.get(row.files_prefix + 'steps.jpg');
  return obj ? obj.arrayBuffer() : null;
}

export interface Agent {
  /** Stable per connected agent (its OAuth client), so one agent can renew its own claim. */
  key: string;
  /** What the user and other agents see, like "Codex" or "Cursor". */
  name: string;
}

/**
 * Marks a waiting bug as being worked on by this agent, unless another agent's claim is still live.
 * Returns who holds the claim afterwards. One UPDATE, so two agents racing can't both win.
 */
export async function claimBug(env: Env, userId: string, bugId: string, agent: Agent): Promise<{ mine: boolean; holder: BugSummary }> {
  const now = Date.now();
  const res = await env.DB.prepare(
    "UPDATE bugs SET claimed_by = ?, claimed_name = ?, claimed_at = ? WHERE id = ? AND user_id = ? AND status = 'waiting' AND (claimed_by IS NULL OR claimed_by = ? OR claimed_at IS NULL OR claimed_at < ?)",
  )
    .bind(agent.key, agent.name, now, bugId, userId, agent.key, now - CLAIM_TTL)
    .run();
  const row = await ownBug(env, userId, bugId);
  return { mine: (res.meta.changes ?? 0) > 0, holder: summary(row) };
}

export async function markFixed(env: Env, userId: string, bugId: string, note: unknown): Promise<BugSummary> {
  return closeBug(env, userId, bugId, 'fixed', clip(note, LIMITS.fixedNote) || null);
}

/** Closes a bug without a code change. The reason is required: the user sees it in Darnly and can reopen the bug. */
export async function markWontFix(env: Env, userId: string, bugId: string, reason: unknown): Promise<BugSummary> {
  const why = clip(reason, LIMITS.fixedNote);
  if (!why) throw new HttpError(400, 'reason_required');
  return closeBug(env, userId, bugId, 'wont_fix', why);
}

async function closeBug(env: Env, userId: string, bugId: string, outcome: 'fixed' | 'wont_fix', note: string | null): Promise<BugSummary> {
  const row = await ownBug(env, userId, bugId);
  const now = Date.now();
  await env.DB.prepare(
    "UPDATE bugs SET status = 'fixed', outcome = ?, fixed_note = ?, fixed_at = ?, claimed_by = NULL, claimed_name = NULL, claimed_at = NULL, question = NULL, question_at = NULL WHERE id = ? AND user_id = ?",
  )
    .bind(outcome, note, now, bugId, userId)
    .run();
  // A won't-fix bug has no fixed page to show.
  if (outcome === 'wont_fix' && row.after_at) await dropAfter(env, userId, row);
  return summary({ ...row, status: 'fixed', outcome, fixed_note: note, fixed_at: now, claimed_by: null, claimed_name: null, claimed_at: null, question: null, question_at: null, after_at: outcome === 'wont_fix' ? null : row.after_at });
}

/** Sends a closed bug back to the inbox (the user pressed Reopen). Its old After picture is dropped, since it no longer shows a fix. */
export async function reopenBug(env: Env, userId: string, bugId: string): Promise<BugSummary> {
  const row = await ownBug(env, userId, bugId);
  if (row.status === 'waiting') return summary(row);
  await env.DB.prepare("UPDATE bugs SET status = 'waiting', outcome = NULL, fixed_note = NULL, fixed_at = NULL WHERE id = ? AND user_id = ?").bind(bugId, userId).run();
  if (row.after_at) await dropAfter(env, userId, row);
  return summary({ ...row, status: 'waiting', outcome: null, fixed_note: null, fixed_at: null, after_at: null });
}

async function dropAfter(env: Env, userId: string, row: BugRow): Promise<void> {
  const key = row.files_prefix + 'after.png';
  const old = await env.FILES.head(key);
  await env.FILES.delete(key);
  await env.DB.prepare('UPDATE bugs SET after_at = NULL, bytes = MAX(0, bytes - ?) WHERE id = ? AND user_id = ?').bind(old?.size ?? 0, row.id, userId).run();
}

const afterKey = async (token: string) => `after:${await sha256(token)}`;

/**
 * A one-time link the agent can PUT a PNG of the fixed page to, without signing in (its shell has no Darnly token).
 * Only a hash of the token is kept, in KV, for 15 minutes.
 */
export async function afterLink(env: Env, userId: string, bugId: string): Promise<string> {
  const token = newToken();
  await env.OAUTH_KV.put(await afterKey(token), JSON.stringify({ userId, bugId }), { expirationTtl: LIMITS.afterLinkSeconds });
  return `${(env.PUBLIC_URL || 'https://api.darnly.dev').replace(/\/+$/, '')}/v1/after/${token}`;
}

/** Saves the agent's After picture through an upload link. The link works once. */
export async function saveAfter(env: Env, token: string, req: Request): Promise<BugSummary> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new HttpError(404, 'link_not_found');
  const key = await afterKey(token);
  const raw = await env.OAUTH_KV.get(key);
  if (!raw) throw new HttpError(404, 'link_expired');
  const { userId, bugId } = JSON.parse(raw) as { userId: string; bugId: string };
  const bytes = await readBytes(req, LIMITS.afterBytes);
  const head = bytes.subarray(0, 4);
  if (!(head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47)) throw new HttpError(415, 'after_not_png');
  const row = await ownBug(env, userId, bugId);
  if (row.status !== 'fixed' || row.outcome === 'wont_fix') throw new HttpError(409, 'bug_not_fixed');
  const stored = await env.DB.prepare('SELECT SUM(bytes) AS stored FROM bugs WHERE user_id = ?').bind(userId).first<{ stored: number | null }>();
  if ((stored?.stored ?? 0) + bytes.byteLength > CAPS.userStoredBytes) throw new HttpError(429, 'storage_full');
  await countUpload(env, userId, bytes.byteLength);
  const fileKey = row.files_prefix + 'after.png';
  const old = row.after_at ? await env.FILES.head(fileKey) : null;
  await env.FILES.put(fileKey, bytes, { httpMetadata: { contentType: 'image/png' } });
  // Used up only once a picture is saved, so an agent that sent the wrong file can try again with the same link.
  await env.OAUTH_KV.delete(key);
  const now = Date.now();
  await env.DB.prepare('UPDATE bugs SET after_at = ?, bytes = MAX(0, bytes - ?) + ? WHERE id = ? AND user_id = ?').bind(now, old?.size ?? 0, bytes.byteLength, bugId, userId).run();
  return summary({ ...row, after_at: now });
}

/** The agent's screenshot of the fixed page. */
export async function getAfter(env: Env, userId: string, bugId: string): Promise<ArrayBuffer> {
  const row = await ownBug(env, userId, bugId);
  const obj = row.after_at ? await env.FILES.get(row.files_prefix + 'after.png') : null;
  if (!obj) throw new HttpError(404, 'not_found');
  return obj.arrayBuffer();
}

/**
 * Records that the agent asked the user something about this bug and is waiting for an answer,
 * so the panel can send the user back to the agent's chat. An empty question clears it.
 */
export async function setQuestion(env: Env, userId: string, bugId: string, question: unknown): Promise<BugSummary> {
  const row = await ownBug(env, userId, bugId);
  const q = clip(question, LIMITS.question) || null;
  const at = q ? Date.now() : null;
  await env.DB.prepare('UPDATE bugs SET question = ?, question_at = ? WHERE id = ? AND user_id = ?').bind(q, at, bugId, userId).run();
  return summary({ ...row, question: q, question_at: at });
}

async function deleteRows(env: Env, rows: { id: string; files_prefix: string }[]): Promise<void> {
  if (!rows.length) return;
  const keys = rows.flatMap((r) => FILE_NAMES.map((f) => r.files_prefix + f));
  for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000));
  for (let i = 0; i < rows.length; i += 50) {
    const ids = rows.slice(i, i + 50).map((r) => r.id);
    await env.DB.prepare(`DELETE FROM bugs WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).run();
  }
}

/** Deletes one of the user's bugs and its files. Someone else's bug looks missing. */
export async function deleteBug(env: Env, userId: string, bugId: string): Promise<void> {
  const row = await ownBug(env, userId, bugId);
  await deleteRows(env, [row]);
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
