-- How a closed bug was closed: 'fixed' (the agent changed code) or 'wont_fix' (closed without a change; the reason is in fixed_note).
-- status keeps 'waiting' and 'fixed' (closed), so extensions from before this column show a won't-fix bug as fixed with its reason.
-- NULL on waiting bugs and on bugs closed before this column existed (those were all fixes).
ALTER TABLE bugs ADD COLUMN outcome TEXT;
-- When the agent uploaded an "after" screenshot of the fixed page (after.png in R2), or NULL.
ALTER TABLE bugs ADD COLUMN after_at INTEGER;
