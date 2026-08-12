// Pulse's landing view: the milestones Cloud is watching, most recently touched
// first.
//
// It answers "what is moving, what is blocked, what regressed" and nothing
// else. There is no completion percentage here because Cloud derives none — a
// milestone has no single current health, only days do.
//
// The page runs Design.md's palette rather than the app's Catppuccin tokens.
// Everything below reads from the `pulse-*` colour tokens; nothing hardcodes a
// hex, so both themes come from `theme.css`.
import { RefreshCw, Signal, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { MilestonePanel } from "@/features/cloudPulse/MilestonePanel";
import { useMilestoneTimelines } from "@/features/cloudPulse/useMilestoneTimelines";
import { generatedAge } from "@/features/cloudInbox/inbox";
import { listMilestones } from "@/shared/api/cloudGateway/client";
import type {
  Milestone,
  MilestoneListResponse,
} from "@/shared/api/cloudGateway/types";

/** A screenful and a bit. Cloud's own default page is 50. */
const PAGE_SIZE = 12;

/**
 * `9 milestones. Updated 4m ago.` — the masthead subline, and the same sentence
 * the live region announces when a refresh lands.
 * Two sentences rather than a dot-separated strip: it is read aloud as often as
 * it is looked at.
 */
export function milestoneSummary(count: number, updated: string): string {
  return `${count} milestone${count === 1 ? "" : "s"}. Updated ${updated}.`;
}

type Page = { rows: Milestone[]; cursor: string | null; generatedAt: string };

type State =
  | { status: "loading" }
  | { status: "ready"; page: Page }
  | { status: "error"; message: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The card's own shape, so the first paint does not resize under the reader. */
function PanelSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="rounded-2xl border border-pulse-hairline bg-pulse-canvas p-6"
    >
      <div className="h-5 w-2/5 rounded bg-pulse-surface" />
      <div className="mt-2 h-3 w-3/5 rounded bg-pulse-surface" />
      <div className="mt-5 h-6 w-1/3 rounded bg-pulse-surface" />
      <div className="mt-5 flex h-[58px] items-start pt-3">
        <div className="h-0.5 w-full rounded bg-pulse-surface" />
      </div>
      <div className="mt-3 h-3 w-1/4 rounded bg-pulse-surface" />
    </div>
  );
}

/** Design.md's cream feature card, doing the page's empty and failed states. */
function Notice({
  action,
  detail,
  onAction,
  title,
}: {
  action: string;
  detail: string;
  onAction: () => void;
  title: string;
}) {
  return (
    <div className="g6-pulse-mesh mt-10 rounded-2xl bg-pulse-surface px-6 py-12 text-center">
      <Signal aria-hidden="true" className="mx-auto size-5 text-pulse-ink-mute" />
      <p className="mt-4 text-pulse-title font-semibold text-pulse-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-[50ch] text-pulse-body text-pulse-ink-mute">
        {detail}
      </p>
      <button
        className="mt-6 rounded-full border-2 border-pulse-brand-ink bg-pulse-canvas px-7 py-3.5 text-pulse-cap font-bold text-pulse-brand-ink transition-[background-color,transform] duration-100 ease-out hover:bg-pulse-surface-alt active:scale-[0.97] active:bg-pulse-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink motion-reduce:transition-none motion-reduce:active:scale-100"
        onClick={onAction}
        type="button"
      >
        {action}
      </button>
    </div>
  );
}

export function PulseMilestones() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const timelines = useMilestoneTimelines(refreshKey);

  useEffect(() => {
    let cancelled = false;
    // The panels stay on screen during a refresh; only the first read shows a
    // loading page.
    setState((current) =>
      current.status === "ready" ? current : { status: "loading" },
    );
    listMilestones({ limit: PAGE_SIZE })
      .then((res: MilestoneListResponse) => {
        if (!cancelled) {
          setNow(Date.now());
          setState({
            status: "ready",
            page: {
              rows: res.data,
              cursor: res.page.next_cursor,
              generatedAt: res.generated_at,
            },
          });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: errorMessage(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const loadMore = useCallback(() => {
    if (state.status !== "ready" || !state.page.cursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    setMoreFailed(false);
    listMilestones({ limit: PAGE_SIZE, cursor: state.page.cursor })
      .then((res) => {
        setState((current) =>
          current.status === "ready"
            ? {
                status: "ready",
                page: {
                  // Only this page is appended; a failure here never restarts
                  // from page one.
                  rows: [...current.page.rows, ...res.data],
                  cursor: res.page.next_cursor,
                  generatedAt: current.page.generatedAt,
                },
              }
            : current,
        );
      })
      // The press did nothing and the button looked identical afterwards, which
      // reads as a dead control rather than a failed request. It says so now.
      .catch(() => setMoreFailed(true))
      .finally(() => setLoadingMore(false));
  }, [loadingMore, state]);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  const refreshing = refreshKey > 0 && state.status === "loading";

  const rows = state.status === "ready" ? state.page.rows : [];
  const summary =
    state.status === "ready"
      ? milestoneSummary(rows.length, generatedAge(state.page.generatedAt, now))
      : "";

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 pb-10 pt-7 sm:px-7">
      {/* Floating chrome rather than an opaque bar with a rule under it: the
          list scrolls *under* a translucent masthead, and the boundary is a
          short fade where the two meet instead of a 1px line. The mesh wash is
          Design.md's gradient, kept to this band alone — behind thirty rows of
          timeline it would cost legibility and buy nothing. */}
      <header className="g6-pulse-mesh g6-pulse-chrome sticky top-0 z-10 -mx-4 px-4 pb-4 after:absolute after:inset-x-0 after:top-full after:h-5 after:bg-gradient-to-b after:from-pulse-canvas after:to-transparent after:content-[''] sm:-mx-7 sm:px-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-pulse-display font-bold text-pulse-ink">Pulse</h1>
            <p className="mt-1 text-pulse-body text-pulse-ink-mute">{summary}</p>
          </div>
          <button
            aria-label="Refresh milestone progress"
            className="shrink-0 rounded-full border-2 border-pulse-brand-ink p-3 text-pulse-brand-ink transition-[background-color,transform] duration-100 ease-out hover:bg-pulse-surface-alt active:scale-[0.97] active:bg-pulse-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink motion-reduce:transition-none motion-reduce:active:scale-100"
            onClick={refresh}
            title="Refresh milestone progress"
            type="button"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-4 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
            />
          </button>
        </div>

        {/* A fact about the window Cloud reads, not a control over it. */}
        <p className="mt-4 text-pulse-caption text-pulse-ink-mute">
          Last 30 UTC days
        </p>
      </header>

      {/* Refresh and load-more both change the list without moving focus, so
          the change is announced rather than only drawn. */}
      <p aria-live="polite" className="sr-only">
        {summary}
      </p>

      {state.status === "loading" ? (
        <div className="mt-6 space-y-4">
          {[0, 1, 2].map((row) => (
            <PanelSkeleton key={row} />
          ))}
        </div>
      ) : null}

      {state.status === "error" ? (
        <Notice
          action="Refresh Pulse"
          detail={state.message}
          onAction={refresh}
          title="Could not load milestones"
        />
      ) : null}

      {state.status === "ready" && rows.length === 0 ? (
        <Notice
          action="Refresh Pulse"
          detail="Milestone progress will appear here when Cloud observes it."
          onAction={refresh}
          title="No milestones"
        />
      ) : null}

      {state.status === "ready" && rows.length > 0 ? (
        <>
          <div className="mt-6 space-y-4">
            {rows.map((milestone) => (
              <MilestonePanel
                key={milestone.id}
                milestone={milestone}
                now={now}
                onRequest={timelines.request}
                onRetry={timelines.retry}
                timeline={timelines.get(milestone.id)}
              />
            ))}
            {loadingMore ? (
              <>
                <PanelSkeleton />
                <PanelSkeleton />
              </>
            ) : null}
          </div>

          {state.page.cursor ? (
            <div className="mt-6 flex flex-col items-center gap-2">
              {moreFailed ? (
                <p className="flex items-center gap-1.5 text-xs text-pulse-error">
                  <TriangleAlert aria-hidden="true" className="size-3.5" />
                  That page did not load.
                </p>
              ) : null}
              <button
                className="rounded-full bg-pulse-surface-alt px-8 py-3.5 text-pulse-cap font-bold text-pulse-ink transition-[background-color,transform] duration-100 ease-out hover:bg-pulse-surface active:scale-[0.97] active:bg-pulse-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink disabled:opacity-60 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100"
                disabled={loadingMore}
                onClick={loadMore}
                type="button"
              >
                {moreFailed ? "Try again" : "Load more milestones"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
