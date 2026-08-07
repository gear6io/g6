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

export type ActionType =
  | "act_on_handoff"
  | "resolve_decision"
  | "unblock_constraint";

/**
 * A property of the viewer, not of the signal: the same constraint is `viewer`
 * for the person Cloud recorded as its owner and `team` for everyone else.
 */
export type ActionAudience = "viewer" | "team";

export type Action = {
  /** `action:v1:{type}:{signal_id}` — derived from the signal, safe as a key. */
  id: string;
  type: ActionType;
  audience: ActionAudience;
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
  open_decisions: number;
  open_constraints: number;
  actions: { viewer: number; team: number; total: number };
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

export type GatewayQuery = ListQuery | ActorQuery;
