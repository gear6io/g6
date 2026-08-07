// Boot state for the gear6 render boundary (see `@/app/rootSurface`).
//
// The legacy nostr-era boot chained migration → identity → community setup →
// relay apply, each without a deadline, so a backend that accepted the socket
// but never answered left the app on its loading gate forever. This boot has
// exactly one step (identity) and a hard deadline: every outcome resolves to a
// state the user can see and act on.
import { getApiIdentity } from "@/shared/api/invoke";

export type Gear6BootState =
  | { status: "loading" }
  | { status: "ready"; pubkey: string; displayName: string }
  | { status: "error"; message: string };

export const BOOT_TIMEOUT_MS = 8_000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Resolve the boot state. Never rejects and never outlives `timeoutMs`, so the
 * caller always has something to render.
 */
export async function runGear6Boot(
  fetchIdentity: () => Promise<{
    pubkey: string;
    display_name: string;
  }> = getApiIdentity,
  timeoutMs: number = BOOT_TIMEOUT_MS,
): Promise<Gear6BootState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Gear6BootState>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          status: "error",
          message: `The gear6 backend did not respond within ${Math.round(timeoutMs / 1_000)}s.`,
        }),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([
      fetchIdentity().then(
        (identity): Gear6BootState => ({
          status: "ready",
          pubkey: identity.pubkey,
          displayName: identity.display_name,
        }),
      ),
      deadline,
    ]);
  } catch (err) {
    return { status: "error", message: errorMessage(err) };
  } finally {
    clearTimeout(timer);
  }
}
