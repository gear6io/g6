// The expanded window: a sidebar, a collapse control, and one content column.
//
// This is not the legacy `AppShell` and does not import it. Cloud builds have
// never evaluated that tree (see `@/app/rootSurface` and
// `docs/gear6-render-boundary.md`), and the two surfaces this window needs —
// Pulse and the inbox — cost far less than mounting 29 feature areas and then
// hiding 27 of them.
import {
  Minimize2,
  Search,
  Settings,
  Signal,
  Inbox as InboxIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { CloudInboxPane } from "@/features/cloudShell/CloudInboxPane";
import { CloudSettingsPane } from "@/features/cloudShell/CloudSettingsPane";
import {
  type CloudView,
  useCloudWindow,
} from "@/features/cloudShell/CloudWindowProvider";
import { CloudThreadPanel } from "@/features/cloudPulse/CloudThreadPanel";
import {
  CloudSearchPalette,
  useSearchHotkey,
} from "@/features/cloudSearch/CloudSearchPalette";
import { PulseMilestones } from "@/features/cloudPulse/PulseMilestones";
import { Button } from "@/shared/ui/button";

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
const TIMELINE_WINDOWS = [7, 30, 90] as const;
type TimelineDays = (typeof TIMELINE_WINDOWS)[number];

type WidthBounds = typeof THREAD;

const NAV: readonly { id: CloudView; label: string; icon: typeof Signal }[] = [
  { id: "pulse", label: "Pulse", icon: Signal },
  { id: "inbox", label: "Inbox", icon: InboxIcon },
];

/** What the window bar calls the column under it. */
const VIEW_TITLE: Record<CloudView, string> = {
  pulse: "Pulse",
  inbox: "Inbox",
  settings: "Settings",
};

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
      className="w-1 shrink-0 cursor-col-resize bg-pulse-hairline transition-colors duration-150 hover:bg-pulse-tint focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink"
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

/**
 * One rail row. The label is the accessible name and the tooltip rather than a
 * word beside the icon: at 52px there is no room for one, and the rail carries
 * two destinations plus settings — a set small enough that the icon is the
 * whole name once you have seen it twice.
 */
function NavButton({
  active,
  count,
  icon: Icon,
  label,
  onSelect,
}: {
  active: boolean;
  /** The viewer's own open obligations. Absent on rows that count nothing. */
  count?: number;
  icon: typeof Signal;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      // One filled cobalt means selected everywhere in Cloud. The neutral rail
      // stays quiet so the active destination remains the only brand moment.
      className={[
        "relative grid size-[38px] shrink-0 place-items-center rounded-lg transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96]",
        "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink",
        active
          ? "bg-pulse-brand text-pulse-brand-fg shadow-[inset_0_0_0_1px_var(--g6-pulse-brand-tint)]"
          : "text-pulse-ink-mute hover:bg-pulse-surface-alt hover:text-pulse-ink",
      ].join(" ")}
      onClick={onSelect}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="sr-only">{label}</span>
      {/* Drawn only when there is something to count: a "0" badge is a red dot
          that means nothing is wrong. */}
      {count ? (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 grid h-[15px] min-w-[15px] place-items-center rounded-full border-2 border-pulse-surface bg-pulse-error px-0.5 text-3xs font-bold text-pulse-brand-fg"
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The window bar's search affordance. A button rather than an input: the thing
 * it opens is the input, and two text fields for one search is one of them
 * lying about where the typing goes.
 */
function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      className="flex h-[29px] min-w-0 max-w-[460px] flex-1 items-center gap-2 rounded-full border border-pulse-hairline bg-pulse-surface px-3 text-[11.5px] text-pulse-ink-mute transition-[background-color,border-color,color,transform] duration-150 hover:border-pulse-brand-ink hover:bg-pulse-surface-alt hover:text-pulse-ink active:scale-[0.99] focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink"
      onClick={onOpen}
      type="button"
    >
      <Search aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">Search milestones, events, people</span>
      <kbd className="ml-auto shrink-0 rounded-[3px] border border-pulse-hairline px-1 font-mono text-badge">
        ⌘K
      </kbd>
    </button>
  );
}

export function CloudShell() {
  const { collapse, error, inbox, selectEvent, selectedEvent, setView, view } =
    useCloudWindow();
  const [threadWidth, resizeThread] = usePanelWidth(THREAD);
  const [searching, setSearching] = useState(false);
  const [pulseSearch, setPulseSearch] = useState({
    query: "",
    milestoneId: null as string | null,
    revision: 0,
  });
  const [timelineDays, setTimelineDays] = useState<TimelineDays>(30);
  const closeThread = useCallback(() => selectEvent(null), [selectEvent]);
  const openSearch = useCallback(() => setSearching(true), []);
  const clearPulseQuery = useCallback(
    () =>
      setPulseSearch((current) => ({
        ...current,
        query: "",
        milestoneId: null,
      })),
    [],
  );

  useSearchHotkey(openSearch);

  // The badge is the viewer's own open count — the same number `/v1/actions`
  // returns rows for — not the tenant's `open` breakdown, which is a different
  // and much larger question.
  const owed =
    inbox.inbox.status === "ready" ? inbox.inbox.value.overview.actions : 0;

  return (
    <div className="relative flex h-dvh overflow-hidden bg-pulse-canvas font-sans text-pulse-ink">
      {/* The rail is the second neutral layer: bone against the content
          column's canvas. `pt-[42px]` clears the close dot at y=13 — the rail runs
          to the window's own top edge, so the clearance is the rail's rather
          than a bar drawn above it. */}
      <nav
        aria-label="Cloud"
        className="flex w-[52px] shrink-0 flex-col items-center gap-[3px] border-r border-pulse-hairline bg-pulse-surface pb-2 pt-[42px]"
      >
        {NAV.map(({ id, label, icon }) => (
          <NavButton
            active={view === id}
            count={id === "inbox" ? owed : undefined}
            icon={icon}
            key={id}
            label={label}
            onSelect={() => setView(id)}
          />
        ))}
        <span className="flex-1" />
        <NavButton
          active={view === "settings"}
          icon={Settings}
          label="Settings"
          onSelect={() => setView("settings")}
        />
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="g6-pulse-chrome z-10 flex h-[42px] shrink-0 items-center gap-2.5 border-b border-pulse-hairline pl-3.5 pr-2.5">
          <span className="shrink-0 text-[13.5px] font-semibold tracking-tight">
            {VIEW_TITLE[view]}
          </span>
          <SearchTrigger onOpen={openSearch} />
          {view === "pulse" ? (
            <div
              aria-label="Timeline window"
              className="ml-auto flex shrink-0 items-center rounded-full border border-pulse-hairline bg-pulse-surface p-0.5"
              role="group"
            >
              {TIMELINE_WINDOWS.map((days) => (
                <button
                  aria-pressed={timelineDays === days}
                  className={`rounded-full px-2 py-1 text-[11.5px] font-semibold tabular-nums transition-[background-color,color,transform] duration-100 active:scale-[0.96] focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink ${
                    timelineDays === days
                      ? "bg-pulse-brand text-pulse-brand-fg"
                      : "text-pulse-ink-mute hover:bg-pulse-surface-alt hover:text-pulse-ink"
                  }`}
                  key={days}
                  onClick={() => setTimelineDays(days)}
                  type="button"
                >
                  {days}d
                </button>
              ))}
            </div>
          ) : null}
          <div
            className={`${view === "pulse" ? "" : "ml-auto"} flex shrink-0 items-center gap-1.5`}
          >
            {error ? (
              <p className="truncate text-xs text-pulse-error" role="status">
                {error}
              </p>
            ) : null}
            {/* Refresh stays with the view that owns the data: the window bar
                has no way to know whether Pulse or the inbox is the stale one,
                and one control that reloads whichever happens to be mounted is
                a control that means something different on each screen. */}
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
          </div>
        </header>

        <main className="flex min-h-0 flex-1" data-testid="cloud-shell">
          {view === "pulse" ? (
            <PulseMilestones
              onClearQuery={clearPulseQuery}
              query={pulseSearch.query}
              queryMilestoneId={pulseSearch.milestoneId}
              queryRevision={pulseSearch.revision}
              timelineDays={timelineDays}
            />
          ) : null}
          {view === "inbox" ? <CloudInboxPane /> : null}
          {view === "settings" ? <CloudSettingsPane /> : null}
        </main>
      </div>

      {/* Each hit goes where that kind of thing is read. A milestone lands on
          Pulse filtered to its own words; an event opens the conversation panel
          on the record itself, which is the whole reason an event match is worth
          returning — searching "read state" should reach the day the gateway
          rejected 44200, not only the milestone whose title says so. */}
      {searching ? (
        <CloudSearchPalette
          onClose={() => setSearching(false)}
          onSelect={(hit) => {
            if (hit.kind === "milestone") {
              setPulseSearch((current) => ({
                query: hit.milestone.subject,
                milestoneId: hit.milestone.id,
                revision: current.revision + 1,
              }));
              setView("pulse");
            } else {
              selectEvent(hit.event);
            }
            setSearching(false);
          }}
        />
      ) : null}

      {/* The source conversation, beside the reading rather than instead of it.
          A sibling of the content column, not a child: the row that opens it
          sits several levels down inside a milestone card, and a panel nested
          there would scroll away with the rail it belongs to. Keyed on the
          event so switching rows remounts rather than showing the previous
          thread while the next one loads. */}
      {selectedEvent ? (
        <div className="g6-pulse-side-panel flex shrink-0 bg-pulse-canvas max-[1199px]:absolute max-[1199px]:inset-y-0 max-[1199px]:right-0 max-[1199px]:z-40 max-[1199px]:max-w-[calc(100%-3rem)]">
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
        </div>
      ) : null}
    </div>
  );
}
