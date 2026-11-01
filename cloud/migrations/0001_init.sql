-- Users sign in with Google. We keep only the Google id and email.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Extension sessions. Only a SHA-256 hash of the token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- One row per captured bug. The report, picture and logs live in R2 under files_prefix.
CREATE TABLE bugs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  page_url TEXT NOT NULL,
  site TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'fixed')),
  fixed_note TEXT,
  has_logs INTEGER NOT NULL DEFAULT 0,
  files_prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  fixed_at INTEGER
);
CREATE INDEX bugs_user_status ON bugs(user_id, status, created_at);
CREATE INDEX bugs_fixed_at ON bugs(status, fixed_at);
