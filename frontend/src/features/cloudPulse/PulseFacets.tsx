// The facet column. At 247 milestones the list is everything at once unless
// something narrows it, and this is the thing that narrows it.
//
// Two groups, both of them filters Cloud serves. Team and Source are absent
// because the API has no team bucket and a milestone carries no provider; saved
// views are absent because nothing persists one. Those are gaps to fill in the
// service, not columns to draw over nothing.
//
// The health counts come from `counts.by_status`, which Cloud computes with the
// health filter **lifted** — so selecting "Regressed" leaves the other three
// reporting their real sizes and the column stays navigable instead of
// collapsing to one row and three zeros.
import type {
  AttentionResponse,
  MilestoneCounts,
  MilestoneStatus,
} from "@/shared/api/cloudGateway/types";

import { STATUS_TOKENS } from "@/features/cloudPulse/milestones";
import {
  type PulseFilter,
  type PulseViewId,
  STATUS_FACET_LABEL,
  STATUS_ORDER,
  VIEWS,
  activeView,
} from "@/features/cloudPulse/pulseView";

function GroupLabel({ children }: { children: string }) {
  return (
    <p className="px-2 pb-1 pt-3.5 text-badge font-bold uppercase tracking-wider text-pulse-ink-mute first:pt-1">
      {children}
    </p>
  );
}

function Facet({
  count,
  label,
  onSelect,
  pressed,
  swatch,
}: {
  /** Null while the collection's size is unknown; no number is drawn then. */
  count: number | null;
  label: string;
  onSelect: () => void;
  pressed: boolean;
  swatch?: string;
}) {
  return (
    <button
      aria-pressed={pressed}
      className={[
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm leading-snug transition-colors",
        "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink",
        pressed
          ? "bg-pulse-brand font-medium text-pulse-brand-fg"
          : "text-pulse-ink-mute hover:bg-pulse-surface-alt hover:text-pulse-ink",
      ].join(" ")}
      onClick={onSelect}
      type="button"
    >
      {/* The swatch is the same fill the rail and the sparkline use for that
          health, so one colour means one thing across the whole view. It is
          never the only cue — the word beside it says the same thing. */}
      {swatch ? (
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${swatch}`}
        />
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
      {count === null ? null : (
        <span
          className={`ml-auto shrink-0 text-2xs tabular-nums ${
            pressed ? "text-pulse-brand-fg/75" : ""
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function PulseFacets({
  attention,
  counts,
  filter,
  onSelectStatus,
  onSelectView,
}: {
  /** Only read for the regression total, which the tiles and the column share. */
  attention: AttentionResponse | null;
  counts: MilestoneCounts | null;
  filter: PulseFilter;
  onSelectStatus: (status: MilestoneStatus) => void;
  onSelectView: (view: PulseViewId) => void;
}) {
  const current = activeView(filter);

  // "Needs attention" is regressed plus at risk, and its count is the sum of
  // those two facets — the same rows, added the same way, so the view and the
  // facets underneath it cannot disagree.
  const attentionCount = counts
    ? counts.by_status.regression + counts.by_status.dependency
    : null;

  return (
    <aside
      aria-label="Filter milestones"
      className="w-[208px] shrink-0 overflow-y-auto border-r border-pulse-hairline px-2 pb-5 pt-2.5"
    >
      <GroupLabel>Views</GroupLabel>
      <Facet
        count={attentionCount}
        label={VIEWS.attention.label}
        onSelect={() => onSelectView("attention")}
        pressed={current === "attention"}
      />
      <Facet
        count={counts?.total ?? null}
        label={VIEWS.all.label}
        onSelect={() => onSelectView("all")}
        pressed={current === "all"}
      />

      <GroupLabel>Status</GroupLabel>
      {STATUS_ORDER.map((status) => (
        <Facet
          count={counts ? counts.by_status[status] : null}
          key={status}
          label={STATUS_FACET_LABEL[status]}
          onSelect={() => onSelectStatus(status)}
          pressed={filter.status.includes(status)}
          swatch={STATUS_TOKENS[status].fill}
        />
      ))}

      {/* Stated rather than silently missing. A facet column that stops at
          Status looks complete; one that says what it cannot group by yet is
          the difference between a gap and a bug. */}
      <p className="px-2 pt-5 text-2xs leading-relaxed text-pulse-ink-mute">
        Team and source are not filters Cloud serves yet.
        {attention ? ` Quiet is ≥${attention.quiet.quiet_days} days.` : ""}
      </p>
    </aside>
  );
}
