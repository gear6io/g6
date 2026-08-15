import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXPANDED_MIN,
  WINDOW_SIZES,
  applyWindowMode,
  clampToWorkArea,
  expandedSize,
} from "./windowMode.ts";

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

// Only compact is checked against the conf file, because only compact still has
// a size to check. Expanded is the monitor's work area now, and a monitor is not
// something `tauri.conf.json` can state — the contract that survives is the
// startup frame's, and `WINDOW_SIZES` has exactly one entry for that reason.
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
  assert.deepEqual(Object.keys(WINDOW_SIZES), ["compact"]);
});

test("expanded is the work area, floored at the minimum", () => {
  assert.deepEqual(expandedSize({ x: 0, y: 25, width: 1440, height: 875 }), {
    width: 1440,
    height: 875,
    ...EXPANDED_MIN,
  });

  // A monitor smaller than the floor, and a monitor that could not be read,
  // both land on the floor rather than on a window that cannot hold the layout.
  assert.deepEqual(expandedSize({ x: 0, y: 0, width: 800, height: 500 }), {
    width: EXPANDED_MIN.minWidth,
    height: EXPANDED_MIN.minHeight,
    ...EXPANDED_MIN,
  });
  assert.deepEqual(expandedSize(null), {
    width: EXPANDED_MIN.minWidth,
    height: EXPANDED_MIN.minHeight,
    ...EXPANDED_MIN,
  });
});

test("the minimum is always applied before the size", async () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  for (const mode of ["expanded", "compact"]) {
    const win = fakeWindow({ area });
    await applyWindowMode(win, mode, true);

    const order = win.calls.map(([name]) => name);
    assert.ok(
      order.indexOf("setMinSize") < order.indexOf("setSize"),
      `${mode}: a stale minimum would clamp the requested size`,
    );
    const { width, height, minWidth, minHeight } =
      mode === "compact" ? WINDOW_SIZES.compact : expandedSize(area);
    assert.deepEqual(win.calls.slice(0, 3), [
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

test("expanding puts the window on the work area's own origin", async () => {
  // Expanded is exactly the work area now, so wherever the compact window was,
  // the grown one has to start at the area's corner: any other origin loses the
  // opposite edge.
  const area = { x: 0, y: 25, width: 1440, height: 875 };

  const nearEdge = fakeWindow({ at: { x: 1040, y: 700 }, area });
  await applyWindowMode(nearEdge, "expanded", false);
  assert.deepEqual(nearEdge.calls.at(-1), ["setPosition", area.x, area.y]);

  // A window already sitting on the origin is not moved to it again.
  const placed = fakeWindow({ at: { x: 0, y: 25 }, area });
  await applyWindowMode(placed, "expanded", false);
  assert.equal(placed.calls.at(-1)[0], "setSize");
});

test("collapsing leaves a window that already fits where the user put it", async () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  const roomy = fakeWindow({ at: { x: 40, y: 60 }, area });
  await applyWindowMode(roomy, "compact", false);
  assert.equal(roomy.calls.at(-1)[0], "setSize");
});

test("an unreadable monitor is not a failed resize", async () => {
  const win = fakeWindow({ area: null });
  await applyWindowMode(win, "expanded", false);
  assert.equal(win.calls.at(-1)[0], "setSize");
});

test("a window larger than the work area keeps its top-left corner visible", () => {
  // 900×600 is under the expanded floor, so the window genuinely overhangs it.
  const area = { x: 0, y: 25, width: 900, height: 600 };
  assert.deepEqual(
    clampToWorkArea({ x: 200, y: 200 }, expandedSize(area), area),
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
