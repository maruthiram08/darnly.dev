-- A short title and one-line summary Claude writes from the note, report and screenshot (null until written, or when AI titles are off).
-- The user's own note stays in report.md and in `title`; the list shows ai_title when there is one.
ALTER TABLE bugs ADD COLUMN ai_title TEXT;
ALTER TABLE bugs ADD COLUMN ai_summary TEXT;
-- How many AI titles were written, per user and for everyone ('*'), so the API bill has a daily ceiling.
ALTER TABLE usage ADD COLUMN ai_titles INTEGER NOT NULL DEFAULT 0;
