-- `reactions.name` holds the emoji itself (`👍`), not a shortcode. 0004 said the
-- opposite; this supersedes it rather than editing it, because a migration that
-- has already run cannot change its bytes without failing every existing install
-- on its checksum.
--
-- Shortcodes are an unstable naming layer over a stable character: `thumbsup` and
-- `+1` name the same 👍, sets rename entries between releases, and every client
-- ships a different table — so two clients reacting with "the same" emoji would
-- sit in two pills that can never merge. `normalize_name` in
-- src/messages/reactions.rs resolves any shortcode to its character on the way in,
-- and keeps `:name:` verbatim only when no emoji claims it (a custom emoji).
--
-- Rows written before this decision hold bare shortcodes. The current writer can
-- never produce a name that is both all-ASCII and not colon-wrapped, so that
-- predicate selects exactly the stale rows and nothing a client could add today.
DELETE FROM reactions
 WHERE name NOT LIKE ':%:'
   AND name NOT GLOB '*[^ -~]*';
