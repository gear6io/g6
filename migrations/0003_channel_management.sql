-- Channel management: the metadata Slack keeps on a conversation, plus the
-- membership table every conversations.{members,join,leave,invite,kick} reads.

-- Slack's topic and purpose are objects, not strings: {value, creator, last_set}.
-- The creator/last_set columns are what fills them; NULL/0 is exactly what Slack
-- reports for a channel whose topic was never set.
--
-- `description` has no Slack equivalent — it is a gear6 addition the web client
-- edits alongside topic and purpose, and rides along as an extra key on the
-- channel object. Slack clients ignore keys they do not know.
ALTER TABLE channels ADD COLUMN is_archived     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN description     TEXT    NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN topic           TEXT    NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN topic_creator   INTEGER REFERENCES users(id);
ALTER TABLE channels ADD COLUMN topic_set       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN purpose         TEXT    NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN purpose_creator INTEGER REFERENCES users(id);
ALTER TABLE channels ADD COLUMN purpose_set     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN updated         INTEGER NOT NULL DEFAULT 0;

UPDATE channels SET updated = created;

-- Membership is metadata, not an access control list: history and posting stay
-- open to any authenticated user. This table answers "who is in this channel",
-- drives `is_member`/`num_members`, and is what users.conversations filters on.
CREATE TABLE channel_members (
  channel_id INTEGER NOT NULL REFERENCES channels(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  joined     INTEGER NOT NULL,           -- unix secs
  PRIMARY KEY (channel_id, user_id)
) WITHOUT ROWID;

-- users.conversations selects by user, which the (channel, user) primary key
-- cannot serve.
CREATE INDEX idx_channel_members_user ON channel_members(user_id);

-- Backfill, so an existing install does not wake up with every channel empty and
-- every user a non-member: creators, plus everyone who has ever spoken.
INSERT OR IGNORE INTO channel_members (channel_id, user_id, joined)
  SELECT id, creator_id, created FROM channels;
INSERT OR IGNORE INTO channel_members (channel_id, user_id, joined)
  SELECT channel_id, user_id, CAST(ts AS INTEGER) FROM messages;
