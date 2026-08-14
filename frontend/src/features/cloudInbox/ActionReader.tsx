// The reading pane: the obligation, why it is yours, the conversation it came
// from, and what else is open on the same milestone.
//
// Today a row states the obligation and the instruction, and the source thread
// lives one window away in Pulse. Here they are the same pane.
//
// Actions are navigation only. Cloud defines no mutation on one — the API is
// explicit that there is no acknowledge, snooze, assign or complete route,
// because that state lives in the source platforms and a mutation endpoint here
// would be a second source of truth nothing reconciles. So there is no Done and
// no Snooze, and the footer says so rather than leaving you to discover it by
// pressing something that does nothing.
import { ExternalLink, TriangleAlert } from "lucide-react";
import { useMemo } from "react";

import { CloudThreadConversation } from "@/features/cloudPulse/CloudThreadPanel";
import type { Action, TimelineEvent } from "@/shared/api/cloudGateway/types";

import {
  ACTION_LABEL,
  priorityLabel,
  relativeAge,
} from "@/features/cloudInbox/inbox";
import { siblingsOnMilestone } from "@/features/cloudInbox/inboxFacets";
import { ProviderIcon, hasProviderIcon } from "@/shared/ui/ProviderIcon";

/** Same two accents the rows use, for the same two meanings. */
const PRIORITY_TINT: Record<Action["priority"]["level"], string> = {
  p0: "border-pulse-error/40 bg-pulse-error/10 text-pulse-error",
  p1: "border-pulse-warning/40 bg-pulse-warning/10 text-pulse-warning",
  p2: "border-pulse-hairline text-pulse-ink-mute",
  p3: "border-pulse-hairline text-pulse-ink-mute",
};

function Crumb({
  children,
  label,
  onSelect,
}: {
  children: React.ReactNode;
  label: string;
  onSelect?: () => void;
}) {
  const body = (
    <>
      <span className="shrink-0 text-xs font-bold uppercase tracking-wider text-pulse-ink-mute">
        {label}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </>
  );
  const shape =
    "inline-flex max-w-full items-center gap-1.5 rounded-full bg-pulse-surface px-2.5 py-0.5 text-xs text-pulse-ink";

  if (!onSelect) {
    return <span className={shape}>{body}</span>;
  }
  return (
    <button
      className={`${shape} transition-colors hover:bg-pulse-surface-alt focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink`}
      onClick={onSelect}
      type="button"
    >
      {body}
    </button>
  );
}

export function ActionReader({
  action,
  actions,
  onOpenMilestone,
  onSelect,
}: {
  action: Action;
  /** The whole loaded list, for the siblings on the same milestone. */
  actions: readonly Action[];
  /** Jumps to Pulse filtered to this action's milestone. Absent when it has none. */
  onOpenMilestone?: (subject: string) => void;
  /** Moving between the related items keeps the reader on the same list. */
  onSelect: (action: Action) => void;
}) {
  const referent = action.referent;
  const siblings = siblingsOnMilestone(actions, action);
  const provider = referent?.provider ?? "";
  const conversationEvent = useMemo<TimelineEvent | null>(
    () =>
      referent?.thread_id
        ? {
            id: action.id,
            occurred_at: action.updated_at,
            provider,
            summary: referent.summary || action.subject,
            thread_id: referent.thread_id,
            type: "log",
            url: referent.url,
          }
        : null,
    [action, provider, referent],
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-pulse-hairline bg-pulse-surface/30 px-5 py-3.5">
        <div className="flex items-center gap-2 text-xs text-pulse-ink-mute">
          <span
            className={`rounded border px-1 font-semibold tabular-nums ${PRIORITY_TINT[action.priority.level]}`}
          >
            {priorityLabel(action.priority.level)}
          </span>
          <span>{ACTION_LABEL[action.required_action]}</span>
          <span aria-hidden="true" className="opacity-50">
            ·
          </span>
          <span>open {relativeAge(action.age_seconds)}</span>
        </div>

        <h2 className="mt-1.5 text-pulse-title font-semibold text-pulse-ink">
          {action.subject}
        </h2>
        {/* Cloud's fixed copy for the kind, not a generated sentence about this
            obligation. It says what the kind asks of you. */}
        <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-pulse-ink-mute">
          {action.instruction}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {action.entity ? (
            <Crumb
              label="Milestone"
              onSelect={
                onOpenMilestone
                  ? () => onOpenMilestone(action.entity?.subject ?? "")
                  : undefined
              }
            >
              {action.entity.subject}
            </Crumb>
          ) : null}
          {/* Drawn only where Cloud resolved a record. A placeholder here would
              be inventing a label Cloud refused to guess. */}
          {referent && (referent.summary || provider) ? (
            <Crumb label="Source">
              <span className="inline-flex items-center gap-1.5">
                {hasProviderIcon(provider) ? (
                  <ProviderIcon
                    className="size-3 shrink-0"
                    provider={provider}
                  />
                ) : null}
                {referent.summary || provider}
              </span>
            </Crumb>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {referent?.url ? (
            <a
              className="inline-flex items-center gap-1.5 rounded-full bg-pulse-brand px-4 py-1 text-xs font-bold text-pulse-brand-fg transition-[background-color,transform] active:scale-[0.98] hover:bg-pulse-press focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink"
              href={referent.url}
              rel="noreferrer noopener"
              target="_blank"
            >
              Open the source
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          ) : null}
          {action.entity && onOpenMilestone ? (
            <button
              className="rounded-full border-2 border-pulse-brand-ink px-4 py-0.5 text-xs font-bold text-pulse-brand-ink transition-[background-color,transform] active:scale-[0.98] hover:bg-pulse-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink"
              onClick={() => onOpenMilestone(action.entity?.subject ?? "")}
              type="button"
            >
              View milestone
            </button>
          ) : null}
          <span className="ml-auto text-xs text-pulse-ink-mute">
            Read-only — Cloud does not post or resolve.
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {/* "Why is this mine" is the question a row cannot answer. Cloud does
            answer it — an obligation is the viewer's exactly where a source
            named the account it is owed by, never guessed from who spoke last —
            so the pane says that rather than implying a judgement call. */}
        <div className="flex items-start gap-2 rounded-lg bg-pulse-surface px-3 py-2 text-xs leading-relaxed text-pulse-ink-mute">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0 text-pulse-warning"
          />
          <p>
            <b className="font-semibold text-pulse-ink">
              Why this is on your list:
            </b>{" "}
            a source named your account on this obligation
            {action.entity ? ` on ${action.entity.subject}` : ""}. It has been
            open {relativeAge(action.age_seconds)} and Cloud has not seen it
            resolved.
          </p>
        </div>

        {conversationEvent ? (
          <div className="mt-4">
            <CloudThreadConversation event={conversationEvent} />
          </div>
        ) : (
          <p className="mt-4 text-xs text-pulse-ink-mute">
            Cloud resolved no conversation for this obligation.
          </p>
        )}

        {siblings.length > 0 ? (
          <>
            <div className="mt-5 flex items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-pulse-ink-mute">
                Also open on this milestone
              </p>
              <span className="h-px flex-1 bg-pulse-hairline" />
            </div>
            <ul className="mt-1">
              {siblings.map((sibling) => (
                <li key={sibling.id}>
                  <button
                    className="grid w-full grid-cols-[auto_1fr_auto] items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-pulse-surface-alt focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink"
                    onClick={() => onSelect(sibling)}
                    type="button"
                  >
                    <span
                      className={`rounded border px-1 text-badge font-semibold tabular-nums ${PRIORITY_TINT[sibling.priority.level]}`}
                    >
                      {priorityLabel(sibling.priority.level)}
                    </span>
                    <span className="min-w-0 text-xs leading-relaxed text-pulse-ink">
                      <b className="font-semibold">
                        {ACTION_LABEL[sibling.required_action]}
                      </b>{" "}
                      — {sibling.subject}
                    </span>
                    <span className="shrink-0 text-badge tabular-nums text-pulse-ink-mute">
                      {relativeAge(sibling.age_seconds)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <p className="shrink-0 border-t border-pulse-hairline bg-pulse-surface/30 px-5 py-2 text-xs text-pulse-ink-mute">
        Cloud defines no action on an obligation — there is no Done and no
        Snooze. Resolving one happens where it was raised.
      </p>
    </div>
  );
}
