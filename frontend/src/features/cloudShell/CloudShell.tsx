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
import { PulseMilestones } from "@/features/cloudPulse/PulseMilestones";
import { Button } from "@/shared/ui/button";
import { Gear6Mark } from "@/shared/ui/g6-logo/Gear6Mark";

const SIDEBAR_STORAGE_KEY = "g6.cloud.sidebarWidth";
const SIDEBAR_DEFAULT = 300;
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 420;
/** One keypress on the separator. Enough to feel, small enough to aim with. */
const SIDEBAR_STEP = 16;

const NAV: readonly { id: CloudView; label: string; icon: typeof Signal }[] = [
  { id: "pulse", label: "Pulse", icon: Signal },
  { id: "inbox", label: "Inbox", icon: InboxIcon },
];

function clampWidth(width: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
}

function readStoredWidth(): number {
  try {
    if (typeof window === "undefined") {
      return SIDEBAR_DEFAULT;
    }
    const raw = Number(window.localStorage.getItem(SIDEBAR_STORAGE_KEY));
    return Number.isFinite(raw) && raw > 0 ? clampWidth(raw) : SIDEBAR_DEFAULT;
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

function useSidebarWidth() {
  const [width, setWidth] = useState(readStoredWidth);

  const resize = useCallback((next: number) => {
    const clamped = clampWidth(next);
    setWidth(clamped);
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(clamped));
    } catch {
      // An unremembered width is not worth failing a drag over.
    }
  }, []);

  return [width, resize] as const;
}

/**
 * A real separator, not a decorative line: the pointer drags it, and the arrow
 * keys move it too — a mouse-only resize is a control a keyboard user can see
 * and cannot reach.
 */
function SidebarSeparator({
  onResize,
  width,
}: {
  onResize: (next: number) => void;
  width: number;
}) {
  const dragging = useRef(false);

  useEffect(() => {
    function move(event: PointerEvent) {
      if (dragging.current) {
        onResize(event.clientX);
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
  }, [onResize]);

  return (
    <div
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemax={SIDEBAR_MAX}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuenow={width}
      className="w-1 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-border focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onResize(width - SIDEBAR_STEP);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onResize(width + SIDEBAR_STEP);
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
      className={[
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors",
        "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60",
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
  const { changing, collapse, error, setView, view } = useCloudWindow();
  const [width, resize] = useSidebarWidth();

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside
        className="flex shrink-0 flex-col overflow-hidden"
        style={{ width }}
      >
        {/* The traffic lights are overlaid at y=25 over this corner, exactly as
            in the compact window, so the first row starts below them. */}
        <div className="flex h-[54px] shrink-0 items-end px-3 pb-1">
          <span className="flex items-center gap-1.5 pl-[68px]">
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

      <SidebarSeparator onResize={resize} width={width} />

      <div className="flex min-w-0 flex-1 flex-col border-l border-border">
        <header className="flex h-[54px] shrink-0 items-center justify-end gap-2 px-4">
          {error ? (
            <p className="truncate text-xs text-muted-foreground" role="status">
              {error}
            </p>
          ) : null}
          <Button
            aria-label="Return to mini inbox"
            className="size-7 text-foreground/80"
            disabled={changing}
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
    </div>
  );
}
