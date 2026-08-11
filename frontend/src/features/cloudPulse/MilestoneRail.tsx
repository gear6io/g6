// One continuous track: a node per stage Cloud observed, a dashed span where it
// observed nothing.
//
// The rail was the calendar once — thirty cells, three of them nodes — which
// spent the whole panel width on days nobody looked at. Now the observed stages
// are the columns and a quiet run costs one narrow marker that still says how
// long it ran. The track never breaks: a gap is drawn dashed and muted rather
// than left blank, because "nothing was observed between these two" is a fact
// about one timeline, not two.
//
// A run of neutral days is one node, since "observed, nothing classified" for
// eleven days running is one fact. Anything Cloud did classify keeps its own.
import { useCallback, useEffect, useRef } from "react";

import {
  STATUS_TOKENS,
  crossesYears,
  gapLabel,
  openParts,
  openTotal,
  rangeLabel,
  stageLabel,
} from "@/features/cloudPulse/milestones";
import type { Stage } from "@/features/cloudPulse/milestones";

/** A single day's node and its date label. Columns grow past this to fill. */
const DAY_MIN = 46;
/** A compressed run carries a range label, so it starts wider. */
const RUN_MIN = 84;
/** A quiet run costs this much and never more, however long it ran. */
const GAP_WIDTH = 36;
/** The pill's inset from its cell (`inset-x-1`), where a run's track ends. */
const RUN_INSET = "4px";

function tooltip(stage: Stage): string {
  const parts = openParts(stage.snapshot);
  return [
    stageLabel(stage),
    [
      `${openTotal(stage.snapshot)} open`,
      ...parts.map(({ kind, value }) => `${kind} ${value}`),
    ].join(" · "),
  ].join("\n");
}

export function MilestoneRail({
  onSelect,
  selected,
  stages,
}: {
  onSelect: (key: string | null) => void;
  selected: string | null;
  stages: readonly Stage[];
}) {
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const scroller = useRef<HTMLDivElement>(null);
  const withYear = crossesYears(stages.flatMap((stage) => [stage.from, stage.to]));

  // The newest stage is what the panel is about, so a rail too long for its
  // panel opens on its right edge rather than on a month-old node.
  useEffect(() => {
    const el = scroller.current;
    if (el) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [stages]);

  /** Left and Right walk the stages; the gap markers are not stops. */
  const move = useCallback(
    (from: string, delta: number) => {
      const at = stages.findIndex((stage) => stage.key === from);
      const next = stages[at + delta];
      if (!next) {
        return;
      }
      const node = nodes.current.get(next.key);
      node?.focus();
      node?.scrollIntoView({ block: "nearest", inline: "center" });
    },
    [stages],
  );

  const jump = useCallback(
    (edge: "first" | "last") => {
      const stage = edge === "first" ? stages[0] : stages.at(-1);
      if (!stage) {
        return;
      }
      const node = nodes.current.get(stage.key);
      node?.focus();
      node?.scrollIntoView({ block: "nearest", inline: "center" });
    },
    [stages],
  );

  // A gap takes a narrow fixed column of its own before the stage that follows
  // it; the stages share whatever width is left, so a short rail fills its
  // panel and a long one scrolls.
  const columns = stages.flatMap((stage) => [
    ...(stage.gapBefore > 0 ? [{ min: GAP_WIDTH, grows: false }] : []),
    { min: stage.days.length > 1 ? RUN_MIN : DAY_MIN, grows: true },
  ]);

  return (
    <div className="g6-rail-scroll -mx-1 overflow-x-auto px-1 pb-1" ref={scroller}>
      <div
        className="grid"
        style={{
          gridTemplateColumns: columns
            .map(({ grows, min }) => (grows ? `minmax(${min}px, 1fr)` : `${min}px`))
            .join(" "),
          minWidth: columns.reduce((total, { min }) => total + min, 0),
        }}
      >
        {stages.map((stage, index) => {
          const token = STATUS_TOKENS[stage.status];
          const open = selected === stage.key;
          const run = stage.days.length > 1;
          // A run is drawn as a bar, not a point, so the track meets its edge
          // rather than running under it to the centre.
          const previous = stages[index - 1];
          const prevRun = (previous?.days.length ?? 0) > 1;
          const from = prevRun ? `-${RUN_INSET}` : "-50%";

          return [
            stage.gapBefore > 0 ? (
              <div className="relative h-[58px]" key={`gap-${stage.key}`}>
                {/* Edge of the previous node to the edge of the next, so the
                    quiet run joins the stages instead of severing them. */}
                <span
                  aria-hidden="true"
                  className="absolute top-[17px] border-t border-dashed border-border"
                  style={{ left: from, right: run ? `-${RUN_INSET}` : "-50%" }}
                />
                <span className="absolute left-1/2 top-[38px] -translate-x-1/2 whitespace-nowrap rounded bg-background px-1 text-[10px] tabular-nums text-muted-foreground/70">
                  <span aria-hidden="true">{stage.gapBefore}d</span>
                  <span className="sr-only">{gapLabel(stage.gapBefore)}</span>
                </span>
              </div>
            ) : null,

            <div className="relative h-[58px]" key={stage.key}>
              {previous && stage.gapBefore === 0 ? (
                <span
                  aria-hidden="true"
                  // The segment leaves the node it starts at, so it carries that
                  // node's status: an amber day runs amber into whatever follows.
                  className={`absolute top-[17px] h-0.5 ${STATUS_TOKENS[previous.status].fill} opacity-60`}
                  // Edge of the previous node to the edge of this one.
                  style={{ left: from, right: run ? `calc(100% - ${RUN_INSET})` : "50%" }}
                />
              ) : null}

              <button
                aria-label={stageLabel(stage)}
                aria-pressed={open}
                className={`absolute top-[2px] flex h-8 items-center justify-center rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${
                  run ? "inset-x-1" : "left-1/2 w-8 -translate-x-1/2"
                }`}
                onClick={() => onSelect(open ? null : stage.key)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    move(stage.key, event.key === "ArrowLeft" ? -1 : 1);
                  }
                  if (event.key === "Home" || event.key === "End") {
                    event.preventDefault();
                    jump(event.key === "Home" ? "first" : "last");
                  }
                  if (event.key === "Escape" && open) {
                    onSelect(null);
                  }
                }}
                ref={(node) => {
                  if (node) {
                    nodes.current.set(stage.key, node);
                  } else {
                    nodes.current.delete(stage.key);
                  }
                }}
                title={tooltip(stage)}
                type="button"
              >
                {/* A compressed run is drawn as the span it covers; a single
                    day stays a point. Both sit on the same track line. */}
                <span
                  aria-hidden="true"
                  className={[
                    "rounded-full transition-all duration-[120ms] motion-reduce:transition-none",
                    token.fill,
                    run ? "w-full" : "",
                    open
                      ? `h-[11px] ring-2 ring-foreground ring-offset-2 ring-offset-background ${run ? "" : "w-[11px]"}`
                      : `h-[9px] hover:h-[11px] ${run ? "" : "w-[9px] hover:w-[11px]"}`,
                  ].join(" ")}
                />
              </button>

              <span
                className={`absolute left-1/2 top-[38px] -translate-x-1/2 whitespace-nowrap text-[10px] ${
                  open ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {rangeLabel(stage.from, stage.to, withYear)}
              </span>
            </div>,
          ];
        })}
      </div>
    </div>
  );
}
