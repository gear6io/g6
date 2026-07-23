import assert from "node:assert/strict";
import test from "node:test";

import {
  eventMatchesFilter,
  messageToRelayEvent,
  isRtmMessage,
} from "./eventAdapter.ts";
import { CHANNEL_EVENT_KINDS } from "../constants/kinds.ts";

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

test("reply carries an e-tag for the thread root", () => {
  const ev = messageToRelayEvent({ ...MSG, thread_ts: "1699999999.000000" });
  assert.deepEqual(ev.tags.at(-1), ["e", "1699999999.000000"]);
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
