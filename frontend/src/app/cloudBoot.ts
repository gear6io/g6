// Boot state for the Cloud root. One step — readiness — and every outcome is a
// state the user can see and act on, so there is no loading gate to get stuck
// behind (the deadline itself lives in the client's AbortSignal).
import { type CloudHealth, health } from "@/shared/api/cloudGateway/client";

export type CloudBootFailure =
  | "configuration"
  | "unavailable"
  | "timeout"
  | "invalid-response";

export type CloudBootState =
  | { status: "connecting" }
  | { status: "ready" }
  | { status: CloudBootFailure; message: string };

/**
 * Gateway error codes collapse into the four states worth telling apart: one
 * the operator fixes (configuration), one that fixes itself (unavailable), one
 * that is worth retrying immediately (timeout), and one that means something
 * between here and Cloud is not Cloud (invalid-response).
 */
const FAILURE_BY_CODE: Record<string, CloudBootFailure> = {
  cloud_not_configured: "configuration",
  cloud_unreachable: "unavailable",
  cloud_not_ready: "unavailable",
  cloud_timeout: "timeout",
  cloud_redirect: "invalid-response",
  cloud_invalid_response: "invalid-response",
};

export function cloudBootState(result: CloudHealth): CloudBootState {
  if (result.ready) {
    return { status: "ready" };
  }
  return {
    status: FAILURE_BY_CODE[result.code] ?? "invalid-response",
    message: result.message,
  };
}

/** Never rejects, so the caller always has something to render. */
export async function runCloudBoot(
  check: () => Promise<CloudHealth> = health,
): Promise<CloudBootState> {
  try {
    return cloudBootState(await check());
  } catch (err) {
    return {
      status: "invalid-response",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
