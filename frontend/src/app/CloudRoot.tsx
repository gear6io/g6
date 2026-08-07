// Root surface for cloud builds. Readiness first, and once Cloud answers, the
// compact action inbox — no decisions or constraints list, no channels, no
// messages, no legacy app shell.
//
// The boot surface stays the whole window only while readiness is unresolved or
// failed: those are the states where there is nothing to put in a panel.
import { useCallback, useEffect, useState } from "react";

import { type CloudBootState, runCloudBoot } from "@/app/cloudBoot";
import { CloudMiniInbox } from "@/features/cloudInbox/CloudMiniInbox";
import { Button } from "@/shared/ui/button";

const COPY: Record<Exclude<CloudBootState["status"], "connecting">, string> = {
  ready: "Gear6 Cloud is ready.",
  configuration: "This gear6 backend has no Gear6 Cloud upstream configured.",
  unavailable: "Gear6 Cloud is not answering right now.",
  timeout: "Gear6 Cloud took too long to answer.",
  "invalid-response": "Gear6 Cloud answered with something unexpected.",
};

export function CloudBootSurface({
  onRetry,
  state,
}: {
  onRetry: () => void;
  state: CloudBootState;
}) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground"
      data-testid={`cloud-root-${state.status}`}
      role={state.status === "connecting" ? "status" : undefined}
    >
      {state.status === "connecting" ? (
        <p className="text-sm text-muted-foreground">
          Connecting to Gear6 Cloud…
        </p>
      ) : (
        <h1 className="text-base font-medium">{COPY[state.status]}</h1>
      )}

      {state.status !== "connecting" && state.status !== "ready" ? (
        <>
          <p
            className="max-w-sm text-sm text-muted-foreground"
            data-testid="cloud-root-error-message"
          >
            {state.message}
          </p>
          <Button
            data-testid="cloud-root-retry"
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

export function CloudRoot() {
  const [state, setState] = useState<CloudBootState>({ status: "connecting" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "connecting" });
    void runCloudBoot().then((next) => {
      if (!cancelled) {
        setState(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // One fresh readiness request per press; the effect's cleanup drops the
  // in-flight answer so a slow first attempt cannot overwrite a newer one.
  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  if (state.status === "ready") {
    return <CloudMiniInbox />;
  }
  return <CloudBootSurface onRetry={retry} state={state} />;
}
