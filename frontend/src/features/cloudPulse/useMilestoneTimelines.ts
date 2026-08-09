// One timeline request per milestone, made when its panel is about to be seen.
//
// Twelve panels means twelve timelines, and a timeline can carry thousands of
// source activities. Fetching them all at mount would spend the landing view's
// first second on rows below the fold, so each panel asks for its own when it
// nears the viewport, and no more than four are ever in flight.
import { useCallback, useEffect, useRef, useState } from "react";

import { milestoneTimeline } from "@/shared/api/cloudGateway/client";
import type { MilestoneTimelineResponse } from "@/shared/api/cloudGateway/types";

/** Enough to fill a screen without queueing behind one slow milestone. */
const MAX_IN_FLIGHT = 4;

export type TimelineLoad =
  | { status: "loading" }
  | { status: "ready"; value: MilestoneTimelineResponse }
  | { status: "error"; code: string; message: string };

export type Timelines = {
  get: (milestoneId: string) => TimelineLoad | undefined;
  /** Idempotent: a milestone already asked for is not asked for again. */
  request: (milestoneId: string) => void;
  retry: (milestoneId: string) => void;
};

function failure(err: unknown): { code: string; message: string } {
  const code =
    typeof err === "object" && err && "code" in err
      ? String((err as { code: unknown }).code)
      : "cloud_unreachable";
  return {
    code,
    message: err instanceof Error ? err.message : String(err),
  };
}

/**
 * `refreshKey` changing drops every cached timeline, which is what a manual
 * refresh means. Panels re-request as they are seen, so a background refresh
 * costs the visible rows and not the whole page.
 */
export function useMilestoneTimelines(refreshKey: number): Timelines {
  const [byId, setById] = useState<Record<string, TimelineLoad>>({});
  const asked = useRef(new Set<string>());
  const queue = useRef<string[]>([]);
  const inFlight = useRef(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (refreshKey === 0) {
      return;
    }
    asked.current = new Set();
    queue.current = [];
    setById({});
  }, [refreshKey]);

  const pump = useCallback(() => {
    while (inFlight.current < MAX_IN_FLIGHT && queue.current.length > 0) {
      const id = queue.current.shift() as string;
      inFlight.current += 1;
      // No `from`/`to`: Cloud's own default is the 30-day window this renders,
      // and sending dates computed from the webview's clock would make the
      // range disagree with the one Cloud describes.
      milestoneTimeline(id)
        .then((value) => {
          if (live.current) {
            setById((current) => ({ ...current, [id]: { status: "ready", value } }));
          }
        })
        .catch((err: unknown) => {
          if (live.current) {
            setById((current) => ({
              ...current,
              [id]: { status: "error", ...failure(err) },
            }));
          }
        })
        .finally(() => {
          inFlight.current -= 1;
          pump();
        });
    }
  }, []);

  const request = useCallback(
    (milestoneId: string) => {
      if (asked.current.has(milestoneId)) {
        return;
      }
      asked.current.add(milestoneId);
      setById((current) => ({ ...current, [milestoneId]: { status: "loading" } }));
      queue.current.push(milestoneId);
      pump();
    },
    [pump],
  );

  const retry = useCallback(
    (milestoneId: string) => {
      asked.current.delete(milestoneId);
      request(milestoneId);
    },
    [request],
  );

  const get = useCallback((milestoneId: string) => byId[milestoneId], [byId]);

  return { get, request, retry };
}
