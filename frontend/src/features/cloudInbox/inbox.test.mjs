import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CloudWindowProvider } from "../cloudShell/CloudWindowProvider.tsx";
import { CloudMiniInbox, InboxBody } from "./CloudMiniInbox.tsx";
import {
  ACTION_LABEL,
  EMPTY_ACTIONS_COPY,
  LANE_LABEL,
  LANE_ORDER,
  actionLane,
  laneGroups,
  priorityLabel,
  relativeAge,
  summaryLabel,
  updatedLabel,
  userLabel,
} from "./inbox.ts";
import {
  NO_INBOX_FILTER,
  applyFilter,
  inboxChip,
  isNewToday,
  kindFacets,
  milestoneFacets,
  newTodayCount,
  providerFacets,
  siblingsOnMilestone,
} from "./inboxFacets.ts";

function action(overrides = {}) {
  return {
    id: "9f2c1b0e5d4a3f6b8c7e2d1a0b9f8e7d",
    subject: "ship the migration",
    required_action: "response",
    dependency_type: "",
    dependency_on: "person",
    priority: { level: "p1", evidence: [] },
    instruction: "Reply to the handoff.",
    entity: null,
    referent: null,
    work_item_ids: [],
    work_item_count: 0,
    opened_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    age_seconds: 1560,
    confidence: 0.9,
    ...overrides,
  };
}

const COUNTS = {
  review: 4,
  approval: 0,
  response: 2,
  decision: 0,
  execute: 0,
  unblock: 1,
};

const OVERVIEW = {
  open: COUNTS,
  actions: 3,
  generated_at: "2026-01-01T00:00:00Z",
};

test("ages compact into minutes, hours, then days", () => {
  assert.equal(relativeAge(0), "just now");
  assert.equal(relativeAge(59), "just now");
  // Clock skew against `generated_at` can go negative; it must not read "-1d".
  assert.equal(relativeAge(-90), "just now");
  assert.equal(relativeAge(1560), "26 min ago");
  assert.equal(relativeAge(3600), "1h ago");
  assert.equal(relativeAge(86_400), "1d ago");
  assert.equal(relativeAge(2 * 86_400 + 4000), "2d ago");
});

test("the updated label reads Cloud's own generation time", () => {
  const at = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(updatedLabel("2026-01-01T00:00:00Z", at), "updated just now");
  assert.equal(updatedLabel("2026-01-01T00:00:00Z", at + 180_000), "updated 3 min ago");
  // An unreadable timestamp is not worth a visible error beside true counts.
  assert.equal(updatedLabel("not a date", at), "updated just now");
});

test("a user falls back from display name to handle to account id", () => {
  const base = { account_id: "U1", actor_id: "U1", kind: "human" };
  assert.equal(userLabel({ ...base, display_name: "Alex", handle: "alex" }), "Alex");
  assert.equal(userLabel({ ...base, display_name: "", handle: "alex" }), "alex");
  assert.equal(userLabel({ ...base, display_name: "", handle: "" }), "U1");
});

test("the summary shows only counts the API supplies", () => {
  assert.equal(summaryLabel(OVERVIEW), "3 open actions for you");
  assert.equal(summaryLabel({ ...OVERVIEW, actions: 1 }), "1 open action for you");
  assert.equal(summaryLabel({ ...OVERVIEW, actions: 0 }), "0 open actions for you");
  // Cloud supplies no resolved count and no viewer/team split any more.
  assert.doesNotMatch(summaryLabel(OVERVIEW), /resolved|team/);
});

test("every required_action Cloud serves has a label, and nothing else does", () => {
  assert.deepEqual(Object.keys(ACTION_LABEL).sort(), [
    "approval",
    "decision",
    "execute",
    "response",
    "review",
    "unblock",
  ]);
  // The two-class taxonomy is gone; a client branching on it branches on air.
  assert.equal(ACTION_LABEL.act_on_handoff, undefined);
});

test("a lane is a priority tier renamed, and every tier lands in one", () => {
  assert.deepEqual(
    ["p0", "p1", "p2", "p3"].map(actionLane),
    ["blocked", "today", "later", "later"],
  );
  // A lane with no label is a heading rendered as `undefined`.
  for (const lane of LANE_ORDER) {
    assert.equal(typeof LANE_LABEL[lane], "string");
  }
});

test("lane groups keep Cloud's order and drop the empty lanes", () => {
  const rows = [
    action({ id: "a", priority: { level: "p2", evidence: [] } }),
    action({ id: "b", priority: { level: "p0", evidence: [] } }),
    action({ id: "c", priority: { level: "p3", evidence: [] } }),
  ];
  const groups = laneGroups(rows);

  // Lane order is `LANE_ORDER`, not arrival order; `today` is absent entirely
  // rather than present and empty.
  assert.deepEqual(
    groups.map(({ lane }) => lane),
    ["blocked", "later"],
  );
  // Inside a lane the rows stay in the order the API returned them.
  assert.deepEqual(
    groups[1].actions.map(({ id }) => id),
    ["a", "c"],
  );
  // The lanes partition the list: nothing is dropped and nothing is counted twice.
  assert.equal(
    groups.reduce((total, group) => total + group.actions.length, 0),
    rows.length,
  );
  assert.deepEqual(laneGroups([]), []);
});

test("the priority chip is uppercased for display only", () => {
  assert.equal(priorityLabel("p0"), "P0");
  assert.equal(priorityLabel("p3"), "P3");
});

function body(props) {
  return renderToStaticMarkup(
    React.createElement(InboxBody, {
      inbox: { status: "loading" },
      onRetryInbox: () => {},
      onRetryUsers: () => {},
      selected: "U1",
      users: { status: "ready", value: [] },
      visible: [],
      ...props,
    }),
  );
}

test("user discovery states render before any inbox read", () => {
  assert.match(body({ users: { status: "loading" } }), /animate|rounded bg-muted/);

  const failed = body({ users: { status: "error", message: "backend is down" } });
  assert.match(failed, /Could not load users/);
  assert.match(failed, /backend is down/);
  assert.match(failed, /Retry/);

  const none = body({ selected: null });
  assert.match(none, /No users found/);
  assert.match(none, /no resolvable accounts/);
});

test("a selected-user failure keeps the panel and offers a retry", () => {
  const failed = body({ inbox: { status: "error", message: "Cloud is not answering" } });
  assert.match(failed, /Could not load this inbox/);
  assert.match(failed, /Retry/);
  // Never an HTTP code and never the account id.
  assert.doesNotMatch(failed, /U1/);
});

test("a row shows the API's own strings and nothing invented", () => {
  const rows = [
    action({
      id: "a",
      entity: {
        id: "e",
        subject: "billing",
        slug: "s",
        description: "importer is waiting on staging",
        keywords: ["billing"],
        status: "active",
      },
    }),
  ];
  const markup = body({ inbox: { status: "ready", value: { actions: rows, overview: OVERVIEW } }, visible: rows });

  assert.match(markup, /ship the migration/);
  assert.match(markup, new RegExp(ACTION_LABEL.response));
  assert.match(markup, /26 min ago/);
  assert.match(markup, /Reply to the handoff\. · billing/);
  // The list is sorted by priority, so the chip is what explains the order.
  assert.match(markup, /P1/);
  // Both variable strings are clamped so a long subject cannot widen the panel.
  assert.match(markup, /line-clamp-2/);
});

test("a referent renders its own record, and its absence renders nothing", () => {
  const withReferent = [
    action({
      id: "a",
      referent: {
        summary: "Add retry to importer",
        provider: "github",
        url: "https://example.com/pr/482",
      },
    }),
  ];
  const markup = body({
    inbox: { status: "ready", value: { actions: withReferent, overview: OVERVIEW } },
    visible: withReferent,
  });
  assert.match(markup, /Add retry to importer/);
  // The provider is its brand mark now, not the word.
  assert.match(markup, /data-provider="github"/);
  assert.match(markup, /https:\/\/example\.com\/pr\/482/);

  // Cloud could not resolve the reference: nothing is substituted for it.
  const unresolved = [action({ id: "a" })];
  const bare = body({
    inbox: { status: "ready", value: { actions: unresolved, overview: OVERVIEW } },
    visible: unresolved,
  });
  assert.doesNotMatch(bare, /Open<|target="_blank"/);
});

test("a provider with no mark of its own still names itself", () => {
  const rows = [
    action({
      id: "a",
      referent: { summary: "Ticket moved", provider: "jira", url: null },
    }),
  ];
  const markup = body({
    inbox: { status: "ready", value: { actions: rows, overview: OVERVIEW } },
    visible: rows,
  });
  assert.doesNotMatch(markup, /data-provider=/);
  assert.match(markup, /jira/);
});

test("clicking a row is the action on it, and which action follows the source", () => {
  function rowMarkup(referent) {
    const rows = [action({ id: "a", referent })];
    return body({
      inbox: { status: "ready", value: { actions: rows, overview: OVERVIEW } },
      onOpenThread: () => {},
      visible: rows,
    });
  }

  // Slack: the window expands to where the thread will be read, so the row is a
  // button and not a link out.
  const slack = rowMarkup({
    summary: "Waiting on staging access",
    provider: "slack",
    url: "https://example.com/archives/C1/p1",
  });
  assert.match(slack, /<button/);
  assert.doesNotMatch(slack, /target="_blank"/);

  // Anything else has only a URL to offer, and hands it to the browser.
  const github = rowMarkup({
    summary: "Add retry to importer",
    provider: "github",
    url: "https://example.com/pr/482",
  });
  assert.match(github, /<a [^>]*href="https:\/\/example\.com\/pr\/482"/);
  assert.doesNotMatch(github, /<button/);

  // No resolved record: nothing to open, so nothing pretends to be clickable.
  const none = rowMarkup(null);
  assert.doesNotMatch(none, /<button|<a /);
});

test("a referent with a record but no link shows the record and no link", () => {
  const rows = [
    action({
      id: "a",
      referent: { summary: "Waiting on staging access", provider: "slack", url: null },
    }),
  ];
  const markup = body({
    inbox: { status: "ready", value: { actions: rows, overview: OVERVIEW } },
    visible: rows,
  });
  assert.match(markup, /Waiting on staging access/);
  assert.doesNotMatch(markup, /target="_blank"/);
});

test("an entity-less row omits the separating dot rather than trailing it", () => {
  const rows = [action({ id: "a" })];
  const markup = body({ inbox: { status: "ready", value: { actions: rows, overview: OVERVIEW } }, visible: rows });
  assert.doesNotMatch(markup, /Reply to the handoff\.\s*·/);
});

test("the composed panel is one landmark, one heading and a labelled control set", () => {
  // The panel reads its data and its window controls from the provider above
  // it — the same one the expanded shell renders under.
  const html = renderToStaticMarkup(
    React.createElement(
      CloudWindowProvider,
      null,
      React.createElement(CloudMiniInbox),
    ),
  );

  assert.equal(html.match(/<main/g).length, 1);
  assert.equal(html.match(/<h1/g).length, 1);
  assert.match(html, /data-testid="cloud-mini-inbox"/);
  // One surface filling the window: no decorative layer behind it to paint a
  // border, and nothing inset that would leave a gutter.
  assert.doesNotMatch(html, /g6-cloud-backdrop/);
  assert.doesNotMatch(html, /rounded-xl|max-w-\[342px\]/);
  assert.match(html, /aria-label="Inbox options"/);
  assert.match(html, /aria-label="(Unpin window|Keep window on top)"/);
  assert.match(html, /aria-live="polite"/);
});

test("an empty inbox explains itself rather than showing an empty list", () => {
  const markup = body({
    inbox: { status: "ready", value: { actions: [], overview: OVERVIEW } },
    visible: [],
  });
  assert.match(markup, /Nothing open here/);
  assert.match(markup, new RegExp(EMPTY_ACTIONS_COPY));
  assert.doesNotMatch(markup, /<ul/, "no list element with nothing in it");
});

/* ------------------------------------------------------------ wide inbox -- */

function entity(id, subject) {
  return { id, subject, slug: subject, description: "", keywords: [] };
}

function referent(provider, summary) {
  return { summary, provider, url: null, thread_id: null };
}

const ROWS = [
  action({
    id: "a",
    required_action: "unblock",
    priority: { level: "p0", evidence: [] },
    entity: entity("m1", "Read-state convergence"),
    referent: referent("slack", "#incidents"),
    age_seconds: 3600,
  }),
  action({
    id: "b",
    required_action: "review",
    priority: { level: "p1", evidence: [] },
    entity: entity("m1", "Read-state convergence"),
    referent: referent("github", "gear6#809"),
    age_seconds: 200_000,
  }),
  action({
    id: "c",
    required_action: "review",
    priority: { level: "p2", evidence: [] },
    entity: null,
    referent: null,
    age_seconds: 400_000,
  }),
];

test("a facet counts with its own dimension lifted and the others applied", () => {
  const filter = { ...NO_INBOX_FILTER, kind: "review" };

  // Under a `review` filter the Action group still reports `unblock`'s size:
  // a facet column that zeroes its siblings is a column you cannot navigate
  // back out of. This is the same rule Cloud applies to `by_status`.
  assert.deepEqual(
    kindFacets(ROWS, filter).map(({ id, count }) => [id, count]),
    [
      ["review", 2],
      ["unblock", 1],
    ],
  );

  // The Milestone group *is* narrowed by the kind filter, because that is a
  // different dimension: two reviews, one on m1 and one on nothing.
  assert.deepEqual(
    milestoneFacets(ROWS, filter).map(({ id, count }) => [id, count]),
    [
      ["m1", 1],
      ["", 1],
    ],
  );
});

test("no milestone is a bucket, not a gap, and it sorts last", () => {
  const facets = milestoneFacets(ROWS, NO_INBOX_FILTER);

  // Hiding the unresolved rows would make the facet counts fail to sum to the
  // list they sit beside.
  assert.equal(
    facets.reduce((total, entry) => total + entry.count, 0),
    ROWS.length,
  );
  assert.equal(facets.at(-1).id, "");
  assert.equal(facets.at(-1).label, "No milestone");
});

test("a source facet is drawn only where Cloud resolved a record", () => {
  const facets = providerFacets(ROWS, NO_INBOX_FILTER);

  // The row with no referent is absent rather than counted under an empty
  // provider: Cloud resolved no record, so there is no source to filter by.
  assert.deepEqual(
    facets.map(({ id }) => id).sort(),
    ["github", "slack"],
  );
});

test("filters compose, and the chip names every one of them", () => {
  const filter = {
    ...NO_INBOX_FILTER,
    kind: "review",
    milestoneId: "m1",
  };
  assert.deepEqual(
    applyFilter(ROWS, filter).map(({ id }) => id),
    ["b"],
  );
  assert.equal(inboxChip(filter, ROWS), "Review · Read-state convergence");
  assert.equal(inboxChip(NO_INBOX_FILTER, ROWS), null);
});

test("the reader's siblings are the same milestone, minus the row being read", () => {
  assert.deepEqual(
    siblingsOnMilestone(ROWS, ROWS[0]).map(({ id }) => id),
    ["b"],
  );
  // A row Cloud resolved no milestone for has no siblings — not every other
  // unresolved row as siblings, which is what grouping on a null id would do.
  assert.deepEqual(siblingsOnMilestone(ROWS, ROWS[2]), []);
});

test("new today is derived from the age Cloud sends, not from a parsed date", () => {
  assert.equal(newTodayCount(ROWS, NO_INBOX_FILTER), 1);
  assert.equal(isNewToday(ROWS[0]), true);
  assert.equal(isNewToday(ROWS[2]), false);
});
