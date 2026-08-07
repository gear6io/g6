import assert from "node:assert/strict";
import test from "node:test";

import { resolveAppMode } from "./mode.ts";

test("VITE_G6_APP_MODE selects the surface", () => {
  assert.equal(resolveAppMode({ VITE_G6_APP_MODE: "cloud" }), "cloud");
  assert.equal(resolveAppMode({ VITE_G6_APP_MODE: "local" }), "local");
  assert.equal(resolveAppMode({ VITE_G6_APP_MODE: "legacy" }), "legacy");
  assert.equal(resolveAppMode({ VITE_G6_APP_MODE: " cloud " }), "cloud");
});

test("VITE_GEAR6=1 stays a compatibility alias for local", () => {
  assert.equal(resolveAppMode({ VITE_GEAR6: "1" }), "local");
  // The explicit mode wins over the alias, so a stale VITE_GEAR6 in someone's
  // .env cannot pin them to the old surface.
  assert.equal(
    resolveAppMode({ VITE_G6_APP_MODE: "cloud", VITE_GEAR6: "1" }),
    "cloud",
  );
});

test("an absent or unrecognised mode keeps today's default", () => {
  assert.equal(resolveAppMode({}), "legacy");
  assert.equal(resolveAppMode({ VITE_GEAR6: "0" }), "legacy");
  assert.equal(resolveAppMode({ VITE_G6_APP_MODE: "clod" }), "legacy");
  // A typo must not silently downgrade an intentional local setup either.
  assert.equal(
    resolveAppMode({ VITE_G6_APP_MODE: "clod", VITE_GEAR6: "1" }),
    "local",
  );
});
