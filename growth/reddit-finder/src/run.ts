import type { Env } from './env';
import { HN_QUERIES, REDDIT_QUERIES, worthJudging } from './queries';
import { searchHn, searchReddit, searchesForThisRun, type FoundPost } from './sources';
import { judge } from './judge';

const now = () => Math.floor(Date.now() / 1000);

/** Saves posts we haven't seen. Posts that fail the cheap word check are stored as "skipped" so they never cost a Claude call. */
async function save(env: Env, posts: FoundPost[]): Promise<number> {
  const me = env.REDDIT_USERNAME?.toLowerCase();
  const seen = new Set<string>();
  const fresh = posts.filter((p) => {
    if (seen.has(p.id) || (me && p.author.toLowerCase() === me)) return false;
    seen.add(p.id);
    return true;
  });
  if (fresh.length === 0) return 0;
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO posts (id, source, url, title, body, community, author, posted_at, found_at, query, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const results = await env.DB.batch(
    fresh.map((p) =>
      stmt.bind(p.id, p.source, p.url, p.title, p.body, p.community, p.author, p.postedAt, now(), p.query, worthJudging(`${p.title}\n${p.body}`) ? 'new' : 'skipped'),
    ),
  );
  return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
}

async function logRun(env: Env, source: string, ok: boolean, found: number, judged: number, error?: string) {
  await env.DB.prepare('INSERT INTO runs (at, source, ok, found, judged, error) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(now(), source, ok ? 1 : 0, found, judged, error ?? null)
    .run();
}

export async function judgedToday(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE judged_at >= ?').bind(now() - 24 * 3600).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Turns an API error into one short line for the inbox page. */
function short(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  // API errors arrive as "400 {json}": keep just the human message.
  const m = msg.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m?.[1]) msg = m[1];
  return msg.replace(/\s+/g, ' ').slice(0, 200);
}

export interface RunSummary {
  found: number;
  passed: number;
  judged: number;
  claudeError?: string;
}

/**
 * Asks Claude about waiting posts, newest first, within the per-run and per-day caps.
 * The calls run side by side so a "Search now" click finishes quickly. A failure is
 * saved as a "claude" run so the inbox page shows why.
 */
async function judgeWaiting(env: Env): Promise<{ judged: number; error?: string }> {
  if (!env.ANTHROPIC_API_KEY) return { judged: 0 };
  const budget = Math.min(Number(env.MAX_JUDGE_PER_RUN), Number(env.MAX_JUDGE_PER_DAY) - (await judgedToday(env)));
  if (budget <= 0) return { judged: 0 };
  const { results } = await env.DB.prepare(`SELECT id, title, body, community, source FROM posts WHERE status = 'new' ORDER BY posted_at DESC LIMIT ?`)
    .bind(budget)
    .all<{ id: string; title: string; body: string; community: string; source: string }>();
  if (results.length === 0) return { judged: 0 };
  const outcomes = await Promise.allSettled(
    results.map(async (p) => {
      const v = await judge(env, p);
      await env.DB.prepare(`UPDATE posts SET status = 'judged', fit = ?, why = ?, mention = ?, draft = ?, judged_at = ? WHERE id = ?`)
        .bind(v?.fit ?? 0, v?.why ?? 'Claude declined to answer for this post.', v?.mention ? 1 : 0, v?.draft ?? '', now(), p.id)
        .run();
    }),
  );
  const judged = outcomes.filter((o) => o.status === 'fulfilled').length;
  const failed = outcomes.find((o): o is PromiseRejectedResult => o.status === 'rejected');
  if (failed) console.error('judge failed', failed.reason);
  await logRun(env, 'claude', !failed || judged > 0, 0, judged, failed ? short(failed.reason) : undefined);
  return { judged, error: failed ? short(failed.reason) : undefined };
}

export async function runOnce(env: Env): Promise<RunSummary> {
  const sources: [string, () => Promise<FoundPost[]>][] = [
    ['reddit', () => searchReddit(env, searchesForThisRun(REDDIT_QUERIES, Number(env.REDDIT_SEARCHES_PER_RUN ?? 5)))],
    ['hn', () => searchHn(HN_QUERIES)],
  ];
  const before = await countNew(env);
  let found = 0;
  await Promise.all(
    sources.map(async ([name, search]) => {
      try {
        const n = await save(env, await search());
        found += n;
        await logRun(env, name, true, n, 0);
      } catch (err) {
        await logRun(env, name, false, 0, 0, short(err));
      }
    }),
  );
  const passed = (await countNew(env)) - before;
  const { judged, error } = await judgeWaiting(env);
  // Keep the database small: forget old posts nobody acted on.
  await env.DB.prepare(`DELETE FROM posts WHERE found_at < ? AND status IN ('skipped', 'judged', 'dismissed')`).bind(now() - 30 * 24 * 3600).run();
  await env.DB.prepare('DELETE FROM runs WHERE at < ?').bind(now() - 7 * 24 * 3600).run();
  return { found, passed, judged, claudeError: error };
}

async function countNew(env: Env): Promise<number> {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM posts WHERE status = 'new'`).first<{ n: number }>())?.n ?? 0;
}
