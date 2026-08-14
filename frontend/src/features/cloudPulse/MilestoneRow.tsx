// One milestone, one 44px row.
//
// The card it replaces was ~210px tall with a full 30-day rail in it, so three
// fit on a screen and 247 milestones was 80 screens of scrolling. Eleven rows
// fit, and the comparison the eye actually wants — which of these is worse —
// finally happens inside one screen instead of across a scroll.
//
// The rail logic does not change. `railStages()` already compresses neutral runs
// and measures the gaps between observed days; the sparkline is that same output
// drawn small with the labels dropped. There is no second compression pass here,
// and there must not be: two of them would disagree the first time either moved.
import { useEffect } from "react";

import type {
  Milestone,
  MilestoneStatus,
  TimelineQuery,
} from "@/shared/api/cloudGateway/types";

import { generatedAge } from "@/features/cloudInbox/inbox";
import {
  type Stage,
  STATUS_TOKENS,
  openTotal,
  railStages,
  stageLabel,
} from "@/features/cloudPulse/milestones";
import type { TimelineLoad } from "@/features/cloudPulse/useMilestoneTimelines";

/** The health word a chip says. `neutral` is a reading, not a verdict. */
const CHIP_LABEL: Record<MilestoneStatus, string> = {
  regression: "Regressed",
  dependency: "At risk",
  progress: "On track",
  neutral: "Observed",
};

/**
 * One pip per observed stage, one dash per gap. A compressed neutral run is one
 * wide pip rather than one per day, which is the whole point of `railStages`:
 * the run is one fact, and drawing fourteen of it would make a quiet fortnight
 * the loudest thing in the row.
 *
 * The newest stage carries a ring so the eye lands on "where is this now"
 * without reading left to right — the row is scanned in a column of eleven, not
 * read on its own.
 */
export function Sparkline({ stages }: { stages: readonly Stage[] }) {
  return (
    <span className="flex h-4 items-center gap-[3px]">
      {stages.map((stage, index) => {
        const compressed = stage.days.length > 1;
        const last = index === stages.length - 1;
        return (
          <span className="contents" key={stage.key}>
            {stage.gapBefore > 0 ? (
              <span
                aria-hidden="true"
                className="block w-2.5 border-t border-dashed border-pulse-tint"
              />
            ) : null}
            <span
              aria-hidden="true"
              className={[
                "block h-[7px] shrink-0",
                compressed ? "w-[18px] rounded-full" : "w-[7px] rounded-full",
                STATUS_TOKENS[stage.status].fill,
                stage.status === "neutral" ? "opacity-45" : "",
                last
                  ? `ring-1 ring-offset-2 ring-offset-pulse-canvas ${RING[stage.status]}`
                  : "",
              ].join(" ")}
            />
          </span>
        );
      })}
    </span>
  );
}

/**
 * The ring is the same hue as the pip it surrounds. A single neutral ring would
 * read as "selected" on a row that is not selected — the ring here says newest,
 * and colour is what says which health.
 */
const RING: Record<MilestoneStatus, string> = {
  regression: "ring-pulse-error",
  dependency: "ring-pulse-warning",
  progress: "ring-pulse-success",
  neutral: "ring-pulse-ink-mute",
};

/** The grid both the header and every row are laid out on. One string, one truth. */
export const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_108px_66px_168px_92px] items-center gap-3.5 px-4";

export function MilestoneRowHeader({ days = 30 }: { days?: number } = {}) {
  return (
    <div
      className={`${ROW_GRID} sticky top-0 z-[3] border-b border-pulse-hairline bg-pulse-canvas/95 py-2 text-xs font-bold uppercase tracking-wider text-pulse-ink-mute backdrop-blur-sm`}
    >
      <span>Milestone</span>
      <span>Status</span>
      <span className="text-right">Open</span>
      <span>Last {days} days</span>
      <span className="text-right">Observed</span>
    </div>
  );
}

export function MilestoneRow({
  milestone,
  now,
  onOpen,
  onRequest,
  selected,
  timeline,
  timelineQuery,
}: {
  milestone: Milestone;
  now: number;
  onOpen: () => void;
  /** Asks for this milestone's timeline; idempotent, and queued four at a time. */
  onRequest: (milestoneId: string, query?: TimelineQuery) => void;
  selected: boolean;
  timeline: TimelineLoad | undefined;
  timelineQuery?: TimelineQuery;
}) {
  const status = milestone.last_activity?.status ?? null;
  const open = openTotal(milestone.open);
  const stages =
    timeline?.status === "ready" ? railStages(timeline.value.days) : [];

  // On mount, not on hover. The sparkline is the column the row is sold on, and
  // a version that filled in under the pointer left the list looking like it had
  // an empty column until you touched it. `request` is idempotent and the hook
  // queues four at a time, so a page of rows is a bounded burst rather than one
  // request per milestone in the collection.
  useEffect(() => {
    onRequest(milestone.id, timelineQuery);
  }, [milestone.id, onRequest, timelineQuery]);

  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={[
        ROW_GRID,
        "w-full border-b border-pulse-hairline py-2 text-left transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.998]",
        "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-pulse-brand-ink",
        selected
          ? "bg-pulse-surface-alt shadow-[inset_3px_0_0_0_var(--g6-pulse-brand-ink)]"
          : "hover:bg-pulse-surface-alt/60",
      ].join(" ")}
      onClick={onOpen}
      type="button"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-pulse-ink">
          {milestone.subject}
        </span>
        {/* The milestone's own description, not a team — Cloud has no team
            bucket, so the second line is what the lattice says this is. */}
        <span className="mt-0.5 block truncate text-xs text-pulse-ink-mute">
          {milestone.description}
        </span>
      </span>

      <span>
        {status ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full bg-pulse-surface px-2 py-0.5 text-badge font-bold uppercase tracking-wider ${STATUS_TOKENS[status].ink}`}
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-current"
            />
            {CHIP_LABEL[status]}
          </span>
        ) : (
          // Never observed is not a health. Cloud only returns these under
          // `has_no_activity`, and calling one "neutral" would state a reading
          // that was never taken.
          <span className="text-xs text-pulse-ink-mute">Never observed</span>
        )}
      </span>

      <span
        className={`text-right tabular-nums ${
          open > 0
            ? "text-sm font-bold text-pulse-ink"
            : "text-xs text-pulse-ink-mute"
        }`}
      >
        {open > 0 ? open : "—"}
      </span>

      {/* A row whose timeline has not landed draws nothing rather than a
          placeholder rail: an invented shape here would be read as a real one. */}
      <span aria-label={stages.length > 0 ? sparklineLabel(stages) : undefined}>
        {stages.length > 0 ? <Sparkline stages={stages} /> : null}
      </span>

      <span className="text-right text-xs tabular-nums text-pulse-ink-mute">
        {milestone.last_activity
          ? generatedAge(milestone.last_activity.observed_at, now)
          : "—"}
      </span>
    </button>
  );
}

/**
 * The sparkline's accessible name. The pips are `aria-hidden` because eight
 * unlabelled dots announce as nothing useful; the sentence names the newest
 * stage and how many there are, which is what the shape conveys at a glance.
 */
export function sparklineLabel(stages: readonly Stage[]): string {
  const newest = stages[stages.length - 1];
  return `${stages.length} observed ${stages.length === 1 ? "stage" : "stages"}, newest ${stageLabel(newest)}`;
}
