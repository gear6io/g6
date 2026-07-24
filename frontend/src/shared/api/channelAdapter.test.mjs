import assert from "node:assert/strict";
import test from "node:test";

import {
  toRawChannel,
  toRawChannelDetail,
  toRawChannelMembers,
} from "./channelAdapter.ts";

const CREATED = 1_700_000_000;
const UPDATED = 1_700_000_500;

function makeChannel(overrides = {}) {
  return {
    id: "C00000001",
    name: "eng",
    creator: "U00000001",
    created: CREATED,
    updated: UPDATED,
    is_archived: false,
    is_member: true,
    is_private: false,
    is_im: false,
    num_members: 3,
    topic: { value: "", creator: "", last_set: 0 },
    purpose: { value: "", creator: "", last_set: 0 },
    description: "",
    ...overrides,
  };
}

test("an untouched topic and purpose map to null, not empty strings", () => {
  const raw = toRawChannel(makeChannel());
  assert.equal(raw.topic, null);
  assert.equal(raw.purpose, null);
  assert.equal(raw.description, "");
  assert.equal(raw.member_count, 3);
  assert.equal(raw.channel_type, "stream");
  assert.equal(raw.visibility, "open");
});

test("a set topic and purpose carry through", () => {
  const raw = toRawChannel(
    makeChannel({
      topic: { value: "ship it", creator: "U00000001", last_set: UPDATED },
      purpose: { value: "the eng channel", creator: "U00000002", last_set: 1 },
      description: "where eng lives",
      is_private: true,
    }),
  );
  assert.equal(raw.topic, "ship it");
  assert.equal(raw.purpose, "the eng channel");
  assert.equal(raw.description, "where eng lives");
  assert.equal(raw.visibility, "private");
});

test("archived_at is null until archived, then an ISO timestamp", () => {
  assert.equal(toRawChannel(makeChannel()).archived_at, null);
  assert.equal(
    toRawChannel(makeChannel({ is_archived: true })).archived_at,
    new Date(UPDATED * 1000).toISOString(),
  );
});

test("detail dates are ISO, and never-set narrative metadata stays null", () => {
  const detail = toRawChannelDetail(
    makeChannel({
      topic: { value: "ship it", creator: "U00000002", last_set: UPDATED },
    }),
  );
  assert.equal(detail.created_at, new Date(CREATED * 1000).toISOString());
  assert.equal(detail.updated_at, new Date(UPDATED * 1000).toISOString());
  assert.equal(detail.created_by, "U00000001");
  assert.equal(detail.topic_set_by, "U00000002");
  assert.equal(detail.topic_set_at, new Date(UPDATED * 1000).toISOString());
  // Never set: no creator and no timestamp, rather than the epoch.
  assert.equal(detail.purpose_set_by, null);
  assert.equal(detail.purpose_set_at, null);
});

test("the channel creator is the owner and everyone else is a member", () => {
  const profiles = {
    u00000001: { display_name: "Astha", is_agent: false },
    u00000002: { display_name: null, is_agent: true },
  };
  const { members, next_cursor } = toRawChannelMembers(
    ["U00000001", "U00000002", "U00000003"],
    makeChannel(),
    profiles,
  );

  assert.equal(next_cursor, null);
  assert.deepEqual(
    members.map((m) => m.role),
    ["owner", "member", "member"],
  );
  assert.equal(members[0].display_name, "Astha");
  assert.equal(members[1].is_agent, true);
  // An id with no profile still yields a member, just an unnamed one.
  assert.equal(members[2].display_name, null);
  assert.equal(members[2].is_agent, false);
  assert.equal(members[0].joined_at, new Date(CREATED * 1000).toISOString());
});
