// Pulse's derived values, kept out of the components so they can be tested
// without a renderer, a clock or a timezone.
//
// Every date here is a UTC calendar day — Cloud's `YYYY-MM-DD` — and is treated
// as one. A `new Date("2026-08-08")` is midnight UTC, but reading `.getDate()`
// off it in Los Angeles gives the 7th, which is how a timeline silently shifts
// by a day west of Greenwich. Nothing below leaves UTC.
import type {
  ActionCounts,
  MilestoneStatus,
  RequiredAction,
  TimelineDay,
  TimelineEvent,
} from "@/shared/api/cloudGateway/types";

/** The window Cloud itself defaults to: `to`, and the 29 days before it. */
export const RANGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` → epoch milliseconds at UTC midnight. NaN for a loose date. */
export function dayValue(date: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
}

export function toDay(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** The UTC day `now` falls on, which is the day Cloud's default range ends. */
export function utcToday(now: number): string {
  return toDay(now);
}

/** The 30-day window ending on `to`. */
function rangeEndingOn(to: string): { from: string; to: string } {
  return { from: toDay(dayValue(to) - (RANGE_DAYS - 1) * DAY_MS), to };
}

/** The 30-day window ending on the UTC day `now` falls on. */
export function defaultRange(now: number): { from: string; to: string } {
  return rangeEndingOn(utcToday(now));
}

/**
 * The window a panel actually renders: Cloud's default 30 days, unless the last
 * observed day is older than that — then the 30 days ending on it. A milestone
 * that went quiet two months ago has a timeline; an empty rail over the last 30
 * days only hides it.
 *
 * `shifted` is false for the default window, and the caller sends no `from`/`to`
 * for it: Cloud derives the same window, and dates off the webview's clock would
 * disagree with the one Cloud describes. A shifted window is built from
 * `lastObserved`, which is Cloud's own date.
 */
export function timelineRange(
  now: number,
  lastObserved: string | null | undefined,
): { from: string; to: string; shifted: boolean } {
  const base = defaultRange(now);
  const last = lastObserved ? dayValue(lastObserved) : NaN;
  if (Number.isNaN(last) || last >= dayValue(base.from)) {
    return { ...base, shifted: false };
  }
  return { ...rangeEndingOn(lastObserved as string), shifted: true };
}

/**
 * Days Cloud observed nothing on between two observed ones: 0 when they are
 * adjacent, and negative for dates out of order or equal, which the rail treats
 * as no gap. It is what the rail's collapsed marker counts.
 */
export function dayGap(earlier: string, later: string): number {
  return (dayValue(later) - dayValue(earlier)) / DAY_MS - 1;
}

/**
 * True only for two adjacent UTC dates. The connector between two nodes means
 * "these days ran into each other"; drawn across a missing date it would claim
 * a status Cloud never derived for it.
 */
export function isConsecutive(earlier: string, later: string): boolean {
  return dayGap(earlier, later) === 0;
}

function formatUtc(date: string, options: Intl.DateTimeFormatOptions): string {
  const value = dayValue(date);
  if (Number.isNaN(value)) {
    return date;
  }
  return new Date(value).toLocaleDateString("en-US", {
    ...options,
    timeZone: "UTC",
  });
}

/**
 * A stage: one observed day, or a run of adjacent days Cloud read as neutral.
 *
 * Neutral means "observed, nothing classified", and a fortnight of it is one
 * fact, not fourteen. Collapsing the run gives the days that did move the room
 * to be read, and the run keeps its own dates so opening it still names them.
 * Only neutral compresses — two progress days are two things that happened.
 */
export type Stage = {
  /** The first date in the stage. Stable across a refresh, so it is the key. */
  key: string;
  status: MilestoneStatus;
  /** Oldest first, and never empty. One entry unless the stage is compressed. */
  days: readonly TimelineDay[];
  from: string;
  to: string;
  /** Days Cloud observed nothing on between the previous stage and this one. */
  gapBefore: number;
  eventCount: number;
  /** What stood open when the stage ended. */
  snapshot: ActionCounts;
  /** Movement across the whole stage, so a compressed run nets out. */
  changes: ActionCounts;
  eventsTruncated: boolean;
};

function sumCounts(list: readonly ActionCounts[]): ActionCounts {
  return ACTION_ORDER.reduce(
    (total, kind) => {
      total[kind] = list.reduce((sum, counts) => sum + counts[kind], 0);
      return total;
    },
    {} as ActionCounts,
  );
}

function toStage(days: readonly TimelineDay[], gapBefore: number): Stage {
  const last = days[days.length - 1];
  return {
    key: days[0].date,
    status: days[0].status,
    days,
    from: days[0].date,
    to: last.date,
    gapBefore,
    eventCount: days.reduce((sum, day) => sum + day.event_count, 0),
    snapshot: last.snapshot,
    changes: sumCounts(days.map((day) => day.changes)),
    eventsTruncated: days.some((day) => day.events_truncated),
  };
}

/** The rail's columns: Cloud's observed days, with the neutral runs folded. */
export function railStages(days: readonly TimelineDay[]): Stage[] {
  const runs: { days: TimelineDay[]; gapBefore: number }[] = [];

  for (const day of days) {
    const open = runs[runs.length - 1];
    const previous = open?.days[open.days.length - 1];
    if (
      previous &&
      day.status === "neutral" &&
      previous.status === "neutral" &&
      isConsecutive(previous.date, day.date)
    ) {
      open.days.push(day);
      continue;
    }
    runs.push({
      days: [day],
      gapBefore: previous ? Math.max(dayGap(previous.date, day.date), 0) : 0,
    });
  }

  return runs.map((run) => toStage(run.days, run.gapBefore));
}

/** Every event in the stage, oldest first, with the day each was observed on. */
export function stageEvents(
  stage: Stage,
): { event: TimelineEvent; date: string; status: MilestoneStatus }[] {
  return stage.days.flatMap((day) =>
    day.events.map((event) => ({
      event,
      date: day.date,
      status: day.status,
    })),
  );
}

/** `Jul 10`, and `Jul 10, 2025` only when the range crosses a year. */
export function dayLabel(date: string, crossesYears = false): string {
  return formatUtc(date, {
    month: "short",
    day: "numeric",
    ...(crossesYears ? { year: "numeric" } : {}),
  });
}

/**
 * A stage's dates under its node: `Jul 20` for one day, `Jul 20-26` for a run
 * inside one month, `Jul 28-Aug 3` across two. Hyphen, not a dash, so the label
 * is the string a copy-paste and a screen reader both get right.
 */
export function rangeLabel(from: string, to: string, withYear = false): string {
  if (from === to) {
    return dayLabel(from, withYear);
  }
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${dayLabel(from, withYear)}-${
    sameMonth && !withYear ? Number(to.slice(8, 10)) : dayLabel(to, withYear)
  }`;
}

/** `Friday, Aug 8` — the tooltip and the daily record's own heading. */
export function longDayLabel(date: string): string {
  return formatUtc(date, { weekday: "long", month: "short", day: "numeric" });
}

export function crossesYears(days: readonly string[]): boolean {
  return days.length > 0 && days[0].slice(0, 4) !== days[days.length - 1].slice(0, 4);
}

/** "today", "yesterday", "6 days ago" — for "Last observed …". */
export function observedLabel(date: string, now: number): string {
  const days = Math.round((dayValue(utcToday(now)) - dayValue(date)) / DAY_MS);
  if (!Number.isFinite(days)) {
    return date;
  }
  if (days <= 0) {
    return "today";
  }
  if (days === 1) {
    return "yesterday";
  }
  return `${days} days ago`;
}

/** `2 open decisions`, `1 open decision`, `0 open decisions`. */
export function countLabel(count: number, singular: string): string {
  return `${count} open ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * The order Cloud declares `ActionCounts` in. Fixed rather than derived from
 * `Object.keys`, so the breakdown reads the same on every panel regardless of
 * the order the keys arrived in.
 */
const ACTION_ORDER: readonly RequiredAction[] = [
  "review",
  "approval",
  "response",
  "decision",
  "execute",
  "unblock",
];

/** Every kind summed. Cloud guarantees all six keys, so this never defaults. */
export function openTotal(counts: ActionCounts): number {
  return ACTION_ORDER.reduce((sum, kind) => sum + counts[kind], 0);
}

/**
 * The nonzero kinds only, in Cloud's key order. A typical milestone has two or
 * three, so rendering all six would be four zeros of noise around the numbers
 * that matter; the total beside it is what keeps the omission honest.
 *
 * Zero is the test even for `changes`, where the value is signed: a kind that
 * did not move is not part of what moved.
 */
export function openParts(
  counts: ActionCounts,
): { kind: RequiredAction; value: number }[] {
  return ACTION_ORDER.filter((kind) => counts[kind] !== 0).map((kind) => ({
    kind,
    value: counts[kind],
  }));
}

/**
 * A signed delta. Hyphen-minus rather than a typographic minus so the string is
 * the one a screen reader and a copy-paste both get right.
 */
export function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * `decision_closed` → `Decision closed`. Cloud documents `reason` as "the rule
 * that fired" and adds rules over time, so this humanizes whatever arrives
 * rather than mapping a fixed list and rendering a raw token for the rest.
 */
export function humanizeReason(reason: string): string {
  const words = reason.replace(/[_-]+/g, " ").trim();
  if (!words) {
    return "Classified";
  }
  return words[0].toUpperCase() + words.slice(1);
}

// `confidenceLabel` and `provenanceLabel` lived here. Nothing draws Cloud's
// evidence any more, so nothing needs to phrase it.

export type StatusToken = {
  label: string;
  /** Node fill and connector colour. */
  fill: string;
  /** Icon and text colour. */
  ink: string;
};

/**
 * Design.md names exactly two semantics, error and success, and forbids a third
 * accent — the aubergine and the link blue are the whole chromatic system. So
 * status runs on the semantic tokens rather than four families out of stock
 * Tailwind, and `dependency` borrows the one colour Design.md does not define
 * (`--g6-pulse-warning`, declared in theme.css alongside the rest).
 *
 * There used to be a third slot here, a separate value for text on the cream
 * surface, because an emerald-600 landed near 3:1 on cream and had to drop two
 * steps while the canvas kept -600. That was a missing-token workaround: one
 * semantic token now clears AA on both backgrounds in both themes (the tightest
 * pair is success on cream at 4.6:1), so the slot is gone rather than ported.
 */
export const STATUS_TOKENS: Record<MilestoneStatus, StatusToken> = {
  progress: {
    label: "Progress",
    fill: "bg-pulse-success",
    ink: "text-pulse-success",
  },
  dependency: {
    label: "Dependency",
    fill: "bg-pulse-warning",
    ink: "text-pulse-warning",
  },
  regression: {
    label: "Regression",
    fill: "bg-pulse-error",
    ink: "text-pulse-error",
  },
  neutral: {
    label: "Neutral",
    fill: "bg-pulse-ink-mute",
    ink: "text-pulse-ink-mute",
  },
};

/**
 * The screen-reader sentence for a stage. Colour is never the only cue, so the
 * status name is in the accessible name of every node on the rail.
 */
export function stageLabel(stage: Stage): string {
  const dates =
    stage.days.length === 1
      ? longDayLabel(stage.from)
      : `${longDayLabel(stage.from)} to ${longDayLabel(stage.to)}, ${stage.days.length} days`;
  return `${dates}, ${STATUS_TOKENS[stage.status].label}, ${eventCountLabel(stage.eventCount)}`;
}

/** `14 days with nothing observed` — the rail's collapsed quiet run. */
export function gapLabel(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"} with nothing observed`;
}

/** `4 observed events`, `1 observed event`. */
export function eventCountLabel(count: number): string {
  return `${count} observed ${count === 1 ? "event" : "events"}`;
}
