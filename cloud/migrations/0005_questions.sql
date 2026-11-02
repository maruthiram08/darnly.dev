-- The question an agent asked the user about a waiting bug, so the panel can say "your agent is waiting for you".
-- Set by the ask_user MCP tool, cleared when the bug is marked fixed or the agent clears it.
ALTER TABLE bugs ADD COLUMN question TEXT;
ALTER TABLE bugs ADD COLUMN question_at INTEGER;
