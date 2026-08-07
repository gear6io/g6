import assert from "node:assert/strict";
import test from "node:test";

import { runGear6Boot } from "./gear6Boot.ts";

test("runGear6Boot reports ready with the backend identity", async () => {
  const state = await runGear6Boot(
    async () => ({ pubkey: "u-dev", display_name: "dev" }),
    1_000,
  );

  assert.deepEqual(state, {
    status: "ready",
    pubkey: "u-dev",
    displayName: "dev",
  });
});

test("runGear6Boot turns a failed identity fetch into a recoverable error", async () => {
  const state = await runGear6Boot(async () => {
    throw new Error("gear6 GET users.identity → HTTP 500");
  }, 1_000);

  assert.equal(state.status, "error");
  assert.match(state.message, /HTTP 500/);
});

test("runGear6Boot gives up on a hung backend instead of loading forever", async () => {
  const state = await runGear6Boot(() => new Promise(() => {}), 10);

  assert.equal(state.status, "error");
  assert.match(state.message, /did not respond/);
});

test("runGear6Boot never rejects, even on a non-Error throw", async () => {
  const state = await runGear6Boot(async () => {
    throw "socket closed";
  }, 1_000);

  assert.deepEqual(state, { status: "error", message: "socket closed" });
});
