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

import {
  CloudSearchPalette,
  personStanding,
  resultSubtitle,
} from "./CloudSearchPalette.tsx";

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

test("a person's row states their standing, which is all Cloud serves", () => {
  assert.equal(
    personStanding({ milestones: 3, open_actions: 4 }),
    "named on 3 milestones · 4 open",
  );
  // Singular, because "named on 1 milestones" is the kind of thing a reader
  // stops on.
  assert.equal(
    personStanding({ milestones: 1, open_actions: 0 }),
    "named on 1 milestone · 0 open",
  );
});

test("the palette offers all four scopes and no counts before a query", () => {
  const markup = palette();

  for (const label of ["Everything", "Milestones", "Events", "People"]) {
    assert.match(markup, new RegExp(`>${label}</button>`));
  }
  // Counts are the response's array lengths, so before a response there are
  // none — a "0" beside every tab would be a fact about nothing.
  assert.doesNotMatch(markup, />Milestones 0</);
});

test("the palette states what each scope matches instead of implying it matches everything", () => {
  const markup = palette();

  assert.match(markup, /Milestones match their subject, description and keywords/);
  assert.match(markup, /Events match what was said on the source record/);
});

test("the palette is a dialog with a named input and its keys stated", () => {
  const markup = palette();

  assert.match(markup, /role="dialog"[^>]*/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /aria-label="Search milestones, events and people"/);
  assert.match(markup, /↑↓ navigate · ↵ open · ⇥ scope · esc close/);
});
