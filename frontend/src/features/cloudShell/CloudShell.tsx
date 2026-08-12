// The expanded window: a sidebar, a collapse control, and one content column.
//
// This is not the legacy `AppShell` and does not import it. Cloud builds have
// never evaluated that tree (see `@/app/rootSurface` and
// `docs/gear6-render-boundary.md`), and the two surfaces this window needs —
// Pulse and the inbox — cost far less than mounting 29 feature areas and then
// hiding 27 of them.
import { Minimize2, Settings, Signal, Inbox as InboxIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { CloudInboxPane } from "@/features/cloudShell/CloudInboxPane";
import { CloudSettingsPane } from "@/features/cloudShell/CloudSettingsPane";
import {
  type CloudView,
  useCloudWindow,
} from "@/features/cloudShell/CloudWindowProvider";
import { CloudThreadPanel } from "@/features/cloudPulse/CloudThreadPanel";
import { PulseMilestones } from "@/features/cloudPulse/PulseMilestones";
import { Button } from "@/shared/ui/button";
import { Gear6Mark } from "@/shared/ui/g6-logo/Gear6Mark";

const SIDEBAR = {
  key: "g6.cloud.sidebarWidth",
  default: 300,
  min: 220,
  max: 420,
};

/**
 * The conversation panel is wider than the nav: it holds message rows, and a
 * 300px column wraps every one of them into a ragged stack.
 */
const THREAD = {
  key: "g6.cloud.threadWidth",
  default: 420,
  min: 320,
  max: 640,
};

/** One keypress on a separator. Enough to feel, small enough to aim with. */
const SIDEBAR_STEP = 16;

type WidthBounds = typeof SIDEBAR;

const NAV: readonly { id: CloudView; label: string; icon: typeof Signal }[] = [
  { id: "pulse", label: "Pulse", icon: Signal },
  { id: "inbox", label: "Inbox", icon: InboxIcon },
];

function clampWidth(bounds: WidthBounds, width: number): number {
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(width)));
}

function readStoredWidth(bounds: WidthBounds): number {
  try {
    if (typeof window === "undefined") {
      return bounds.default;
    }
    const raw = Number(window.localStorage.getItem(bounds.key));
    return Number.isFinite(raw) && raw > 0
      ? clampWidth(bounds, raw)
      : bounds.default;
  } catch {
    return bounds.default;
  }
}

/** Shared by both resizable columns: same persistence, different key and bounds. */
function usePanelWidth(bounds: WidthBounds) {
  const [width, setWidth] = useState(() => readStoredWidth(bounds));

  const resize = useCallback(
    (next: number) => {
      const clamped = clampWidth(bounds, next);
      setWidth(clamped);
      try {
        window.localStorage.setItem(bounds.key, String(clamped));
      } catch {
        // An unremembered width is not worth failing a drag over.
      }
    },
    [bounds],
  );

  return [width, resize] as const;
}

/**
 * A real separator, not a decorative line: the pointer drags it, and the arrow
 * keys move it too — a mouse-only resize is a control a keyboard user can see
 * and cannot reach.
 */
function PanelSeparator({
  bounds,
  label,
  onResize,
  /** Which edge the panel is anchored to; a right panel grows as the pointer moves left. */
  side = "left",
  width,
}: {
  bounds: WidthBounds;
  label: string;
  onResize: (next: number) => void;
  side?: "left" | "right";
  width: number;
}) {
  const dragging = useRef(false);

  useEffect(() => {
    function move(event: PointerEvent) {
      if (dragging.current) {
        onResize(
          side === "left" ? event.clientX : window.innerWidth - event.clientX,
        );
      }
    }
    function end() {
      dragging.current = false;
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [onResize, side]);

  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={bounds.max}
      aria-valuemin={bounds.min}
      aria-valuenow={width}
      className="w-1 shrink-0 cursor-col-resize bg-pulse-hairline transition-colors hover:bg-pulse-tint focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink"
      onKeyDown={(event) => {
        // Left always narrows the column left of the handle, which is what the
        // key looks like it should do from either side.
        const grow = side === "left" ? SIDEBAR_STEP : -SIDEBAR_STEP;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onResize(width - grow);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onResize(width + grow);
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        dragging.current = true;
      }}
      role="separator"
      tabIndex={0}
    />
  );
}

function NavButton({
  active,
  icon: Icon,
  label,
  onSelect,
}: {
  active: boolean;
  icon: typeof Signal;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      // Selected is the filled aubergine, the same treatment the Pulse scope
      // pills use for the same meaning. The sidebar sits on the cream surface
      // and the alt lavender is only 1.05:1 against it, so a tinted-chip
      // "selected" would have been invisible in light; the fill is also the
      // one selection language this window already had.
      className={[
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors",
        "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink",
        active
          ? "bg-pulse-brand font-medium text-pulse-brand-fg"
          : "text-pulse-ink-mute hover:bg-pulse-canvas hover:text-pulse-ink",
      ].join(" ")}
      onClick={onSelect}
      type="button"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function CloudShell() {
  const { collapse, error, selectEvent, selectedEvent, setView, view } =
    useCloudWindow();
  const [width, resize] = usePanelWidth(SIDEBAR);
  const [threadWidth, resizeThread] = usePanelWidth(THREAD);
  const closeThread = useCallback(() => selectEvent(null), [selectEvent]);

  return (
    <div className="flex h-dvh overflow-hidden bg-pulse-canvas text-pulse-ink">
      {/* The sidebar is the second neutral layer: cream against the content
          column's canvas, so the two panes read as different surfaces without
          a rule between them. */}
      <aside
        className="flex shrink-0 flex-col overflow-hidden bg-pulse-surface"
        style={{ width }}
      >
        {/* The close dot is overlaid at y=25 over this corner, exactly as in the
            compact window, so the first row starts below it. `pl-[40px]` is the
            whole brand inset, written out rather than summed from a container
            padding: minimize and zoom are hidden (see `hide_minimize_and_zoom`
            in src-tauri), so the brand clears one dot, not three. */}
        <div className="flex h-[54px] shrink-0 items-end pb-1 pl-[40px] pr-3">
          <span className="flex items-center gap-1.5">
            <Gear6Mark className="size-4 rounded-[4px]" />
            <span className="text-sm font-semibold tracking-tight">Gear6</span>
          </span>
        </div>

        <nav aria-label="Cloud" className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map(({ id, label, icon }) => (
            <NavButton
              active={view === id}
              icon={icon}
              key={id}
              label={label}
              onSelect={() => setView(id)}
            />
          ))}
        </nav>

        <div className="p-2">
          <NavButton
            active={view === "settings"}
            icon={Settings}
            label="Settings"
            onSelect={() => setView("settings")}
          />
        </div>
      </aside>

      <PanelSeparator
        bounds={SIDEBAR}
        label="Resize sidebar"
        onResize={resize}
        width={width}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[54px] shrink-0 items-center justify-end gap-2 px-4">
          {error ? (
            <p className="truncate text-xs text-pulse-error" role="status">
              {error}
            </p>
          ) : null}
          <Button
            aria-label="Return to mini inbox"
            className="size-7 text-pulse-ink-mute hover:bg-pulse-surface hover:text-pulse-ink active:bg-pulse-surface-alt"
            onClick={collapse}
            size="icon"
            title="Return to mini inbox"
            variant="ghost"
          >
            <Minimize2 aria-hidden="true" className="size-3.5" />
          </Button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto" data-testid="cloud-shell">
          {view === "pulse" ? <PulseMilestones /> : null}
          {view === "inbox" ? <CloudInboxPane /> : null}
          {view === "settings" ? <CloudSettingsPane /> : null}
        </main>
      </div>

      {/* The source conversation, beside the reading rather than instead of it.
          A sibling of the content column, not a child: the row that opens it
          sits several levels down inside a milestone card, and a panel nested
          there would scroll away with the rail it belongs to. Keyed on the
          event so switching rows remounts rather than showing the previous
          thread while the next one loads. */}
      {selectedEvent ? (
        <>
          <PanelSeparator
            bounds={THREAD}
            label="Resize conversation"
            onResize={resizeThread}
            side="right"
            width={threadWidth}
          />
          <CloudThreadPanel
            event={selectedEvent}
            key={selectedEvent.id}
            onClose={closeThread}
            widthPx={threadWidth}
          />
        </>
      ) : null}
    </div>
  );
}
