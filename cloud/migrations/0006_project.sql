-- Which of the user's projects a bug belongs to (named in the Darnly panel), so an agent can ask for only its own.
ALTER TABLE bugs ADD COLUMN project TEXT;
CREATE INDEX IF NOT EXISTS bugs_user_project ON bugs (user_id, project);
