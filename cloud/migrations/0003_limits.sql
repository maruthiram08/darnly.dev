-- Usage counters that deleting bugs can't reset. scope is a user id, or '*' for everyone together.
-- day is the UTC date, like 2026-11-01. Old rows are removed by the daily cleanup.
CREATE TABLE usage (
  scope TEXT NOT NULL,
  day TEXT NOT NULL,
  uploads INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  signups INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, day)
);

-- Size of each bug's files, so a user's total storage can be capped.
ALTER TABLE bugs ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;
