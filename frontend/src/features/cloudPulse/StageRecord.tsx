// One stage, opened underneath its node: what Cloud classified, what the
// milestone stood at when the stage ended, what moved, and the records the
// reading came from.
//
// A stage is one observed day, or a compressed run of neutral ones. When it is
// a run, the events are grouped under the day they landed on and that day's own
// state, because "which of these eleven days was that" is the first thing
// anybody asks of a compressed stretch.
import { ExternalLink, TriangleAlert } from "lucide-react";
import { useState } from "react";

import {
  STATUS_TOKENS,
  confidenceLabel,
  evidenceDetail,
  eventCountLabel,
  humanizeReason,
  longDayLabel,
  openParts,
  openTotal,
  rangeLabel,
  signed,
  stageEvents,
} from "@/features/cloudPulse/milestones";
import type { Stage } from "@/features/cloudPulse/milestones";
import { StatusIcon } from "@/features/cloudPulse/StatusIcon";
import type {
  ActionCounts,
  MilestoneStatus,
  TimelineEvent,
} from "@/shared/api/cloudGateway/types";

/** Rendered immediately; the rest are behind one press. */
const FIRST_EVENTS = 6;

type EventRow = { event: TimelineEvent; date: string; status: MilestoneStatus };

function Rows({ rows }: { rows: readonly { label: string; value: string }[] }) {
  return (
    <dl className="space-y-1.5">
      {rows.map(({ label, value }) => (
        <div className="flex items-baseline justify-between gap-3" key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-xs tabular-nums text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The total, then the kinds that are actually open. All six every time would be
 * four zeros crowding a 240px column; the total is what makes the omission safe
 * to read.
 */
function snapshotRows(snapshot: ActionCounts) {
  return [
    { label: "Total open", value: String(openTotal(snapshot)) },
    ...openParts(snapshot).map(({ kind, value }) => ({
      label: humanizeReason(kind),
      value: String(value),
    })),
  ];
}

/** The same rule over signed movement: a kind that did not move did not move. */
function changeRows(changes: ActionCounts) {
  const moved = openParts(changes);
  if (moved.length === 0) {
    return [{ label: "No movement", value: "0" }];
  }
  return moved.map(({ kind, value }) => ({
    label: humanizeReason(kind),
    value: signed(value),
  }));
}

/** Consecutive rows on the same day, in the order Cloud returned them. */
function byDay(rows: readonly EventRow[]) {
  const groups: { date: string; status: MilestoneStatus; rows: EventRow[] }[] = [];
  for (const row of rows) {
    const open = groups[groups.length - 1];
    if (open && open.date === row.date) {
      open.rows.push(row);
      continue;
    }
    groups.push({ date: row.date, status: row.status, rows: [row] });
  }
  return groups;
}

function EventLine({ event }: { event: TimelineEvent }) {
  const at = new Date(event.occurred_at);
  const time = Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <li className="flex min-h-7 items-baseline gap-3 text-xs">
      <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{time}</span>
      <span className="w-[72px] shrink-0 truncate text-muted-foreground">
        {/* Title-cased for reading; the raw provider stays in the label. */}
        <span aria-label={event.provider} className="capitalize">
          {event.provider}
        </span>
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground" title={event.summary}>
        {event.summary}
      </span>
      {event.url ? (
        <a
          className="inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
          href={event.url}
          rel="noreferrer noopener"
          target="_blank"
        >
          Open
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      ) : null}
    </li>
  );
}

export function StageRecord({
  previousDate,
  stage,
}: {
  /** The last date of the previous *returned* stage: what `changes` measures from. */
  previousDate: string | null;
  stage: Stage;
}) {
  const [expanded, setExpanded] = useState(false);
  const token = STATUS_TOKENS[stage.status];
  const compressed = stage.days.length > 1;

  const all = stageEvents(stage);
  const shown = expanded ? all : all.slice(0, FIRST_EVENTS);
  const groups = compressed ? byDay(shown) : [];

  return (
    <div className="mt-4 border-t border-border pt-4 duration-[180ms] animate-in fade-in slide-in-from-top-1 motion-reduce:animate-none">
      {/* One separator on the line: the status icon already breaks the dates
          from the state, so only the event count needs a dot. */}
      <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
        <span>
          {compressed
            ? rangeLabel(stage.from, stage.to)
            : longDayLabel(stage.from)}
        </span>
        <StatusIcon className={`size-3.5 ${token.text}`} status={stage.status} />
        <span className={token.text}>{token.label}</span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <span className="font-normal text-muted-foreground">
          {compressed
            ? `${stage.days.length} days · ${eventCountLabel(stage.eventCount)}`
            : eventCountLabel(stage.eventCount)}
        </span>
      </h4>

      <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,1fr)_240px] md:divide-x md:divide-border">
        <div className="order-2 space-y-5 md:order-1 md:pr-6">
          <section>
            <h5 className="text-xs font-semibold text-foreground">
              {compressed ? "What Cloud classified" : "Why this day moved"}
            </h5>

            {stage.evidence.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {/* Neutral is Cloud observing records and classifying none of
                    them, so an empty list here is the state itself. */}
                Cloud observed these records and classified none of them.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {stage.evidence.map((evidence, index) => {
                  // The state leads the line. `model_finding` and its kin are
                  // dropped by `evidenceDetail`: on a line that already reads
                  // "Progress · Analysis" they say nothing twice.
                  const detail = evidenceDetail(evidence);
                  return (
                    <li key={`${evidence.reason}-${index}`}>
                      <p className="flex items-center gap-1.5 text-xs">
                        <StatusIcon
                          className={`size-3.5 ${STATUS_TOKENS[evidence.classification].text}`}
                          status={evidence.classification}
                        />
                        <span
                          className={`font-medium ${STATUS_TOKENS[evidence.classification].text}`}
                        >
                          {STATUS_TOKENS[evidence.classification].label}
                        </span>
                        <span aria-hidden="true" className="text-muted-foreground">
                          ·
                        </span>
                        <span className="text-muted-foreground">
                          {evidence.provenance === "deterministic"
                            ? // A workflow fact is not a probability, so its
                              // 1.0 is not shown as one.
                              "Workflow fact"
                            : `Analysis (${confidenceLabel(evidence.confidence)} confidence)`}
                        </span>
                      </p>
                      {detail ? (
                        <p className="mt-0.5 pl-5 text-2xs text-foreground/80">
                          {detail}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h5 className="text-xs font-semibold text-foreground">Events</h5>

            {stage.eventsTruncated ? (
              <p className="mt-2 flex items-start gap-1.5 text-2xs text-muted-foreground">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                Cloud limited events for these dates. Health and counts are
                complete.
              </p>
            ) : null}

            {all.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {stage.eventsTruncated
                  ? "No events were returned for these dates."
                  : "No events were recorded."}
              </p>
            ) : compressed ? (
              // Every event under the day it landed on and that day's own
              // state: a compressed stretch must still say which day was which.
              <div className="mt-2 space-y-3">
                {groups.map((group) => (
                  <div key={group.date}>
                    <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {longDayLabel(group.date)}
                      </span>
                      <StatusIcon
                        className={`size-3 ${STATUS_TOKENS[group.status].text}`}
                        status={group.status}
                      />
                      <span className={STATUS_TOKENS[group.status].text}>
                        {STATUS_TOKENS[group.status].label}
                      </span>
                    </p>
                    <ul className="mt-1 divide-y divide-border/60">
                      {group.rows.map(({ event }) => (
                        <EventLine event={event} key={event.id} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-border/60">
                {shown.map(({ event }) => (
                  <EventLine event={event} key={event.id} />
                ))}
              </ul>
            )}

            {all.length > FIRST_EVENTS ? (
              <button
                className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => setExpanded((open) => !open)}
                type="button"
              >
                {expanded ? "Show fewer" : `Show all ${all.length} events`}
              </button>
            ) : null}
          </section>
        </div>

        <div className="order-1 space-y-5 md:order-2 md:pl-6">
          <section>
            <h5 className="text-xs font-semibold text-foreground">
              {compressed ? "State when the stretch ended" : "End-of-day state"}
            </h5>
            <div className="mt-2">
              <Rows rows={snapshotRows(stage.snapshot)} />
            </div>
          </section>

          <section>
            <h5 className="text-xs font-semibold text-foreground">
              {previousDate
                ? `Change since ${longDayLabel(previousDate)}`
                : "Change at start of range"}
            </h5>
            <div className="mt-2">
              {/* Foreground for every value: a falling count is not always good
                  and a rising one is not always bad, and the evidence above is
                  what explains the stage. */}
              <Rows rows={changeRows(stage.changes)} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
