import type { Env } from './env';
import { HN_QUERIES, REDDIT_QUERIES, worthJudging } from './queries';
import { searchHn, searchReddit, type FoundPost } from './sources';
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

/** Asks Claude about waiting posts, newest first, within the per-run and per-day caps. */
async function judgeWaiting(env: Env): Promise<number> {
  if (!env.ANTHROPIC_API_KEY) return 0;
  const budget = Math.min(Number(env.MAX_JUDGE_PER_RUN), Number(env.MAX_JUDGE_PER_DAY) - (await judgedToday(env)));
  if (budget <= 0) return 0;
  const { results } = await env.DB.prepare(`SELECT id, title, body, community, source FROM posts WHERE status = 'new' ORDER BY posted_at DESC LIMIT ?`)
    .bind(budget)
    .all<{ id: string; title: string; body: string; community: string; source: string }>();
  let judged = 0;
  for (const p of results) {
    try {
      const v = await judge(env, p);
      await env.DB.prepare(`UPDATE posts SET status = 'judged', fit = ?, why = ?, mention = ?, draft = ?, judged_at = ? WHERE id = ?`)
        .bind(v?.fit ?? 0, v?.why ?? 'Claude declined to answer for this post.', v?.mention ? 1 : 0, v?.draft ?? '', now(), p.id)
        .run();
      judged++;
    } catch (err) {
      console.error('judge failed', p.id, err);
      break; // API down or out of credit: try again next hour
    }
  }
  return judged;
}

export async function runOnce(env: Env): Promise<void> {
  const sources: [string, () => Promise<FoundPost[]>][] = [
    ['reddit', () => searchReddit(env, REDDIT_QUERIES)],
    ['hn', () => searchHn(HN_QUERIES)],
  ];
  for (const [name, search] of sources) {
    try {
      await logRun(env, name, true, await save(env, await search()), 0);
    } catch (err) {
      await logRun(env, name, false, 0, 0, err instanceof Error ? err.message : String(err));
    }
  }
  const judged = await judgeWaiting(env);
  if (judged > 0) await logRun(env, 'claude', true, 0, judged);
  // Keep the database small: forget old posts nobody acted on.
  await env.DB.prepare(`DELETE FROM posts WHERE found_at < ? AND status IN ('skipped', 'judged', 'dismissed')`).bind(now() - 30 * 24 * 3600).run();
  await env.DB.prepare('DELETE FROM runs WHERE at < ?').bind(now() - 7 * 24 * 3600).run();
}
