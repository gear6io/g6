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
 */
export const WINDOW_SIZES: Record<WindowMode, WindowSize> = {
  compact: { width: 380, height: 520, minWidth: 320, minHeight: 360 },
  expanded: { width: 1180, height: 760, minWidth: 960, minHeight: 640 },
};

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
 * pinned: a 1180×760 window on top of everything is not a floating inbox any
 * more, it is a window that will not get out of the way.
 */
export async function applyWindowMode(
  port: WindowPort,
  mode: WindowMode,
  pinned: boolean,
): Promise<void> {
  const size = WINDOW_SIZES[mode];

  await port.setAlwaysOnTop(mode === "compact" && pinned);

  // Minimum first, both directions: a minimum larger than the requested size
  // clamps it, so collapsing while the expanded minimum is still in force would
  // resize the window to 960×640 and call it 380×520.
  await port.setMinSize(size.minWidth, size.minHeight);
  await port.setSize(size.width, size.height);

  const area = await port.workArea();
  if (!area) {
    return;
  }
  const at = await port.position();
  const next = clampToWorkArea(at, size, area);
  if (next.x !== at.x || next.y !== at.y) {
    await port.setPosition(next.x, next.y);
  }
}
