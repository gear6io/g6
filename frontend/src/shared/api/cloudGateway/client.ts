// The desktop's only door to G6 Cloud, and it does not open onto Cloud: every
// call goes to `/api/cloud/*` on the gear6 backend, which does the outbound
// request itself.
//
// The origin below is derived from VITE_RELAY_URL for exactly that reason —
// there is no Cloud URL in the webview at all. Moving Cloud, or putting the
// planned router in front of it, is a change to the backend's upstream setting
// and nothing here. (A test asserts that setting's name never appears in this
// file; keep it that way.)
import { relayHttpFromWs } from "@/shared/api/inviteHelpers";

import type {
  ActionListResponse,
  ActorQuery,
  AttentionQuery,
  AttentionResponse,
  CloudErrorEnvelope,
  GatewayQuery,
  OverviewQuery,
  SearchQuery,
  SearchResponse,
  MilestoneListQuery,
  MilestoneListResponse,
  MilestoneTimelineResponse,
  OverviewResponse,
  QueryRangeResponse,
  ResolveExtractionRequest,
  TimelineQuery,
  UserListResponse,
} from "@/shared/api/cloudGateway/types";

const DEFAULT_RELAY_URL = "ws://localhost:3000";

/**
 * Longer than the backend's own 12s deadline, so a slow Cloud surfaces as the
 * backend's `cloud_timeout` (which says which hop was slow) rather than as this
 * abort. This is the backstop for the backend itself never answering.
 */
export const CLIENT_TIMEOUT_MS = 15_000;

export class CloudGatewayError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CloudGatewayError";
    this.code = code;
  }
}

export function gatewayOrigin(): string {
  const env = (import.meta.env ?? {}) as { VITE_RELAY_URL?: string };
  return relayHttpFromWs(env.VITE_RELAY_URL ?? DEFAULT_RELAY_URL);
}

function gatewayUrl(path: string, query?: GatewayQuery): string {
  const url = new URL(`${gatewayOrigin()}/api/cloud/${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/** `globalThis.fetch` rather than a captured binding so tests can stub it. */
function gatewayFetch(path: string, query?: GatewayQuery): Promise<Response> {
  return globalThis.fetch(gatewayUrl(path, query), {
    signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
  });
}

/**
 * The failure code for a non-2xx response. The backend's gateway failures and
 * Cloud's own 400/503 both arrive as a JSON envelope, so its `error.code` is
 * used as-is; Cloud's plain-text 503 readiness answer has no envelope and gets
 * `cloud_not_ready` — Cloud is reachable, its read model is not.
 */
async function failure(res: Response): Promise<CloudGatewayError> {
  const body = await res.text().catch(() => "");
  try {
    const envelope = JSON.parse(body) as CloudErrorEnvelope;
    if (envelope?.error?.code) {
      return new CloudGatewayError(envelope.error.code, envelope.error.message);
    }
  } catch {
    // Not JSON: fall through to the plain-text reading below.
  }
  return new CloudGatewayError(
    "cloud_not_ready",
    body.trim() || `Gear6 Cloud answered HTTP ${res.status}.`,
  );
}

function transportFailure(err: unknown): CloudGatewayError {
  // AbortSignal.timeout rejects with a TimeoutError; anything else means the
  // gear6 backend itself did not answer, which is the same recoverable
  // "unavailable" as Cloud being down from the user's point of view.
  const timedOut = err instanceof Error && err.name === "TimeoutError";
  return new CloudGatewayError(
    timedOut ? "cloud_timeout" : "cloud_unreachable",
    timedOut
      ? "The gear6 backend did not answer in time."
      : `The gear6 backend could not be reached: ${err instanceof Error ? err.message : String(err)}`,
  );
}

export type CloudHealth =
  | { ready: true }
  | { ready: false; code: string; message: string };

/**
 * Readiness. Never rejects: every outcome is something the Cloud root renders.
 */
export async function health(): Promise<CloudHealth> {
  let res: Response;
  try {
    res = await gatewayFetch("healthz");
  } catch (err) {
    const { code, message } = transportFailure(err);
    return { ready: false, code, message };
  }
  if (res.ok) {
    return { ready: true };
  }
  const { code, message } = await failure(res);
  return { ready: false, code, message };
}

async function getJson<T>(path: string, query?: GatewayQuery): Promise<T> {
  let res: Response;
  try {
    res = await gatewayFetch(path, query);
  } catch (err) {
    throw transportFailure(err);
  }
  if (!res.ok) {
    throw await failure(res);
  }
  // Returned as parsed, not remapped: see the note in `./types`.
  return (await res.json()) as T;
}

/**
 * The development user directory. The route is compiled out of a release
 * backend, so this rejects with the gateway's 404 there rather than returning
 * an empty list — callers gate the call on the build, not on the answer.
 */
export function listDevUsers(): Promise<UserListResponse> {
  return getJson("v1/dev/users");
}

export function listActions(
  accountId: string,
  query?: Omit<ActorQuery, "account_id">,
): Promise<ActionListResponse> {
  return getJson("v1/actions", { ...query, account_id: accountId });
}

export function overview(
  accountId: string,
  query?: Omit<OverviewQuery, "account_id">,
): Promise<OverviewResponse> {
  return getJson("v1/overview", { ...query, account_id: accountId });
}

/**
 * The four tiles above the list. No actor, like `/v1/overview`'s `open`: what
 * is regressing is not a fact about the viewer.
 *
 * The thresholds are left to Cloud's defaults unless a caller has a reason —
 * and the response echoes whichever were used, so a label is rendered from
 * `blocked.blocked_days` rather than from what was asked for.
 */
export function attention(query?: AttentionQuery): Promise<AttentionResponse> {
  return getJson("v1/attention", query);
}

/**
 * One query across milestones, rail events and people. One route rather than
 * three because a palette showing counts per scope needs all three answers per
 * keystroke, and three round trips are three chances to draw counts from
 * different instants.
 */
export function search(query: SearchQuery): Promise<SearchResponse> {
  return getJson("v1/search", query);
}

/** No actor: the counts on a milestone are the tenant's, not the viewer's. */
export function listMilestones(
  query?: MilestoneListQuery,
): Promise<MilestoneListResponse> {
  return getJson("v1/milestones", query);
}

/**
 * The one path with a value in it. The id always comes from a milestone the
 * list returned, and the backend rejects anything that is not Cloud's 32-hex
 * entity shape before it builds an upstream URL — so this interpolates without
 * escaping, and there is nothing here for a caller to smuggle a segment through.
 */
export function milestoneTimeline(
  milestoneId: string,
  query?: TimelineQuery,
): Promise<MilestoneTimelineResponse> {
  return getJson(`v1/milestones/${milestoneId}/timeline`, query);
}

/**
 * The conversation behind an event, in place of a link out.
 *
 * The only POST, and it is still a read — a signal reference, a depth and a
 * cursor do not fit a query string. The request is sent as written: the backend
 * caps its size and forwards the bytes, and Cloud's schema is the validator.
 */
export async function resolveExtraction(
  request: ResolveExtractionRequest,
): Promise<QueryRangeResponse> {
  let res: Response;
  try {
    res = await globalThis.fetch(gatewayUrl("v1/extractions/resolve"), {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
  } catch (err) {
    throw transportFailure(err);
  }
  if (!res.ok) {
    throw await failure(res);
  }
  return (await res.json()) as QueryRangeResponse;
}
