// The compact inbox's derived values, kept out of the component so they can be
// tested without a renderer or a clock.
//
// Nothing here converts a Cloud value into a different unit: ages arrive as
// whole seconds and are formatted, `generated_at` stays the RFC 3339 string it
// was sent as. See the note at the top of `@/shared/api/cloudGateway/types`.
import type {
  Action,
  CloudUser,
  OverviewResponse,
  PriorityLevel,
  RequiredAction,
} from "@/shared/api/cloudGateway/types";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The reference's compact age: minutes, then hours, then days, never a
 * composite. Under a minute reads "just now" rather than "0 min ago", which is
 * both wrong-looking and the most common case right after an obligation opens.
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

/**
 * "just now" / "3 min ago", from Cloud's own generation time — the age alone,
 * for callers that supply their own verb.
 */
export function generatedAge(generatedAt: string, now: number): string {
  const at = Date.parse(generatedAt);
  if (Number.isNaN(at)) {
    // An unparseable timestamp is not worth a visible error: the label is
    // ambient, and the counts beside it are still true.
    return "just now";
  }
  return relativeAge((now - at) / 1000);
}

/** "updated just now" / "updated 3 min ago", for callers that do not. */
export function updatedLabel(generatedAt: string, now: number): string {
  return `updated ${generatedAge(generatedAt, now)}`;
}

/**
 * Display name, then handle, then the provider id. Cloud documents display name
 * as "empty when unknown" and handle as changeable, so neither is guaranteed;
 * the provider id always exists because it is the key the row is fetched by.
 */
export function userLabel(user: CloudUser): string {
  return user.display_name || user.handle || user.provider_id;
}

/**
 * The metadata line's short name for what an Action Item asks. A `Record` over
 * the union rather than a lookup with a fallback: Cloud adding a seventh
 * `required_action` should be a type error here, not a blank chip at runtime.
 */
export const ACTION_LABEL: Record<RequiredAction, string> = {
  review: "Review",
  approval: "Approval",
  response: "Response",
  decision: "Decision",
  execute: "Execute",
  unblock: "Unblock",
};

/**
 * The urgency chip. Uppercased for display only — the wire value is lowercase
 * and every comparison against it stays exact, per Cloud's "never case-fold".
 */
export function priorityLabel(level: PriorityLevel): string {
  return level.toUpperCase();
}

/**
 * The API-faithful replacement for the reference's "8 open · 10 resolved":
 * Cloud supplies no resolved count, so none is shown. `actions` is already the
 * viewer's own count — every row `/v1/actions` returns is theirs — so there is
 * no second number to set it against.
 */
export function summaryLabel(overview: OverviewResponse): string {
  const { actions } = overview;
  return `${actions} open ${actions === 1 ? "action" : "actions"} for you`;
}

/**
 * One sentence, because there is one list. The inbox had audience chips until
 * Cloud dropped `audience`: every action in it is the viewer's own.
 */
export const EMPTY_ACTIONS_COPY = "This user has no open actions right now.";

/* ------------------------------------------------------------------ lanes -- */

/**
 * The three bands the list is read in. They are the priority tiers renamed, and
 * nothing else — Cloud carries no due date, no snooze and no blocked flag, so a
 * lane that meant "due today" would be a number this client made up. `p0` is the
 * tier Cloud raises when an obligation is holding work, which is what makes
 * "Blocked" a restatement rather than a claim; `p2` and `p3` share a lane
 * because the distinction between them does not change what you do next.
 */
export type Lane = "blocked" | "today" | "later";

export const LANE_ORDER: readonly Lane[] = ["blocked", "today", "later"];

export const LANE_LABEL: Record<Lane, string> = {
  blocked: "Blocked",
  today: "Today",
  later: "Later",
};

export function actionLane(level: PriorityLevel): Lane {
  if (level === "p0") {
    return "blocked";
  }
  return level === "p1" ? "today" : "later";
}

/**
 * The list split into its lanes, in `LANE_ORDER` and with the empty ones
 * dropped: a lane heading over no rows is a section that says only that the
 * section is not there.
 *
 * Order inside a lane is Cloud's own — `/v1/actions` is already sorted by
 * priority, and re-sorting here would fight it on the ties.
 */
export function laneGroups(
  actions: readonly Action[],
): { lane: Lane; actions: Action[] }[] {
  return LANE_ORDER.map((lane) => ({
    lane,
    actions: actions.filter(
      (action) => actionLane(action.priority.level) === lane,
    ),
  })).filter((group) => group.actions.length > 0);
}
