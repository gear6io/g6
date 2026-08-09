// Pulse's derived values, kept out of the components so they can be tested
// without a renderer, a clock or a timezone.
//
// Every date here is a UTC calendar day — Cloud's `YYYY-MM-DD` — and is treated
// as one. A `new Date("2026-08-08")` is midnight UTC, but reading `.getDate()`
// off it in Los Angeles gives the 7th, which is how a timeline silently shifts
// by a day west of Greenwich. Nothing below leaves UTC.
import type { MilestoneStatus, TimelineDay } from "@/shared/api/cloudGateway/types";

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

/**
 * The rail's cells: every calendar day in the range, observed or not. Built
 * from the range rather than from the returned days, because the empty cells
 * are the point — a gap between two nodes is a week nobody looked at.
 */
export function calendarDays(from: string, to: string): string[] {
  const start = dayValue(from);
  const end = dayValue(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return [];
  }
  const days: string[] = [];
  for (let at = start; at <= end; at += DAY_MS) {
    days.push(toDay(at));
  }
  return days;
}

/** The 30-day window ending on the UTC day `now` falls on. */
export function defaultRange(now: number): { from: string; to: string } {
  const to = utcToday(now);
  return { from: toDay(dayValue(to) - (RANGE_DAYS - 1) * DAY_MS), to };
}

/**
 * True only for two adjacent UTC dates. The connector between two nodes means
 * "these days ran into each other"; drawn across a missing date it would claim
 * a status Cloud never derived for it.
 */
export function isConsecutive(earlier: string, later: string): boolean {
  return dayValue(later) - dayValue(earlier) === DAY_MS;
}

/**
 * First day, last day, and every seventh in between — plus whichever day is
 * selected, so the record open below the rail always names itself.
 */
export function isLabelled(
  index: number,
  total: number,
  selectedIndex: number | null,
): boolean {
  return (
    index === 0 ||
    index === total - 1 ||
    index % 7 === 0 ||
    index === selectedIndex
  );
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

/** `Jul 10`, and `Jul 10, 2025` only when the range crosses a year. */
export function dayLabel(date: string, crossesYears = false): string {
  return formatUtc(date, {
    month: "short",
    day: "numeric",
    ...(crossesYears ? { year: "numeric" } : {}),
  });
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

/** `86%`, from Cloud's 0..1. Deterministic entries never show one. */
export function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export type StatusToken = {
  label: string;
  /** Node fill and connector colour. */
  fill: string;
  /** Icon and text colour. */
  text: string;
};

export const STATUS_TOKENS: Record<MilestoneStatus, StatusToken> = {
  progress: {
    label: "Progress",
    fill: "bg-emerald-600 dark:bg-emerald-400",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  dependency: {
    label: "Dependency",
    fill: "bg-amber-600 dark:bg-amber-400",
    text: "text-amber-600 dark:text-amber-400",
  },
  regression: {
    label: "Regression",
    fill: "bg-rose-600 dark:bg-rose-400",
    text: "text-rose-600 dark:text-rose-400",
  },
  neutral: {
    label: "Neutral",
    fill: "bg-slate-500 dark:bg-slate-400",
    text: "text-slate-500 dark:text-slate-400",
  },
};

/**
 * The screen-reader sentence for a node. Colour is never the only cue, so the
 * status name is in the accessible name of every node that has one.
 */
export function nodeLabel(day: TimelineDay): string {
  const events = `${day.event_count} observed ${day.event_count === 1 ? "activity" : "activities"}`;
  return `${longDayLabel(day.date)}, ${STATUS_TOKENS[day.status].label}, ${events}`;
}
