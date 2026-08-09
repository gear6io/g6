// Thirty UTC days, and a node on each one Cloud observed.
//
// The cells are the calendar, not the data: a day nothing happened on is an
// empty cell, and the line between two nodes is drawn only when their dates are
// adjacent. A carried-forward status would say "still blocked" where Cloud only
// recorded "nobody looked".
import { useCallback, useRef } from "react";

import {
  STATUS_TOKENS,
  crossesYears,
  dayLabel,
  isConsecutive,
  isLabelled,
  longDayLabel,
  nodeLabel,
} from "@/features/cloudPulse/milestones";
import type { TimelineDay } from "@/shared/api/cloudGateway/types";

/** Below this the rail scrolls; 30 × 28px is the narrowest it reads at. */
const MIN_RAIL_WIDTH = 840;

function tooltip(day: TimelineDay): string {
  const { open_decisions, open_handoffs, open_constraints } = day.snapshot;
  return [
    longDayLabel(day.date),
    STATUS_TOKENS[day.status].label,
    `${day.event_count} observed ${day.event_count === 1 ? "activity" : "activities"}`,
    `Open decisions ${open_decisions} · handoffs ${open_handoffs} · constraints ${open_constraints}`,
  ].join("\n");
}

export function MilestoneRail({
  calendar,
  days,
  onSelect,
  selected,
}: {
  calendar: readonly string[];
  days: readonly TimelineDay[];
  onSelect: (date: string | null) => void;
  selected: string | null;
}) {
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const observed = new Map(days.map((day) => [day.date, day]));
  const withYear = crossesYears(calendar);
  const selectedIndex = selected ? calendar.indexOf(selected) : -1;

  /**
   * Left and Right walk the observed days, skipping the empty cells between
   * them: they are the rail's items, and stepping through 23 unfocusable
   * calendar days to reach the next one is not navigation.
   */
  const move = useCallback(
    (from: string, delta: number) => {
      const order = days.map((day) => day.date);
      const at = order.indexOf(from);
      const next = order[at + delta];
      if (!next) {
        return;
      }
      const node = nodes.current.get(next);
      node?.focus();
      node?.scrollIntoView({ block: "nearest", inline: "center" });
    },
    [days],
  );

  const jump = useCallback(
    (edge: "first" | "last") => {
      const date = edge === "first" ? days[0]?.date : days.at(-1)?.date;
      if (!date) {
        return;
      }
      const node = nodes.current.get(date);
      node?.focus();
      node?.scrollIntoView({ block: "nearest", inline: "center" });
    },
    [days],
  );

  return (
    <div className="g6-rail-scroll -mx-1 overflow-x-auto px-1 pb-1">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${calendar.length}, minmax(28px, 1fr))`,
          minWidth: MIN_RAIL_WIDTH,
        }}
      >
        {calendar.map((date, index) => {
          const day = observed.get(date);
          const previous = index > 0 ? calendar[index - 1] : null;
          const connected =
            day && previous && observed.has(previous) && isConsecutive(previous, date);

          return (
            <div className="relative h-[58px]" key={date}>
              {connected ? (
                <span
                  aria-hidden="true"
                  className={`absolute top-[17px] h-0.5 ${STATUS_TOKENS[day.status].fill} opacity-60`}
                  // Centre of the previous cell to the centre of this one.
                  style={{ left: "-50%", width: "100%" }}
                />
              ) : null}

              {day ? (
                <button
                  aria-label={nodeLabel(day)}
                  aria-pressed={selected === date}
                  className="absolute left-1/2 top-[2px] flex size-8 -translate-x-1/2 items-center justify-center rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  key={date}
                  onClick={() => onSelect(selected === date ? null : date)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                      event.preventDefault();
                      move(date, event.key === "ArrowLeft" ? -1 : 1);
                    }
                    if (event.key === "Home" || event.key === "End") {
                      event.preventDefault();
                      jump(event.key === "Home" ? "first" : "last");
                    }
                    if (event.key === "Escape" && selected === date) {
                      onSelect(null);
                    }
                  }}
                  ref={(node) => {
                    if (node) {
                      nodes.current.set(date, node);
                    } else {
                      nodes.current.delete(date);
                    }
                  }}
                  title={tooltip(day)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={[
                      "rounded-full transition-all duration-[120ms] motion-reduce:transition-none",
                      STATUS_TOKENS[day.status].fill,
                      selected === date
                        ? "size-[11px] ring-2 ring-foreground ring-offset-2 ring-offset-background"
                        : "size-[9px] hover:size-[11px]",
                    ].join(" ")}
                  />
                </button>
              ) : null}

              {isLabelled(index, calendar.length, selectedIndex) ? (
                <span className="absolute left-1/2 top-[38px] -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground">
                  {dayLabel(date, withYear)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
