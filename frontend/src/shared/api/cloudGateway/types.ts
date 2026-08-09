// The G6 Cloud wire shapes, modelled directly from g6.cloud/openapi.yaml.
//
// Nothing here is converted on arrival: dates stay RFC 3339 strings, ages stay
// whole seconds, confidence stays a 0..1 number, signal ids and cursors stay
// exact strings. Cloud renders instants server-side precisely because an epoch
// nanosecond does not survive a JS number, and re-parsing them here would put
// that hazard straight back.

export type Page = {
  /** The page size actually applied, after Cloud's defaulting. */
  limit: number;
  /**
   * Opaque, versioned, base64url. Pass it back verbatim; a future Cloud rejects
   * an old cursor with `400 invalid_cursor` rather than decoding it into a
   * plausible wrong page.
   */
  next_cursor: string | null;
};

export type Entity = {
  id: string;
  slug: string;
  summary: string;
  /** Lattice status of the milestone identity: active, merged, pruned. */
  status: string;
};

export type SignalKind = "decision" | "handoff" | "constraint";

export type Signal = {
  /** Content-addressed and stable across polls — safe as a list key. */
  id: string;
  kind: SignalKind;
  subject: string;
  /** Null when the signal has no resolved entity, or the projection has no row. */
  entity: Entity | null;
  work_item_ids: string[];
  work_item_count: number;
  /** RFC 3339 UTC, whole seconds. */
  opened_at: string;
  updated_at: string;
  age_seconds: number;
  confidence: number;
};

export type SignalListResponse = {
  data: Signal[];
  page: Page;
  generated_at: string;
};

/**
 * A decision is deliberately absent: no source states an owner for one, so it
 * cannot be anybody's personal queue. `/v1/open-decisions` serves them instead.
 */
export type ActionType = "act_on_handoff" | "unblock_constraint";

export type Action = {
  /** `action:v1:{type}:{signal_id}` — derived from the signal, safe as a key. */
  id: string;
  type: ActionType;
  /** Fixed copy for the action type. Not per-signal and not generated. */
  instruction: string;
  signal: Signal;
};

export type ActionListResponse = {
  data: Action[];
  page: Page;
  generated_at: string;
};

/** One Slack account worth sending as the viewer. Development only. */
export type CloudUser = {
  /** The value the gateway turns into `X-G6-Actor-ID`. */
  account_id: string;
  actor_id: string;
  kind: "human" | "bot" | "app" | "agent";
  /** Login or username. Changeable upstream; not an identity. */
  handle: string;
  /** Empty when unknown. */
  display_name: string;
  email: string;
};

export type UserListResponse = {
  data: CloudUser[];
  /** `limit` is the fixed 1000-row cap and `next_cursor` is always null. */
  page: Page;
  generated_at: string;
};

export type OverviewResponse = {
  /** Whole-tenant totals. The same for every viewer. */
  open_decisions: number;
  open_constraints: number;
  /**
   * Open handoffs and constraints this viewer is actionable on — exactly the
   * number of rows `/v1/actions` returns for the same actor. The three counts
   * are not a partition and do not sum to anything meaningful.
   */
  actions: number;
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
  slug: string;
  summary: string;
  /** Never `merged`: those are served under the milestone they merged into. */
  status: "active" | "pruned";
  updated_at: string;
  last_activity: MilestoneLastActivity | null;
  /** Whole-tenant open signals on this milestone, not the viewer's inbox. */
  open_decisions: number;
  open_handoffs: number;
  open_constraints: number;
};

export type MilestoneListResponse = {
  data: Milestone[];
  page: Page;
  generated_at: string;
};

/** Enjin's state at the end of the day. */
export type TimelineSnapshot = {
  open_decisions: number;
  open_handoffs: number;
  open_constraints: number;
  /** Reach of the open constraints — how many work items they touch. */
  constraint_work_items: number;
};

/** Net movement since the previous *returned* day, signed. */
export type TimelineChanges = TimelineSnapshot;

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

export type TimelineSource = {
  id: string;
  type: "log" | "span.event" | "wait.open" | "wait.close" | "resolver";
  occurred_at: string;
  /** Empty where the record has nothing safe to show. */
  summary: string;
  provider: string;
  /** The source's own link, or null where it supplied none. Never fabricated. */
  url: string | null;
};

export type TimelineDay = {
  date: string;
  /** The strongest classification in `status_evidence`. */
  status: MilestoneStatus;
  observed_at: string;
  /** May exceed `sources.length` when the response's activity cap cut. */
  event_count: number;
  snapshot: TimelineSnapshot;
  changes: TimelineChanges;
  status_evidence: StatusEvidence[];
  sources: TimelineSource[];
  /** True when the 5000-activity cap cut this day's list; counts are unaffected. */
  sources_truncated: boolean;
};

export type MilestoneTimelineResponse = {
  milestone: Entity;
  /** Observed UTC days only, oldest first. A quiet day is absent, not neutral. */
  days: TimelineDay[];
  generated_at: string;
};

/** Cloud's own error shape, relayed unchanged, and the gateway's own failures. */
export type CloudErrorEnvelope = {
  error: { code: string; message: string };
};

/** The allowlisted query parameters. Nothing else reaches Cloud. */
export type ListQuery = {
  entity_id?: string;
  limit?: number;
  cursor?: string;
};

/**
 * The viewer, as a query parameter. It is deliberately not a header: the
 * backend validates this value and writes `X-G6-Actor-ID` itself, so the
 * browser never sends that header and it stays out of the CORS allowlist.
 */
export type ActorQuery = { account_id: string };

/** `/v1/milestones` pages on its own sort key and rejects a signal cursor. */
export type MilestoneListQuery = {
  status?: "active" | "pruned" | "all";
  limit?: number;
  cursor?: string;
};

/** Inclusive UTC days, `YYYY-MM-DD`. Cloud validates them, not this client. */
export type TimelineQuery = { from?: string; to?: string };

export type GatewayQuery =
  | ListQuery
  | ActorQuery
  | MilestoneListQuery
  | TimelineQuery;
