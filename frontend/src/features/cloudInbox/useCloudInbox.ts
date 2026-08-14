// The inbox's reads, owned above the panels that draw them. Both the compact
// window and the expanded shell show the same inbox, so collapsing one into the
// other must not refetch it — and the selected development user has to survive
// the trip, since it is session state that is never persisted.
import { useCallback, useEffect, useState } from "react";

import {
  listActions,
  listDevUsers,
  overview as fetchOverview,
} from "@/shared/api/cloudGateway/client";
import type {
  Action,
  CloudUser,
  OverviewResponse,
} from "@/shared/api/cloudGateway/types";

/**
 * The user directory is a development-only Cloud route, compiled out of a
 * release backend. Gating the call on the build rather than on a 404 keeps the
 * production path free of a request that is known to fail.
 *
 * `VITE_G6_CLOUD_DEV_USERS` opts a *build* into it. `import.meta.env.DEV` is
 * false in every build regardless of `--mode` — it tracks the dev server, not
 * the mode — so without this flag a built cloud bundle can never resolve an
 * actor, and the screenshot harness would photograph "No users found" on every
 * screen. It is off unless something sets it.
 */
export const CAN_LIST_USERS = Boolean(
  (import.meta.env ?? {}).DEV ||
    (import.meta.env ?? {}).VITE_G6_CLOUD_DEV_USERS === "true",
);

export type Load<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; message: string };

export type Inbox = { actions: Action[]; overview: OverviewResponse };

/**
 * Whose obligations to read. `me` is the inbox and the only one whose length is
 * the badge `/v1/overview` reports; `anyone` is every open obligation in the
 * tenant. Cloud's third scope, `unassigned`, is deliberately not offered here —
 * it is a queue of its own rather than a share of somebody's.
 */
export type InboxOwner = "me" | "anyone";

export type CloudInbox = {
  users: Load<CloudUser[]>;
  selected: string | null;
  inbox: Load<Inbox>;
  owner: InboxOwner;
  setOwner: (owner: InboxOwner) => void;
  select: (accountId: string) => void;
  refresh: () => void;
  retryUsers: () => void;
  retryInbox: () => void;
};

/** Cloud's maximum. Anything larger is a `400`, not a silent clamp. */
const PAGE_SIZE = 100;

/**
 * Every page, not the first one.
 *
 * The wide inbox derives its facet counts from these rows, and a count over a
 * prefix is a number that disagrees with the list it sits beside. An inbox is
 * what one person owes — `/v1/overview`'s `actions` states its exact size — so
 * this terminates in one or two requests for the scope that matters.
 */
async function listAllActions(
  accountId: string,
  owner: InboxOwner,
): Promise<Action[]> {
  const rows: Action[] = [];
  let cursor: string | undefined;
  do {
    const page = await listActions(accountId, {
      owner,
      limit: PAGE_SIZE,
      cursor,
    });
    rows.push(...page.data);
    cursor = page.page.next_cursor ?? undefined;
  } while (cursor);
  return rows;
}

function errorMessage(err: unknown): string {
  // Never the HTTP status and never the account id: the panel keeps the
  // selected user visible, so naming it in the failure adds nothing.
  return err instanceof Error ? err.message : String(err);
}

export function useCloudInbox(): CloudInbox {
  const [users, setUsers] = useState<Load<CloudUser[]>>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [inbox, setInbox] = useState<Load<Inbox>>({ status: "loading" });
  const [usersAttempt, setUsersAttempt] = useState(0);
  const [inboxAttempt, setInboxAttempt] = useState(0);
  const [owner, setOwner] = useState<InboxOwner>("me");

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
    Promise.all([listAllActions(selected, owner), fetchOverview(selected)])
      .then(([actions, overview]) => {
        if (!cancelled) {
          setInbox({ status: "ready", value: { actions, overview } });
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
  }, [owner, selected, inboxAttempt]);

  const retryUsers = useCallback(
    () => setUsersAttempt((count) => count + 1),
    [],
  );
  const retryInbox = useCallback(
    () => setInboxAttempt((count) => count + 1),
    [],
  );
  const refresh = useCallback(() => {
    retryUsers();
    retryInbox();
  }, [retryUsers, retryInbox]);

  return {
    users,
    selected,
    inbox,
    owner,
    setOwner,
    select: setSelected,
    refresh,
    retryUsers,
    retryInbox,
  };
}
