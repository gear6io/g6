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
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronDown, CircleCheck, CornerUpRight, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  listActions,
  listDevUsers,
  overview as fetchOverview,
} from "@/shared/api/cloudGateway/client";
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
  AUDIENCE_LABEL,
  FILTERS,
  type InboxFilter,
  emptyActionsCopy,
  filterActions,
  relativeAge,
  summaryLabel,
  updatedLabel,
  userLabel,
} from "@/features/cloudInbox/inbox";

/**
 * The user directory is a development-only Cloud route, compiled out of a
 * release backend. Gating the call on the build rather than on a 404 keeps the
 * production path free of a request that is known to fail.
 */
const CAN_LIST_USERS = Boolean((import.meta.env ?? {}).DEV);

type Load<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; message: string };

type Inbox = { actions: Action[]; overview: OverviewResponse };

const ACTION_ICON: Record<ActionType, typeof CornerUpRight> = {
  act_on_handoff: CornerUpRight,
  resolve_decision: CircleCheck,
  unblock_constraint: TriangleAlert,
};

const ACTION_ICON_TINT: Record<ActionType, string> = {
  act_on_handoff: "text-violet-500",
  resolve_decision: "text-sky-500",
  unblock_constraint: "text-orange-500",
};

function errorMessage(err: unknown): string {
  // Never the HTTP status and never the account id: the panel keeps the
  // selected user visible, so naming it in the failure adds nothing.
  return err instanceof Error ? err.message : String(err);
}

/* ---------------------------------------------------------------- chrome -- */

function PinButton() {
  // The window opens pinned (`alwaysOnTop` in tauri.conf.json), so this starts
  // pressed and the state lives here rather than being read back.
  const [pinned, setPinned] = useState(true);

  const toggle = useCallback(() => {
    const next = !pinned;
    setPinned(next);
    if (isTauri()) {
      void getCurrentWindow().setAlwaysOnTop(next);
    }
  }, [pinned]);

  return (
    <Button
      aria-label={pinned ? "Unpin window" : "Keep window on top"}
      aria-pressed={pinned}
      className="size-7 text-foreground/80"
      onClick={toggle}
      size="icon"
      variant="ghost"
    >
      <PinGlyph filled={pinned} />
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
function UserSelect({
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

function FilterChips({
  filter,
  onFilter,
}: {
  filter: InboxFilter;
  onFilter: (next: InboxFilter) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {FILTERS.map(({ id, label }) => (
        <button
          aria-pressed={filter === id}
          className={[
            "h-[22px] shrink-0 rounded-full px-2.5 text-2xs font-medium transition-colors",
            "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
            filter === id
              ? "bg-muted text-foreground"
              : "border border-border text-muted-foreground hover:bg-muted/60",
          ].join(" ")}
          key={id}
          onClick={() => onFilter(id)}
          type="button"
        >
          {label}
        </button>
      ))}
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
          <span className="truncate">
            {ACTION_LABEL[action.type]} · {AUDIENCE_LABEL[action.audience]}
          </span>
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
  const [users, setUsers] = useState<Load<CloudUser[]>>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [inbox, setInbox] = useState<Load<Inbox>>({ status: "loading" });
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [usersAttempt, setUsersAttempt] = useState(0);
  const [inboxAttempt, setInboxAttempt] = useState(0);

  useEffect(() => {
    if (!CAN_LIST_USERS) {
      setUsers({ status: "ready", value: [] });
      return;
    }
    let cancelled = false;
    setUsers({ status: "loading" });
    listDevUsers()
      .then((res) => {
        if (cancelled) {
          return;
        }
        setUsers({ status: "ready", value: res.data });
        // First returned account, and only ever here: the selection is session
        // state and is never persisted.
        setSelected(res.data[0]?.account_id ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setUsers({ status: "error", message: errorMessage(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [usersAttempt]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    // ponytail: the effect's cleanup flag IS the request version the LLD asks
    // for — React re-runs this on every selection change, so a slower prior
    // read finds `cancelled` set and cannot overwrite the current inbox.
    let cancelled = false;
    setInbox({ status: "loading" });
    Promise.all([listActions(selected), fetchOverview(selected)])
      .then(([actions, overview]) => {
        if (!cancelled) {
          setInbox({ status: "ready", value: { actions: actions.data, overview } });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setInbox({ status: "error", message: errorMessage(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected, inboxAttempt]);

  const refresh = useCallback(() => {
    setUsersAttempt((count) => count + 1);
    setInboxAttempt((count) => count + 1);
  }, []);

  const visible =
    inbox.status === "ready" ? filterActions(inbox.value.actions, filter) : [];

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
              <PinButton />
              <OverflowMenu onRefresh={refresh} />
            </span>
          </div>

          {users.status === "loading" ? (
            <div aria-hidden="true" className="my-2 h-4 w-28 rounded bg-muted" />
          ) : null}
          {users.status === "ready" && selected ? (
            <UserSelect
              onSelect={setSelected}
              selected={selected}
              users={users.value}
            />
          ) : null}
        </header>

        {inbox.status === "ready" && selected ? (
          <div className="flex shrink-0 items-baseline justify-between gap-2 px-4 pb-2 text-xs text-muted-foreground">
            <span className="truncate">{summaryLabel(inbox.value.overview)}</span>
            <span className="shrink-0">
              {updatedLabel(inbox.value.overview.generated_at, Date.now())}
            </span>
          </div>
        ) : null}

        {selected ? <FilterChips filter={filter} onFilter={setFilter} /> : null}

        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          <InboxBody
            filter={filter}
            inbox={inbox}
            onRetryInbox={() => setInboxAttempt((count) => count + 1)}
            onRetryUsers={() => setUsersAttempt((count) => count + 1)}
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

/** Exported for the state-by-state render tests; not a second entry point. */
export function InboxBody({
  filter,
  inbox,
  onRetryInbox,
  onRetryUsers,
  selected,
  users,
  visible,
}: {
  filter: InboxFilter;
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
    return <Notice title="Nothing open here">{emptyActionsCopy(filter)}</Notice>;
  }

  return (
    <ul>
      {visible.map((action) => (
        <ActionRow action={action} key={action.id} />
      ))}
    </ul>
  );
}
