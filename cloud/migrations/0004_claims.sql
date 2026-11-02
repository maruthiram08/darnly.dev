-- Which coding agent is working on a waiting bug, so two agents don't fix the same one.
-- A claim lasts 20 minutes (see CLAIM_TTL in src/bugs.ts) and is cleared when the bug is marked fixed.
ALTER TABLE bugs ADD COLUMN claimed_by TEXT;
ALTER TABLE bugs ADD COLUMN claimed_name TEXT;
ALTER TABLE bugs ADD COLUMN claimed_at INTEGER;
