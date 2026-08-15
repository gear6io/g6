// One timeline request per milestone, made when its panel is about to be seen.
//
// Twelve panels means twelve timelines, and a timeline can carry thousands of
// source activities. Fetching them all at mount would spend the landing view's
// first second on rows below the fold, so each panel asks for its own when it
// nears the viewport, and no more than four are ever in flight.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { milestoneTimeline } from "@/shared/api/cloudGateway/client";
import type {
  MilestoneTimelineResponse,
  TimelineQuery,
} from "@/shared/api/cloudGateway/types";

/** Enough to fill a screen without queueing behind one slow milestone. */
const MAX_IN_FLIGHT = 4;

export type TimelineLoad =
  | { status: "loading" }
  | { status: "ready"; value: MilestoneTimelineResponse }
  | { status: "error"; code: string; message: string };

export type Timelines = {
  get: (milestoneId: string) => TimelineLoad | undefined;
  /**
   * Idempotent inside one cache key: a milestone already asked for is not asked
   * for again until refresh or the selected window changes.
   */
  request: (milestoneId: string, query?: TimelineQuery) => void;
  retry: (milestoneId: string, query?: TimelineQuery) => void;
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
 * `cacheKey` changing drops every cached timeline. It includes both manual
 * refreshes and the selected time window, so a response for 30d can never be
 * reused after the reader switches to 7d or 90d.
 */
export function useMilestoneTimelines(cacheKey: string | number): Timelines {
  const [byId, setById] = useState<Record<string, TimelineLoad>>({});
  const asked = useRef(new Set<string>());
  const generation = useRef(0);
  const queue = useRef<
    { generation: number; id: string; query?: TimelineQuery }[]
  >([]);
  const inFlight = useRef(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Reset before row effects ask for the new window. A passive reset would run
  // after child effects and could discard their newly queued requests.
  useLayoutEffect(() => {
    generation.current += 1;
    asked.current = new Set();
    queue.current = [];
    setById({});
  }, [cacheKey]);

  const pump = useCallback(() => {
    while (inFlight.current < MAX_IN_FLIGHT && queue.current.length > 0) {
      const queued = queue.current.shift() as {
        generation: number;
        id: string;
        query?: TimelineQuery;
      };
      const { id, query } = queued;
      inFlight.current += 1;
      // Window dates come from the list response's generated instant, never the
      // webview clock. The query is omitted only for legacy callers that still
      // rely on Cloud's default window.
      milestoneTimeline(id, query)
        .then((value) => {
          if (live.current && queued.generation === generation.current) {
            setById((current) => ({
              ...current,
              [id]: { status: "ready", value },
            }));
          }
        })
        .catch((err: unknown) => {
          if (live.current && queued.generation === generation.current) {
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
    (milestoneId: string, query?: TimelineQuery) => {
      if (asked.current.has(milestoneId)) {
        return;
      }
      asked.current.add(milestoneId);
      setById((current) => ({
        ...current,
        [milestoneId]: { status: "loading" },
      }));
      queue.current.push({
        generation: generation.current,
        id: milestoneId,
        query,
      });
      pump();
    },
    // Changing the key also changes this callback, so mounted rows ask again
    // after the layout reset above (including on manual refresh).
    [cacheKey, pump],
  );

  const retry = useCallback(
    (milestoneId: string, query?: TimelineQuery) => {
      asked.current.delete(milestoneId);
      request(milestoneId, query);
    },
    [request],
  );

  const get = useCallback((milestoneId: string) => byId[milestoneId], [byId]);

  return { get, request, retry };
}
