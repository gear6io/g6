import assert from "node:assert/strict";
import test from "node:test";

import { windowDragTarget } from "./startupWindowDrag.helpers.ts";

test("windowDragTarget moves the window by the pointer's travel", () => {
  const target = windowDragTarget(
    { x: 100, y: 200 },
    { x: 150, y: 260 },
    { x: 170, y: 240 },
  );

  assert.deepEqual(target, { x: 120, y: 180 });
});

test("windowDragTarget holds still while the pointer has not moved", () => {
  const origin = { x: 100, y: 200 };
  const pointer = { x: 150, y: 260 };

  assert.deepEqual(windowDragTarget(origin, pointer, pointer), origin);
});

// The regression this replaced native startDragging for: a second display sits
// at a negative x in the macOS global space, so the target has to go negative
// rather than clamp to the first screen.
test("windowDragTarget follows the pointer onto a display left of the primary", () => {
  const target = windowDragTarget(
    { x: 40, y: 120 },
    { x: 200, y: 300 },
    { x: -1400, y: 260 },
  );

  assert.deepEqual(target, { x: -1560, y: 80 });
});
