import assert from "node:assert/strict";
import test from "node:test";

import {
  clearCommunityStorage,
  migrateLegacyCommunityStorage,
} from "./communityStorage.ts";

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
}

test("migrateLegacyCommunityStorage promotes current Gear6 workspace state", () => {
  const storage = createMemoryStorage({
    "g6-workspaces": '[{"id":"current"}]',
    "g6-active-workspace-id": "current",
  });

  migrateLegacyCommunityStorage(storage);

  assert.equal(storage.getItem("g6-communities"), '[{"id":"current"}]');
  assert.equal(storage.getItem("g6-active-community-id"), "current");
});

test("migrateLegacyCommunityStorage does not overwrite new community state", () => {
  const storage = createMemoryStorage({
    "g6-communities": '[{"id":"new"}]',
    "g6-active-community-id": "new",
    "g6-workspaces": '[{"id":"old"}]',
    "g6-active-workspace-id": "old",
  });

  migrateLegacyCommunityStorage(storage);

  assert.equal(storage.getItem("g6-communities"), '[{"id":"new"}]');
  assert.equal(storage.getItem("g6-active-community-id"), "new");
});

test("clearCommunityStorage removes new and legacy state", () => {
  const storage = createMemoryStorage({
    "g6-communities": "new",
    "g6-active-community-id": "new",
    "g6-workspaces": "old",
    "g6-active-workspace-id": "old",
  });

  clearCommunityStorage(storage);
  migrateLegacyCommunityStorage(storage);

  assert.equal(storage.length, 0);
});
