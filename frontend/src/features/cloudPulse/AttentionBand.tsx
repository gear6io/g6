// The four numbers above the list: what regressed, what is blocked, what went
// quiet, what finished. This is the thing a lead opens Pulse to learn, and
// before it existed the only way to learn it was to scroll.
//
// Each tile echoes the threshold Cloud computed it with, so "Blocked ≥5d" is
// rendered from `blocked.blocked_days` rather than from what this client asked
// for. Two of them are also the filter for their own set; two are not, because
// `/v1/milestones` has no blocked filter and a closed obligation is not a
// milestone the list can show at all. Those two are read, not pressed — a tile
// that looks identical to its neighbours and does nothing when clicked is worse
// than one that never offered.
import type { AttentionResponse } from "@/shared/api/cloudGateway/types";

const DAY_SECONDS = 24 * 60 * 60;

/** `11 days` — the oldest still-open blocker, in the unit the tile is thresholded in. */
export function longestBlockedLabel(seconds: number | null): string | null {
  if (seconds === null) {
    return null;
  }
  const days = Math.floor(seconds / DAY_SECONDS);
  if (days < 1) {
    return "longest: under a day";
  }
  return `longest: ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * `2 new since yesterday`. `entered` is the *entered set* — milestones at
 * regression now that were not `since_days` ago — not the difference of two
 * totals, which would read zero on a day three regressed and three recovered.
 */
export function enteredLabel(
  entered: number,
  sinceDays: number,
): string | null {
  if (entered === 0) {
    return null;
  }
  const window = sinceDays === 1 ? "since yesterday" : `in ${sinceDays} days`;
  return `${entered} new ${window}`;
}

const TONE = {
  bad: { edge: "border-l-pulse-error", ink: "text-pulse-error" },
  warn: { edge: "border-l-pulse-warning", ink: "text-pulse-warning" },
  ok: { edge: "border-l-pulse-success", ink: "text-pulse-success" },
} as const;

function Tile({
  detail,
  label,
  onSelect,
  pressed,
  tone,
  value,
}: {
  detail: string | null;
  label: string;
  /** Absent when Cloud has no filter for this set; the tile is then a number. */
  onSelect?: () => void;
  pressed?: boolean;
  tone: keyof typeof TONE;
  value: number;
}) {
  const body = (
    <>
      <span
        className={`text-[22px] font-bold leading-[1.15] tabular-nums ${TONE[tone].ink}`}
      >
        {value}
      </span>
      <span className="text-[11px] font-bold uppercase tracking-[0.8px] text-pulse-ink-mute">
        {label}
      </span>
      {/* The sub-line is dropped rather than rendered empty: "0 new since
          yesterday" is a sentence that makes a reader stop and check. */}
      <span className="text-[11px] text-pulse-ink-mute">{detail ?? " "}</span>
    </>
  );

  const shape = `flex min-w-0 flex-1 flex-col gap-px rounded-[10px] border border-l-[3px] border-pulse-hairline bg-pulse-canvas ${TONE[tone].edge} px-3 py-[9px] text-left`;

  if (!onSelect) {
    return <div className={shape}>{body}</div>;
  }
  return (
    <button
      aria-pressed={pressed}
      className={`${shape} transition-[background-color,border-color,box-shadow,transform] duration-150 hover:border-pulse-brand-ink hover:bg-pulse-surface-alt active:scale-[0.99] focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink ${
        pressed
          ? "bg-pulse-surface-alt shadow-[inset_0_0_0_1px_var(--g6-pulse-brand-tint)]"
          : ""
      }`}
      onClick={onSelect}
      type="button"
    >
      {body}
    </button>
  );
}

export function AttentionBand({
  attention,
  onlyQuiet,
  onlyRegressed,
  onSelectQuiet,
  onSelectRegressed,
}: {
  attention: AttentionResponse;
  onlyQuiet: boolean;
  onlyRegressed: boolean;
  onSelectQuiet: () => void;
  onSelectRegressed: () => void;
}) {
  const { blocked, closed, quiet, regressed } = attention;

  return (
    <div className="flex shrink-0 gap-2 border-b border-pulse-hairline bg-pulse-surface/35 px-4 pb-2.5 pt-3">
      <Tile
        detail={enteredLabel(regressed.entered, regressed.since_days)}
        label="Regressed"
        onSelect={onSelectRegressed}
        pressed={onlyRegressed}
        tone="bad"
        value={regressed.total}
      />
      {/* No filter exists for either of the next two, so neither pretends to be
          one. `/v1/milestones` selects on health and quietness; being blocked is
          a property of the obligations on a milestone, not of the milestone. */}
      <Tile
        detail={longestBlockedLabel(blocked.longest_seconds)}
        label={`Blocked ≥${blocked.blocked_days}d`}
        tone="warn"
        value={blocked.total}
      />
      <Tile
        detail={`no events in ${quiet.quiet_days}d`}
        label="Went quiet"
        onSelect={onSelectQuiet}
        pressed={onlyQuiet}
        tone="warn"
        value={quiet.total}
      />
      {/* "Action items", never "milestones": a milestone is not recorded as
          closed anywhere in this read model, and the grain is per contribution
          — one person blocking four work items is four of these. */}
      <Tile
        detail={`action items, last ${closed.closed_days}d`}
        label="Closed out"
        tone="ok"
        value={closed.total}
      />
    </div>
  );
}
