// The palette's shell and its one derived string.
//
// Effects do not run under `renderToStaticMarkup`, so what is pinned here is the
// palette's opening state — which is the state that has to say what it searches,
// because a search box that looks like it covers everything and covers one
// collection is the failure mode this screen is most exposed to.
import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CloudSearchPalette, resultSubtitle } from "./CloudSearchPalette.tsx";

function milestone(overrides = {}) {
  return {
    id: "0123456789abcdef0123456789abcdef",
    subject: "Read-state convergence across communities",
    slug: "read-state-convergence",
    description: "Markers stop drifting when a community switch clears.",
    keywords: ["read-state"],
    updated_at: "2026-01-01T00:00:00Z",
    last_activity: {
      date: "2026-01-01",
      status: "regression",
      observed_at: "2026-01-01T00:00:00Z",
    },
    open: {
      review: 3,
      approval: 0,
      response: 0,
      decision: 2,
      execute: 0,
      unblock: 2,
    },
    open_since: {
      review: null,
      approval: null,
      response: null,
      decision: null,
      execute: null,
      unblock: "2026-01-01T00:00:00Z",
    },
    ...overrides,
  };
}

const palette = () =>
  renderToStaticMarkup(
    React.createElement(CloudSearchPalette, {
      onClose: () => {},
      onSelect: () => {},
    }),
  );

test("the subtitle is built from fields the row actually carries", () => {
  assert.equal(resultSubtitle(milestone(), 7), "regressed · 7 open");

  // A milestone with no observed day has no health, so the clause is absent
  // rather than rendered as "unknown" — the same rule the rest of Cloud follows.
  assert.equal(
    resultSubtitle(milestone({ last_activity: null }), 0),
    "0 open",
  );
});

test("the palette says what it searches rather than implying it searches everything", () => {
  const markup = palette();

  assert.match(markup, /Search milestones/);
  // No Events and no People scope: `/v1/milestones?q=` matches a milestone's own
  // words, and Cloud is explicit that what was said on one is not searchable
  // there. Tabs that return nothing would be worse than one honest list.
  assert.doesNotMatch(markup, />Events<|>People<|>Everything</);
  assert.match(markup, /not searchable here/);
});

test("the palette is a dialog with a named input and its keys stated", () => {
  const markup = palette();

  assert.match(markup, /role="dialog"[^>]*/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /aria-label="Search milestones"/);
  assert.match(markup, /↑↓ navigate · ↵ open · esc close/);
});
