// One milestone: what it is, what is open on it, how its last thirty days
// read, and — when a day is selected — why that day read the way it did.
//
// The panel is not a link and not a button. Only the nodes, the source links,
// Retry and the disclosure are interactive, because there is nowhere else for a
// milestone to go: Cloud serves no milestone detail view.
import { TriangleAlert, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";

import {
  STATUS_TOKENS,
  countLabel,
  observedLabel,
  openParts,
  openTotal,
  railStages,
  timelineRange,
} from "@/features/cloudPulse/milestones";
import { MilestoneRail } from "@/features/cloudPulse/MilestoneRail";
import { STATUS_FACET_LABEL } from "@/features/cloudPulse/pulseView";
import { StageRecord } from "@/features/cloudPulse/StageRecord";
import { StatusIcon } from "@/features/cloudPulse/StatusIcon";
import type { TimelineLoad } from "@/features/cloudPulse/useMilestoneTimelines";
import type {
  Milestone,
  TimelineEvent,
  TimelineQuery,
} from "@/shared/api/cloudGateway/types";

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
        <TriangleAlert
          aria-hidden="true"
          className="size-3.5 text-pulse-error"
        />
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
  onOpenEvent,
  onClose,
  openEventId,
  onRequest,
  onRetry,
  timeline,
  timelineQuery,
}: {
  milestone: Milestone;
  now: number;
  /** Opens an event's source conversation. Passed straight through to the record. */
  onOpenEvent?: (event: TimelineEvent) => void;
  onClose?: () => void;
  openEventId?: string | null;
  onRequest: (milestoneId: string, query?: TimelineQuery) => void;
  onRetry: (milestoneId: string, query?: TimelineQuery) => void;
  timeline: TimelineLoad | undefined;
  timelineQuery?: TimelineQuery;
}) {
  const [selected, setSelected] = useState<string | null | undefined>();

  const last = milestone.last_activity;
  // Explicit 7/30/90-day windows win. The shifted fallback remains for callers
  // that do not supply a window and would otherwise show an empty old rail.
  const range = timelineRange(now, last?.date);
  const query =
    timelineQuery ??
    (range.shifted ? { from: range.from, to: range.to } : undefined);
  const ref = useOnApproach(() => onRequest(milestone.id, query));

  const days = timeline?.status === "ready" ? timeline.value.days : [];
  const stages = railStages(days);
  const selectedKey =
    selected === undefined ? (stages.at(-1)?.key ?? null) : selected;
  const selectedIndex = stages.findIndex((stage) => stage.key === selectedKey);
  const selectedStage = selectedIndex >= 0 ? stages[selectedIndex] : null;
  const openPhrase = countLabel(openTotal(milestone.open), "action item");

  // A refresh can drop the stage that was open. Closing it beats leaving a
  // record on screen that the current range no longer contains.
  useEffect(() => {
    if (selectedKey && timeline?.status === "ready" && selectedIndex < 0) {
      setSelected(undefined);
    }
  }, [selectedIndex, selectedKey, timeline?.status]);

  useEffect(() => {
    setSelected(undefined);
  }, [milestone.id, timelineQuery?.from, timelineQuery?.to]);

  return (
    <article className="flex min-h-0 flex-1 flex-col bg-pulse-canvas" ref={ref}>
      <header className="flex shrink-0 items-start gap-2 border-b border-pulse-hairline py-3 pl-[18px] pr-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 break-words text-sm font-semibold leading-snug text-pulse-ink">
            {milestone.subject}
          </h3>
          {/* The slug used to sit here. It is a machine key, and `description`
              is the one line that says where the milestone actually stands —
              which is why it is no longer truncated to save twenty pixels. */}
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-pulse-ink-mute">
            {milestone.description}
          </p>
        </div>
        {onClose ? (
          <button
            aria-label="Close detail"
            className="shrink-0 rounded-md p-1.5 text-pulse-ink-mute transition-colors hover:bg-pulse-surface-alt hover:text-pulse-ink focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-5 pt-3.5">
        <div className="flex min-h-6 items-center gap-2">
          {last ? (
            <p
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-pulse-surface px-2.5 py-1 text-pulse-eyebrow font-bold uppercase ${STATUS_TOKENS[last.status].ink}`}
            >
              <StatusIcon className="size-3" status={last.status} />
              {STATUS_FACET_LABEL[last.status]}
            </p>
          ) : (
            <p className="text-xs text-pulse-ink-mute">Not observed yet</p>
          )}
          {last ? (
            <p className="ml-auto text-xs tabular-nums text-pulse-ink-mute">
              Last observed {observedLabel(last.date, now)}
            </p>
          ) : null}
        </div>

        {/* The reader's one quantitative moment. The total is the number the eye
          should land on, so it is the only display-scale type on the panel; the
          kinds are chips beside it. The pipe separators this replaced were
          punctuation doing a layout's job. */}
        <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {openTotal(milestone.open) === 0 ? (
            // Nothing open is not a statistic. Setting a zero in display type
            // gives the loudest thing in the reader to the one number that means
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
                {openTotal(milestone.open) === 1
                  ? "action item open"
                  : "action items open"}
              </span>
            </p>
          )}
          {openParts(milestone.open).map(({ kind, value }) => (
            <span
              className="inline-flex items-center rounded-full bg-pulse-surface px-2.5 py-1 text-pulse-eyebrow font-bold uppercase text-pulse-ink"
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
                selected={selectedKey}
                stages={stages}
              />
            )
          ) : null}
        </div>

        {/* The record animates itself out before unmounting, which it cannot do
          from a bare conditional — without this the exit never runs. */}
        <AnimatePresence initial={false}>
          {selectedStage ? (
            <StageRecord
              key={selectedStage.key}
              onOpenEvent={onOpenEvent}
              openEventId={openEventId}
              previousDate={
                selectedIndex > 0 ? stages[selectedIndex - 1].to : null
              }
              stage={selectedStage}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </article>
  );
}
