import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { WINDOW_SIZES, applyWindowMode, clampToWorkArea } from "./windowMode.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/** A window that records the calls in the order they were awaited. */
function fakeWindow({ at = { x: 100, y: 100 }, area = null } = {}) {
  const calls = [];
  return {
    calls,
    position: async () => at,
    workArea: async () => area,
    setMinSize: async (width, height) => {
      calls.push(["setMinSize", width, height]);
    },
    setSize: async (width, height) => {
      calls.push(["setSize", width, height]);
    },
    setAlwaysOnTop: async (on) => {
      calls.push(["setAlwaysOnTop", on]);
    },
    setPosition: async (x, y) => {
      calls.push(["setPosition", x, y]);
    },
  };
}

test("the compact shape is the one tauri.conf.json opens with", () => {
  const conf = JSON.parse(
    fs.readFileSync(path.join(here, "../../../src-tauri/tauri.conf.json"), "utf8"),
  );
  const [startup] = conf.app.windows;
  const { compact } = WINDOW_SIZES;

  assert.equal(startup.width, compact.width);
  assert.equal(startup.height, compact.height);
  assert.equal(startup.minWidth, compact.minWidth);
  assert.equal(startup.minHeight, compact.minHeight);
});

test("the minimum is always applied before the size", async () => {
  for (const mode of ["expanded", "compact"]) {
    const win = fakeWindow();
    await applyWindowMode(win, mode, true);

    const order = win.calls.map(([name]) => name);
    assert.ok(
      order.indexOf("setMinSize") < order.indexOf("setSize"),
      `${mode}: a stale minimum would clamp the requested size`,
    );
    const { width, height, minWidth, minHeight } = WINDOW_SIZES[mode];
    assert.deepEqual(win.calls, [
      ["setAlwaysOnTop", mode === "compact"],
      ["setMinSize", minWidth, minHeight],
      ["setSize", width, height],
    ]);
  }
});

test("expanded is never on top, and collapsing restores what compact had", async () => {
  const expanded = fakeWindow();
  await applyWindowMode(expanded, "expanded", true);
  assert.deepEqual(expanded.calls[0], ["setAlwaysOnTop", false]);

  const unpinned = fakeWindow();
  await applyWindowMode(unpinned, "compact", false);
  assert.deepEqual(unpinned.calls[0], ["setAlwaysOnTop", false]);

  const pinned = fakeWindow();
  await applyWindowMode(pinned, "compact", true);
  assert.deepEqual(pinned.calls[0], ["setAlwaysOnTop", true]);
});

test("growing near an edge moves the window back onto the screen", async () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 };

  const nearEdge = fakeWindow({ at: { x: 1040, y: 700 }, area });
  await applyWindowMode(nearEdge, "expanded", false);
  assert.deepEqual(nearEdge.calls.at(-1), ["setPosition", 260, 140]);

  // A window that already fits is left exactly where the user put it.
  const roomy = fakeWindow({ at: { x: 40, y: 60 }, area });
  await applyWindowMode(roomy, "expanded", false);
  assert.equal(roomy.calls.at(-1)[0], "setSize");
});

test("an unreadable monitor is not a failed resize", async () => {
  const win = fakeWindow({ area: null });
  await applyWindowMode(win, "expanded", false);
  assert.equal(win.calls.at(-1)[0], "setSize");
});

test("a window larger than the work area keeps its top-left corner visible", () => {
  const area = { x: 0, y: 25, width: 900, height: 600 };
  assert.deepEqual(
    clampToWorkArea({ x: 200, y: 200 }, WINDOW_SIZES.expanded, area),
    { x: 0, y: 25 },
  );
});

test("a resize failure rejects rather than reporting a mode it did not reach", async () => {
  const win = fakeWindow();
  win.setSize = async () => {
    throw new Error("window is gone");
  };
  await assert.rejects(applyWindowMode(win, "expanded", false), /window is gone/);
});
