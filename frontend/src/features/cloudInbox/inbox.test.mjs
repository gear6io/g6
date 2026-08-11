import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CloudWindowProvider } from "../cloudShell/CloudWindowProvider.tsx";
import { CloudMiniInbox, InboxBody } from "./CloudMiniInbox.tsx";
import {
  ACTION_LABEL,
  EMPTY_ACTIONS_COPY,
  priorityLabel,
  relativeAge,
  summaryLabel,
  updatedLabel,
  userLabel,
} from "./inbox.ts";

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
  const base = { account_id: "U1", actor_id: "U1", kind: "human", email: "" };
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
      entity: { id: "e", slug: "s", summary: "billing", status: "active" },
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
  assert.match(markup, /github/);
  assert.match(markup, /https:\/\/example\.com\/pr\/482/);

  // Cloud could not resolve the reference: nothing is substituted for it.
  const unresolved = [action({ id: "a" })];
  const bare = body({
    inbox: { status: "ready", value: { actions: unresolved, overview: OVERVIEW } },
    visible: unresolved,
  });
  assert.doesNotMatch(bare, /Open<|target="_blank"/);
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
