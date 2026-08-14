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

test("the window Cloud reads is stated as a fact, not offered as a control", () => {
  const markup = page();
  assert.match(markup, /Last 30 UTC days/);
  // It used to sit in the header looking like something to press.
  assert.doesNotMatch(markup, /<button[^>]*>[^<]*Last 30 UTC days/);
});

test("the first paint is the card's own shape, so it does not resize under you", () => {
  const markup = page();
  // Three placeholders, each carrying the rail's row height like the real card.
  assert.equal((markup.match(/aria-hidden="true"/g) ?? []).length >= 3, true);
  assert.equal((markup.match(/h-\[58px\]/g) ?? []).length, 3);
  assert.doesNotMatch(markup, /Could not load milestones|No milestones/);
});

test("the summary counts milestones without a backend lifecycle", () => {
  assert.equal(milestoneSummary(9, "4m ago"), "9 milestones. Updated 4m ago.");
  assert.equal(milestoneSummary(1, "just now"), "1 milestone. Updated just now.");
});
