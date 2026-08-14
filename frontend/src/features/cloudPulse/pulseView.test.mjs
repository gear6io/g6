// What the list is showing, and the query it becomes.
//
// The point of testing this apart from the component is that the query is the
// contract with Cloud: a facet that renders correctly and sends the wrong
// `status` shows the wrong list confidently, which is the failure this file
// exists to catch.
import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AttentionBand,
  enteredLabel,
  longestBlockedLabel,
} from "./AttentionBand.tsx";
import {
  NO_FILTER,
  activeLabel,
  activeView,
  countLine,
  filterQuery,
  toggleStatus,
  viewFilter,
} from "./pulseView.ts";

const PAGE = { limit: 40 };

function counts(overrides = {}) {
  return {
    total: 247,
    by_status: { regression: 6, dependency: 8, progress: 191, neutral: 42 },
    no_activity: 0,
    ...overrides,
  };
}

test("the default view asks Cloud for the two healths that need a reader", () => {
  const query = filterQuery(viewFilter("attention"), PAGE);

  assert.equal(query.status, "regression,dependency");
  // `counts` is always on: the facet column and the "N of M" line both describe
  // the whole filtered collection, which is the one number paging cannot derive.
  assert.equal(query.counts, true);
  // Absent rather than empty. Cloud reads an absent `q` as no filter; sending
  // an empty one is a parameter the request did not need.
  assert.equal(query.q, undefined);
  assert.equal(query.quiet_days, undefined);
});

test("quietness composes with health rather than replacing it", () => {
  const query = filterQuery(
    { status: ["progress"], quietDays: 14, movedToday: false },
    PAGE,
    "read state",
  );

  // A milestone can be on track and silent for a fortnight — that is exactly
  // the one worth surfacing, so the two filters are sent together.
  assert.equal(query.status, "progress");
  assert.equal(query.quiet_days, 14);
  assert.equal(query.q, "read state");
});

test("a cursor carries every filter with it", () => {
  const filter = {
    status: ["regression"],
    quietDays: null,
    movedToday: false,
  };
  const query = filterQuery(filter, { limit: 40, cursor: "opaque" }, "relay");

  // A cursor is a position in a sort, not a saved query: dropping the filter
  // here would page the unfiltered collection from a filtered position.
  assert.equal(query.cursor, "opaque");
  assert.equal(query.status, "regression");
  assert.equal(query.q, "relay");
});

test("a filter names itself, and a named view is recognised whatever the order", () => {
  assert.equal(activeView(viewFilter("attention")), "attention");
  assert.equal(
    activeView({
      status: ["dependency", "regression"],
      quietDays: null,
      movedToday: false,
    }),
    "attention",
  );
  assert.equal(activeView(NO_FILTER), "all");
  assert.equal(activeView(viewFilter("moved")), "moved");
  // A search is not one of the named views even when its healths match one.
  assert.equal(activeView(viewFilter("attention"), "relay"), null);

  assert.equal(activeLabel(viewFilter("attention")), "Needs attention");
  // "All milestones" is the unfiltered list, so it has no chip to remove.
  assert.equal(activeLabel(NO_FILTER), null);
  assert.equal(
    activeLabel(
      { status: ["regression"], quietDays: 14, movedToday: false },
      "relay",
    ),
    "“relay” · Regressed · Quiet ≥14d",
  );
});

test("a second press on a facet clears it", () => {
  const once = toggleStatus(NO_FILTER, "regression");
  assert.deepEqual(once.status, ["regression"]);
  assert.deepEqual(toggleStatus(once, "regression").status, []);
});

test("the count line describes the collection, not the rows on screen", () => {
  // 40 loaded out of a filtered 247 is still "40 of 247" — the page is a prefix
  // of the collection, and counting the rows drawn would say 40 of 40.
  assert.equal(countLine(40, counts()), "40 of 247");
  // Before `counts` lands there is no denominator to state, so none is invented.
  assert.equal(countLine(40, null), "40 shown");
});

test("a tile's sub-line is dropped rather than rendered as a zero", () => {
  assert.equal(enteredLabel(2, 1), "2 new since yesterday");
  assert.equal(enteredLabel(3, 7), "3 new in 7 days");
  // "0 new since yesterday" is a sentence a reader stops and re-reads.
  assert.equal(enteredLabel(0, 1), null);

  assert.equal(longestBlockedLabel(11 * 24 * 60 * 60), "longest: 11 days");
  assert.equal(longestBlockedLabel(24 * 60 * 60), "longest: 1 day");
  assert.equal(longestBlockedLabel(null), null);
});

test("only the tiles Cloud can filter by are pressable", () => {
  const markup = renderToStaticMarkup(
    React.createElement(AttentionBand, {
      attention: {
        regressed: { total: 6, entered: 2, since_days: 1 },
        blocked: { total: 3, longest_seconds: 950400, blocked_days: 5 },
        quiet: { total: 5, quiet_days: 14 },
        closed: { total: 18, closed_days: 7 },
        generated_at: "2026-01-01T00:00:00Z",
      },
      onlyQuiet: false,
      onlyRegressed: false,
      onSelectQuiet: () => {},
      onSelectRegressed: () => {},
    }),
  );

  // Regressed and quiet filter the list. Blocked and closed cannot: milestones
  // are selected on health and quietness, being blocked is a property of the
  // obligations on a milestone, and a closed obligation is not a row at all.
  assert.equal((markup.match(/<button/g) ?? []).length, 2);
  // Each tile echoes the threshold Cloud computed it with, rather than the one
  // this client remembers asking for.
  assert.match(markup, />Blocked ≥5d</);
  assert.match(markup, /no events in 14d/);
  assert.match(markup, /action items, last 7d/);
  // "Closed 18 action items", never "18 milestones" — a milestone is never
  // recorded as closed anywhere in this read model.
  assert.doesNotMatch(markup, /closed[^<]*milestones/i);
});
