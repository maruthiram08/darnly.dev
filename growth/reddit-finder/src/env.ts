export interface Env {
  DB: D1Database;
  /** Claude API key: `wrangler secret put ANTHROPIC_API_KEY`. */
  ANTHROPIC_API_KEY?: string;
  /** Needed when the key isn't tied to a workspace: the workspace id (wrkspc_...) from the Claude Console. */
  ANTHROPIC_WORKSPACE_ID?: string;
  /** Password for the inbox page: `wrangler secret put INBOX_KEY`. */
  INBOX_KEY?: string;
  /** Optional Reddit API app (reddit.com/prefs/apps, type "script"). Without it we use Reddit's public feeds. */
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  /** Maruthi's Reddit username, so their own posts are skipped. */
  REDDIT_USERNAME?: string;
  MODEL: string;
  MAX_JUDGE_PER_RUN: string;
  MAX_JUDGE_PER_DAY: string;
  /** How many Reddit searches each run makes. They take turns, so all of them run every few hours without hitting Reddit's limit. */
  REDDIT_SEARCHES_PER_RUN?: string;
}
