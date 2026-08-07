// Root surface for gear6 builds. Deliberately tiny: it replaces the legacy
// nostr-era `App`/`AppShell` tree at the boot boundary (see
// `@/app/rootSurface`) so none of that tree's routes, subscriptions,
// notifications or unsupported Tauri calls start at all.
//
// TEMPORARY — see docs/gear6-render-boundary.md for what has to be rebuilt
// here before the legacy shell can be reintroduced or deleted.
import { useCallback, useEffect, useState } from "react";

import { type Gear6BootState, runGear6Boot } from "@/app/gear6Boot";
import { Button } from "@/shared/ui/button";

const REBUILD_NOTICE =
  "The gear6 workspace UI is being rebuilt. The legacy shell is not mounted in this build.";

export function Gear6BootSurface({
  onRetry,
  state,
}: {
  onRetry: () => void;
  state: Gear6BootState;
}) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground"
      data-testid={`gear6-root-${state.status}`}
      role={state.status === "loading" ? "status" : undefined}
    >
      {state.status === "loading" ? (
        <p className="text-sm text-muted-foreground">Connecting to gear6…</p>
      ) : null}

      {state.status === "ready" ? (
        <>
          <h1 className="text-base font-medium">
            Connected as {state.displayName}
          </h1>
          <p className="font-mono text-xs text-muted-foreground">
            {state.pubkey}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {REBUILD_NOTICE}
          </p>
        </>
      ) : null}

      {state.status === "error" ? (
        <>
          <h1 className="text-base font-medium">Could not reach gear6</h1>
          <p
            className="max-w-sm text-sm text-muted-foreground"
            data-testid="gear6-root-error-message"
          >
            {state.message}
          </p>
          <Button
            data-testid="gear6-root-retry"
            onClick={onRetry}
            variant="outline"
          >
            Retry
          </Button>
        </>
      ) : null}
    </div>
  );
}

export function Gear6Root() {
  const [state, setState] = useState<Gear6BootState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void runGear6Boot().then((next) => {
      if (!cancelled) {
        setState(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return <Gear6BootSurface onRetry={retry} state={state} />;
}
