-- The user object was a stub: `real_name` and `profile.display_name` were both
-- rendered from `username`. These are the fields Slack actually stores.
ALTER TABLE users ADD COLUMN display_name      TEXT    NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN real_name         TEXT    NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN title             TEXT    NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN status_text       TEXT    NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN status_emoji      TEXT    NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN status_expiration INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN updated           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email             TEXT;

-- Slack seeds real_name from the account name and leaves display_name empty;
-- clients fall back display_name -> real_name -> name.
UPDATE users SET real_name = username, updated = created;

-- Partial: email is optional, and SQLite treats every NULL as distinct anyway —
-- the WHERE clause just makes that explicit and keeps the index small.
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
