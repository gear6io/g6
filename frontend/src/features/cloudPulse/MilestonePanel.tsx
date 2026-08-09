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
  calendarDays,
  countLabel,
  defaultRange,
  observedLabel,
} from "@/features/cloudPulse/milestones";
import { DailyRecord } from "@/features/cloudPulse/DailyRecord";
import { MilestoneRail } from "@/features/cloudPulse/MilestoneRail";
import { StatusIcon } from "@/features/cloudPulse/StatusIcon";
import type { TimelineLoad } from "@/features/cloudPulse/useMilestoneTimelines";
import type { Milestone } from "@/shared/api/cloudGateway/types";
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
  onRequest: (milestoneId: string) => void;
  onRetry: (milestoneId: string) => void;
  timeline: TimelineLoad | undefined;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const ref = useOnApproach(() => onRequest(milestone.id));

  const days = timeline?.status === "ready" ? timeline.value.days : [];
  const range = defaultRange(now);
  const calendar = calendarDays(range.from, range.to);
  const selectedIndex = days.findIndex((day) => day.date === selected);
  const selectedDay = selectedIndex >= 0 ? days[selectedIndex] : null;

  // A refresh can drop the day that was open. Closing it beats leaving a record
  // on screen that the current range no longer contains.
  useEffect(() => {
    if (selected && timeline?.status === "ready" && selectedIndex < 0) {
      setSelected(null);
    }
  }, [selected, selectedIndex, timeline?.status]);

  const last = milestone.last_activity;

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
            <>
              <p
                className={`flex items-center gap-1.5 text-xs font-medium sm:justify-end ${STATUS_TOKENS[last.status].text}`}
              >
                <StatusIcon className="size-3.5" status={last.status} />
                {STATUS_TOKENS[last.status].label}
              </p>
              <p className="mt-0.5 text-2xs text-muted-foreground">
                Last observed {observedLabel(last.date, now)}
              </p>
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground sm:justify-end">
              <span
                aria-hidden="true"
                className="size-[9px] rounded-full border border-border"
              />
              No activity yet
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs sm:flex sm:items-center sm:gap-4">
        {[
          countLabel(milestone.open_decisions, "decision"),
          countLabel(milestone.open_handoffs, "handoff"),
          countLabel(milestone.open_constraints, "constraint"),
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
            onRetry={() => onRetry(milestone.id)}
          />
        ) : null}
        {timeline?.status === "ready" ? (
          days.length === 0 ? (
            <p className="flex h-[58px] items-center text-xs text-muted-foreground">
              No observed activity in the last 30 days.
            </p>
          ) : (
            <MilestoneRail
              calendar={calendar}
              days={days}
              onSelect={setSelected}
              selected={selected}
            />
          )
        ) : null}
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span className="truncate">
          {last ? `Last observed ${observedLabel(last.date, now)}` : "Not observed yet"}
          {timeline?.status === "ready" && days.length > 0
            ? ` · ${days.at(-1)?.event_count} activities`
            : ""}
        </span>
        {selectedDay ? (
          <button
            className="shrink-0 underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setSelected(null)}
            type="button"
          >
            Hide daily record
          </button>
        ) : null}
      </div>

      {selectedDay ? (
        <DailyRecord
          day={selectedDay}
          previousDate={selectedIndex > 0 ? days[selectedIndex - 1].date : null}
        />
      ) : null}
    </article>
  );
}
