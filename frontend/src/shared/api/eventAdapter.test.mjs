import assert from "node:assert/strict";
import test from "node:test";

import {
  eventMatchesFilter,
  messageToRelayEvent,
  isRtmMessage,
  isRtmReaction,
  reactionEventsFor,
  reactionToRelayEvent,
} from "./eventAdapter.ts";
import { CHANNEL_EVENT_KINDS } from "../constants/kinds.ts";
import { getThreadReference } from "../../features/messages/lib/threading.ts";

const MSG = {
  type: "message",
  channel: "C00000001",
  user: "U00000007",
  text: "hi <@U00000002>",
  ts: "1700000000.123456",
};

test("isRtmMessage rejects non-message frames", () => {
  assert.equal(isRtmMessage({ type: "hello" }), false);
  assert.equal(isRtmMessage({ type: "pong" }), false);
  assert.equal(isRtmMessage(MSG), true);
  assert.equal(isRtmMessage({ ...MSG, ts: 123 }), false);
});

test("slack decimal ts → whole-seconds created_at, raw ts kept in tag", () => {
  const ev = messageToRelayEvent(MSG);
  assert.equal(ev.created_at, 1700000000);
  assert.equal(ev.id, "C00000001:1700000000.123456");
  assert.deepEqual(ev.tags[0], ["h", "C00000001"]);
  assert.deepEqual(ev.tags[1], ["ts", "1700000000.123456"]);
  assert.equal(ev.content, "hi <@U00000002>");
});

test("reply carries a reply-marked e-tag naming the thread root's event id", () => {
  const ev = messageToRelayEvent({ ...MSG, thread_ts: "1699999999.000000" });
  assert.deepEqual(ev.tags.at(-1), [
    "e",
    "C00000001:1699999999.000000",
    "",
    "reply",
  ]);
  assert.deepEqual(getThreadReference(ev.tags), {
    parentId: "C00000001:1699999999.000000",
    rootId: "C00000001:1699999999.000000",
  });
});

// The backend promotes a root's thread_ts to its own ts once it has replies.
// Tagging that as a reply would make the root a reply to itself and drop it out
// of the channel timeline.
test("thread root (thread_ts === ts) stays a top-level event", () => {
  const ev = messageToRelayEvent({ ...MSG, thread_ts: MSG.ts });
  assert.equal(
    ev.tags.some((t) => t[0] === "e"),
    false,
  );
  assert.equal(getThreadReference(ev.tags).parentId, null);
});

test("filter match: kind + #h channel routing", () => {
  const ev = messageToRelayEvent(MSG);
  const filter = { kinds: [...CHANNEL_EVENT_KINDS], "#h": ["C00000001"], limit: 1000 };
  assert.equal(eventMatchesFilter(filter, ev), true);
  // wrong channel is filtered out (broadcast reaches every socket)
  assert.equal(
    eventMatchesFilter({ ...filter, "#h": ["C00000002"] }, ev),
    false,
  );
  // kind not requested
  assert.equal(eventMatchesFilter({ kinds: [7], limit: 0 }, ev), false);
});

test("embedded reactions expand to one kind:7 event per reactor", () => {
  const events = reactionEventsFor(
    {
      ts: "1700000000.123456",
      reactions: [
        {
          name: "\u{1F44D}",
          users: ["U00000007", "U00000002"],
          count: 2,
          reaction_ts: ["1700000001.000000", "1700000002.000000"],
        },
        {
          name: "\u{1F389}",
          users: ["U00000002"],
          count: 1,
          reaction_ts: ["1700000003.000000"],
        },
      ],
    },
    "C00000001",
  );

  assert.equal(events.length, 3);
  assert.equal(
    events[0].id,
    "C00000001:1700000000.123456:U00000007:\u{1F44D}:1700000001.000000",
  );
  assert.equal(events[0].pubkey, "U00000007");
  assert.equal(events[0].kind, 7);
  assert.equal(events[0].content, "👍");
  assert.deepEqual(events[0].tags, [
    ["e", "C00000001:1700000000.123456"],
    ["h", "C00000001"],
  ]);
  // Pill order is the backend's (first-reacted first); the formatter sorts by
  // created_at, so the second emoji must not tie with the first.
  assert.ok(events[2].created_at > events[0].created_at);
  // A custom emoji has no character to store, so the backend keeps the
  // shortcode and it reaches the pill unchanged.
  const custom = reactionEventsFor(
    {
      ts: "1700000000.000001",
      reactions: [
        {
          name: ":party_parrot:",
          users: ["U1"],
          count: 1,
          reaction_ts: ["1700000009.000000"],
        },
      ],
    },
    "C1",
  );
  assert.equal(custom[0].content, ":party_parrot:");
  assert.deepEqual(reactionEventsFor({ ts: "1.0" }, "C1"), []);
});

test("live reaction frames: add is a kind:7, remove deletes it by id", () => {
  const added = {
    type: "reaction_added",
    user: "U00000007",
    reaction: "\u{1F44D}",
    item_user: "U00000002",
    reaction_ts: "1700000050.000000",
    item: { type: "message", channel: "C00000001", ts: "1700000000.123456" },
    event_ts: "1700000100.000000",
  };
  assert.equal(isRtmReaction(added), true);
  assert.equal(isRtmReaction({ type: "message" }), false);
  // A frame without the placement token cannot be turned into a stable id.
  const { reaction_ts: _token, ...noToken } = added;
  assert.equal(isRtmReaction(noToken), false);

  const add = reactionToRelayEvent(added);
  assert.equal(
    add.id,
    "C00000001:1700000000.123456:U00000007:\u{1F44D}:1700000050.000000",
  );
  assert.equal(add.kind, 7);
  assert.equal(add.created_at, 1700000100);
  assert.deepEqual(add.tags[0], ["e", "C00000001:1700000000.123456"]);

  // The removal is a deletion naming the reaction event, and must not collide
  // with it — same id would dedup one of the two away.
  const remove = reactionToRelayEvent({ ...added, type: "reaction_removed" });
  assert.equal(remove.kind, 5);
  assert.notEqual(remove.id, add.id);
  assert.deepEqual(remove.tags[0], ["e", add.id]);

  // Both must reach an open channel subscription.
  const filter = { kinds: [...CHANNEL_EVENT_KINDS], "#h": ["C00000001"], limit: 100 };
  assert.equal(eventMatchesFilter(filter, add), true);
  assert.equal(eventMatchesFilter(filter, remove), true);
});

test("a re-added reaction is a different event than the one removed", () => {
  const base = {
    type: "reaction_added",
    user: "U00000007",
    reaction: "\u{1F440}",
    reaction_ts: "1700000050.000000",
    item: { type: "message", channel: "C00000001", ts: "1700000000.123456" },
  };
  const first = reactionToRelayEvent(base);
  const removal = reactionToRelayEvent({ ...base, type: "reaction_removed" });
  const again = reactionToRelayEvent({
    ...base,
    reaction_ts: "1700000060.000000",
  });

  // The removal names the first placement and must not name the second one —
  // a deletion is permanent, so a shared id would hide the pill forever.
  assert.deepEqual(removal.tags[0], ["e", first.id]);
  assert.notEqual(again.id, first.id);
});
