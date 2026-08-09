// Pulse's landing view: the active milestones, most recently touched first.
//
// It answers "what is moving, what is blocked, what regressed" and nothing
// else. There is no completion percentage here because Cloud derives none — a
// milestone has no single current health, only days do.
import { RefreshCw, Signal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { MilestonePanel } from "@/features/cloudPulse/MilestonePanel";
import { useMilestoneTimelines } from "@/features/cloudPulse/useMilestoneTimelines";
import { updatedLabel } from "@/features/cloudInbox/inbox";
import { listMilestones } from "@/shared/api/cloudGateway/client";
import type {
  Milestone,
  MilestoneListResponse,
} from "@/shared/api/cloudGateway/types";
import { Button } from "@/shared/ui/button";

/** A screenful and a bit. Cloud's own default page is 50. */
const PAGE_SIZE = 12;

type Page = { rows: Milestone[]; cursor: string | null; generatedAt: string };

type State =
  | { status: "loading" }
  | { status: "ready"; page: Page }
  | { status: "error"; message: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function PanelSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-[184px] rounded-[14px] border border-border p-5"
    >
      <div className="h-4 w-2/5 rounded bg-muted" />
      <div className="mt-2 h-3 w-1/5 rounded bg-muted" />
      <div className="mt-5 h-3 w-3/5 rounded bg-muted" />
      <div className="mt-6 h-0.5 w-full rounded bg-muted" />
    </div>
  );
}

export function PulseMilestones() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const timelines = useMilestoneTimelines(refreshKey);

  useEffect(() => {
    let cancelled = false;
    // The panels stay on screen during a refresh; only the first read shows a
    // loading page.
    setState((current) =>
      current.status === "ready" ? current : { status: "loading" },
    );
    listMilestones({ status: "active", limit: PAGE_SIZE })
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
    listMilestones({
      status: "active",
      limit: PAGE_SIZE,
      cursor: state.page.cursor,
    })
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
      .catch(() => {
        // The button stays, so the retry is the same press again.
      })
      .finally(() => setLoadingMore(false));
  }, [loadingMore, state]);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  const refreshing = refreshKey > 0 && state.status === "loading";

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 pb-10 pt-7 sm:px-7">
      <header className="sticky top-0 z-10 -mx-4 border-b border-border bg-background px-4 pb-3 sm:-mx-7 sm:px-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold text-foreground">Pulse</h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Active milestones
              {state.status === "ready"
                ? ` · ${updatedLabel(state.page.generatedAt, now)}`
                : ""}
            </p>
            <p className="text-xs text-muted-foreground">Last 30 UTC days</p>
          </div>
          <Button
            aria-label="Refresh milestone progress"
            className="size-7 text-foreground/80"
            onClick={refresh}
            size="icon"
            title="Refresh milestone progress"
            variant="ghost"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-3.5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
            />
          </Button>
        </div>
      </header>

      {state.status === "loading" ? (
        <div className="mt-5 space-y-4">
          {[0, 1, 2].map((row) => (
            <PanelSkeleton key={row} />
          ))}
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="mt-16 text-center">
          <Signal aria-hidden="true" className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold text-foreground">
            Could not load milestones
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{state.message}</p>
          <Button className="mt-4" onClick={refresh} size="sm" variant="outline">
            Refresh Pulse
          </Button>
        </div>
      ) : null}

      {state.status === "ready" && state.page.rows.length === 0 ? (
        <div className="mt-16 text-center">
          <Signal aria-hidden="true" className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold text-foreground">
            No active milestones
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Milestone progress will appear here when Cloud observes it.
          </p>
          <Button className="mt-4" onClick={refresh} size="sm" variant="outline">
            Refresh Pulse
          </Button>
        </div>
      ) : null}

      {state.status === "ready" && state.page.rows.length > 0 ? (
        <>
          <div className="mt-5 space-y-4">
            {state.page.rows.map((milestone) => (
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
            <Button
              className="mt-4 h-9 w-full"
              disabled={loadingMore}
              onClick={loadMore}
              variant="ghost"
            >
              Load more milestones
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
