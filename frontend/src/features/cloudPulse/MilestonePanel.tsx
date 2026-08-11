// One milestone: what it is, what is open on it, how its last thirty days
// read, and — when a day is selected — why that day read the way it did.
//
// The panel is not a link and not a button. Only the nodes, the source links,
// Retry and the disclosure are interactive, because there is nowhere else for a
// milestone to go: Cloud serves no milestone detail view.
import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  STATUS_TOKENS,
  countLabel,
  eventCountLabel,
  observedLabel,
  openParts,
  openTotal,
  railStages,
  timelineRange,
} from "@/features/cloudPulse/milestones";
import { MilestoneRail } from "@/features/cloudPulse/MilestoneRail";
import { StageRecord } from "@/features/cloudPulse/StageRecord";
import { StatusIcon } from "@/features/cloudPulse/StatusIcon";
import type { TimelineLoad } from "@/features/cloudPulse/useMilestoneTimelines";
import type { Milestone, TimelineQuery } from "@/shared/api/cloudGateway/types";
import { Button } from "@/shared/ui/button";

/** Ask for a timeline a little before the panel is actually on screen. */
const PREFETCH_MARGIN = "300px";

function useOnApproach(onApproach: () => void) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    // No observer (the node test environment, an old webview): fetch rather
    // than render a panel that waits for an event that will never arrive.
    if (!node || typeof IntersectionObserver === "undefined") {
      onApproach();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onApproach();
          observer.disconnect();
        }
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onApproach]);

  return ref;
}

function RailSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-[58px] items-start gap-2 pt-3">
      <div className="h-0.5 flex-1 rounded bg-muted" />
    </div>
  );
}

function RailFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-[58px] flex-col justify-center gap-1">
      <p className="flex items-center gap-1.5 text-xs text-foreground">
        <TriangleAlert aria-hidden="true" className="size-3.5" />
        Timeline unavailable
      </p>
      <p className="flex items-center gap-2 text-2xs text-muted-foreground">
        <span className="truncate">{message}</span>
        <Button className="h-6 px-2 text-2xs" onClick={onRetry} size="sm" variant="outline">
          Retry timeline
        </Button>
      </p>
    </div>
  );
}

export function MilestonePanel({
  milestone,
  now,
  onRequest,
  onRetry,
  timeline,
}: {
  milestone: Milestone;
  now: number;
  onRequest: (milestoneId: string, query?: TimelineQuery) => void;
  onRetry: (milestoneId: string, query?: TimelineQuery) => void;
  timeline: TimelineLoad | undefined;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const last = milestone.last_activity;
  // A milestone last seen more than thirty days ago renders the thirty days
  // ending on that day instead of an empty rail over the current window.
  const range = timelineRange(now, last?.date);
  const query = range.shifted ? { from: range.from, to: range.to } : undefined;
  const ref = useOnApproach(() => onRequest(milestone.id, query));

  const days = timeline?.status === "ready" ? timeline.value.days : [];
  const stages = railStages(days);
  const selectedIndex = stages.findIndex((stage) => stage.key === selected);
  const selectedStage = selectedIndex >= 0 ? stages[selectedIndex] : null;

  // A refresh can drop the stage that was open. Closing it beats leaving a
  // record on screen that the current range no longer contains.
  useEffect(() => {
    if (selected && timeline?.status === "ready" && selectedIndex < 0) {
      setSelected(null);
    }
  }, [selected, selectedIndex, timeline?.status]);

  return (
    <article className="rounded-[14px] border border-border p-4 sm:p-5" ref={ref}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="line-clamp-2 break-words text-base font-semibold text-foreground">
            {milestone.summary}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {milestone.slug}
          </p>
        </div>

        <div className="shrink-0 sm:text-right">
          {last ? (
            // Recency lives once, under the rail. Here it would be the same
            // sentence twice on one panel.
            <p
              className={`flex items-center gap-1.5 text-xs font-medium sm:justify-end ${STATUS_TOKENS[last.status].text}`}
            >
              <StatusIcon className="size-3.5" status={last.status} />
              {STATUS_TOKENS[last.status].label}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs sm:gap-4">
        {[
          // The total leads, because a breakdown that hides its zeros needs one
          // number that does not.
          countLabel(openTotal(milestone.open), "action item"),
          ...openParts(milestone.open).map(({ kind, value }) => `${value} ${kind}`),
        ].map((label, index) => (
          <span className="flex items-center gap-4" key={label}>
            {index > 0 ? (
              <span aria-hidden="true" className="hidden text-border sm:inline">
                │
              </span>
            ) : null}
            <span className="text-muted-foreground">{label}</span>
          </span>
        ))}
      </div>

      <div className="mt-3">
        {!timeline || timeline.status === "loading" ? <RailSkeleton /> : null}
        {timeline?.status === "error" ? (
          <RailFailure
            message={timeline.message}
            onRetry={() => onRetry(milestone.id, query)}
          />
        ) : null}
        {timeline?.status === "ready" ? (
          days.length === 0 ? (
            <p className="flex h-[58px] items-center text-xs text-muted-foreground">
              {last
                ? // The window already follows the last observed day, so this
                  // is Cloud returning no days for a range it said had one.
                  "Nothing observed in this window."
                : "Nothing observed yet."}
            </p>
          ) : (
            <MilestoneRail
              onSelect={setSelected}
              selected={selected}
              stages={stages}
            />
          )
        ) : null}
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span className="truncate">
          {[
            last ? `Last observed ${observedLabel(last.date, now)}` : null,
            timeline?.status === "ready" && days.length > 0
              ? eventCountLabel(days.at(-1)?.event_count ?? 0)
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {selectedStage ? (
          <button
            className="shrink-0 underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setSelected(null)}
            type="button"
          >
            Hide record
          </button>
        ) : null}
      </div>

      {selectedStage ? (
        <StageRecord
          previousDate={selectedIndex > 0 ? stages[selectedIndex - 1].to : null}
          stage={selectedStage}
        />
      ) : null}
    </article>
  );
}
