// The page shell around the panels: the masthead, the stated timeline window,
// and the first paint.
//
// Effects do not run under `renderToStaticMarkup`, so what is rendered here is
// the page's initial state. That is the right thing to pin: it is the frame
// every later state is drawn into, and the summary sentence is checked as the
// pure function it is rather than through a fetch that cannot happen here.
import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CloudWindowProvider } from "../cloudShell/CloudWindowProvider.tsx";
import { MilestoneRowHeader } from "./MilestoneRow.tsx";
import { PulseMilestones, milestoneSummary } from "./PulseMilestones.tsx";

// The page reads the window's selected event, so it renders inside the window —
// which is where it always mounts in the product too.
const page = () =>
  renderToStaticMarkup(
    React.createElement(
      CloudWindowProvider,
      null,
      React.createElement(PulseMilestones),
    ),
  );

test("the masthead does not invent milestone lifecycle filters", () => {
  const markup = page();

  // The view no longer names itself: the window bar does. What this pins is
  // that no lifecycle vocabulary appears here — `active` and `pruned` are the
  // service's own bookkeeping about an identity, not selectable states, and a
  // request for `status=active` is a `400`.
  assert.doesNotMatch(markup, />Pulse</);
  assert.doesNotMatch(markup, />Active<|>Pruned<|>All<|Milestone scope/);
});

// The sparkline column names the window Cloud reads. It is a column heading,
// not a range control: the timeline's default range is Cloud's own, and a 7/30/90
// switcher would have to compute dates from this webview's clock and could then
// disagree with the range Cloud actually served.
test("the window Cloud reads is stated as a fact, not offered as a control", () => {
  const markup = renderToStaticMarkup(
    React.createElement(MilestoneRowHeader),
  );
  assert.match(markup, />Last 30 days</);
  assert.doesNotMatch(markup, /<button/);
});

test("the first paint is the row's own shape, so it does not resize under you", () => {
  const markup = page();
  // Placeholders carrying the row height, not the old card's.
  assert.equal((markup.match(/h-\[42px\]/g) ?? []).length, 6);
  assert.doesNotMatch(markup, /Could not load milestones|No milestones/);
});

test("the summary counts milestones without a backend lifecycle", () => {
  assert.equal(milestoneSummary(9, "4m ago"), "9 milestones. Updated 4m ago.");
  assert.equal(milestoneSummary(1, "just now"), "1 milestone. Updated just now.");
});
