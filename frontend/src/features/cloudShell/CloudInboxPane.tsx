// The wide inbox: facets, a list, and a reading pane.
//
// This stopped sharing `InboxBody` with the compact window. It was a 380px list
// rendered at 900px — same rows, more whitespace, and 340px of column doing
// nothing. The compact window keeps the single dense list, which is the right
// answer at 380px and the wrong one at 1180px; a wide window should buy
// something the narrow one cannot.
import { X } from "lucide-react";
import { useMemo, useState } from "react";

import { ActionReader } from "@/features/cloudInbox/ActionReader";
import { UserSelect } from "@/features/cloudInbox/CloudMiniInbox";
import {
  ACTION_LABEL,
  LANE_LABEL,
  LANE_ORDER,
  actionLane,
  priorityLabel,
  relativeAge,
  summaryLabel,
} from "@/features/cloudInbox/inbox";
import {
  type FacetEntry,
  type InboxFilter,
  NO_INBOX_FILTER,
  SCOPE_LABEL,
  applyFilter,
  inboxChip,
  kindFacets,
  milestoneFacets,
  newTodayCount,
  providerFacets,
} from "@/features/cloudInbox/inboxFacets";
import type { InboxOwner } from "@/features/cloudInbox/useCloudInbox";
import { useCloudWindow } from "@/features/cloudShell/CloudWindowProvider";
import type { Action, RequiredAction } from "@/shared/api/cloudGateway/types";
import { ProviderIcon, hasProviderIcon } from "@/shared/ui/ProviderIcon";

/** Same two accents the compact rows use, for the same two meanings. */
const PRIORITY_TINT: Record<Action["priority"]["level"], string> = {
  p0: "border-pulse-error/40 bg-pulse-error/10 text-pulse-error",
  p1: "border-pulse-warning/40 bg-pulse-warning/10 text-pulse-warning",
  p2: "border-pulse-hairline text-pulse-ink-mute",
  p3: "border-pulse-hairline text-pulse-ink-mute",
};

/** The lane tint on a row's left edge. Selection overrides it, so they never argue. */
const LANE_EDGE = {
  blocked: "border-l-pulse-error/55",
  today: "border-l-pulse-warning/55",
  later: "border-l-transparent",
} as const;

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
  /** Null draws no number at all, for a set whose size is not known yet. */
  count: number | null;
  label: string;
  onSelect: () => void;
  pressed: boolean;
  swatch?: React.ReactNode;
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
      {swatch ? <span className="w-3.5 shrink-0 text-center">{swatch}</span> : null}
      <span className="min-w-0 truncate">{label}</span>
      {count === null ? null : (
        <span
          className={`ml-auto shrink-0 text-2xs tabular-nums ${pressed ? "text-pulse-brand-fg/75" : ""}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function ActionRow({
  action,
  onSelect,
  selected,
}: {
  action: Action;
  onSelect: () => void;
  selected: boolean;
}) {
  const lane = actionLane(action.priority.level);
  const referent = action.referent;

  return (
    <li>
      <button
        aria-current={selected ? "true" : undefined}
        className={[
          "block w-full border-b border-l-[3px] border-pulse-hairline px-3 py-2 text-left transition-colors",
          "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-pulse-brand-ink",
          selected
            ? "border-l-pulse-brand-ink bg-pulse-surface-alt"
            : `${LANE_EDGE[lane]} hover:bg-pulse-surface-alt/60`,
        ].join(" ")}
        onClick={onSelect}
        type="button"
      >
        <span className="flex items-center gap-1.5 text-2xs text-pulse-ink-mute">
          <span
            className={`shrink-0 rounded border px-1 font-semibold tabular-nums ${PRIORITY_TINT[action.priority.level]}`}
          >
            {priorityLabel(action.priority.level)}
          </span>
          <span className="truncate">{ACTION_LABEL[action.required_action]}</span>
          <span className="ml-auto shrink-0 tabular-nums">
            {relativeAge(action.age_seconds)}
          </span>
        </span>

        <span className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-pulse-ink">
          {action.subject}
        </span>

        {/* Source and milestone on one line. An action carries an entity and a
            milestone's open counts are made of actions — this is where that
            connection is worth stating, and it is drawn only where Cloud
            resolved the referent it names. */}
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-badge text-pulse-ink-mute">
          {referent && hasProviderIcon(referent.provider) ? (
            <ProviderIcon className="size-3 shrink-0" provider={referent.provider} />
          ) : null}
          {referent?.summary ? (
            <span className="min-w-0 shrink truncate">{referent.summary}</span>
          ) : null}
          {referent?.summary && action.entity ? (
            <span aria-hidden="true" className="shrink-0 opacity-50">
              ·
            </span>
          ) : null}
          {action.entity ? (
            <span className="min-w-0 truncate">{action.entity.subject}</span>
          ) : null}
          {!referent?.summary && !action.entity ? (
            <span className="opacity-75">No source record resolved</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export function CloudInboxPane() {
  const { inbox: data, setView } = useCloudWindow();
  const { inbox, owner, retryInbox, select, selected, setOwner, users } = data;
  const [filter, setFilter] = useState<InboxFilter>(NO_INBOX_FILTER);
  const [openId, setOpenId] = useState<string | null>(null);

  const all = inbox.status === "ready" ? inbox.value.actions : [];
  const visible = useMemo(() => applyFilter(all, filter), [all, filter]);
  const open = useMemo(
    () => visible.find((action) => action.id === openId) ?? null,
    [openId, visible],
  );

  const kinds = useMemo(() => kindFacets(all, filter), [all, filter]);
  const milestones = useMemo(() => milestoneFacets(all, filter), [all, filter]);
  const providers = useMemo(() => providerFacets(all, filter), [all, filter]);
  const chip = inboxChip(filter, all);

  const lanes = useMemo(
    () =>
      LANE_ORDER.map((lane) => ({
        lane,
        rows: visible.filter((action) => actionLane(action.priority.level) === lane),
      })).filter((group) => group.rows.length > 0),
    [visible],
  );

  function selectScope(next: InboxOwner) {
    setOwner(next);
    // The facets describe the previous scope's rows. Keeping them would filter
    // the new list by a milestone that may not be in it.
    setFilter(NO_INBOX_FILTER);
    setOpenId(null);
  }

  return (
    <div className="flex min-w-0 flex-1">
      <aside
        aria-label="Filter actions"
        className="w-[208px] shrink-0 overflow-y-auto border-r border-pulse-hairline px-2 pb-5 pt-2.5"
      >
        <GroupLabel>Views</GroupLabel>
        {/* `me` and `anyone` are separate reads, not a client-side split: an
            obligation nobody was named on reaches no inbox at all, so the wider
            scope has rows the narrower one can never contain. */}
        {/* Only the scope in hand has a count: the other one's size is a read
            that has not happened, and rendering it as `0` would state a number
            about a list nobody has fetched. */}
        {(["me", "anyone"] as const).map((scope) => (
          <Facet
            count={scope === owner ? all.length : null}
            key={scope}
            label={SCOPE_LABEL[scope]}
            onSelect={() => selectScope(scope)}
            pressed={owner === scope && !filter.newToday}
          />
        ))}
        <Facet
          count={newTodayCount(all, filter)}
          label="New today"
          onSelect={() =>
            setFilter((current) => ({ ...current, newToday: !current.newToday }))
          }
          pressed={filter.newToday}
        />

        {kinds.length > 0 ? <GroupLabel>Action</GroupLabel> : null}
        {kinds.map((entry: FacetEntry) => (
          <Facet
            count={entry.count}
            key={entry.id}
            label={entry.label}
            onSelect={() =>
              setFilter((current) => ({
                ...current,
                kind:
                  current.kind === entry.id
                    ? null
                    : (entry.id as RequiredAction),
              }))
            }
            pressed={filter.kind === entry.id}
          />
        ))}

        {milestones.length > 0 ? <GroupLabel>Milestone</GroupLabel> : null}
        {milestones.map((entry) => (
          <Facet
            count={entry.count}
            key={entry.id || "none"}
            label={entry.label}
            onSelect={() =>
              setFilter((current) => ({
                ...current,
                milestoneId:
                  current.milestoneId === entry.id ? null : entry.id,
              }))
            }
            pressed={filter.milestoneId === entry.id}
          />
        ))}

        {providers.length > 0 ? <GroupLabel>Source</GroupLabel> : null}
        {providers.map((entry) => (
          <Facet
            count={entry.count}
            key={entry.id}
            label={entry.label}
            onSelect={() =>
              setFilter((current) => ({
                ...current,
                provider: current.provider === entry.id ? null : entry.id,
              }))
            }
            pressed={filter.provider === entry.id}
            swatch={
              hasProviderIcon(entry.id) ? (
                <ProviderIcon className="size-3" provider={entry.id} />
              ) : undefined
            }
          />
        ))}

        {users.status === "ready" && selected ? (
          <div className="mt-5 border-t border-pulse-hairline px-2 pt-2">
            <UserSelect onSelect={select} selected={selected} users={users.value} />
          </div>
        ) : null}
      </aside>

      <div className="flex w-[372px] shrink-0 flex-col border-r border-pulse-hairline">
        <div className="flex shrink-0 items-center gap-2 border-b border-pulse-hairline px-3 py-1.5 text-2xs text-pulse-ink-mute">
          {chip ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-pulse-surface-alt py-0.5 pl-2.5 pr-1 font-semibold text-pulse-ink">
              <span className="max-w-[150px] truncate">{chip}</span>
              <button
                aria-label="Clear filter"
                className="rounded-full p-0.5 text-pulse-ink-mute hover:text-pulse-ink focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink"
                onClick={() => setFilter({ ...NO_INBOX_FILTER, scope: filter.scope })}
                type="button"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </span>
          ) : null}
          <span className="tabular-nums">
            {visible.length} of {all.length}
          </span>
          {/* Cloud sorts by priority then opening instant and serves no other
              order, so the list states its sort rather than offering one. */}
          <span className="ml-auto font-semibold">By priority</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {inbox.status === "loading" ? (
            <p className="px-3 py-4 text-xs text-pulse-ink-mute">Loading actions…</p>
          ) : null}

          {inbox.status === "error" ? (
            <div className="px-3 py-4">
              <p className="text-sm font-semibold text-pulse-ink">
                Could not load this inbox
              </p>
              <p className="mt-1 text-xs text-pulse-ink-mute">{inbox.message}</p>
              <button
                className="mt-3 rounded-full border-2 border-pulse-brand-ink px-4 py-1 text-2xs font-bold text-pulse-brand-ink hover:bg-pulse-surface-alt focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pulse-brand-ink"
                onClick={retryInbox}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : null}

          {inbox.status === "ready" && visible.length === 0 ? (
            <p className="px-3 py-4 text-xs text-pulse-ink-mute">
              {chip
                ? "No action matches this filter. Clearing it shows the rest."
                : "This user has no open actions right now."}
            </p>
          ) : null}

          {/* Lane headings stay sticky, so "Blocked" is still visible ten rows
              into it. One list, not three: the rows are one sequence to arrow
              through and three lists would announce three. */}
          <ul>
            {lanes.map(({ lane, rows }) => (
              <li key={lane}>
                <p className="sticky top-0 z-[3] flex items-baseline gap-2 bg-pulse-canvas px-3 pb-1 pt-2.5 text-badge font-bold uppercase tracking-wider text-pulse-ink-mute">
                  <span className="tabular-nums text-pulse-ink">{rows.length}</span>
                  <span>{LANE_LABEL[lane]}</span>
                  <span aria-hidden="true" className="h-px flex-1 self-center bg-pulse-hairline" />
                </p>
                <ul>
                  {rows.map((action) => (
                    <ActionRow
                      action={action}
                      key={action.id}
                      onSelect={() => setOpenId(action.id)}
                      selected={openId === action.id}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>

        <p aria-live="polite" className="sr-only">
          {inbox.status === "ready"
            ? `${visible.length} actions shown${chip ? `, filtered to ${chip}` : ""}`
            : "Loading actions"}
        </p>
      </div>

      {open ? (
        <ActionReader
          action={open}
          actions={all}
          onOpenMilestone={() => setView("pulse")}
          onSelect={(next) => setOpenId(next.id)}
        />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <p className="text-sm font-semibold text-pulse-ink">
            Select an action to read it
          </p>
          <p className="mt-1 max-w-[44ch] text-xs leading-relaxed text-pulse-ink-mute">
            The reader shows why the obligation is yours, the record it came
            from, and what else is open on the same milestone.
          </p>
          {inbox.status === "ready" ? (
            <p className="mt-3 text-2xs text-pulse-ink-mute">
              {summaryLabel(inbox.value.overview)}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
