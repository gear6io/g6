// Pulse's landing view: a facet column, four numbers, one row per milestone,
// and the detail on demand.
//
// It answers "what is moving, what is blocked, what regressed" and nothing else.
// There is no completion percentage here because Cloud derives none — a
// milestone has no single current health, only days do, which is why the health
// sits inside `last_activity` and never on the milestone itself.
//
// The page runs Design.md's palette rather than the app's Catppuccin tokens.
// Everything below reads from the `pulse-*` colour tokens; nothing hardcodes a
// hex, so both themes come from `theme.css`.
import { RefreshCw, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { generatedAge } from "@/features/cloudInbox/inbox";
import { AttentionBand } from "@/features/cloudPulse/AttentionBand";
import { MilestonePanel } from "@/features/cloudPulse/MilestonePanel";
import {
  MilestoneRow,
  MilestoneRowHeader,
} from "@/features/cloudPulse/MilestoneRow";
import { PulseFacets } from "@/features/cloudPulse/PulseFacets";
import {
  NO_FILTER,
  type PulseFilter,
  type PulseViewId,
  activeLabel,
  countLine,
  filterQuery,
  toggleStatus,
  viewFilter,
} from "@/features/cloudPulse/pulseView";
import { useCloudWindow } from "@/features/cloudShell/CloudWindowProvider";
import { useMilestoneTimelines } from "@/features/cloudPulse/useMilestoneTimelines";
import { attention, listMilestones } from "@/shared/api/cloudGateway/client";
import type {
  AttentionResponse,
  Milestone,
  MilestoneCounts,
  MilestoneListResponse,
  MilestoneStatus,
} from "@/shared/api/cloudGateway/types";

/**
 * A screenful of 44px rows and a little more. Larger than the old 12 because a
 * row is a fifth of a card's height, so the same scroll distance is now five
 * times as many milestones.
 */
const PAGE_SIZE = 40;

/**
 * `9 milestones. Updated 4m ago.` — the sentence the live region announces when
 * a refresh lands. Two sentences rather than a dot-separated strip: it is read
 * aloud as often as it is looked at.
 */
export function milestoneSummary(count: number, updated: string): string {
  return `${count} milestone${count === 1 ? "" : "s"}. Updated ${updated}.`;
}

type Page = {
  rows: Milestone[];
  cursor: string | null;
  counts: MilestoneCounts | null;
  generatedAt: string;
};

type State =
  | { status: "loading" }
  | { status: "ready"; page: Page }
  | { status: "error"; message: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The row's own shape, so the first paint does not resize under the reader. */
function RowSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex h-[42px] items-center gap-3.5 border-b border-pulse-hairline px-4"
    >
      <div className="h-3 flex-1 rounded bg-pulse-surface" />
      <div className="h-3 w-[108px] rounded bg-pulse-surface" />
      <div className="h-3 w-[66px] rounded bg-pulse-surface" />
      <div className="h-3 w-[168px] rounded bg-pulse-surface" />
      <div className="h-3 w-[92px] rounded bg-pulse-surface" />
    </div>
  );
}

/** Design.md's cream feature card, doing the list's empty and failed states. */
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
    <div className="g6-pulse-mesh m-6 rounded-2xl bg-pulse-surface px-6 py-12 text-center">
      <p className="text-pulse-title font-semibold text-pulse-ink">{title}</p>
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

export function PulseMilestones({
  /**
   * Cloud's own `q` — a milestone's subject, description and keywords. Set by
   * the ⌘K palette; empty is no filter, which is what Cloud does with it too.
   */
  query = "",
}: {
  query?: string;
} = {}) {
  // The conversation panel is the shell's, not this view's — a record opens it
  // and the shell renders it beside the content column.
  const { selectEvent, selectedEvent } = useCloudWindow();
  const [filter, setFilter] = useState<PulseFilter>(() => viewFilter("attention"));
  const [state, setState] = useState<State>({ status: "loading" });
  const [tiles, setTiles] = useState<AttentionResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const timelines = useMilestoneTimelines(refreshKey);

  // The palette's hit is a filter like any other, so it lands in the same value
  // the facets write to rather than in a second piece of state beside it.
  useEffect(() => {
    setFilter((current) => (current.q === query ? current : { ...current, q: query }));
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    // The rows stay on screen during a refresh; only the first read is a
    // loading list.
    setState((current) =>
      current.status === "ready" ? current : { status: "loading" },
    );
    listMilestones(filterQuery(filter, { limit: PAGE_SIZE }))
      .then((res: MilestoneListResponse) => {
        if (!cancelled) {
          setNow(Date.now());
          setState({
            status: "ready",
            page: {
              rows: res.data,
              cursor: res.page.next_cursor,
              counts: res.counts,
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
  }, [filter, refreshKey]);

  // The tiles are whole-tenant and carry no filter, so they are read once per
  // refresh rather than once per facet press: narrowing the list does not change
  // what regressed.
  useEffect(() => {
    let cancelled = false;
    attention()
      .then((value) => {
        if (!cancelled) {
          setTiles(value);
        }
      })
      // A failed strip is not a failed page. The list below it is the view;
      // four missing numbers are worth less than an error state over the rows.
      .catch(() => {
        if (!cancelled) {
          setTiles(null);
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
    // Every filter is resent with the cursor: a cursor is a position in a sort,
    // not a saved query, and Cloud pages the filtered collection only while the
    // filter is still on the request.
    listMilestones(
      filterQuery(filter, { limit: PAGE_SIZE, cursor: state.page.cursor }),
    )
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
                  counts: res.counts ?? current.page.counts,
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
  }, [filter, loadingMore, state]);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  const refreshing = refreshKey > 0 && state.status === "loading";

  const rows = state.status === "ready" ? state.page.rows : [];
  const counts = state.status === "ready" ? state.page.counts : null;
  const summary =
    state.status === "ready"
      ? milestoneSummary(rows.length, generatedAge(state.page.generatedAt, now))
      : "";
  const chip = activeLabel(filter);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const applyFilter = useCallback((next: PulseFilter) => {
    setFilter(next);
    // The panel is a milestone from the previous list. Keeping it open over a
    // list that no longer contains it shows detail for a row you cannot see.
    setSelectedId(null);
  }, []);

  const selectView = useCallback(
    (view: PulseViewId) => applyFilter({ ...viewFilter(view), q: query }),
    [applyFilter, query],
  );
  const selectStatus = useCallback(
    (status: MilestoneStatus) =>
      applyFilter({ ...toggleStatus(filter, status), quietDays: null }),
    [applyFilter, filter],
  );

  const onlyRegressed =
    filter.status.length === 1 && filter.status[0] === "regression";
  const onlyQuiet = filter.quietDays !== null;

  return (
    <div className="flex min-w-0 flex-1">
      <PulseFacets
        attention={tiles}
        counts={counts}
        filter={filter}
        onSelectStatus={selectStatus}
        onSelectView={selectView}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {tiles ? (
          <AttentionBand
            attention={tiles}
            onlyQuiet={onlyQuiet}
            onlyRegressed={onlyRegressed}
            onSelectQuiet={() =>
              applyFilter(
                onlyQuiet
                  ? { ...NO_FILTER, q: query }
                  : { ...NO_FILTER, q: query, quietDays: tiles.quiet.quiet_days },
              )
            }
            onSelectRegressed={() =>
              applyFilter(
                onlyRegressed
                  ? { ...NO_FILTER, q: query }
                  : { ...NO_FILTER, q: query, status: ["regression"] },
              )
            }
          />
        ) : null}

        {/* With facets in play, a list that does not state its own filter is a
            list you cannot trust: "nothing here" and "nothing here *under this
            filter*" are different sentences. */}
        <div className="flex shrink-0 items-center gap-2.5 border-b border-pulse-hairline px-4 py-1.5 text-2xs text-pulse-ink-mute">
          {chip ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-pulse-surface-alt py-0.5 pl-2.5 pr-1 font-semibold text-pulse-ink">
              {chip}
              <button
                aria-label="Clear filter"
                className="rounded-full p-0.5 text-pulse-ink-mute hover:text-pulse-ink focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink"
                onClick={() => applyFilter({ ...NO_FILTER, q: query })}
                type="button"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </span>
          ) : null}
          <span className="tabular-nums">{countLine(rows.length, counts)}</span>
          {/* Cloud sorts by `last_activity` descending and serves no other
              order, so this states the sort rather than offering one that does
              not exist. */}
          <span className="ml-auto font-semibold">Sorted by last observed</span>
          <button
            aria-label="Refresh milestones"
            className="rounded-md p-1 text-pulse-ink-mute transition-colors hover:bg-pulse-surface hover:text-pulse-ink focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink"
            onClick={refresh}
            title="Refresh milestones"
            type="button"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-3.5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
            />
          </button>
        </div>

        {/* Refresh, paging and every facet press change the list without moving
            focus, so the change is announced rather than only drawn. */}
        <p aria-live="polite" className="sr-only">
          {summary}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {state.status === "ready" && rows.length > 0 ? (
            <MilestoneRowHeader />
          ) : null}

          {state.status === "loading"
            ? [0, 1, 2, 3, 4, 5].map((row) => <RowSkeleton key={row} />)
            : null}

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
              action="Show all milestones"
              detail={
                chip
                  ? "No milestone matches this filter. Clearing it shows the rest."
                  : "Milestone progress will appear here when Cloud observes it."
              }
              onAction={() => applyFilter(viewFilter("all"))}
              title={chip ? "Nothing under this filter" : "No milestones"}
            />
          ) : null}

          {rows.map((milestone) => (
            <MilestoneRow
              key={milestone.id}
              milestone={milestone}
              now={now}
              onOpen={() =>
                setSelectedId((current) =>
                  current === milestone.id ? null : milestone.id,
                )
              }
              onRequest={timelines.request}
              selected={selectedId === milestone.id}
              timeline={timelines.get(milestone.id)}
            />
          ))}

          {loadingMore ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : null}

          {state.status === "ready" && state.page.cursor ? (
            <div className="flex flex-col items-center gap-2 py-5">
              {moreFailed ? (
                <p className="flex items-center gap-1.5 text-xs text-pulse-error">
                  <TriangleAlert aria-hidden="true" className="size-3.5" />
                  That page did not load.
                </p>
              ) : null}
              <button
                className="rounded-full bg-pulse-surface-alt px-8 py-2.5 text-pulse-cap font-bold text-pulse-ink transition-[background-color,transform] duration-100 ease-out hover:bg-pulse-surface active:scale-[0.97] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink disabled:opacity-60 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100"
                disabled={loadingMore}
                onClick={loadMore}
                type="button"
              >
                {moreFailed ? "Try again" : "Load more milestones"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Nothing was lost when the card became a row: the full rail, the counts,
          the stage record and the event list are all here, in the one place
          where a rail node is big enough to aim at. */}
      {selected ? (
        <aside
          aria-label={selected.subject}
          className="flex w-[396px] shrink-0 flex-col overflow-hidden border-l border-pulse-hairline shadow-panel-left"
        >
          <div className="flex shrink-0 items-start justify-between gap-2 border-b border-pulse-hairline px-4 py-2">
            <p className="min-w-0 truncate text-sm font-semibold text-pulse-ink">
              {selected.subject}
            </p>
            <button
              aria-label="Close detail"
              className="shrink-0 rounded-md p-1 text-pulse-ink-mute hover:bg-pulse-surface hover:text-pulse-ink focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink"
              onClick={() => setSelectedId(null)}
              type="button"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <MilestonePanel
              milestone={selected}
              now={now}
              onOpenEvent={selectEvent}
              onRequest={timelines.request}
              onRetry={timelines.retry}
              openEventId={selectedEvent?.id ?? null}
              timeline={timelines.get(selected.id)}
            />
          </div>
          <p className="shrink-0 border-t border-pulse-hairline px-4 py-2 text-2xs text-pulse-ink-mute">
            Read-only — Cloud does not post.
          </p>
        </aside>
      ) : null}
    </div>
  );
}
