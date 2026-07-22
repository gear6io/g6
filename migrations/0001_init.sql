CREATE TABLE users (
  id            INTEGER PRIMARY KEY,      -- rendered to clients as U{:08}
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created       INTEGER NOT NULL          -- unix secs
);

CREATE TABLE tokens (
  token_sha256 TEXT PRIMARY KEY,          -- base64(sha256("xoxb-<32 hex>"))
  user_id      INTEGER NOT NULL REFERENCES users(id),
  created      INTEGER NOT NULL
);

CREATE TABLE channels (
  id         INTEGER PRIMARY KEY,         -- rendered to clients as C{:08}
  name       TEXT NOT NULL UNIQUE,
  creator_id INTEGER NOT NULL REFERENCES users(id),
  created    INTEGER NOT NULL,
  is_private INTEGER NOT NULL DEFAULT 0
);

-- Slack keys a message by (channel, ts). There is no surrogate id, so neither is there one here.
--
-- ts is a fixed-width "<10 digits>.<6 digits>" string, so lexicographic order equals
-- chronological order until the year 2286. Do not "fix" the ORDER BY into a numeric cast.
--
-- thread_ts:  NULL     -> plain message, no thread
--             = ts     -> thread parent (set on its first reply)
--             = parent -> reply
CREATE TABLE messages (
  channel_id INTEGER NOT NULL REFERENCES channels(id),
  ts         TEXT    NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  thread_ts  TEXT,
  text       TEXT    NOT NULL,
  PRIMARY KEY (channel_id, ts)
) WITHOUT ROWID;

CREATE INDEX idx_messages_thread ON messages(channel_id, thread_ts, ts);
