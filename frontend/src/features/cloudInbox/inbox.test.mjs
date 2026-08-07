import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CloudMiniInbox, InboxBody } from "./CloudMiniInbox.tsx";
import {
  ACTION_LABEL,
  emptyActionsCopy,
  filterActions,
  relativeAge,
  summaryLabel,
  updatedLabel,
  userLabel,
} from "./inbox.ts";

function action(overrides = {}) {
  return {
    id: "action:v1:act_on_handoff:9f2c",
    type: "act_on_handoff",
    audience: "viewer",
    instruction: "Reply to the handoff.",
    signal: {
      id: "9f2c",
      kind: "handoff",
      subject: "ship the migration",
      entity: null,
      work_item_ids: [],
      work_item_count: 0,
      opened_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      age_seconds: 1560,
      confidence: 0.9,
    },
    ...overrides,
  };
}

const OVERVIEW = {
  open_decisions: 4,
  open_constraints: 2,
  actions: { viewer: 3, team: 9, total: 12 },
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

test("chips filter the returned page, never the request", () => {
  const rows = [
    action({ id: "a", audience: "viewer" }),
    action({ id: "b", audience: "team" }),
    action({ id: "c", audience: "team" }),
  ];
  assert.deepEqual(filterActions(rows, "all").length, 3);
  assert.deepEqual(
    filterActions(rows, "viewer").map((row) => row.id),
    ["a"],
  );
  assert.deepEqual(
    filterActions(rows, "team").map((row) => row.id),
    ["b", "c"],
  );
});

test("the summary shows only counts the API supplies", () => {
  const label = summaryLabel(OVERVIEW);
  assert.equal(label, "12 open · 3 for you");
  assert.doesNotMatch(label, /resolved/, "Cloud supplies no resolved count");
});

test("each empty filter says which filter emptied it", () => {
  const copies = ["all", "viewer", "team"].map(emptyActionsCopy);
  assert.equal(new Set(copies).size, 3);
});

function body(props) {
  return renderToStaticMarkup(
    React.createElement(InboxBody, {
      filter: "all",
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
      signal: { ...action().signal, entity: { id: "e", slug: "s", summary: "billing", status: "active" } },
    }),
  ];
  const markup = body({ inbox: { status: "ready", value: { actions: rows, overview: OVERVIEW } }, visible: rows });

  assert.match(markup, /ship the migration/);
  assert.match(markup, new RegExp(ACTION_LABEL.act_on_handoff));
  assert.match(markup, /for you/);
  assert.match(markup, /26 min ago/);
  assert.match(markup, /Reply to the handoff\. · billing/);
  // Both variable strings are clamped so a long subject cannot widen the panel.
  assert.match(markup, /line-clamp-2/);
});

test("an entity-less row omits the separating dot rather than trailing it", () => {
  const rows = [action({ id: "a" })];
  const markup = body({ inbox: { status: "ready", value: { actions: rows, overview: OVERVIEW } }, visible: rows });
  assert.doesNotMatch(markup, /Reply to the handoff\.\s*·/);
});

test("the composed panel is one landmark, one heading and a labelled control set", () => {
  const html = renderToStaticMarkup(React.createElement(CloudMiniInbox));

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

test("an empty filter keeps the chips and explains itself", () => {
  const markup = body({
    filter: "viewer",
    inbox: { status: "ready", value: { actions: [], overview: OVERVIEW } },
    visible: [],
  });
  assert.match(markup, /Nothing open here/);
  assert.match(markup, new RegExp(emptyActionsCopy("viewer")));
});
