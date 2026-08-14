// The 380x520 compact action inbox: one surface filling the window, and nothing
// else. No wide layout, no side navigation, no detail pane, no mutations — rows
// are read-only because Cloud defines no action on them yet.
//
// There is deliberately no decorative backdrop behind this. A gutter revealing
// one only works when the revealed thing reads as depth; at 18px around a
// 380px window it read as a coloured border drawn around the app instead. The
// window's own rounding and shadow do that job.
//
// Every visible string comes from the API or is fixed chrome copy. There is no
// resolved count, no channel and no person invented here, because `/v1/actions`
// supplies none of those. The source record on a row is Cloud's own `referent`,
// drawn only where Cloud resolved one.
import {
  CheckCheck,
  ChevronDown,
  CornerUpRight,
  EllipsisVertical,
  GitPullRequestArrow,
  Maximize2,
  Pin,
  Play,
  Scale,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";

import type {
  Action,
  CloudUser,
  OverviewResponse,
  RequiredAction,
} from "@/shared/api/cloudGateway/types";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Gear6Mark } from "@/shared/ui/g6-logo/Gear6Mark";
import { ProviderIcon, hasProviderIcon } from "@/shared/ui/ProviderIcon";

import {
  ACTION_LABEL,
  EMPTY_ACTIONS_COPY,
  LANE_LABEL,
  LANE_ORDER,
  type Lane,
  actionLane,
  laneGroups,
  priorityLabel,
  relativeAge,
  summaryLabel,
  updatedLabel,
  userLabel,
} from "@/features/cloudInbox/inbox";
import {
  CAN_LIST_USERS,
  type Inbox,
  type Load,
} from "@/features/cloudInbox/useCloudInbox";
import { useCloudWindow } from "@/features/cloudShell/CloudWindowProvider";

const ACTION_ICON: Record<RequiredAction, typeof CornerUpRight> = {
  review: GitPullRequestArrow,
  approval: CheckCheck,
  response: CornerUpRight,
  decision: Scale,
  execute: Play,
  unblock: TriangleAlert,
};

/**
 * Only `unblock` is tinted. The other five icons sit immediately left of
 * `ACTION_LABEL`, which names the action in words, so a per-kind hue was
 * decorating a label rather than carrying anything — six accents that Design.md
 * does not have and that no reader had to decode. `unblock` keeps its colour
 * because it is a state, not a category: it is the one row that is stuck.
 */
function actionIconTint(action: RequiredAction): string {
  return action === "unblock" ? "text-pulse-warning" : "";
}

/**
 * `p0` and `p1` are tinted because they are the reason a row is at the top;
 * `p2`/`p3` stay muted so the chip does not compete with the subject on a list
 * where most rows are one of them. The tint is the semantic pair rather than
 * rose/amber — same two meanings, stated in the palette that owns them.
 */
const PRIORITY_TINT: Record<Action["priority"]["level"], string> = {
  p0: "border-pulse-error/40 bg-pulse-error/10 text-pulse-error",
  p1: "border-pulse-warning/40 bg-pulse-warning/10 text-pulse-warning",
  p2: "border-pulse-hairline text-pulse-ink-mute",
  p3: "border-pulse-hairline text-pulse-ink-mute",
};

/**
 * The lane counter's tint, which is `PRIORITY_TINT`'s two accents restated on
 * one number each. `later` stays ink because a count with no accent is the
 * baseline the other two are read against — three tinted numbers is three
 * alarms, which is none.
 */
const LANE_TINT: Record<Lane, string> = {
  blocked: "text-pulse-error",
  today: "text-pulse-warning",
  later: "text-pulse-ink",
};

/* ---------------------------------------------------------------- chrome -- */

function PinButton() {
  const { pinned, togglePin } = useCloudWindow();

  return (
    <Button
      aria-label={pinned ? "Unpin window" : "Keep window on top"}
      aria-pressed={pinned}
      className="size-7 text-pulse-ink-mute"
      onClick={togglePin}
      size="icon"
      variant="ghost"
    >
      {/* Filled head for the pressed state: the outline alone reads the same
          at 16px whether the window is on top or not. */}
      <Pin aria-hidden="true" className={pinned ? "fill-current" : undefined} />
    </Button>
  );
}

/**
 * The one way into the full window. Stays live during the resize; a second
 * press is dropped by the provider rather than by a disabled attribute.
 *
 * Icon only, like the two beside it, but drawn on the surface fill: a word on
 * one of three same-weight controls is chrome a 42px bar cannot spare, and the
 * fill already says which of the three is the primary one. The label it lost
 * lives in `aria-label` and `title`, so nothing is lost to a screen reader or
 * to a hover.
 */
function ExpandButton() {
  const { expand } = useCloudWindow();

  return (
    <Button
      aria-label="Expand to full window"
      className="size-7 bg-pulse-surface text-pulse-ink hover:bg-pulse-brand hover:text-pulse-brand-fg"
      // Not `onClick={expand}`: that hands the click event over as the view.
      onClick={() => expand()}
      size="icon"
      title="Expand to full window"
      variant="ghost"
    >
      <Maximize2 aria-hidden="true" className="size-3.5" />
    </Button>
  );
}

/**
 * The three lane counters, and the filter for each. Counts are of the rows
 * actually returned, so the three of them always sum to the list below — a lane
 * total that disagreed with what you can scroll to is worse than no lane at all.
 *
 * A pressed lane filters to it; pressing it again clears. Unfiltered is the
 * default because the grouped list already answers "what is blocked" without a
 * click, and a filter that is on before you touch anything is a list quietly
 * hiding rows.
 */
function Lanes({
  actions,
  lane,
  onSelect,
}: {
  actions: readonly Action[];
  lane: Lane | null;
  onSelect: (next: Lane | null) => void;
}) {
  const counts = useMemo(() => {
    const tally: Record<Lane, number> = { blocked: 0, today: 0, later: 0 };
    for (const action of actions) {
      tally[actionLane(action.priority.level)] += 1;
    }
    return tally;
  }, [actions]);

  return (
    <div className="flex shrink-0 gap-1.5 px-3.5 pb-2">
      {LANE_ORDER.map((id) => (
        <button
          aria-pressed={lane === id}
          className={[
            "flex-1 rounded-lg border px-2 py-1 text-left transition-colors",
            "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink",
            lane === id
              ? "border-pulse-brand-ink bg-pulse-surface-alt"
              : "border-pulse-hairline hover:border-pulse-brand-ink",
          ].join(" ")}
          key={id}
          onClick={() => onSelect(lane === id ? null : id)}
          type="button"
        >
          <span
            className={`block text-lg font-bold leading-tight tabular-nums ${LANE_TINT[id]}`}
          >
            {counts[id]}
          </span>
          <span className="block text-badge font-bold uppercase tracking-wider text-pulse-ink-mute">
            {LANE_LABEL[id]}
          </span>
        </button>
      ))}
    </div>
  );
}

function OverflowMenu({ onRefresh }: { onRefresh: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Inbox options"
          className="size-7 text-pulse-ink-mute"
          size="icon"
          variant="ghost"
        >
          <EllipsisVertical aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {CAN_LIST_USERS ? (
          <DropdownMenuLabel className="text-2xs font-normal text-pulse-ink-mute">
            Development build
          </DropdownMenuLabel>
        ) : null}
        <DropdownMenuItem onSelect={onRefresh}>Refresh</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A native `<select>` with its chrome removed: it keeps platform keyboard
 * behaviour and escapes the panel's scroll clipping for free, which a custom
 * popover in a 342px panel would have to re-earn.
 */
export function UserSelect({
  onSelect,
  selected,
  users,
}: {
  onSelect: (accountId: string) => void;
  selected: string;
  users: readonly CloudUser[];
}) {
  const label = useMemo(() => {
    const user = users.find((candidate) => candidate.account_id === selected);
    return user ? userLabel(user) : selected;
  }, [selected, users]);

  return (
    <div className="relative flex h-8 items-center gap-1">
      <span className="truncate text-xs font-medium text-pulse-ink">
        {label}
      </span>
      <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-pulse-ink-mute" />
      <select
        aria-label="View actions as user"
        className="absolute inset-0 cursor-pointer appearance-none opacity-0"
        onChange={(event) => onSelect(event.target.value)}
        value={selected}
      >
        {users.map((user) => (
          <option key={user.account_id} value={user.account_id}>
            {userLabel(user)}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ------------------------------------------------------------------ rows -- */

/**
 * The source record the obligation arose from. Absent entirely when Cloud could
 * not resolve the reference, and its own fields are empty strings rather than
 * nulls where the record had nothing to show — in both cases nothing is drawn,
 * because a placeholder here would be inventing a label Cloud refused to guess.
 */
function ReferentLine({ referent }: { referent: Action["referent"] }) {
  if (!referent || (!referent.summary && !referent.provider)) {
    return null;
  }

  const icon = hasProviderIcon(referent.provider);

  return (
    <p className="mt-1 flex items-center gap-1.5 text-2xs text-pulse-ink-mute">
      {icon ? (
        <ProviderIcon
          className="size-3 shrink-0"
          provider={referent.provider}
        />
      ) : referent.provider ? (
        <span className="shrink-0 capitalize" aria-label={referent.provider}>
          {referent.provider}
        </span>
      ) : null}
      {referent.provider && referent.summary ? (
        <span aria-hidden="true">·</span>
      ) : null}
      <span className="min-w-0 truncate" title={referent.summary}>
        {referent.summary}
      </span>
    </p>
  );
}

/**
 * Clicking a row *is* the action on it: there is no separate "Open" affordance,
 * because a row whose whole purpose is to point at one record should not make
 * you aim at four characters of it.
 *
 * Which action depends on where the record lives. A Slack referent expands the
 * window to the inbox, because that is where the thread will be read; anything
 * else has only a URL to offer and hands it to the browser. A referent with
 * neither is not interactive at all — Cloud resolved no record, so there is
 * nothing to open and a dead button would say otherwise.
 */
function ActionRow({
  action,
  first,
  onOpenThread,
}: {
  action: Action;
  /** First row under a lane heading: the heading is already the separator. */
  first?: boolean;
  onOpenThread?: () => void;
}) {
  const Icon = ACTION_ICON[action.required_action];
  const level = action.priority.level;
  const referent = action.referent;
  const slack = referent?.provider.toLowerCase() === "slack";
  const url = referent?.url ?? null;

  const interactive =
    "-mx-1 block w-full rounded-sm px-1 text-left focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-pulse-brand-ink";

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2 text-xs text-pulse-ink-mute">
        <span className="flex min-w-0 items-center gap-1.5">
          {/* The list is sorted by priority, so the chip is what explains the
              order. Without it the top row looks arbitrary. */}
          <span
            className={`shrink-0 rounded border px-1 text-2xs font-semibold tabular-nums ${PRIORITY_TINT[level]}`}
          >
            {priorityLabel(level)}
          </span>
          <Icon
            aria-hidden="true"
            className={`size-3.5 shrink-0 ${actionIconTint(action.required_action)}`}
          />
          <span className="truncate">{ACTION_LABEL[action.required_action]}</span>
        </span>
        <span className="shrink-0">{relativeAge(action.age_seconds)}</span>
      </div>

      <p className="mt-1 line-clamp-2 text-sm font-semibold text-pulse-ink group-hover:underline group-hover:underline-offset-2">
        {action.subject}
      </p>
      <p className="mt-0.5 line-clamp-2 text-xs text-pulse-ink-mute">
        {action.instruction}
        {action.entity ? ` · ${action.entity.subject}` : ""}
      </p>
      <ReferentLine referent={referent} />
    </>
  );

  // The 1px rule is a border on an inset wrapper rather than a `Separator`
  // element: a `<div>` between two `<li>`s is not a list, and the divider has to
  // start and end 14px in rather than running into the panel's corners.
  return (
    <li className="px-3.5">
      <div
        className={`pb-2.5 pt-2.5 ${first ? "" : "border-t border-pulse-hairline"}`}
      >
        {slack && onOpenThread ? (
          // ponytail: expanding is all this can do today. Cloud's referent
          // carries no channel id and no thread ts, so there is nothing to
          // render a thread from; when it does, the panel mounts here.
          <button
            className={`group ${interactive}`}
            onClick={onOpenThread}
            type="button"
          >
            {body}
          </button>
        ) : url ? (
          <a
            className={`group ${interactive}`}
            href={url}
            rel="noreferrer noopener"
            target="_blank"
          >
            {body}
          </a>
        ) : (
          body
        )}
      </div>
    </li>
  );
}

function SkeletonRows() {
  return (
    <div aria-hidden="true" className="space-y-4 px-4 pt-3.5">
      {[0, 1, 2].map((row) => (
        <div className="space-y-2" key={row}>
          <div className="h-3 w-24 rounded bg-pulse-surface-alt animate-pulse motion-reduce:animate-none" />
          <div className="h-3.5 w-full rounded bg-pulse-surface-alt animate-pulse motion-reduce:animate-none" />
          <div className="h-3 w-2/3 rounded bg-pulse-surface-alt animate-pulse motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

function Notice({
  children,
  onRetry,
  title,
}: {
  children: string;
  onRetry?: () => void;
  title: string;
}) {
  return (
    <div className="px-4 py-6 text-center">
      <p className="text-sm font-semibold text-pulse-ink">{title}</p>
      <p className="mt-1 text-xs text-pulse-ink-mute">{children}</p>
      {onRetry ? (
        <Button className="mt-3" onClick={onRetry} size="sm" variant="outline">
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- panel -- */

export function CloudMiniInbox() {
  const { error, expand, inbox: data } = useCloudWindow();
  const { inbox, refresh, retryInbox, retryUsers, select, selected, users } =
    data;
  const [lane, setLane] = useState<Lane | null>(null);

  const all = inbox.status === "ready" ? inbox.value.actions : [];
  const visible = lane
    ? all.filter((action) => actionLane(action.priority.level) === lane)
    : all;

  return (
    // `h-dvh`, not `min-h-dvh`: the panel is `flex-1` over a scrolling list, and
    // a min-height container is still content-sized — the list would grow the
    // window's own height instead of scrolling, pushing its last rows past the
    // bottom edge with no way to reach them.
    <main className="flex h-dvh flex-col overflow-hidden">
      <section
        // Edge to edge: no rounding and no shadow of its own, because the
        // window already supplies both. A card inset inside a 380px window is
        // what produced the border being complained about.
        className="g6-cloud-panel flex min-h-0 flex-1 flex-col overflow-hidden"
        data-testid="cloud-mini-inbox"
      >
        {/* One 42px bar, and nothing above it. The close dot sits at x=14, y=13
            (`trafficLightPosition` in tauri.conf.json), so `pl-9` — 36px —
            clears it and the bar's own height centres the dot in it. The
            previous 54px of padding existed only because the dot was parked
            25px down; moving the dot is what deleted the band, not this class.
            Minimize and zoom are hidden in src-tauri's `hide_minimize_and_zoom`,
            so the brand clears one dot rather than three. */}
        <header className="flex h-[42px] shrink-0 items-center gap-2 pl-9 pr-2">
          {/* `rust-gear.avif` has no alpha — its #e6e6e6 matte is a visible
              square on the white panel. Rounding it reads as a deliberate
              app-icon tile instead of a stray box. */}
          <Gear6Mark className="size-4.5 rounded-[5px]" />
          <h1 className="text-sm font-semibold tracking-tight text-pulse-ink">
            Gear6
          </h1>
          <span className="ml-auto flex items-center gap-px">
            <ExpandButton />
            <PinButton />
            <OverflowMenu onRefresh={refresh} />
          </span>
        </header>

        {/* Development-only, and no longer in the bar: the picker is a control
            for whoever is testing the gateway, and the 42px bar belongs to the
            three the shipped window has. */}
        {users.status === "loading" ? (
          <div aria-hidden="true" className="mx-3.5 mb-2 h-4 w-28 shrink-0 rounded bg-pulse-surface-alt animate-pulse motion-reduce:animate-none" />
        ) : null}
        {users.status === "ready" && selected ? (
          <div className="shrink-0 px-3.5">
            <UserSelect
              onSelect={select}
              selected={selected}
              users={users.value}
            />
          </div>
        ) : null}

        {/* A resize that did not happen leaves the window as it was, so this
            explains the button that appeared to do nothing rather than
            blocking the panel behind it. */}
        {error ? (
          <p
            className="shrink-0 px-4 pb-2 text-2xs text-pulse-ink-mute"
            role="status"
          >
            Could not open the full window: {error}
          </p>
        ) : null}

        {/* The counts sit in what used to be the dead band: the first row now
            starts around y=100 rather than y=175, which is one whole action row
            back in a 520px window. */}
        {inbox.status === "ready" && selected ? (
          <>
            <InboxSummary className="px-3.5 pb-2" overview={inbox.value.overview} />
            <Lanes actions={all} lane={lane} onSelect={setLane} />
          </>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          <InboxBody
            inbox={inbox}
            onOpenThread={() => expand("inbox")}
            onRetryInbox={retryInbox}
            onRetryUsers={retryUsers}
            selected={selected}
            users={users}
            visible={visible}
          />
        </div>

        <p aria-live="polite" className="sr-only">
          {inbox.status === "ready"
            ? `${visible.length} actions shown${lane ? `, filtered to ${LANE_LABEL[lane]}` : ""}`
            : "Loading actions"}
        </p>
      </section>
    </main>
  );
}

/**
 * The counts line. Exported because the expanded shell shows the same inbox and
 * the same sentence about it, at a different width.
 */
export function InboxSummary({
  className = "",
  overview,
}: {
  className?: string;
  overview: OverviewResponse;
}) {
  return (
    <div
      className={`flex shrink-0 items-baseline justify-between gap-2 text-xs text-pulse-ink-mute ${className}`}
    >
      <span className="truncate">{summaryLabel(overview)}</span>
      <span className="shrink-0">
        {updatedLabel(overview.generated_at, Date.now())}
      </span>
    </div>
  );
}

/** Exported for the state-by-state render tests; not a second entry point. */
export function InboxBody({
  inbox,
  onOpenThread,
  onRetryInbox,
  onRetryUsers,
  selected,
  users,
  visible,
}: {
  inbox: Load<Inbox>;
  /**
   * What a Slack row does when clicked. Omitted by the expanded shell, where
   * there is nowhere further to expand to, so those rows fall through to the
   * source URL like every other provider.
   */
  onOpenThread?: () => void;
  onRetryInbox: () => void;
  onRetryUsers: () => void;
  selected: string | null;
  users: Load<CloudUser[]>;
  visible: readonly Action[];
}) {
  if (users.status === "loading") {
    return <SkeletonRows />;
  }
  if (users.status === "error") {
    return (
      <Notice onRetry={onRetryUsers} title="Could not load users">
        {users.message}
      </Notice>
    );
  }
  if (!selected) {
    return (
      <Notice title="No users found">
        Cloud has no resolvable accounts in this dataset.
      </Notice>
    );
  }
  if (inbox.status === "loading") {
    return <SkeletonRows />;
  }
  if (inbox.status === "error") {
    return (
      <Notice onRetry={onRetryInbox} title="Could not load this inbox">
        {inbox.message}
      </Notice>
    );
  }
  if (visible.length === 0) {
    return <Notice title="Nothing open here">{EMPTY_ACTIONS_COPY}</Notice>;
  }

  // Lane headings are `<li>`s inside the same list rather than a `<ul>` per
  // lane: the rows are one sequence to arrow through, and three lists would
  // announce three. Sticky, so "Blocked" is still overhead ten rows into it.
  return (
    <ul>
      {laneGroups(visible).map(({ lane, actions }) => (
        <li key={lane}>
          <p className="sticky top-0 z-[2] bg-pulse-canvas px-3.5 pb-1 pt-2.5 text-badge font-bold uppercase tracking-wider text-pulse-ink-mute">
            {LANE_LABEL[lane]}
          </p>
          <ul>
            {actions.map((action, index) => (
              <ActionRow
                action={action}
                first={index === 0}
                key={action.id}
                onOpenThread={onOpenThread}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
