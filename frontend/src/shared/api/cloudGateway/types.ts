// The G6 Cloud wire shapes, modelled directly from g6.cloud/openapi.yaml (2.0.0).
//
// Nothing here is converted on arrival: dates stay RFC 3339 strings, ages stay
// whole seconds, confidence stays a 0..1 number, ids and cursors stay exact
// strings. Cloud renders instants server-side precisely because an epoch
// nanosecond does not survive a JS number, and re-parsing them here would put
// that hazard straight back.
//
// Every enum value below is lowercase because Cloud's are, `p0`..`p3` included.
// Compare them exactly; never case-fold one to match.

export type Page = {
  /** The page size actually applied, after Cloud's defaulting. */
  limit: number;
  /**
   * Opaque, versioned, base64url. Pass it back verbatim; a future Cloud rejects
   * an old cursor with `400 invalid_cursor` rather than decoding it into a
   * plausible wrong page. Cursors minted by API v1 are already rejected.
   */
  next_cursor: string | null;
};

export type Entity = {
  id: string;
  /** The human title. `slug` is the machine key beside it, not a substitute. */
  subject: string;
  slug: string;
  /** The state across all the evidence, not whatever thread touched it last. */
  description: string;
  /** The discriminating terms the lattice accreted onto this identity. */
  keywords: string[];
};

/* -------------------------------------------------------- action items -- */

/**
 * What an Action Item asks of its target — the taxonomy's one axis, and what
 * replaced the `decision`/`handoff`/`constraint` classification. `unblock` is a
 * strict fallback Cloud sharpens in place on a later tick, keeping the id.
 */
export type RequiredAction =
  | "review"
  | "approval"
  | "response"
  | "decision"
  | "execute"
  | "unblock";

/**
 * Open Action Items keyed by `required_action`. Every key is always present, so
 * a zero arrives as a zero rather than as an absent key to default.
 */
export type ActionCounts = Record<RequiredAction, number>;

/** Signed movement between two days' snapshots. The same six keys. */
export type ActionChanges = ActionCounts;

/** `p0` is most urgent, and is the inbox's primary sort key. */
export type PriorityLevel = "p0" | "p1" | "p2" | "p3";

export type PriorityEvidence = {
  provenance: "deterministic" | "enjin.priority.synthesis";
  /** The rule that fired. */
  reason: string;
  /** The judge's one-line explanation. Null on a deterministic entry. */
  rationale: string | null;
  /** `1.0` for a deterministic entry — a source-native label is not a probability. */
  confidence: number;
};

/** A folded urgency, with what it was folded from. Re-judging moves either way. */
export type Priority = { level: PriorityLevel; evidence: PriorityEvidence[] };

/**
 * The source record an Action Item or a timeline event points at, as a person
 * recognizes it. Read from that record at request time, so it says what the
 * record says now.
 */
export type Referent = {
  /** Empty where the record has nothing safe to show. */
  summary: string;
  /** Empty when the source record names none. */
  provider: string;
  /** The source's own link, or null where it supplied none. Never fabricated. */
  url: string | null;
  /**
   * The conversation this record sits in. Pass it to `resolveExtraction` as a
   * `trace` reference to render what was said in place. Null where the
   * reference does not resolve.
   */
  thread_id: string | null;
};

/**
 * One open Action Item — an obligation somebody owes, per target, per
 * contribution. One person blocking four work items is four of these.
 */
export type Action = {
  /** Content-addressed and opaque: no parseable parts. Safe as a list key. */
  id: string;
  /** Cloud's own one-line statement of what is owed. Contains no source text. */
  subject: string;
  required_action: RequiredAction;
  /** What kind of thing is waited on. `""` is a real stored state, not a gap. */
  dependency_type: "" | "access" | "resource" | "technical" | "data" | "compliance";
  /** Who or what the target is. `""` is unproven; `person` is implied in an inbox. */
  dependency_on:
    | ""
    | "person"
    | "team"
    | "customer"
    | "vendor"
    | "system"
    | "external";
  priority: Priority;
  /** Fixed copy for the `required_action`. Not per-obligation and not generated. */
  instruction: string;
  /** Null when the obligation has no resolved entity, or the projection has no row. */
  entity: Entity | null;
  /** Null where the reference does not resolve. Nothing is ever substituted for it. */
  referent: Referent | null;
  work_item_ids: string[];
  work_item_count: number;
  /** RFC 3339 UTC, whole seconds. This contribution's own instant. */
  opened_at: string;
  updated_at: string;
  age_seconds: number;
  confidence: number;
};

export type ActionListResponse = {
  data: Action[];
  page: Page;
  generated_at: string;
};

/** One Slack account worth sending as the viewer. */
export type CloudUser = {
  /** The value the gateway turns into `X-G6-Actor-ID`. */
  account_id: string;
  actor_id: string;
  kind: "human" | "bot" | "app" | "agent";
  /** Login or username. Changeable upstream; not an identity. */
  handle: string;
  /** Empty when unknown. */
  display_name: string;
};

export type UserListResponse = {
  data: CloudUser[];
  /** `limit` is the fixed 1000-row cap and `next_cursor` is always null. */
  page: Page;
  generated_at: string;
};

export type OverviewResponse = {
  /**
   * Whole-tenant open Action Items per kind. The same for every viewer, and the
   * only place an obligation nobody was named on is visible at all.
   */
  open: ActionCounts;
  /**
   * How many the viewer owes — exactly the number of rows `/v1/actions` returns
   * for the same actor. The two are not a partition and do not sum to anything:
   * an obligation the viewer owes is counted in both.
   */
  actions: number;
  /**
   * Whole-tenant obligations **closed** in the trailing `resolved_days` window.
   * Null unless `resolved_days` asked for it.
   *
   * Obligations, never milestones: a milestone is not recorded as closed
   * anywhere in this read model, so "closed 18 action items" is the only
   * sentence this number supports. Abandoned obligations are excluded — they
   * stalled, and counting a stall as an accomplishment is the one way to read
   * this field wrongly.
   */
  resolved: ActionCounts | null;
  generated_at: string;
};

/* ------------------------------------------------------------ milestones -- */

export type MilestoneStatus = "neutral" | "progress" | "dependency" | "regression";

/** The newest observed timeline day. Absent activity is not a neutral day. */
export type MilestoneLastActivity = {
  date: string;
  status: MilestoneStatus;
  observed_at: string;
};

export type Milestone = {
  id: string;
  /** The human title the lattice settled on. Rewritten only by a confident finding. */
  subject: string;
  slug: string;
  /** The milestone's state across all its evidence, not its latest thread. */
  description: string;
  keywords: string[];
  updated_at: string;
  last_activity: MilestoneLastActivity | null;
  /**
   * Whole-tenant open Action Items on this milestone, not the viewer's inbox.
   * Includes the obligations nobody was named on.
   */
  open: ActionCounts;
  open_since: OpenSince;
};

/**
 * When each of `open`'s counts started: the opening instant of the **oldest**
 * still-open obligation of that kind, null where none is open.
 *
 * `open.unblock` says a milestone is blocked; `open_since.unblock` says since
 * when. Oldest rather than newest on purpose — a milestone blocked for a week
 * that picks up a second blocker this morning has still been blocked for a
 * week. The age is this client's subtraction, which is what keeps a cached
 * response honest.
 */
export type OpenSince = Record<RequiredAction, string | null>;

/**
 * Milestone counts per health. All four keys always present; a zero arrives as
 * a zero rather than as an absent key to default.
 */
export type HealthCounts = Record<MilestoneStatus, number>;

/** The whole filtered collection, not the page. Null unless `counts=true`. */
export type MilestoneCounts = {
  /** Every milestone the filters admit — the number the page is "14 of". */
  total: number;
  /**
   * Each health's own size, computed with the **health filter lifted**, so a
   * selected facet keeps reporting its siblings' sizes and the column stays
   * navigable. Under a `status` filter these sum to more than `total`, which is
   * the point of them rather than a bug in them.
   */
  by_status: HealthCounts;
  /** Nonzero only under `has_no_activity=true`. Not a health. */
  no_activity: number;
};

export type MilestoneListResponse = {
  data: Milestone[];
  page: Page;
  counts: MilestoneCounts | null;
  generated_at: string;
};

/**
 * What was open at the end of the day, counted from the same table that badges
 * `/v1/milestones` — so a milestone's badge and its snapshot cannot disagree.
 */
export type TimelineSnapshot = ActionCounts;

/** Net movement since the previous *returned* day, signed. */
export type TimelineChanges = ActionChanges;

export type StatusEvidence = {
  classification: "progress" | "dependency" | "regression";
  provenance: "deterministic" | "synthesis";
  /** The rule that fired: `handoff_opened`, `decision_closed`, … */
  reason: string;
  /** The model's one-line explanation. Null on a deterministic entry. */
  rationale: string | null;
  /** `1.0` for a deterministic entry — a workflow fact is not a probability. */
  confidence: number;
};

/** One record observed on the day. Display fields only. */
export type TimelineEvent = {
  /** A 32-hex content address, opaque: no parseable parts. */
  id: string;
  type: "log" | "span.event" | "wait.open" | "wait.close" | "resolver";
  occurred_at: string;
  /** Empty where the record has nothing safe to show, or does not resolve. */
  summary: string;
  provider: string;
  /** The source's own link, or null where it supplied none. Never fabricated. */
  url: string | null;
  /**
   * The conversation this record sits in. Pass it to `resolveExtraction` as a
   * `trace` reference to render what was said in place instead of linking out.
   *
   * A day's events are collapsed to one row per thread, so this is also how a
   * collapsed row is expanded back into the records behind it. Null where the
   * reference does not resolve.
   */
  thread_id: string | null;
};

export type TimelineDay = {
  date: string;
  /** The strongest classification in `status_evidence`. */
  status: MilestoneStatus;
  observed_at: string;
  /** May exceed `events.length` when the response's record cap cut. */
  event_count: number;
  snapshot: TimelineSnapshot;
  changes: TimelineChanges;
  status_evidence: StatusEvidence[];
  events: TimelineEvent[];
  /** True when the 5000-event cap cut this day's list; counts are unaffected. */
  events_truncated: boolean;
};

export type MilestoneTimelineResponse = {
  milestone: Entity;
  /** Observed UTC days only, oldest first. A quiet day is absent, not neutral. */
  days: TimelineDay[];
  generated_at: string;
};

/* ------------------------------------------------------------- attention -- */

/**
 * The four numbers above a milestone list — what regressed, what is blocked,
 * what went quiet, what finished. Whole-tenant and actor-free: what is
 * regressing is not a fact about the viewer.
 *
 * Four differently shaped tiles rather than one shape with three nulls, because
 * the questions differ: one is a status, two are ages, one is a window. Each
 * tile echoes the threshold it was computed with, so a label reads
 * `Blocked ≥{blocked_days}d` from the response rather than from what the client
 * remembers asking for.
 */
export type AttentionResponse = {
  regressed: {
    /**
     * Milestones whose newest observed day is a regression. Equal to
     * `counts.by_status.regression` on `/v1/milestones?counts=true` read at the
     * same instant.
     */
    total: number;
    /**
     * Milestones at regression now that were **not** `since_days` ago — the
     * entered set, not the difference of two totals. On a day three regress and
     * three recover the difference is zero and two are still new.
     */
    entered: number;
    since_days: number;
  };
  blocked: {
    /** Milestones with a still-open `unblock` older than `blocked_days`. */
    total: number;
    /** The oldest still-open blocker's age. Null when nothing is blocked. */
    longest_seconds: number | null;
    blocked_days: number;
  };
  quiet: {
    /**
     * Observed at least once, then stopped. A milestone nothing was ever
     * observed on is not counted: it did not go quiet, it was never seen.
     */
    total: number;
    quiet_days: number;
  };
  closed: {
    /**
     * **Obligations**, not milestones — a milestone is never recorded as closed
     * anywhere in this read model. "Closed 18 action items", never "18
     * milestones". Abandoned obligations are excluded.
     */
    total: number;
    closed_days: number;
  };
  generated_at: string;
};

export type AttentionQuery = {
  /** How far back `regressed.entered` compares. Defaults to 1. */
  since_days?: number;
  /** How long a blocker must have been open to count. Defaults to 5. */
  blocked_days?: number;
  /** How stale the newest observation must be. Defaults to 14. */
  quiet_days?: number;
  /** The trailing window `closed.total` counts over. Defaults to 7. */
  closed_days?: number;
};

/* ---------------------------------------------------------------- search -- */

/**
 * One rail event that matched, and the milestone it sits on. A `TimelineEvent`
 * with the id added rather than the subject: a denormalized title here is a
 * second copy that can disagree with the one in `milestones`.
 */
export type SearchEvent = TimelineEvent & { milestone_id: string };

/**
 * One person a search matched, and what they stand on. The counts cover their
 * **actor's** whole account set, not the account that matched: somebody found by
 * their Slack handle still counts work a GitHub source named them on.
 */
export type Person = CloudUser & {
  /** Distinct milestones they are named on, open or closed. */
  milestones: number;
  open_actions: number;
  /** A **prefix** of those ids, not a page — there is no cursor here. */
  milestone_ids: string[];
};

/**
 * What one query found, per collection. A scope that was not asked for is an
 * empty array, never null; under `scope: "all"` the array lengths are the tab
 * counts, and there is deliberately no separate count field for them to
 * disagree with.
 */
export type SearchResponse = {
  /** Subject, description, keywords — `/v1/milestones?q=`'s own predicate. */
  milestones: Milestone[];
  /**
   * Matched on the **source record's text**, which the rail does not store: the
   * scan runs against the logs and the hits are mapped back through the pointer
   * that labels them. The expensive scope, and bounded rather than exhaustive —
   * these are the best hits, not every hit.
   */
  events: SearchEvent[];
  /** Handle and display name, never `account_id`. */
  people: Person[];
  scope: SearchScope;
  generated_at: string;
};

export type SearchScope = "all" | "milestones" | "events" | "people";

export type SearchQuery = {
  /**
   * Required, unlike `/v1/milestones?q=` where absent means no filter: a search
   * route with no query would read every collection whole, so an empty one is
   * `400 missing_query`.
   */
  q: string;
  scope?: SearchScope;
  /** **Per collection**, not across them. */
  limit?: number;
};

/** Cloud's own error shape, relayed unchanged, and the gateway's own failures. */
export type CloudErrorEnvelope = {
  error: { code: string; message: string };
};

/**
 * The viewer, as a query parameter. It is deliberately not a header: the
 * backend validates this value and writes `X-G6-Actor-ID` itself, so the
 * browser never sends that header and it stays out of the CORS allowlist.
 */
export type ActorQuery = {
  account_id: string;
  /** One milestone identity, 32-hex. Omitted means no filter. */
  entity_id?: string;
  /**
   * Three questions rather than one with a modifier: `me` is the inbox and the
   * only one whose length is the badge, `unassigned` is the obligations no
   * source named an account on, `anyone` is the tenant. An unknown value is a
   * `400`, not a silent `me`.
   */
  owner?: "me" | "unassigned" | "anyone";
  /** 1..=100. Above the deployment's cap is a `400`, not a silent clamp. */
  limit?: number;
  /**
   * `/v1/actions` sorts `(priority, opened_at, id)` and has its own cursor
   * shape. Handing it a `/v1/milestones` cursor is `400 invalid_cursor` rather
   * than a page that starts in the wrong place.
   */
  cursor?: string;
};

/** `/v1/overview` takes the actor's filters plus one backward-looking window. */
export type OverviewQuery = ActorQuery & {
  /** 1..=365. Absent means `resolved` comes back null and closed rows are never scanned. */
  resolved_days?: number;
};

/**
 * `/v1/milestones` pages on its own sort key and rejects an actions cursor.
 *
 * `q`, `status` and `quiet_days` compose and page with the same cursor, so they
 * are resent alongside it: a cursor is a position in a sort, not a saved query.
 */
export type MilestoneListQuery = {
  /**
   * Case-insensitive substring over the milestone's own words — `subject`,
   * `description`, `keywords`. Not `slug`, and not what was *said* on the
   * milestone: utterances are logs in another database, which is a different
   * feature rather than a wider match. Over 200 characters is `400
   * invalid_query`.
   */
  q?: string;
  /** Comma-separated `MilestoneStatus` values. Absent means all of them. */
  status?: string;
  /**
   * Serve only milestones whose newest observed instant is older than N days.
   * Quietness is not a fifth status: a milestone can be `progress` and silent
   * for a fortnight, which is exactly the one worth surfacing.
   */
  quiet_days?: number;
  /** Populate `counts`. Off by default — it is a second aggregate over every row. */
  counts?: boolean;
  /** Include the milestones nothing was ever observed on. They sort last. */
  has_no_activity?: boolean;
  limit?: number;
  cursor?: string;
};

/** Inclusive UTC days, `YYYY-MM-DD`. Cloud validates them, not this client. */
export type TimelineQuery = { from?: string; to?: string };

export type GatewayQuery =
  | ActorQuery
  | AttentionQuery
  | OverviewQuery
  | MilestoneListQuery
  | SearchQuery
  | TimelineQuery;

/**
 * The one write-shaped read. A signal reference, a depth and a cursor do not fit
 * a query string, so this route is a POST — but nothing is written and no source
 * platform is called; it returns the landed logs already in Cloud.
 *
 * Only `slack` and `github` are accepted. A `TimelineEvent.provider` may say
 * `jira` or `notion`, and those have no resolver: check before offering the
 * affordance rather than calling and handling the rejection.
 */
export type ResolveExtractionRequest = {
  provider: "slack" | "github";
  /**
   * `trace` is the conversation (a `thread_id`); `log` is one immutable record.
   * `trace` with `depth: "focus"` is rejected.
   */
  reference: { type: "log" | "trace"; id: string };
  /** Defaults to `context` — the whole conversation, chronological. */
  depth?: "focus" | "context";
  /** 1..100. */
  limit?: number;
  /** From a previous response's `nextCursor`. Bound to its provider and thread. */
  cursor?: string;
};

/** One landed log. `body` and `attribute` are the stored cold and promoted JSON, merged. */
export type RawRow = {
  /** RFC 3339 UTC. The nanosecond value stays in `data.timestamp`. */
  timestamp: string;
  data: {
    /** Epoch **nanoseconds**, not seconds or milliseconds. */
    timestamp: number;
    observed_timestamp: number;
    id: string;
    /** The conversation or lifecycle. Empty on a record nothing correlated. */
    trace_id: string;
    span_id: string;
    severity_text: string;
    severity_number: number;
    /** `message` is absent rather than empty when the record has no content. */
    body: Record<string, unknown>;
    attribute: Record<string, unknown>;
    resource: Record<string, unknown>;
    scope: Record<string, unknown>;
  };
};

export type RawData = {
  queryName: "extraction";
  /** Empty when the result is complete. Pass it back as `cursor`. */
  nextCursor: string;
  rows: RawRow[];
};

/**
 * The querier's generic raw contract, camelCase where the rest of this file is
 * snake_case — that is Cloud's shape, not a slip. Replacing Cloud's current
 * ClickHouse implementation with the querier changes nothing here.
 */
export type QueryRangeResponse = {
  type: "raw";
  /** Exactly one result, always named `extraction`. */
  data: { results: [RawData] };
  meta?: { rowsScanned: number; bytesScanned: number; durationMs?: number };
  /**
   * A degraded but useful answer — a record whose conversation could not be
   * correlated comes back alone, with the reason here. Not an error.
   */
  warning?: { message: string };
};
