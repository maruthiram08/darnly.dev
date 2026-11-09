-- Posts the finder found. One row per Reddit post or HN item.
CREATE TABLE posts (
  id TEXT PRIMARY KEY,            -- "reddit:t3_abc123" or "hn:4123456"
  source TEXT NOT NULL,           -- reddit | hn
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  community TEXT NOT NULL DEFAULT '',  -- subreddit, or "Hacker News"
  author TEXT NOT NULL DEFAULT '',
  posted_at INTEGER NOT NULL,     -- unix seconds
  found_at INTEGER NOT NULL,
  query TEXT NOT NULL DEFAULT '',
  -- new: waiting for Claude; skipped: failed the cheap word check; judged: Claude scored it;
  -- replied: Maruthi posted a reply; dismissed: Maruthi skipped it
  status TEXT NOT NULL DEFAULT 'new',
  fit INTEGER,                    -- 0-10
  why TEXT,
  mention INTEGER,                -- 1 if Darnly honestly fits in the reply
  draft TEXT,
  judged_at INTEGER
);
CREATE INDEX posts_status ON posts (status, fit DESC, posted_at DESC);

-- One row per source per run, so the inbox can say if Reddit is blocking us.
CREATE TABLE runs (
  at INTEGER NOT NULL,
  source TEXT NOT NULL,
  ok INTEGER NOT NULL,
  found INTEGER NOT NULL DEFAULT 0,
  judged INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX runs_at ON runs (at DESC);
