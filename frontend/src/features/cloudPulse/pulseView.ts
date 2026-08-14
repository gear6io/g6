// What the list is showing, as a value rather than as four pieces of component
// state. Kept out of the component so the query it becomes can be checked
// without a renderer or a network.
//
// Every filter here is one Cloud serves. There is no team facet because the API
// has no team bucket, no source facet because a milestone carries no provider,
// and no saved views because nothing persists one. A facet drawn over a filter
// the service cannot apply is a control that silently shows the wrong list.
import type {
  MilestoneCounts,
  MilestoneListQuery,
  MilestoneStatus,
} from "@/shared/api/cloudGateway/types";

/**
 * The health vocabulary in the order the facet column lists it: worst first,
 * because the column is read top-down by somebody looking for what is wrong.
 * `neutral` is last and is deliberately called "Observed only" rather than
 * "Neutral" — it means observed and unclassified, which is a fact about Cloud's
 * reading rather than a verdict on the work.
 */
export const STATUS_ORDER: readonly MilestoneStatus[] = [
  "regression",
  "dependency",
  "progress",
  "neutral",
];

export const STATUS_FACET_LABEL: Record<MilestoneStatus, string> = {
  regression: "Regressed",
  dependency: "At risk",
  progress: "On track",
  neutral: "Observed only",
};

/**
 * Named views. "Moved today" is completed client-side across sorted milestone
 * pages because Cloud does not expose a matching predicate. "My milestones"
 * remains absent because the read model carries no ownership to filter by.
 */
export const VIEWS = {
  attention: {
    label: "Needs attention",
    /** Regressed and at risk: the two healths that mean somebody has to look. */
    status: ["regression", "dependency"] as MilestoneStatus[],
    movedToday: false,
  },
  moved: {
    label: "Moved today",
    status: [] as MilestoneStatus[],
    movedToday: true,
  },
  all: {
    label: "All milestones",
    status: [] as MilestoneStatus[],
    movedToday: false,
  },
} as const;

export type PulseViewId = keyof typeof VIEWS;

export type PulseFilter = {
  /** Empty means every health, which is what an absent `status` param means. */
  status: MilestoneStatus[];
  /**
   * Set by the "went quiet" tile. Not a fifth status: a milestone can be
   * `progress` and silent for a fortnight, which is exactly the one worth
   * surfacing, so quietness composes with health rather than replacing it.
   */
  quietDays: number | null;
  /** Newest observation falls on Cloud's generated UTC day. */
  movedToday: boolean;
};

export const NO_FILTER: PulseFilter = {
  status: [],
  quietDays: null,
  movedToday: false,
};

export function viewFilter(view: PulseViewId): PulseFilter {
  return {
    ...NO_FILTER,
    status: [...VIEWS[view].status],
    movedToday: VIEWS[view].movedToday,
  };
}

/**
 * The filter as Cloud's query. `counts` is always asked for: the facet column
 * and the "N of M" line both describe the whole filtered collection, and that
 * is the one number a client cannot derive by paging.
 *
 * Empty values are `undefined` rather than empty strings — an empty `q` is
 * "no search" to Cloud, but sending one is still a parameter the request did
 * not need.
 */
export function filterQuery(
  filter: PulseFilter,
  page: { limit: number; cursor?: string },
  query = "",
): MilestoneListQuery {
  return {
    ...page,
    counts: true,
    q: query || undefined,
    status: filter.status.length > 0 ? filter.status.join(",") : undefined,
    quiet_days: filter.quietDays ?? undefined,
  };
}

/** Which named view this filter is, or null when it is a facet combination. */
export function activeView(
  filter: PulseFilter,
  query = "",
): PulseViewId | null {
  if (filter.quietDays !== null || query) {
    return null;
  }
  for (const [id, view] of Object.entries(VIEWS)) {
    if (
      view.status.length === filter.status.length &&
      view.status.every((status) => filter.status.includes(status)) &&
      view.movedToday === filter.movedToday
    ) {
      return id as PulseViewId;
    }
  }
  return null;
}

/**
 * What the list says it is showing, as one removable chip. A list that does not
 * state its own filter is a list you cannot trust: with facets in play, "no
 * results" and "no results *here*" are different sentences and only one of them
 * is usually true.
 */
export function activeLabel(filter: PulseFilter, query = ""): string | null {
  const view = activeView(filter, query);
  if (view) {
    return view === "all" ? null : VIEWS[view].label;
  }
  const parts: string[] = [];
  if (query) {
    parts.push(`“${query}”`);
  }
  for (const status of STATUS_ORDER) {
    if (filter.status.includes(status)) {
      parts.push(STATUS_FACET_LABEL[status]);
    }
  }
  if (filter.quietDays !== null) {
    parts.push(`Quiet ≥${filter.quietDays}d`);
  }
  if (filter.movedToday) {
    parts.push(VIEWS.moved.label);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * `14 of 247`. `total` is the filtered collection and the page is a prefix of
 * it, so this is honest even before the last page is loaded — which is the
 * whole reason `counts` is requested rather than counting the rows on screen.
 */
export function countLine(
  shown: number,
  counts: MilestoneCounts | null,
): string {
  if (!counts) {
    return `${shown} shown`;
  }
  return `${shown} of ${counts.total}`;
}

/**
 * Toggling a health facet. A second press clears it rather than leaving the
 * column with no way back to everything except finding the view again.
 */
export function toggleStatus(
  filter: PulseFilter,
  status: MilestoneStatus,
): PulseFilter {
  const on = filter.status.includes(status);
  return {
    ...filter,
    status: on
      ? filter.status.filter((entry) => entry !== status)
      : [...filter.status, status],
  };
}
