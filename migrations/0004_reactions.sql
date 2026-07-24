-- Reactions: one row per (message, user, emoji), which is exactly what Slack's
-- `reactions.add` writes and what its `{name, users, count}` message decoration
-- aggregates back out.
--
-- `name` is the bare Slack shortcode — no colons, lowercased, validated in
-- reactions.rs. The web client speaks unicode glyphs and translates on its side,
-- so what lands here is the same alphabet a `slack_sdk` bot sends.
--
-- A message is keyed (channel_id, ts) with no surrogate id, so the reference is
-- composite too. Like `messages -> channels` it carries no ON DELETE clause: the
-- delete paths remove children explicitly, and a missed one is a hard foreign key
-- failure rather than an orphan row.
CREATE TABLE reactions (
  channel_id INTEGER NOT NULL,
  ts         TEXT    NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  name       TEXT    NOT NULL,
  -- Same fixed-width "<secs>.<micros>" string `messages.ts` uses, so string order
  -- is chronological order. Whole seconds are too coarse: a burst of reactions
  -- lands in one second and the pills would then be ordered by name, not by who
  -- reacted first.
  created    TEXT    NOT NULL,
  PRIMARY KEY (channel_id, ts, user_id, name),
  FOREIGN KEY (channel_id, ts) REFERENCES messages(channel_id, ts)
) WITHOUT ROWID;
