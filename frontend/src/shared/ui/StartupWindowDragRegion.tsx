import { isTauri } from "@tauri-apps/api/core";
import { LogicalPosition, getCurrentWindow } from "@tauri-apps/api/window";
import * as React from "react";

import { performTitleBarDoubleClickAction } from "@/shared/lib/titleBarActions";
import {
  type WindowDragPoint,
  windowDragTarget,
} from "@/shared/ui/startupWindowDrag.helpers";

const WINDOW_DRAG_HANDLE_HEIGHT = 44;
const WINDOW_DRAG_INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function isWindowDragHandleEvent(
  event: MouseEvent | PointerEvent,
  fullWindow = false,
) {
  if (!fullWindow && event.clientY > WINDOW_DRAG_HANDLE_HEIGHT) {
    return false;
  }

  const target = event.target;
  return !(
    target instanceof Element &&
    target.closest(WINDOW_DRAG_INTERACTIVE_SELECTOR)
  );
}

/**
 * `fullWindow` drags from any non-interactive pixel instead of the top strip.
 * For the small cloud panel, which has no title bar and too little chrome to
 * aim at. Double-click keeps to the top strip either way — zoom-from-anywhere
 * would fire on stray clicks in the body.
 *
 * The window is moved by hand rather than by the platform's `startDragging()`.
 * Tauri's macOS path (tao `drag_window`) reads `NSApp.currentEvent`, but the
 * webview's JS runs out of process, so by the time the IPC lands the current
 * event is an AppKit-defined one. tao then fabricates a mouse-down out of
 * `NSEvent.mouseLocation` — a global screen coordinate handed to an API that
 * reads it as window-relative. Close enough to work on the display the window
 * opened on, and wrong everywhere else, so the window cannot be dragged to a
 * second screen.
 */
export function StartupWindowDragRegion({
  fullWindow = false,
}: {
  fullWindow?: boolean;
} = {}) {
  React.useEffect(() => {
    const appWindow = isTauri() ? getCurrentWindow() : null;

    // Non-null only between pointerdown and pointerup, and only once the
    // window's own origin has been read back.
    let pointerId: number | null = null;
    let pointerOrigin: WindowDragPoint | null = null;
    let origin: WindowDragPoint | null = null;
    let pointer: WindowDragPoint | null = null;
    let frame = 0;

    function moveWindow() {
      frame = 0;
      if (!appWindow || !origin || !pointerOrigin || !pointer) {
        return;
      }

      const target = windowDragTarget(origin, pointerOrigin, pointer);
      void appWindow.setPosition(new LogicalPosition(target.x, target.y));
    }

    function endDrag() {
      pointerId = null;
      pointerOrigin = null;
      origin = null;
      pointer = null;
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0 || event.detail > 1) {
        return;
      }

      if (!isWindowDragHandleEvent(event, fullWindow) || !appWindow) {
        return;
      }

      // Keeps the drag alive if the pointer outruns the window, and stops the
      // press from starting a text selection.
      document.documentElement.setPointerCapture(event.pointerId);
      event.preventDefault();

      pointerId = event.pointerId;
      pointerOrigin = { x: event.screenX, y: event.screenY };
      pointer = pointerOrigin;
      origin = null;

      const dragId = event.pointerId;
      void Promise.all([appWindow.outerPosition(), appWindow.scaleFactor()])
        .then(([position, scaleFactor]) => {
          // Dropped if the press already ended, or a second drag started.
          if (pointerId !== dragId) {
            return;
          }

          origin = position.toLogical(scaleFactor);
          moveWindow();
        })
        .catch(() => endDrag());
    }

    function handlePointerMove(event: PointerEvent) {
      if (event.pointerId !== pointerId) {
        return;
      }

      pointer = { x: event.screenX, y: event.screenY };
      frame ||= requestAnimationFrame(moveWindow);
    }

    function handlePointerUp(event: PointerEvent) {
      if (event.pointerId === pointerId) {
        endDrag();
      }
    }

    // Suppresses Tauri's injected handler, which only fires on elements
    // carrying `data-tauri-drag-region`. Strip mode only: a full-window region
    // has no such elements to fight with, and swallowing every mousedown and
    // mouseup in the app to fix a problem it does not have would cost far more
    // than it saves.
    function stopTauriDragRegionHandler(event: MouseEvent) {
      if (event.button !== 0 || !isWindowDragHandleEvent(event)) {
        return;
      }

      event.stopImmediatePropagation();
    }

    function handleDoubleClick(event: MouseEvent) {
      if (event.button !== 0 || !isWindowDragHandleEvent(event)) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      void performTitleBarDoubleClickAction();
    }

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerUp, true);
    window.addEventListener("dblclick", handleDoubleClick, true);
    if (!fullWindow) {
      window.addEventListener("mousedown", stopTauriDragRegionHandler, true);
      window.addEventListener("mouseup", stopTauriDragRegionHandler, true);
    }
    return () => {
      endDrag();
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerUp, true);
      window.removeEventListener("dblclick", handleDoubleClick, true);
      window.removeEventListener("mousedown", stopTauriDragRegionHandler, true);
      window.removeEventListener("mouseup", stopTauriDragRegionHandler, true);
    };
  }, [fullWindow]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-20 h-10 select-none"
    />
  );
}
