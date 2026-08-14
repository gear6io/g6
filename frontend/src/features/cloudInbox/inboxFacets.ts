// The wide inbox's facets, derived from the rows themselves.
//
// Unlike Pulse's, these are not server filters: `/v1/actions` selects on `owner`
// and `entity_id` and nothing else. Deriving the rest here is honest only
// because the collection is small and bounded — an inbox is what one person
// owes, `/v1/overview`'s `actions` states its exact size, and the hook pages to
// that size before anything is counted. A facet computed over a prefix of a
// large collection would be a number that quietly disagrees with the list.
//
// Each facet's counts are computed with its **own** dimension lifted and the
// others applied, the same rule `/v1/milestones` uses for `by_status`: a
// selected facet keeps reporting its siblings' sizes, so the column stays
// navigable instead of collapsing to one row and a column of zeros.
import type { Action, RequiredAction } from "@/shared/api/cloudGateway/types";

import { ACTION_LABEL, actionLane } from "@/features/cloudInbox/inbox";

/**
 * Whose obligations the list is showing. Cloud's own three, minus
 * `unassigned` — that is a queue of its own rather than a share of somebody's,
 * and putting it in the same picker as "mine" is the two-lists-one-name
 * mistake the API is explicit about avoiding.
 */
export type InboxScope = "me" | "anyone";

export const SCOPE_LABEL: Record<InboxScope, string> = {
  me: "Open",
  anyone: "Everything",
};

export type InboxFilter = {
  scope: InboxScope;
  kind: RequiredAction | null;
  /** `""` selects the rows Cloud resolved no milestone for. */
  milestoneId: string | null;
  provider: string | null;
  /** Opened within a day. Derived from `age_seconds`, which Cloud clamps at zero. */
  newToday: boolean;
};

export const NO_INBOX_FILTER: InboxFilter = {
  scope: "me",
  kind: null,
  milestoneId: null,
  provider: null,
  newToday: false,
};

const DAY_SECONDS = 24 * 60 * 60;

export function isNewToday(action: Action): boolean {
  return action.age_seconds < DAY_SECONDS;
}

function milestoneKey(action: Action): string {
  return action.entity?.id ?? "";
}

function providerKey(action: Action): string {
  return action.referent?.provider ?? "";
}

/**
 * `except` names the dimension being counted, so that dimension's own selection
 * is ignored while the others still apply.
 */
export function applyFilter(
  actions: readonly Action[],
  filter: InboxFilter,
  except?: "kind" | "milestone" | "provider" | "newToday",
): Action[] {
  return actions.filter((action) => {
    if (except !== "newToday" && filter.newToday && !isNewToday(action)) {
      return false;
    }
    if (except !== "kind" && filter.kind && action.required_action !== filter.kind) {
      return false;
    }
    if (
      except !== "milestone" &&
      filter.milestoneId !== null &&
      milestoneKey(action) !== filter.milestoneId
    ) {
      return false;
    }
    if (
      except !== "provider" &&
      filter.provider !== null &&
      providerKey(action) !== filter.provider
    ) {
      return false;
    }
    return true;
  });
}

export type FacetEntry = { id: string; label: string; count: number };

/** The six kinds, in Cloud's own declaration order, empty ones dropped. */
export function kindFacets(
  actions: readonly Action[],
  filter: InboxFilter,
): FacetEntry[] {
  const pool = applyFilter(actions, filter, "kind");
  const tally = new Map<string, number>();
  for (const action of pool) {
    tally.set(
      action.required_action,
      (tally.get(action.required_action) ?? 0) + 1,
    );
  }
  return [...tally.entries()]
    .map(([id, count]) => ({ id, label: ACTION_LABEL[id as RequiredAction], count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * The milestones this inbox touches. An action carries an `entity` and a
 * milestone's open counts are made of actions, but nothing in either view said
 * so — this is the same fact, in the place you would want it.
 *
 * "No milestone" is a real bucket, not a gap: Cloud resolved no entity for
 * those rows, and hiding them would make the facet counts fail to sum.
 */
export function milestoneFacets(
  actions: readonly Action[],
  filter: InboxFilter,
): FacetEntry[] {
  const pool = applyFilter(actions, filter, "milestone");
  const tally = new Map<string, { label: string; count: number }>();
  for (const action of pool) {
    const id = milestoneKey(action);
    const existing = tally.get(id);
    tally.set(id, {
      label: existing?.label ?? action.entity?.subject ?? "No milestone",
      count: (existing?.count ?? 0) + 1,
    });
  }
  return [...tally.entries()]
    .map(([id, { label, count }]) => ({ id, label, count }))
    // Busiest first, and "No milestone" last whatever its size: it is the
    // absence of the thing the group is named after.
    .sort((a, b) => {
      if (a.id === "") return 1;
      if (b.id === "") return -1;
      return b.count - a.count || a.label.localeCompare(b.label);
    });
}

/** Where the obligations came from. Rows Cloud resolved no record for are omitted. */
export function providerFacets(
  actions: readonly Action[],
  filter: InboxFilter,
): FacetEntry[] {
  const pool = applyFilter(actions, filter, "provider");
  const tally = new Map<string, number>();
  for (const action of pool) {
    const id = providerKey(action);
    if (id) {
      tally.set(id, (tally.get(id) ?? 0) + 1);
    }
  }
  return [...tally.entries()]
    .map(([id, count]) => ({
      id,
      label: id[0].toUpperCase() + id.slice(1),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function newTodayCount(
  actions: readonly Action[],
  filter: InboxFilter,
): number {
  return applyFilter(actions, filter, "newToday").filter(isNewToday).length;
}

/**
 * What the list says it is showing. Same rule as Pulse's chip: with facets in
 * play, "nothing here" and "nothing here under this filter" are different
 * sentences and only one of them is usually true.
 */
export function inboxChip(
  filter: InboxFilter,
  actions: readonly Action[],
): string | null {
  const parts: string[] = [];
  if (filter.newToday) {
    parts.push("New today");
  }
  if (filter.kind) {
    parts.push(ACTION_LABEL[filter.kind]);
  }
  if (filter.milestoneId !== null) {
    const named = actions.find(
      (action) => milestoneKey(action) === filter.milestoneId,
    );
    parts.push(named?.entity?.subject ?? "No milestone");
  }
  if (filter.provider !== null) {
    parts.push(filter.provider ? filter.provider : "No source");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The other open items on the same milestone — the reader's "what else is
 * stuck here". The action being read is excluded, and a row Cloud resolved no
 * milestone for has no siblings rather than every other unresolved row as
 * siblings.
 */
export function siblingsOnMilestone(
  actions: readonly Action[],
  action: Action,
): Action[] {
  if (!action.entity) {
    return [];
  }
  return actions.filter(
    (other) => other.id !== action.id && other.entity?.id === action.entity?.id,
  );
}

/** The lane a row sits in, re-exported so the wide list and the compact one agree. */
export { actionLane };
