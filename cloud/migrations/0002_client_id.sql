-- One upload per capture: the extension sends a random id with each capture, and a repeat
-- (double click, retry after a timeout) returns the bug already saved instead of a copy.
ALTER TABLE bugs ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX bugs_user_client ON bugs(user_id, client_id) WHERE client_id IS NOT NULL;
