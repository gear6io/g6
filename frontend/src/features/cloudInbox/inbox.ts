// The compact inbox's derived values, kept out of the component so they can be
// tested without a renderer or a clock.
//
// Nothing here converts a Cloud value into a different unit: ages arrive as
// whole seconds and are formatted, `generated_at` stays the RFC 3339 string it
// was sent as. See the note at the top of `@/shared/api/cloudGateway/types`.
import type {
  Action,
  ActionAudience,
  ActionType,
  CloudUser,
  OverviewResponse,
} from "@/shared/api/cloudGateway/types";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The reference's compact age: minutes, then hours, then days, never a
 * composite. Under a minute reads "just now" rather than "0 min ago", which is
 * both wrong-looking and the most common case right after a signal opens.
 */
export function relativeAge(seconds: number): string {
  // Cloud clamps `age_seconds` at zero, but `generated_at` ages are computed
  // against this machine's clock and can land slightly negative.
  const age = Math.max(0, Math.floor(seconds));
  if (age < MINUTE) {
    return "just now";
  }
  if (age < HOUR) {
    return `${Math.floor(age / MINUTE)} min ago`;
  }
  if (age < DAY) {
    return `${Math.floor(age / HOUR)}h ago`;
  }
  return `${Math.floor(age / DAY)}d ago`;
}

/** "updated just now" / "updated 3 min ago", from Cloud's own generation time. */
export function updatedLabel(generatedAt: string, now: number): string {
  const at = Date.parse(generatedAt);
  if (Number.isNaN(at)) {
    // An unparseable timestamp is not worth a visible error: the label is
    // ambient, and the counts beside it are still true.
    return "updated just now";
  }
  return `updated ${relativeAge((now - at) / 1000)}`;
}

/**
 * Display name, then handle, then the account id. Cloud documents display name
 * as "empty when unknown" and handle as changeable, so neither is guaranteed;
 * the account id always exists because it is the key the row is fetched by.
 */
export function userLabel(user: CloudUser): string {
  return user.display_name || user.handle || user.account_id;
}

export type InboxFilter = "all" | "viewer" | "team";

/** Fixed order and labels; `aria-pressed` marks the active one. */
export const FILTERS: readonly { id: InboxFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "viewer", label: "For you" },
  { id: "team", label: "Team" },
];

/**
 * Client-side only. The action page is already the whole compact surface, so
 * filtering it costs one pass and no second round trip — and `audience` is a
 * property of the response, not a server parameter Cloud accepts.
 */
export function filterActions(
  actions: readonly Action[],
  filter: InboxFilter,
): Action[] {
  return filter === "all"
    ? [...actions]
    : actions.filter((action) => action.audience === filter);
}

/** The metadata line's short name for each action type. */
export const ACTION_LABEL: Record<ActionType, string> = {
  act_on_handoff: "Handoff",
  resolve_decision: "Decision",
  unblock_constraint: "Blocker",
};

export const AUDIENCE_LABEL: Record<ActionAudience, string> = {
  viewer: "for you",
  team: "team",
};

/**
 * The API-faithful replacement for the reference's "8 open · 10 resolved":
 * Cloud supplies no resolved count, so none is shown.
 */
export function summaryLabel(overview: OverviewResponse): string {
  return `${overview.actions.total} open · ${overview.actions.viewer} for you`;
}

/**
 * The empty-state sentence, named by the filter that produced it — so an empty
 * list under `For you` cannot be misread as the user having no work at all.
 * Worded per filter rather than interpolating the chip label, because "no for
 * you actions" is not a sentence.
 */
export function emptyActionsCopy(filter: InboxFilter): string {
  if (filter === "viewer") {
    return "Nothing is assigned to this user right now.";
  }
  if (filter === "team") {
    return "This user has no team actions right now.";
  }
  return "This user has no open actions right now.";
}
