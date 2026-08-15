// The two shapes the one cloud window takes, and the resize that moves between
// them. Kept away from React and from Tauri: everything here works on a small
// port so the sequence can be tested without a native window, which is the only
// way to prove the ordering below is the ordering that ships.

export type WindowMode = "compact" | "expanded";

export type WindowSize = {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
};

/**
 * `compact` repeats `tauri.conf.json`'s startup window on purpose: that file is
 * the contract for the *first* frame, and this module is the contract for every
 * one after it. They are checked against each other in the tests.
 *
 * Compact is the only mode with a size here. Expanded has none: it fills the
 * monitor's work area, so its size is a property of the monitor rather than a
 * number this file can hold. See `EXPANDED_MIN` and `expandedSize`.
 */
export const WINDOW_SIZES: Record<"compact", WindowSize> = {
  compact: { width: 380, height: 520, minWidth: 320, minHeight: 360 },
};

/**
 * Expanded's fixed part. A window holding a nav rail, a facet column, a table
 * and a detail panel stops being any of those below this, so the minimum is a
 * real floor rather than the old 1180×760 default's smaller sibling.
 */
export const EXPANDED_MIN = { minWidth: 960, minHeight: 640 } as const;

/**
 * Expanded is the work area, floored at the minimum — a monitor smaller than
 * the floor gets a window that overhangs it, which `clampToWorkArea` then pins
 * to the top-left corner rather than hiding the controls that live there.
 *
 * `null` is a monitor that could not be read: the floor is the only honest
 * size left, and it is one the window is guaranteed to be allowed.
 */
export function expandedSize(area: Area | null): WindowSize {
  return {
    width: Math.max(EXPANDED_MIN.minWidth, area?.width ?? 0),
    height: Math.max(EXPANDED_MIN.minHeight, area?.height ?? 0),
    ...EXPANDED_MIN,
  };
}

export type Point = { x: number; y: number };

export type Area = { x: number; y: number; width: number; height: number };

/**
 * Everything the resize needs from a window, in logical pixels. A port rather
 * than the Tauri window itself so the sequence is testable, and so the browser
 * build has something to be handed that does nothing.
 */
export type WindowPort = {
  setMinSize: (width: number, height: number) => Promise<void>;
  setSize: (width: number, height: number) => Promise<void>;
  setAlwaysOnTop: (on: boolean) => Promise<void>;
  position: () => Promise<Point>;
  setPosition: (x: number, y: number) => Promise<void>;
  /** The current monitor's usable area, or null when it cannot be read. */
  workArea: () => Promise<Area | null>;
};

/**
 * The window's origin after growing, kept inside the monitor's usable area. A
 * mini window sitting near the right edge grows off the screen otherwise, and
 * the part that leaves is the part with the collapse button in it.
 *
 * Pinned to the area's origin when the window is larger than the area, because
 * losing the bottom-right corner is survivable and losing the top-left one —
 * traffic lights, sidebar, collapse — is not.
 */
export function clampToWorkArea(
  at: Point,
  size: { width: number; height: number },
  area: Area,
): Point {
  const x = Math.min(at.x, area.x + area.width - size.width);
  const y = Math.min(at.y, area.y + area.height - size.height);
  return { x: Math.max(area.x, x), y: Math.max(area.y, y) };
}

/**
 * Resize the window into `mode`. Rejects if any step does, leaving the caller to
 * keep the mode it had — a half-applied resize is still a window the user can
 * see, so the failure has to be visible rather than swallowed.
 *
 * `pinned` is the compact window's own always-on-top state. Expanded is never
 * pinned: a work-area-sized window on top of everything is not a floating inbox
 * any more, it is a window that will not get out of the way.
 *
 * The monitor is read first now, not last. It used to be a position clamp
 * applied after the fact; expanded's *size* comes from it, so it has to be in
 * hand before anything is set.
 */
export async function applyWindowMode(
  port: WindowPort,
  mode: WindowMode,
  pinned: boolean,
): Promise<void> {
  await port.setAlwaysOnTop(mode === "compact" && pinned);

  const area = await port.workArea();
  const size =
    mode === "compact" ? WINDOW_SIZES.compact : expandedSize(area);

  // Minimum first, both directions: a minimum larger than the requested size
  // clamps it, so collapsing while the expanded minimum is still in force would
  // resize the window to 960×640 and call it 380×520.
  await port.setMinSize(size.minWidth, size.minHeight);
  await port.setSize(size.width, size.height);

  if (!area) {
    return;
  }
  const at = await port.position();
  const next = clampToWorkArea(at, size, area);
  if (next.x !== at.x || next.y !== at.y) {
    await port.setPosition(next.x, next.y);
  }
}
