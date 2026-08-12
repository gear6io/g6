// The fold from Cloud's immutable log history to a readable conversation.
// Pure functions only, no renderer — the panel is covered in `pulse.test.mjs`.
import assert from "node:assert/strict";
import test from "node:test";

import { toThread, toTimelineMessages } from "./thread.ts";

/** Epoch nanoseconds, which is what Cloud sends and what the adapter must halve. */
function nanos(iso) {
  return Date.parse(iso) * 1e6;
}

function row(id, at, attribute, message) {
  return {
    timestamp: at,
    data: {
      attribute,
      body: message === undefined ? {} : { message },
      id,
      observed_timestamp: nanos(at),
      resource: { "g6.source.provider": "slack" },
      scope: {},
      severity_number: 9,
      severity_text: "INFO",
      span_id: "",
      timestamp: nanos(at),
      trace_id: "0123456789abcdef0123456789abcdef",
    },
  };
}

function slack(id, at, ts, threadTs, message, extra = {}) {
  return row(
    id,
    at,
    {
      "g6.actor.id": "slack:U1",
      "g6.actor.name": "Astha",
      "slack.channel.id": "C1",
      "slack.message.ts": ts,
      ...(threadTs ? { "slack.thread.ts": threadTs } : {}),
      ...extra,
    },
    message,
  );
}

const HEAD = slack("a1", "2026-07-01T09:00:00Z", "100.1", "100.1", "ship it?");
const REPLY = slack("b2", "2026-07-01T09:05:00Z", "100.2", "100.1", "yes");

test("nanoseconds become seconds, not a date in the year 33,658", () => {
  const [head] = toTimelineMessages([HEAD]);

  assert.equal(head.createdAt, Date.parse("2026-07-01T09:00:00Z") / 1000);
  // A slip here does not throw, it renders a plausible-looking wrong year, so
  // the assertion is on the number rather than on the formatted string.
  assert.ok(head.createdAt < 2_000_000_000, "seconds, not nanoseconds");
});

test("a thread is its opening message plus one level of replies", () => {
  const { head, replies } = toThread([HEAD, REPLY]);

  assert.equal(head.id, "a1");
  assert.equal(head.depth, 0);
  assert.equal(head.parentId, null);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, "b2");
  assert.equal(replies[0].depth, 1);
  assert.equal(replies[0].parentId, "a1");
  assert.equal(replies[0].rootId, "a1");
});

test("a window that missed the opening message does not promote a reply into it", () => {
  // Cloud pages a long conversation, so the first page a reader lands on can
  // begin partway in. Inventing a head there would put a mid-thread reply at the
  // top of the panel as if it had started the conversation.
  const { head, replies } = toThread([REPLY]);

  assert.equal(head, null);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, "b2");
});

test("an edit marks the message it names rather than becoming a row", () => {
  const edit = slack(
    "c3",
    "2026-07-01T09:10:00Z",
    "100.1",
    "100.1",
    "ship it today?",
    { "g6.log.kind": "update", "slack.item.ts": "100.1" },
  );

  const messages = toTimelineMessages([HEAD, REPLY, edit]);

  assert.equal(messages.length, 2, "the edit is folded, not appended");
  assert.equal(messages[0].edited, true);
  assert.equal(messages[1].edited, false);
});

test("a delete removes its target, and only its target", () => {
  const del = slack("d4", "2026-07-01T09:20:00Z", "100.2", "100.1", undefined, {
    "g6.log.kind": "delete",
    "slack.item.ts": "100.2",
  });

  const messages = toTimelineMessages([HEAD, REPLY, del]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, "a1", "the reply went, the head stayed");
});

test("reactions join their target by slack.item.ts and count up", () => {
  const react = (id, name, action, ts) =>
    slack(id, "2026-07-01T09:30:00Z", "", "", undefined, {
      "g6.log.kind": "reaction",
      "slack.item.ts": ts,
      "slack.reaction.action": action,
      "slack.reaction.name": name,
    });

  const messages = toTimelineMessages([
    HEAD,
    REPLY,
    react("r1", "tada", "added", "100.1"),
    react("r2", "tada", "added", "100.1"),
    react("r3", "eyes", "added", "100.2"),
  ]);

  assert.equal(messages.length, 2, "reactions are pills, not rows");
  assert.deepEqual(
    messages[0].reactions.map((r) => [r.emoji, r.count]),
    [["tada", 2]],
  );
  assert.deepEqual(
    messages[1].reactions.map((r) => [r.emoji, r.count]),
    [["eyes", 1]],
  );
  // No viewer identity on this surface, so nothing may claim to be the reader's.
  assert.equal(messages[0].reactions[0].reactedByCurrentUser, false);
});

test("a removed reaction takes its pill away once the count reaches zero", () => {
  const react = (id, action) =>
    slack(id, "2026-07-01T09:30:00Z", "", "", undefined, {
      "g6.log.kind": "reaction",
      "slack.item.ts": "100.1",
      "slack.reaction.action": action,
      "slack.reaction.name": "tada",
    });

  const [head] = toTimelineMessages([
    HEAD,
    react("r1", "added"),
    react("r2", "removed"),
  ]);

  assert.deepEqual(head.reactions, []);
});

test("a reaction naming no target is dropped rather than guessed at", () => {
  const orphan = slack("r9", "2026-07-01T09:30:00Z", "", "", undefined, {
    "g6.log.kind": "reaction",
    "slack.reaction.action": "added",
    "slack.reaction.name": "tada",
  });

  const messages = toTimelineMessages([HEAD, orphan]);

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].reactions, []);
});

test("a GitHub trace reads as its opening body followed by its comments", () => {
  // No slack.* coordinates at all: the first record is the issue or PR body and
  // the rest are the comments on it, which is what the lifecycle already means.
  const gh = (id, at, message) =>
    row(id, at, { "g6.actor.id": "github:1", "g6.actor.login": "octo" }, message);

  const { head, replies } = toThread([
    gh("g1", "2026-07-02T10:00:00Z", "Timeline rail drops events"),
    gh("g2", "2026-07-02T11:00:00Z", "reproduced on main"),
  ]);

  assert.equal(head.id, "g1");
  assert.equal(head.author, "octo", "the login stands in for an unresolved name");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].body, "reproduced on main");
});

test("an unresolved author keeps its opaque id instead of being named Unknown", () => {
  const anonymous = row("x1", "2026-07-03T08:00:00Z", { "g6.actor.id": "slack:U9" }, "hi");

  const [message] = toTimelineMessages([anonymous]);

  assert.equal(message.author, "slack:U9");
  assert.equal(message.pubkey, "slack:U9");
});

test("a record with no content is a message with an empty body, not a crash", () => {
  const empty = slack("e1", "2026-07-03T08:00:00Z", "200.1", "200.1", undefined);

  const [message] = toTimelineMessages([empty]);

  assert.equal(message.body, "");
});

test("attributes arrive nested, which is the shape Cloud actually sends", () => {
  // The fixtures above use the flat dotted form the OpenAPI examples show.
  // The live API sends `{g6: {actor: {id}}}` instead — the stored cold and
  // promoted JSON merged — and reading only the flat form silently produced
  // messages with no author, no threading and no reactions.
  const nested = (id, at, message, attribute) => ({
    timestamp: at,
    data: {
      attribute,
      body: { message },
      id,
      observed_timestamp: nanos(at),
      resource: { g6: { source: { provider: "slack" } } },
      scope: {},
      severity_number: 9,
      severity_text: "INFO",
      span_id: "",
      timestamp: nanos(at),
      trace_id: "d08ee9f6b4d3dffe50e5fe3f5be5d0c3",
    },
  });

  const { head, replies } = toThread([
    nested("n1", "2026-05-14T01:42:46Z", "opening", {
      g6: { actor: { id: "U01UTLTJFFB", kind: "bot" } },
      slack: {
        channel: { id: "C04LJS10VTL" },
        message: { ts: "1778789566.938399" },
        thread: { ts: "1778789566.938399" },
      },
    }),
    nested("n2", "2026-05-14T01:49:54Z", "a reply", {
      g6: { actor: { id: "UDKU51ZHQ", kind: "human" } },
      slack: {
        channel: { id: "C04LJS10VTL" },
        message: { ts: "1778789994.719959" },
        thread: { ts: "1778789566.938399" },
      },
    }),
  ]);

  assert.equal(head.author, "U01UTLTJFFB");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].parentId, "n1", "nested slack.thread.ts still threads");
  assert.equal(replies[0].author, "UDKU51ZHQ");
});
