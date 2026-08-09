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
// resolved count, no source message, no channel and no person invented here,
// because `/v1/actions` supplies none of those.
import { ChevronDown, CornerUpRight, Maximize2, TriangleAlert } from "lucide-react";
import { useMemo } from "react";

import type {
  Action,
  ActionType,
  CloudUser,
  OverviewResponse,
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

import {
  ACTION_LABEL,
  EMPTY_ACTIONS_COPY,
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

const ACTION_ICON: Record<ActionType, typeof CornerUpRight> = {
  act_on_handoff: CornerUpRight,
  unblock_constraint: TriangleAlert,
};

const ACTION_ICON_TINT: Record<ActionType, string> = {
  act_on_handoff: "text-violet-500",
  unblock_constraint: "text-orange-500",
};

/* ---------------------------------------------------------------- chrome -- */

function PinButton() {
  const { pinned, togglePin } = useCloudWindow();

  return (
    <Button
      aria-label={pinned ? "Unpin window" : "Keep window on top"}
      aria-pressed={pinned}
      className="size-7 text-foreground/80"
      onClick={togglePin}
      size="icon"
      variant="ghost"
    >
      <PinGlyph filled={pinned} />
    </Button>
  );
}

/** The one way into the full window. Disabled while a resize is in flight. */
function ExpandButton() {
  const { changing, expand } = useCloudWindow();

  return (
    <Button
      aria-label="Open Pulse"
      className="size-7 text-foreground/80"
      disabled={changing}
      onClick={expand}
      size="icon"
      title="Open Pulse"
      variant="ghost"
    >
      <Maximize2 aria-hidden="true" className="size-3.5" />
    </Button>
  );
}

/** Inline rather than a lucide import so the pressed state can fill the head. */
function PinGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
    >
      <path d="M12 17v5" />
      <path
        d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z"
        fill={filled ? "currentColor" : "none"}
      />
    </svg>
  );
}

function OverflowMenu({ onRefresh }: { onRefresh: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Inbox options"
          className="size-7 text-foreground/80"
          size="icon"
          variant="ghost"
        >
          <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
          </svg>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {CAN_LIST_USERS ? (
          <DropdownMenuLabel className="text-2xs font-normal text-muted-foreground">
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
      <span className="truncate text-xs font-medium text-foreground">
        {label}
      </span>
      <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
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

function ActionRow({ action }: { action: Action }) {
  const Icon = ACTION_ICON[action.type];
  const { signal } = action;

  // The 1px rule is a border on an inset wrapper rather than a `Separator`
  // element: a `<div>` between two `<li>`s is not a list, and the divider has to
  // start and end 16px in rather than running into the panel's corners.
  return (
    <li className="px-4 first:[&>div]:border-t-0">
      <div className="border-t border-border pb-3 pt-3.5">
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon
            aria-hidden="true"
            className={`size-3.5 shrink-0 ${ACTION_ICON_TINT[action.type]}`}
          />
          <span className="truncate">{ACTION_LABEL[action.type]}</span>
        </span>
        <span className="shrink-0">{relativeAge(signal.age_seconds)}</span>
      </div>

      <p className="mt-1 line-clamp-2 text-sm font-semibold text-foreground">
        {signal.subject}
      </p>
      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
        {action.instruction}
        {signal.entity ? ` · ${signal.entity.summary}` : ""}
      </p>
      </div>
    </li>
  );
}

function SkeletonRows() {
  return (
    <div aria-hidden="true" className="space-y-4 px-4 pt-3.5">
      {[0, 1, 2].map((row) => (
        <div className="space-y-2" key={row}>
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="h-3.5 w-full rounded bg-muted" />
          <div className="h-3 w-2/3 rounded bg-muted" />
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
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{children}</p>
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
  const { error, inbox: data } = useCloudWindow();
  const { inbox, refresh, retryInbox, retryUsers, select, selected, users } =
    data;

  const visible = inbox.status === "ready" ? inbox.value.actions : [];

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
        {/* The traffic lights are overlaid on the content at y=25, so the
            header starts below them rather than behind them. */}
        <header className="shrink-0 px-4 pt-[54px]">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              {/* `rust-gear.avif` has no alpha — its #e6e6e6 matte is a visible
                  square on the white panel. Rounding it reads as a deliberate
                  app-icon tile instead of a stray box. */}
              <Gear6Mark className="size-5 rounded-[5px]" />
              <h1 className="text-lg font-semibold tracking-tight text-foreground">
                Gear6
              </h1>
            </span>
            <span className="flex items-center gap-0.5">
              <ExpandButton />
              <PinButton />
              <OverflowMenu onRefresh={refresh} />
            </span>
          </div>

          {users.status === "loading" ? (
            <div aria-hidden="true" className="my-2 h-4 w-28 rounded bg-muted" />
          ) : null}
          {users.status === "ready" && selected ? (
            <UserSelect
              onSelect={select}
              selected={selected}
              users={users.value}
            />
          ) : null}
        </header>

        {/* A resize that did not happen leaves the window as it was, so this
            explains the button that appeared to do nothing rather than
            blocking the panel behind it. */}
        {error ? (
          <p
            className="shrink-0 px-4 pb-2 text-2xs text-muted-foreground"
            role="status"
          >
            Could not open the full window: {error}
          </p>
        ) : null}

        {inbox.status === "ready" && selected ? (
          <InboxSummary className="px-4 pb-3" overview={inbox.value.overview} />
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          <InboxBody
            inbox={inbox}
            onRetryInbox={retryInbox}
            onRetryUsers={retryUsers}
            selected={selected}
            users={users}
            visible={visible}
          />
        </div>

        <p aria-live="polite" className="sr-only">
          {inbox.status === "ready"
            ? `${visible.length} actions shown`
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
      className={`flex shrink-0 items-baseline justify-between gap-2 text-xs text-muted-foreground ${className}`}
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
  onRetryInbox,
  onRetryUsers,
  selected,
  users,
  visible,
}: {
  inbox: Load<Inbox>;
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

  return (
    <ul>
      {visible.map((action) => (
        <ActionRow action={action} key={action.id} />
      ))}
    </ul>
  );
}
