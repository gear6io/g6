import assert from "node:assert/strict";
import test from "node:test";

import { emojiDisplayName } from "./emojiName.ts";

test("emojiDisplayName names a glyph and leaves a shortcode alone", () => {
  assert.equal(emojiDisplayName("\u{1F44D}"), ":+1:");
  assert.equal(emojiDisplayName("\u{1F389}"), ":tada:");
  assert.equal(emojiDisplayName(":party_parrot:"), ":party_parrot:");
  // Nothing in the set: shown as typed.
  assert.equal(emojiDisplayName("not an emoji"), "not an emoji");
});
