// One milestone: what it is, what is open on it, how its last thirty days
// read, and — when a day is selected — why that day read the way it did.
//
// The panel is not a link and not a button. Only the nodes, the source links,
// Retry and the disclosure are interactive, because there is nowhere else for a
// milestone to go: Cloud serves no milestone detail view.
import { TriangleAlert } from "lucide-react";
import { AnimatePresence } from "motion/react";
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
      <div className="h-0.5 flex-1 rounded bg-pulse-hairline" />
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
      <p className="flex items-center gap-1.5 text-xs text-pulse-ink">
        <TriangleAlert aria-hidden="true" className="size-3.5 text-pulse-error" />
        Timeline unavailable
      </p>
      <p className="flex items-center gap-2 text-2xs text-pulse-ink-mute">
        <span className="truncate">{message}</span>
        <button
          className="shrink-0 rounded-full border border-pulse-brand-ink px-3 py-1.5 text-2xs font-bold text-pulse-brand-ink transition-[background-color,transform] duration-100 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 hover:bg-pulse-surface-alt active:bg-pulse-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink"
          onClick={onRetry}
          type="button"
        >
          Retry timeline
        </button>
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
  const openPhrase = countLabel(openTotal(milestone.open), "action item");

  // A refresh can drop the stage that was open. Closing it beats leaving a
  // record on screen that the current range no longer contains.
  useEffect(() => {
    if (selected && timeline?.status === "ready" && selectedIndex < 0) {
      setSelected(null);
    }
  }, [selected, selectedIndex, timeline?.status]);

  return (
    <article
      className="overflow-hidden rounded-2xl border border-pulse-hairline bg-pulse-canvas p-6"
      ref={ref}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h3 className="line-clamp-2 break-words text-pulse-title font-semibold text-pulse-ink">
            {milestone.subject}
          </h3>
          {/* The slug used to sit here. It is a machine key, and `description`
              is the one line that says where the milestone actually stands —
              which is why it is no longer truncated to save twenty pixels. */}
          <p className="mt-1 line-clamp-2 text-pulse-caption text-pulse-ink-mute">
            {milestone.description}
          </p>
        </div>

        {last ? (
          // Recency lives once, under the rail. Here it would be the same
          // sentence twice on one panel.
          <p
            className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-pulse-surface px-3 py-1 text-pulse-eyebrow font-bold uppercase ${STATUS_TOKENS[last.status].ink}`}
          >
            <StatusIcon className="size-3.5" status={last.status} />
            {STATUS_TOKENS[last.status].label}
          </p>
        ) : null}
      </div>

      {/* The card's one quantitative moment. The total is the number the eye
          should land on, so it is the only display-scale type on the panel; the
          kinds are chips beside it. The pipe separators this replaced were
          punctuation doing a layout's job. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {openTotal(milestone.open) === 0 ? (
          // Nothing open is not a statistic. Setting a zero in display type
          // gives the loudest thing on the card to the one number that means
          // there is nothing to look at.
          <p className="text-xs text-pulse-ink-mute">{openPhrase}</p>
        ) : (
          <p className="flex items-baseline gap-2">
            {/* One sentence for a screen reader; a numeral and a label for an
                eye. Same string, read the way each one reads. */}
            <span className="sr-only">{openPhrase}</span>
            <span
              aria-hidden="true"
              className="text-pulse-heading font-bold text-pulse-brand-ink"
            >
              {openTotal(milestone.open)}
            </span>
            <span aria-hidden="true" className="text-xs text-pulse-ink-mute">
              {openPhrase.slice(String(openTotal(milestone.open)).length + 1)}
            </span>
          </p>
        )}
        {openParts(milestone.open).map(({ kind, value }) => (
          <span
            className="inline-flex items-center rounded-full bg-pulse-surface px-3 py-1 text-pulse-eyebrow font-bold uppercase text-pulse-ink"
            key={kind}
          >
            {/* One string, not two children: adjacent JSX expressions are split
                by comment markers in the server renderer, and this label is
                read as one phrase. */}
            {`${value} ${kind}`}
          </span>
        ))}
      </div>

      <div className="mt-4">
        {!timeline || timeline.status === "loading" ? <RailSkeleton /> : null}
        {timeline?.status === "error" ? (
          <RailFailure
            message={timeline.message}
            onRetry={() => onRetry(milestone.id, query)}
          />
        ) : null}
        {timeline?.status === "ready" ? (
          days.length === 0 ? (
            <p className="flex h-[58px] items-center text-xs text-pulse-ink-mute">
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

      <div className="mt-3 flex items-baseline justify-between gap-3 text-xs text-pulse-ink-mute">
        <span className="truncate">
          {[
            last ? `Last observed ${observedLabel(last.date, now)}` : null,
            // This count is the last observed day's. An open record states its
            // own stage's, which is a different number under the same words a
            // line apart, so only one of them is on screen at a time.
            timeline?.status === "ready" && days.length > 0 && !selectedStage
              ? eventCountLabel(days.at(-1)?.event_count ?? 0)
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {selectedStage ? (
          <button
            className="shrink-0 rounded-full px-3 py-1.5 text-pulse-cap font-bold text-pulse-brand-ink transition-[background-color,transform] duration-100 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 hover:bg-pulse-surface-alt active:bg-pulse-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink"
            onClick={() => setSelected(null)}
            type="button"
          >
            Hide record
          </button>
        ) : null}
      </div>

      {/* The record animates itself out before unmounting, which it cannot do
          from a bare conditional — without this the exit never runs. */}
      <AnimatePresence initial={false}>
        {selectedStage ? (
          <StageRecord
            key={selectedStage.key}
            previousDate={selectedIndex > 0 ? stages[selectedIndex - 1].to : null}
            stage={selectedStage}
          />
        ) : null}
      </AnimatePresence>
    </article>
  );
}
