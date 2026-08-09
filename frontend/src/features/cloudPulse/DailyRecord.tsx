// One observed day, opened underneath its node: why Cloud read it that way,
// what the milestone stood at when it ended, what moved, and the activities the
// reading came from.
import { ExternalLink, TriangleAlert } from "lucide-react";
import { useState } from "react";

import {
  STATUS_TOKENS,
  confidenceLabel,
  humanizeReason,
  longDayLabel,
  signed,
} from "@/features/cloudPulse/milestones";
import { StatusIcon } from "@/features/cloudPulse/StatusIcon";
import type {
  TimelineDay,
  TimelineSnapshot,
  TimelineSource,
} from "@/shared/api/cloudGateway/types";

/** Rendered immediately; the rest are behind one press. */
const FIRST_SOURCES = 6;

function Rows({
  rows,
}: {
  rows: readonly { label: string; value: string }[];
}) {
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

function snapshotRows(snapshot: TimelineSnapshot) {
  return [
    { label: "Open decisions", value: String(snapshot.open_decisions) },
    { label: "Open handoffs", value: String(snapshot.open_handoffs) },
    { label: "Open constraints", value: String(snapshot.open_constraints) },
    {
      label: "Constraint reach",
      value: `${snapshot.constraint_work_items} work items`,
    },
  ];
}

function changeRows(changes: TimelineSnapshot) {
  return [
    { label: "Open decisions", value: signed(changes.open_decisions) },
    { label: "Open handoffs", value: signed(changes.open_handoffs) },
    { label: "Open constraints", value: signed(changes.open_constraints) },
    { label: "Constraint reach", value: signed(changes.constraint_work_items) },
  ];
}

function SourceRow({ source }: { source: TimelineSource }) {
  const at = new Date(source.occurred_at);
  const time = Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <li className="flex min-h-7 items-baseline gap-3 text-xs">
      <span className="w-14 shrink-0 tabular-nums text-muted-foreground">
        {time}
      </span>
      <span className="w-[72px] shrink-0 truncate text-muted-foreground">
        {/* Title-cased for reading; the raw provider stays in the label. */}
        <span aria-label={source.provider} className="capitalize">
          {source.provider}
        </span>
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground" title={source.summary}>
        {source.summary}
      </span>
      {source.url ? (
        <a
          className="inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
          href={source.url}
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

export function DailyRecord({
  day,
  previousDate,
}: {
  day: TimelineDay;
  /** The previous *returned* day, which is what `changes` is measured against. */
  previousDate: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const sources = expanded ? day.sources : day.sources.slice(0, FIRST_SOURCES);
  const token = STATUS_TOKENS[day.status];

  return (
    <div className="mt-4 border-t border-border pt-4 duration-[180ms] animate-in fade-in slide-in-from-top-1 motion-reduce:animate-none">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span>{longDayLabel(day.date)}</span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <StatusIcon className={`size-3.5 ${token.text}`} status={day.status} />
        <span className={token.text}>{token.label}</span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <span className="font-normal text-muted-foreground">
          {day.event_count} observed{" "}
          {day.event_count === 1 ? "activity" : "activities"}
        </span>
      </h4>

      <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,1fr)_240px] md:divide-x md:divide-border">
        <div className="order-2 space-y-5 md:order-1 md:pr-6">
          <section>
            <h5 className="text-xs font-semibold text-foreground">
              Why this day moved
            </h5>
            <ul className="mt-2 space-y-2">
              {day.status_evidence.map((evidence, index) => (
                <li key={`${evidence.reason}-${index}`}>
                  <p className="flex items-center gap-1.5 text-xs text-foreground">
                    <StatusIcon
                      className={`size-3.5 ${STATUS_TOKENS[evidence.classification].text}`}
                      status={evidence.classification}
                    />
                    {humanizeReason(evidence.reason)}
                  </p>
                  <p className="mt-0.5 pl-5 text-2xs text-muted-foreground">
                    {evidence.provenance === "deterministic"
                      ? // A workflow fact is not a probability, so its 1.0 is
                        // not shown as one.
                        "Workflow fact"
                      : `Analysis · ${confidenceLabel(evidence.confidence)} confidence`}
                    {evidence.rationale ? ` · ${evidence.rationale}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h5 className="text-xs font-semibold text-foreground">
              Source activity
            </h5>

            {day.sources_truncated ? (
              <p className="mt-2 flex items-start gap-1.5 text-2xs text-muted-foreground">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                Cloud limited source activities for this date. Health and counts
                are complete.
              </p>
            ) : null}

            {day.sources.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {day.sources_truncated
                  ? "No source activities were returned for this date."
                  : "No source activities were recorded."}
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border/60">
                {sources.map((source) => (
                  <SourceRow key={source.id} source={source} />
                ))}
              </ul>
            )}

            {day.sources.length > FIRST_SOURCES ? (
              <button
                className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => setExpanded((open) => !open)}
                type="button"
              >
                {expanded
                  ? "Show fewer"
                  : `Show all ${day.sources.length} source activities`}
              </button>
            ) : null}
          </section>
        </div>

        <div className="order-1 space-y-5 md:order-2 md:pl-6">
          <section>
            <h5 className="text-xs font-semibold text-foreground">
              End-of-day state
            </h5>
            <div className="mt-2">
              <Rows rows={snapshotRows(day.snapshot)} />
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
                  what explains the day. */}
              <Rows rows={changeRows(day.changes)} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
