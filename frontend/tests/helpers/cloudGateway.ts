// A stubbed Gear6 Cloud, for the screenshot specs.
//
// Every payload here is shaped by `g6.cloud/openapi.yaml` and typed against
// `@/shared/api/cloudGateway/types` — a fixture that drifts from the wire shape
// produces a screenshot of a screen that cannot exist. Nothing is invented that
// the API does not carry: there is no team on a milestone and no due date on an
// action, because Cloud serves neither.
import type { Page } from "@playwright/test";

import type {
  Action,
  ActionCounts,
  AttentionResponse,
  Milestone,
  MilestoneStatus,
  RequiredAction,
  TimelineDay,
} from "../../src/shared/api/cloudGateway/types";

const GENERATED_AT = "2026-08-14T09:12:00Z";

function counts(overrides: Partial<ActionCounts> = {}): ActionCounts {
  return {
    review: 0,
    approval: 0,
    response: 0,
    decision: 0,
    execute: 0,
    unblock: 0,
    ...overrides,
  };
}

function openSince(
  overrides: Partial<Record<RequiredAction, string | null>> = {},
) {
  return {
    review: null,
    approval: null,
    response: null,
    decision: null,
    execute: null,
    unblock: null,
    ...overrides,
  };
}

function hex(seed: number): string {
  return seed.toString(16).padStart(32, "0");
}

function milestone(
  seed: number,
  subject: string,
  description: string,
  status: MilestoneStatus | null,
  open: Partial<ActionCounts>,
  observedAt: string,
): Milestone {
  return {
    id: hex(seed),
    subject,
    slug: subject.toLowerCase().replace(/\W+/g, "-"),
    description,
    keywords: [],
    updated_at: observedAt,
    last_activity: status
      ? { date: observedAt.slice(0, 10), status, observed_at: observedAt }
      : null,
    open: counts(open),
    open_since: openSince(
      open.unblock ? { unblock: "2026-08-03T09:00:00Z" } : {},
    ),
  };
}

export const MILESTONES: Milestone[] = [
  milestone(
    1,
    "Read-state convergence across communities",
    "Markers stop drifting when a community switch clears the outgoing channel.",
    "regression",
    { review: 3, decision: 2, unblock: 2 },
    "2026-08-12T09:12:00Z",
  ),
  milestone(
    2,
    "Agent observer frames survive a cold start",
    "Replay gap on kind 24200 after a restart with a seeded archive.",
    "regression",
    { review: 2, response: 2, unblock: 1 },
    "2026-08-14T05:40:00Z",
  ),
  milestone(
    3,
    "Cloud window: compact and expanded parity",
    "The thread panel still needs a channel id before it can render in place.",
    "dependency",
    { review: 2, approval: 1 },
    "2026-08-13T11:02:00Z",
  ),
  milestone(
    4,
    "Relay admission limits under burst load",
    "Decision open on the per-pubkey ceiling and how it degrades.",
    "dependency",
    { decision: 2, execute: 2 },
    "2026-08-11T16:20:00Z",
  ),
  milestone(
    5,
    "Pulse timeline rail compression",
    "Quiet runs collapse to one marker, and the run keeps its own dates.",
    "neutral",
    {},
    "2026-07-31T10:00:00Z",
  ),
  milestone(
    6,
    "Managed agent readiness across providers",
    "Databricks host normalisation, and what readiness means when it fails.",
    "dependency",
    { review: 4, approval: 2 },
    "2026-08-14T03:15:00Z",
  ),
  milestone(
    7,
    "Local archive seeding for agent metrics",
    "Kind 44200 replay ordering when the archive is seeded mid-session.",
    "regression",
    { review: 1, execute: 1 },
    "2026-08-14T00:30:00Z",
  ),
  milestone(
    8,
    "Theme tokens: dark Pulse canvas contrast",
    "Brand-ink lift verified at 6.48:1 against the dark canvas.",
    "progress",
    { approval: 1 },
    "2026-08-12T14:45:00Z",
  ),
  milestone(
    9,
    "Playwright suite: two-community switch case",
    "Merged, awaiting a green nightly before the guard is relied on.",
    "progress",
    { review: 2 },
    "2026-08-13T08:00:00Z",
  ),
  milestone(
    10,
    "Gateway pagination for the actions endpoint",
    "Cursor stability under concurrent writes to the same projection.",
    "neutral",
    {},
    "2026-07-29T12:00:00Z",
  ),
];

const ATTENTION: AttentionResponse = {
  regressed: { total: 6, entered: 2, since_days: 1 },
  blocked: { total: 3, longest_seconds: 11 * 24 * 60 * 60, blocked_days: 5 },
  quiet: { total: 5, quiet_days: 14 },
  closed: { total: 18, closed_days: 7 },
  generated_at: GENERATED_AT,
};

const MILESTONE_COUNTS = {
  total: 247,
  by_status: { regression: 6, dependency: 8, progress: 191, neutral: 42 },
  no_activity: 0,
};

function day(
  date: string,
  status: MilestoneStatus,
  snapshot: Partial<ActionCounts>,
): TimelineDay {
  return {
    date,
    status,
    observed_at: `${date}T14:31:00Z`,
    event_count: 4,
    snapshot: counts(snapshot),
    changes: counts({ decision: 1 }),
    status_evidence: [
      {
        classification: status === "neutral" ? "progress" : status,
        provenance: "deterministic",
        reason: "decision_closed",
        rationale: null,
        confidence: 1,
      },
    ],
    events: [
      {
        id: hex(900),
        type: "log",
        occurred_at: `${date}T09:12:00Z`,
        summary: "Gateway rejected kind 44200 on the internal build.",
        provider: "slack",
        url: null,
        thread_id: null,
      },
      {
        id: hex(901),
        type: "log",
        occurred_at: `${date}T11:40:00Z`,
        summary: "Review opened: rail badge guard.",
        provider: "github",
        url: null,
        thread_id: null,
      },
    ],
    events_truncated: false,
  };
}

/** A shape with a compressed neutral run and two gaps, so the rail has work to do. */
const TIMELINE_DAYS: TimelineDay[] = [
  day("2026-07-16", "progress", { review: 2 }),
  day("2026-07-17", "progress", { review: 2, decision: 1 }),
  day("2026-07-22", "neutral", { review: 2, decision: 1 }),
  day("2026-07-23", "neutral", { review: 2, decision: 1 }),
  day("2026-07-24", "neutral", { review: 3, decision: 1 }),
  day("2026-08-04", "dependency", { review: 3, decision: 2, unblock: 1 }),
  day("2026-08-12", "regression", { review: 3, decision: 2, unblock: 2 }),
];

function action(
  seed: number,
  level: "p0" | "p1" | "p2" | "p3",
  required: RequiredAction,
  subject: string,
  instruction: string,
  ageSeconds: number,
  entity: Milestone | null,
  provider: string,
  summary: string,
): Action {
  return {
    id: hex(100 + seed),
    subject,
    required_action: required,
    dependency_type: "",
    dependency_on: "person",
    priority: { level, evidence: [] },
    instruction,
    entity: entity
      ? {
          id: entity.id,
          subject: entity.subject,
          slug: entity.slug,
          description: entity.description,
          keywords: entity.keywords,
        }
      : null,
    referent: provider
      ? { summary, provider, url: "https://example.invalid/record", thread_id: "t1" }
      : null,
    work_item_ids: [],
    work_item_count: 1,
    opened_at: "2026-08-12T09:12:00Z",
    updated_at: "2026-08-13T09:12:00Z",
    age_seconds: ageSeconds,
    confidence: 0.9,
  };
}

const HOUR = 3600;
const DAY = 24 * HOUR;

export const ACTIONS: Action[] = [
  action(
    1,
    "p0",
    "unblock",
    "Gateway rejects kind 44200 on the internal build",
    "Confirm whether the subscription ships in 0.9.40 or gets backported.",
    2 * DAY,
    MILESTONES[0],
    "slack",
    "#incidents",
  ),
  action(
    2,
    "p0",
    "decision",
    "Pick the read-state migration path for 0.9.40",
    "Two proposals are open and the release branch cuts Thursday.",
    DAY,
    MILESTONES[0],
    "github",
    "gear6#812",
  ),
  action(
    3,
    "p1",
    "review",
    "Rail badge fix — guard the community switch",
    "One file, six lines, with a playwright case attached.",
    6 * HOUR,
    MILESTONES[0],
    "github",
    "gear6#809",
  ),
  action(
    4,
    "p1",
    "response",
    "Priya asked whether the 30-day window is UTC or local",
    "Answer in thread; the docs say UTC and the tooltip does not.",
    3 * HOUR,
    MILESTONES[2],
    "slack",
    "#relay-protocol",
  ),
  action(
    5,
    "p1",
    "review",
    "Observer ingestion: drop frames older than the archive seed",
    "One file, six lines, with a playwright case attached.",
    8 * HOUR,
    MILESTONES[1],
    "github",
    "gear6#814",
  ),
  action(
    6,
    "p1",
    "response",
    "Marco asked whether the backport lands before Thursday",
    "Answer in thread; the docs say UTC and the tooltip does not.",
    11 * HOUR,
    MILESTONES[1],
    "slack",
    "#incidents",
  ),
  action(
    7,
    "p2",
    "approval",
    "Theme token pass for the dark Pulse canvas",
    "A contrast table is attached and sign-off unblocks the release notes.",
    9 * HOUR,
    MILESTONES[7],
    "github",
    "gear6#805",
  ),
  action(
    8,
    "p2",
    "review",
    "Relay admission ceiling per pubkey",
    "One file, six lines, with a playwright case attached.",
    DAY,
    null,
    "github",
    "gear6#798",
  ),
  action(
    9,
    "p3",
    "execute",
    "Regenerate the milestone fixture set for the pulse tests",
    "Run the generator and commit the result.",
    2 * DAY,
    null,
    "",
    "",
  ),
];

const OVERVIEW = {
  open: counts({ review: 14, approval: 3, response: 6, decision: 4, unblock: 5 }),
  actions: ACTIONS.length,
  resolved: null,
  generated_at: GENERATED_AT,
};

const USERS = {
  data: [
    {
      account_id: "U024BE7LH",
      actor_id: "U024BE7LH",
      kind: "human" as const,
      handle: "priya",
      display_name: "Priya Raman",
      email: "",
    },
  ],
  page: { limit: 1000, next_cursor: null },
  generated_at: GENERATED_AT,
};

function json(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

/**
 * Answers every `/api/cloud/*` route the Cloud surface calls. Routed at the
 * network layer rather than by stubbing the client, so what is screenshotted is
 * the real fetch path, the real error handling and the real loading states.
 */
export async function installCloudGateway(page: Page): Promise<void> {
  await page.route("**/api/cloud/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/api\/cloud\//, "");

    if (path === "healthz") {
      return route.fulfill({ status: 200, contentType: "text/plain", body: "ok" });
    }
    if (path === "v1/dev/users" || path === "v1/users") {
      return route.fulfill(json(USERS));
    }
    if (path === "v1/overview") {
      return route.fulfill(json(OVERVIEW));
    }
    if (path === "v1/actions") {
      return route.fulfill(
        json({
          data: ACTIONS,
          page: { limit: 100, next_cursor: null },
          generated_at: GENERATED_AT,
        }),
      );
    }
    if (path === "v1/attention") {
      return route.fulfill(json(ATTENTION));
    }
    if (path === "v1/milestones") {
      const status = url.searchParams.get("status");
      const q = url.searchParams.get("q");
      let rows = MILESTONES;
      if (status) {
        const wanted = new Set(status.split(","));
        rows = rows.filter(
          (row) => row.last_activity && wanted.has(row.last_activity.status),
        );
      }
      if (q) {
        const needle = q.toLowerCase();
        rows = rows.filter((row) =>
          `${row.subject} ${row.description}`.toLowerCase().includes(needle),
        );
      }
      return route.fulfill(
        json({
          data: rows,
          page: { limit: 40, next_cursor: null },
          counts:
            url.searchParams.get("counts") === "true" ? MILESTONE_COUNTS : null,
          generated_at: GENERATED_AT,
        }),
      );
    }
    if (/^v1\/milestones\/[0-9a-f]{32}\/timeline$/.test(path)) {
      return route.fulfill(
        json({
          milestone: {
            id: MILESTONES[0].id,
            subject: MILESTONES[0].subject,
            slug: MILESTONES[0].slug,
            description: MILESTONES[0].description,
            keywords: [],
          },
          days: TIMELINE_DAYS,
          generated_at: GENERATED_AT,
        }),
      );
    }
    if (path === "v1/search") {
      const needle = (url.searchParams.get("q") ?? "").toLowerCase();
      return route.fulfill(
        json({
          milestones: MILESTONES.filter((row) =>
            `${row.subject} ${row.description}`.toLowerCase().includes(needle),
          ).slice(0, 3),
          events: [
            {
              id: hex(910),
              type: "log",
              occurred_at: "2026-08-12T09:12:00Z",
              summary:
                "Gateway rejected kind 44200 — read state replay stalled.",
              provider: "slack",
              url: null,
              thread_id: "t1",
              milestone_id: MILESTONES[0].id,
            },
            {
              id: hex(911),
              type: "log",
              occurred_at: "2026-08-12T14:05:00Z",
              summary:
                "Decision: migrate read markers in place, or dual-write for one release.",
              provider: "github",
              url: null,
              thread_id: "t2",
              milestone_id: MILESTONES[0].id,
            },
          ],
          people: [
            {
              account_id: "U024BE7LH",
              actor_id: "U024BE7LH",
              kind: "human",
              handle: "priya",
              display_name: "Priya Raman",
              email: "",
              milestones: 3,
              open_actions: 4,
              milestone_ids: [MILESTONES[0].id],
            },
          ],
          scope: "all",
          generated_at: GENERATED_AT,
        }),
      );
    }

    // An unrouted Cloud path is a fixture gap, not a screen state. Failing loudly
    // beats screenshotting an error panel that looks like a design decision.
    return route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "fixture_missing", message: `no fixture for ${path}` },
      }),
    });
  });
}
