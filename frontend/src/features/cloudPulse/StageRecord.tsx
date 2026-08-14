// One stage, opened underneath its node: how it was classified, what the
// milestone stood at when it ended, what moved, and the records it was read
// from.
//
// A stage is one observed day, or a compressed run of neutral ones. When it is
// a run, the events are grouped under the day they landed on and that day's own
// state, because "which of these eleven days was that" is the first thing
// anybody asks of a compressed stretch.
//
// Cloud's `status_evidence` — the rationale and provenance behind the
// classification — is deliberately not drawn here. The record states the
// reading; it does not argue for it.
import { ExternalLink, TriangleAlert } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

import {
  STATUS_TOKENS,
  eventCountLabel,
  longDayLabel,
  openTotal,
  rangeLabel,
  stageEvents,
} from "@/features/cloudPulse/milestones";
import type { Stage } from "@/features/cloudPulse/milestones";
import { StatusIcon } from "@/features/cloudPulse/StatusIcon";
import type {
  MilestoneStatus,
  TimelineEvent,
} from "@/shared/api/cloudGateway/types";
import { canOpenThread } from "@/features/cloudPulse/CloudThreadPanel";
import { ProviderIcon, hasProviderIcon } from "@/shared/ui/ProviderIcon";

/** Rendered immediately; the rest are behind one press. */
const FIRST_EVENTS = 6;

type EventRow = { event: TimelineEvent; date: string; status: MilestoneStatus };

function movementLabel(stage: Stage, previousDate: string | null): string {
  const movement = openTotal(stage.changes);
  if (!previousDate) {
    return `${openTotal(stage.snapshot)} open at start of range`;
  }
  const previous = rangeLabel(previousDate, previousDate);
  if (movement > 0) {
    return `${movement} more open than ${previous}`;
  }
  if (movement < 0) {
    return `${Math.abs(movement)} fewer open than ${previous}`;
  }
  return `no net change since ${previous}`;
}

/** Consecutive rows on the same day, in the order Cloud returned them. */
function byDay(rows: readonly EventRow[]) {
  const groups: { date: string; status: MilestoneStatus; rows: EventRow[] }[] =
    [];
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

/**
 * `wait.open` → `wait opened`. Only the kinds that mean something different
 * from "something was written down" are worth a word; a `log` is the default
 * and saying so on every row would be noise on the majority of them.
 */
const EVENT_KINDS: Record<string, string> = {
  "span.event": "span",
  resolver: "resolver",
  "wait.close": "wait closed",
  "wait.open": "wait opened",
};

/**
 * Cloud leaves `provider` empty on most timeline events, and "Open in " is not
 * an accessible name.
 */
function openLabel(event: TimelineEvent): string {
  return event.provider ? `Open in ${event.provider}` : "Open the source";
}

function EventLine({
  event,
  onOpen,
  open,
}: {
  event: TimelineEvent;
  /** Absent where there is no panel to open into, which is every SSR test. */
  onOpen?: (event: TimelineEvent) => void;
  open?: boolean;
}) {
  const at = new Date(event.occurred_at);
  const time = Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleTimeString([], {
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
      });
  const kind = EVENT_KINDS[event.type];

  const body = (
    <>
      <span
        aria-label={event.provider}
        className="flex w-4 shrink-0 justify-center text-pulse-ink-mute"
        title={event.provider}
      >
        {hasProviderIcon(event.provider) ? (
          <ProviderIcon className="mt-0.5 size-3.5" provider={event.provider} />
        ) : (
          <span
            aria-hidden="true"
            className="text-pulse-eyebrow font-bold uppercase"
          >
            {event.provider.slice(0, 2)}
          </span>
        )}
      </span>
      <span className="min-w-0 text-xs leading-relaxed text-pulse-ink">
        {kind ? <span className="font-semibold">{`${kind} — `}</span> : null}
        <span className="line-clamp-2">{event.summary}</span>
      </span>
      <span className="shrink-0 whitespace-nowrap text-badge tabular-nums text-pulse-ink-mute">
        {time}
      </span>
    </>
  );

  // The conversation, in place. Offered only where Cloud can actually serve it:
  // the row needs a thread id, a provider with a resolver, and a panel to open
  // into. Any of those missing and the row keeps the behavior it always had.
  if (onOpen && canOpenThread(event)) {
    return (
      <li className="group flex items-start">
        <button
          aria-pressed={open}
          className={`grid min-w-0 flex-1 grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2 rounded-lg border px-2 py-2 text-left transition-colors active:bg-pulse-surface hover:bg-pulse-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink ${
            open
              ? "border-pulse-brand-ink bg-pulse-surface-alt"
              : "border-transparent"
          }`}
          onClick={() => onOpen(event)}
          type="button"
        >
          {body}
          <span className="sr-only">Show conversation</span>
        </button>
        {/* The link out survives alongside it: reading here and acting at the
            source are two different errands. */}
        {event.url ? (
          <a
            className="shrink-0 rounded p-2 text-pulse-link opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink group-hover:opacity-100 hover:opacity-100 motion-reduce:transition-none"
            href={event.url}
            rel="noreferrer noopener"
            target="_blank"
          >
            <ExternalLink aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{openLabel(event)}</span>
          </a>
        ) : null}
      </li>
    );
  }

  if (!event.url) {
    return (
      <li className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2 rounded-lg px-2 py-2">
        {body}
      </li>
    );
  }

  return (
    <li>
      {/* The row is the link. One "Open" per row was the same call to action
          repeated down the list; the whole row is a bigger target and says it
          once, in the hover. */}
      <a
        className="group grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2 rounded-lg border border-transparent px-2 py-2 transition-colors active:bg-pulse-surface hover:bg-pulse-surface-alt focus-visible:bg-pulse-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink"
        href={event.url}
        rel="noreferrer noopener"
        target="_blank"
      >
        {body}
        <span className="sr-only">{openLabel(event)}</span>
      </a>
    </li>
  );
}

export function StageRecord({
  onOpenEvent,
  openEventId,
  previousDate,
  stage,
}: {
  /** Opens an event's source conversation. Omitted where no panel exists. */
  onOpenEvent?: (event: TimelineEvent) => void;
  /** The event currently open in the panel, so its row can say so. */
  openEventId?: string | null;
  /** The last date of the previous *returned* stage: what `changes` measures from. */
  previousDate: string | null;
  stage: Stage;
}) {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();
  const token = STATUS_TOKENS[stage.status];
  const compressed = stage.days.length > 1;

  const all = stageEvents(stage);
  const shown = expanded ? all : all.slice(0, FIRST_EVENTS);
  const groups = compressed ? byDay(shown) : [];

  return (
    // Enter and exit along the same path. This used to be enter-only CSS
    // keyframes, so the record faded in and then vanished on the frame it
    // closed — the way out has to be the way in reversed, or the drawer reads
    // as two unrelated events. A critically damped spring (no overshoot: this
    // is a disclosure, not something the reader threw) at Apple's 0.3s
    // response. Only opacity and transform move; the height is left to layout
    // so the card does not relayout on every frame.
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 origin-top border-t border-pulse-hairline pt-3"
      exit={{ opacity: 0, y: reduced ? 0 : -4 }}
      initial={{ opacity: 0, y: reduced ? 0 : -4 }}
      transition={
        reduced
          ? { duration: 0.12 }
          : { type: "spring", bounce: 0, duration: 0.3 }
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-pulse-ink-mute">
        <h4 className="text-sm font-bold text-pulse-ink">
          {rangeLabel(stage.from, stage.to)}
        </h4>
        <span
          className={`inline-flex items-center gap-1 font-semibold ${token.ink}`}
        >
          <StatusIcon className="size-3" status={stage.status} />
          {token.label}
        </span>
        <span>
          {compressed ? `${stage.days.length} days · ` : ""}
          {eventCountLabel(stage.eventCount)} ·{" "}
          {movementLabel(stage, previousDate)}
        </span>
      </div>

      <div className="mt-1">
        {all.length === 0 ? (
          <p className="px-2 text-xs text-pulse-ink-mute">
            {stage.eventsTruncated
              ? "No events were returned for these dates."
              : "No events were recorded."}
          </p>
        ) : compressed ? (
          // Every event under the day it landed on and that day's own state: a
          // compressed stretch must still say which day was which.
          <div className="space-y-2.5">
            {groups.map((group) => (
              <div key={group.date}>
                <p className="flex items-center gap-1.5 px-2 pt-1 text-pulse-eyebrow font-bold uppercase">
                  <span className="text-pulse-ink">
                    {longDayLabel(group.date)}
                  </span>
                  <StatusIcon
                    className={`size-3 ${STATUS_TOKENS[group.status].ink}`}
                    status={group.status}
                  />
                  <span className={STATUS_TOKENS[group.status].ink}>
                    {STATUS_TOKENS[group.status].label}
                  </span>
                </p>
                <ul className="mt-0.5">
                  {group.rows.map(({ event }) => (
                    <EventLine
                      event={event}
                      key={event.id}
                      onOpen={onOpenEvent}
                      open={event.id === openEventId}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <ul>
            {shown.map(({ event }) => (
              <EventLine
                event={event}
                key={event.id}
                onOpen={onOpenEvent}
                open={event.id === openEventId}
              />
            ))}
          </ul>
        )}

        {all.length > FIRST_EVENTS ? (
          <button
            className="ml-2 mt-2 rounded-full bg-pulse-surface-alt px-4 py-2 text-pulse-cap font-bold text-pulse-ink transition-[background-color,transform] duration-100 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 hover:bg-pulse-surface active:bg-pulse-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink"
            onClick={() => setExpanded((open) => !open)}
            type="button"
          >
            {expanded ? "Show fewer" : `Show all ${all.length} events`}
          </button>
        ) : null}

        {/* A footnote about the list, so it sits after the list. */}
        {stage.eventsTruncated ? (
          <p className="mt-2 flex items-start gap-1.5 px-2 text-xs text-pulse-ink-mute">
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
            Cloud limited events for these dates. Health and counts are
            complete.
          </p>
        ) : null}
      </div>
    </motion.div>
  );
}
