// One window, two shapes, one set of state. The compact inbox and the expanded
// shell are two renderings of the same session: the same loaded actions, the
// same selected development user, the same pin. Expanding is a resize plus a
// different tree, never a reload.
import { isTauri } from "@tauri-apps/api/core";
import {
  LogicalPosition,
  LogicalSize,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import { type CloudInbox, useCloudInbox } from "@/features/cloudInbox/useCloudInbox";
import {
  type Appearance,
  applyAppearance,
  readAppearance,
  storeAppearance,
} from "@/features/cloudShell/appearance";
import {
  type WindowMode,
  type WindowPort,
  applyWindowMode,
} from "@/features/cloudShell/windowMode";

export type CloudView = "pulse" | "inbox" | "settings";

export type CloudWindow = {
  mode: WindowMode;
  /** True while a resize is in flight; the mode controls are disabled on it. */
  changing: boolean;
  /** The last resize failure, or null. Non-blocking: the old mode still works. */
  error: string | null;
  pinned: boolean;
  view: CloudView;
  appearance: Appearance;
  expand: () => void;
  collapse: () => void;
  togglePin: () => void;
  setView: (view: CloudView) => void;
  setAppearance: (appearance: Appearance) => void;
  inbox: CloudInbox;
};

const CloudWindowContext = createContext<CloudWindow | null>(null);

/**
 * The real window, in logical pixels. Tauri reports positions and monitors in
 * physical ones, so every read is converted on the way out and every write is
 * handed over as logical — mixing the two silently halves or doubles a
 * coordinate on a retina display.
 */
function tauriPort(): WindowPort {
  const win = getCurrentWindow();
  return {
    setMinSize: (width, height) => win.setMinSize(new LogicalSize(width, height)),
    setSize: (width, height) => win.setSize(new LogicalSize(width, height)),
    setAlwaysOnTop: (on) => win.setAlwaysOnTop(on),
    position: async () => {
      const [at, scale] = await Promise.all([
        win.outerPosition(),
        win.scaleFactor(),
      ]);
      return at.toLogical(scale);
    },
    setPosition: (x, y) => win.setPosition(new LogicalPosition(x, y)),
    workArea: async () => {
      const monitor = await currentMonitor();
      if (!monitor) {
        return null;
      }
      const { position, size } = monitor.workArea;
      const at = position.toLogical(monitor.scaleFactor);
      const extent = size.toLogical(monitor.scaleFactor);
      return { x: at.x, y: at.y, width: extent.width, height: extent.height };
    },
  };
}

export function CloudWindowProvider({ children }: { children: ReactNode }) {
  const inbox = useCloudInbox();
  const [mode, setMode] = useState<WindowMode>("compact");
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The window opens pinned (`alwaysOnTop` in tauri.conf.json), so this starts
  // pressed and the state lives here rather than being read back.
  const [pinned, setPinned] = useState(true);
  const [view, setView] = useState<CloudView>("pulse");
  const [appearance, setAppearanceState] = useState<Appearance>(readAppearance);

  // Applied here rather than in the settings pane: the choice has to hold on
  // every launch, including the ones where nobody opens settings.
  useEffect(() => {
    applyAppearance(appearance);
    if (appearance !== "system") {
      return;
    }
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const follow = () => applyAppearance("system");
    media?.addEventListener("change", follow);
    return () => media?.removeEventListener("change", follow);
  }, [appearance]);

  const setAppearance = useCallback((next: Appearance) => {
    setAppearanceState(next);
    storeAppearance(next);
  }, []);

  const change = useCallback(
    (next: WindowMode) => {
      if (changing || next === mode) {
        return;
      }
      setChanging(true);
      setError(null);
      // Off Tauri — the browser test build — there is no window to resize, so
      // the mode is simply the tree that renders.
      const applied = isTauri()
        ? applyWindowMode(tauriPort(), next, pinned)
        : Promise.resolve();
      void applied
        .then(() => {
          setMode(next);
          if (next === "expanded") {
            setView("pulse");
          }
        })
        .catch((err: unknown) => {
          // The window kept the shape it had, so the mode does too. Saying so
          // beats a shell rendered into a 380px frame.
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => setChanging(false));
    },
    [changing, mode, pinned],
  );

  const expand = useCallback(() => change("expanded"), [change]);
  const collapse = useCallback(() => change("compact"), [change]);

  const togglePin = useCallback(() => {
    setPinned((current) => {
      const next = !current;
      if (isTauri()) {
        void getCurrentWindow().setAlwaysOnTop(next);
      }
      return next;
    });
  }, []);

  const value = useMemo<CloudWindow>(
    () => ({
      mode,
      changing,
      error,
      pinned,
      view,
      appearance,
      expand,
      collapse,
      togglePin,
      setView,
      setAppearance,
      inbox,
    }),
    [
      mode,
      changing,
      error,
      pinned,
      view,
      appearance,
      expand,
      collapse,
      togglePin,
      setAppearance,
      inbox,
    ],
  );

  return (
    <CloudWindowContext.Provider value={value}>
      {children}
    </CloudWindowContext.Provider>
  );
}

export function useCloudWindow(): CloudWindow {
  const value = useContext(CloudWindowContext);
  if (!value) {
    throw new Error("useCloudWindow must be used inside CloudWindowProvider");
  }
  return value;
}
