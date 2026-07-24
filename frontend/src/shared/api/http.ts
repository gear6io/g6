// Thin HTTP client for the gear6 Slack-compatible REST API. Auth is disabled
// backend-side for local dev (GEAR6_DISABLE_AUTH), so no Authorization header is
// sent — the backend resolves requests as its `dev` user. Add token handling here
// once a real login flow exists.
import { relayHttpFromWs } from "@/shared/api/inviteHelpers";

function baseUrl(): string {
  const ws = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:3000";
  return relayHttpFromWs(ws);
}

export async function apiGet<T>(
  endpoint: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const url = new URL(`${baseUrl()}/api/${endpoint}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`gear6 GET ${endpoint} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function apiPost<T>(
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${baseUrl()}/api/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`gear6 POST ${endpoint} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * A POST that fails loudly. Slack reports every method failure inside a 200 body
 * (`{ok: false, error}`), so a bare `apiPost` makes a rejected mutation look
 * like a success — the caller has to check `ok` or silently swallow it. Use this
 * for anything that writes; use `apiGet`/`apiPost` only when the caller inspects
 * `ok` itself.
 */
export async function apiCall<T>(
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await apiPost<T & { ok: boolean; error?: string }>(endpoint, body);
  if (!res.ok) throw new Error(res.error ?? `gear6 ${endpoint} failed`);
  return res;
}
