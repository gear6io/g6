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
 */
export const CAN_LIST_USERS = Boolean((import.meta.env ?? {}).DEV);

export type Load<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; message: string };

export type Inbox = { actions: Action[]; overview: OverviewResponse };

export type CloudInbox = {
  users: Load<CloudUser[]>;
  selected: string | null;
  inbox: Load<Inbox>;
  select: (accountId: string) => void;
  refresh: () => void;
  retryUsers: () => void;
  retryInbox: () => void;
};

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
          setInbox({
            status: "ready",
            value: { actions: actions.data, overview },
          });
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
    select: setSelected,
    refresh,
    retryUsers,
    retryInbox,
  };
}
