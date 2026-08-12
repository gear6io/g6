import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MilestonePanel } from "./MilestonePanel.tsx";
import { MilestoneRail } from "./MilestoneRail.tsx";
import { StageRecord } from "./StageRecord.tsx";
import { railStages } from "./milestones.ts";

const NOW = Date.parse("2026-08-08T12:00:00Z");

/** Cloud always sends all six keys, so every fixture does too. */
function counts(overrides = {}) {
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

function day(date, overrides = {}) {
  return {
    date,
    status: "progress",
    observed_at: `${date}T14:31:00Z`,
    event_count: 4,
    snapshot: counts({ decision: 2, response: 1, unblock: 3 }),
    changes: counts({ decision: -1, response: 1 }),
    status_evidence: [
      {
        classification: "progress",
        provenance: "deterministic",
        reason: "decision_closed",
        rationale: null,
        confidence: 1,
      },
    ],
    events: [],
    events_truncated: false,
    ...overrides,
  };
}

const MILESTONE = {
  id: "0123456789abcdef0123456789abcdef",
  subject: "Product import pipeline",
  slug: "product-import",
  description: "Blocked on vendor staging credentials",
  keywords: ["importer", "vendor"],
  updated_at: "2026-08-08T14:31:00Z",
  last_activity: {
    date: "2026-08-08",
    status: "progress",
    observed_at: "2026-08-08T14:31:00Z",
  },
  open: counts({ decision: 2, response: 1, unblock: 3 }),
};

function panel(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(MilestonePanel, {
      milestone: MILESTONE,
      now: NOW,
      onRequest: () => {},
      onRetry: () => {},
      timeline: undefined,
      ...overrides,
    }),
  );
}

function rail(days, selected = null) {
  return renderToStaticMarkup(
    React.createElement(MilestoneRail, {
      onSelect: () => {},
      selected,
      stages: railStages(days),
    }),
  );
}

/** The record for the first stage the days fold into. */
function record(days, previousDate = null) {
  return renderToStaticMarkup(
    React.createElement(StageRecord, {
      previousDate,
      stage: railStages(days)[0],
    }),
  );
}

/** A day nothing was classified on, which is what Cloud calls neutral. */
function quiet(date, overrides = {}) {
  return day(date, {
    status: "neutral",
    event_count: 1,
    status_evidence: [],
    changes: counts(),
    ...overrides,
  });
}

test("a panel names the milestone, its total, and the kinds actually open", () => {
  const markup = panel({
    timeline: { status: "ready", value: { days: [day("2026-08-08")] } },
  });

  assert.match(markup, /Product import pipeline/);
  // The slug is a machine key and is no longer drawn; the state line is.
  assert.doesNotMatch(markup, /product-import/);
  assert.match(markup, /Blocked on vendor staging credentials/);
  assert.match(markup, /6 open action items/);
  assert.match(markup, /2 decision/);
  assert.match(markup, /1 response/);
  assert.match(markup, /3 unblock/);
  // The four kinds at zero are not printed; the total is what covers them.
  assert.doesNotMatch(markup, /0 review|0 approval|0 execute/);
  // The lifecycle status is `active` for every row v1 asks for, so it is not
  // printed as a badge that can only ever say one thing.
  assert.doesNotMatch(markup, /Pruned/);
  // No completion figure: Cloud derives none.
  assert.doesNotMatch(markup, /\d+%/);
});

test("a milestone with nothing open says zero rather than showing no counts", () => {
  const markup = panel({
    milestone: { ...MILESTONE, open: counts() },
    timeline: { status: "ready", value: { days: [] } },
  });
  assert.match(markup, /0 open action items/);
});

test("a milestone nothing was derived about says so instead of showing neutral", () => {
  const markup = panel({
    milestone: { ...MILESTONE, last_activity: null },
    timeline: { status: "ready", value: { days: [] } },
  });
  assert.match(markup, /Nothing observed yet/);
  assert.doesNotMatch(markup, /Last observed/);
  assert.doesNotMatch(markup, /Neutral/, "a quiet range is not a neutral day");
});

const STALE = {
  ...MILESTONE,
  last_activity: {
    date: "2026-05-10",
    status: "progress",
    observed_at: "2026-05-10T09:12:00Z",
  },
};

test("a milestone last seen before the window renders the window it was seen in", () => {
  const markup = panel({
    milestone: STALE,
    timeline: { status: "ready", value: { days: [day("2026-05-10")] } },
  });

  // The window asked for is the 30 days ending on the last observed day, so the
  // rail has the day it was seen on rather than nothing at all.
  assert.match(markup, /May 10/);
  assert.doesNotMatch(markup, /Aug 8/);
  assert.doesNotMatch(markup, /Nothing observed/);
  assert.match(markup, /Last observed 90 days ago/);
  // The same sentence twice on one panel is what made it read as a
  // contradiction; recency belongs under the rail only.
  assert.equal(markup.match(/Last observed/g).length, 1);
});

test("a shifted window Cloud still returns nothing for says so", () => {
  const markup = panel({
    milestone: STALE,
    timeline: { status: "ready", value: { days: [] } },
  });
  assert.match(markup, /Nothing observed in this window/);
});

test("a failed timeline keeps the milestone and offers only that retry", () => {
  const markup = panel({
    timeline: {
      status: "error",
      code: "cloud_timeout",
      message: "G6 Cloud did not answer in time",
    },
  });
  assert.match(markup, /Timeline unavailable/);
  assert.match(markup, /G6 Cloud did not answer in time/);
  assert.match(markup, /Retry timeline/);
  // Identity and counts come from the list response and survive the failure.
  assert.match(markup, /Product import pipeline/);
  assert.match(markup, /6 open action items/);
});

test("the rail draws a column per stage and one marker per quiet run", () => {
  const markup = rail([day("2026-07-20"), day("2026-08-08")]);

  assert.equal(markup.match(/<button/g).length, 2, "only observed days");
  // Eighteen unobserved days cost one narrow column, not eighteen.
  assert.equal(markup.match(/h-\[58px\]/g).length, 3);
  assert.match(markup, />18d</, "the days nobody looked at are still counted");
  assert.match(markup, /18 days with nothing observed/, "and are named");
  // Colour is never the only cue: the accessible name carries the status.
  assert.match(markup, /aria-label="Monday, Jul 20, Progress, 4 observed events"/);

  // Adjacent days need no marker between them.
  const adjacent = rail([day("2026-08-07"), day("2026-08-08")]);
  assert.equal(adjacent.match(/h-\[58px\]/g).length, 2);
  assert.doesNotMatch(adjacent, /\dd</);
});

test("the track runs unbroken: solid between adjacent stages, dashed over a gap", () => {
  const solid = (markup) => (markup.match(/h-0\.5 bg-/g) ?? []).length;
  const dashed = (markup) => (markup.match(/border-dashed/g) ?? []).length;

  const joined = rail([day("2026-08-07"), day("2026-08-08")]);
  assert.equal(solid(joined), 1);
  assert.equal(dashed(joined), 0);

  // Nothing was observed on the 7th, so the two stages are joined by a dashed
  // span rather than by a line claiming a status Cloud never derived.
  const gapped = rail([day("2026-08-06"), day("2026-08-08")]);
  assert.equal(solid(gapped), 0, "no status is carried across the gap");
  assert.equal(dashed(gapped), 1, "but the rail is still one timeline");
  assert.match(
    gapped,
    /left:-50%;right:-50%/,
    "centre of one node to centre of the next",
  );

  assert.equal(solid(rail([day("2026-08-08")])), 0, "a lone stage");
});

test("a run of neutral days is one stage, and a classified day is never folded", () => {
  const markup = rail([
    quiet("2026-08-01"),
    quiet("2026-08-02"),
    quiet("2026-08-03"),
    day("2026-08-04"),
  ]);

  assert.equal(markup.match(/<button/g).length, 2, "three quiet days, one node");
  assert.match(markup, /Aug 1-3/, "the run names the days it covers");
  assert.match(
    markup,
    /aria-label="Saturday, Aug 1 to Monday, Aug 3, 3 days, Neutral, 3 observed events"/,
  );
  assert.match(markup, /aria-label="Tuesday, Aug 4, Progress/);

  // A quiet day with a day between it and the next is its own stage: the run
  // has to be continuous to be one fact.
  const split = rail([quiet("2026-08-01"), quiet("2026-08-03")]);
  assert.equal(split.match(/<button/g).length, 2);
});

test("every node names its own dates, and no unobserved day is named", () => {
  const markup = rail([day("2026-07-20"), day("2026-08-08")]);
  assert.match(markup, /Jul 20/);
  assert.match(markup, /Aug 8/);
  // The dates between were never observed, so the rail does not print them.
  assert.doesNotMatch(markup, /Jul 21|Aug 1</);
});

test("a record states the reading and never argues for it", () => {
  const markup = record(
    [
      day("2026-08-08", {
        status_evidence: [
          {
            classification: "progress",
            provenance: "deterministic",
            reason: "decision_closed",
            rationale: null,
            confidence: 1,
          },
          {
            classification: "dependency",
            provenance: "synthesis",
            reason: "model_finding",
            rationale: "Deployment completed successfully",
            confidence: 0.86,
          },
        ],
      }),
    ],
    "2026-07-31",
  );

  assert.match(markup, /Saturday, Aug 8/);
  // The day's own classification, once.
  assert.match(markup, /Progress/);
  // Cloud's evidence is not drawn: no rationale, no rule name, no provenance
  // and no confidence anywhere in the record.
  assert.doesNotMatch(markup, /Deployment completed successfully/);
  assert.doesNotMatch(markup, /Decision closed/);
  assert.doesNotMatch(markup, /Workflow fact|Analysis/);
  assert.doesNotMatch(markup, /Dependency/, "a second classification is evidence");
  assert.doesNotMatch(markup, /\d+% confidence/);

  // The snapshot leads with the total, then only the kinds actually open.
  assert.match(markup, /Total open/);
  assert.match(markup, />6</);
  assert.match(markup, /Change since Friday, Jul 31/);
  assert.match(markup, />-1</, "a negative delta is signed");
  assert.match(markup, />\+1</, "a positive delta is signed");
  // Cloud dropped `constraint_work_items` in 2.0; nothing stands in for it.
  assert.doesNotMatch(markup, /Constraint reach|work items/);
  // A falling count is not always good and a rising one is not always bad, so
  // no value is coloured by the direction it moved.
  for (const value of markup.match(/<dd class="[^"]*"/g)) {
    // The strip sits on the brand band, so the neutral colour is the band's
    // own foreground; the rule it enforces is unchanged.
    assert.match(value, /text-pulse-brand-fg/);
    assert.doesNotMatch(value, /emerald|rose|amber/);
  }
});

test("a compressed stage dates every event and nets its movement", () => {
  const event = (id, date, hour) => ({
    id,
    type: "log",
    occurred_at: `${date}T${hour}:00:00Z`,
    summary: `event ${id}`,
    provider: "slack",
    url: null,
  });

  const markup = record([
    quiet("2026-08-01", {
      events: [event("a", "2026-08-01", "09")],
      changes: counts({ review: 2 }),
    }),
    quiet("2026-08-02", { events: [], changes: counts({ review: -1 }) }),
    quiet("2026-08-03", {
      events: [event("b", "2026-08-03", "16")],
      changes: counts({ review: 1 }),
    }),
  ]);

  assert.match(markup, /Aug 1-3/);
  assert.match(markup, /3 days/);
  // Each event is read against the day it landed on, and that day's own state.
  assert.match(markup, /Saturday, Aug 1/);
  assert.match(markup, /Monday, Aug 3/);
  assert.doesNotMatch(markup, /Sunday, Aug 2/, "a day with no events has no group");
  assert.equal(markup.match(/Neutral/g).length, 3, "the stage and both days");
  // Movement nets across the run rather than showing the last day's alone.
  assert.match(markup, />\+2</);
});

test("the first returned stage has no previous one to be measured against", () => {
  const markup = record([day("2026-07-10")]);
  assert.match(markup, /Change at start of range/);
  assert.doesNotMatch(markup, /Change since/);
});

test("a truncated event list says so and is never mistaken for a quiet stage", () => {
  const cut = record([day("2026-08-08", { events: [], events_truncated: true })]);
  assert.match(cut, /Cloud limited events/);
  assert.match(cut, /No events were returned/);
  assert.match(cut, /4 observed events/, "the day's own count is complete");

  const empty = record([day("2026-08-08", { events: [], event_count: 0 })]);
  assert.match(empty, /No events were recorded/);
  assert.doesNotMatch(empty, /Cloud limited/);
});

test("an event with no link gets no link, not a dead one", () => {
  const event = (url) => ({
    id: "s1",
    type: "log",
    occurred_at: "2026-08-08T14:31:00Z",
    summary: "PR #482 merged",
    provider: "github",
    url,
  });

  const linked = record([
    day("2026-08-08", { events: [event("https://example.com/pr/482")] }),
  ]);
  assert.match(linked, /href="https:\/\/example\.com\/pr\/482"/);
  assert.match(linked, /rel="noreferrer noopener"/);
  // The row is the link, so the affordance the per-row "Open" used to carry
  // has to survive in the accessible name.
  assert.match(linked, /Open in github/);

  const bare = record([day("2026-08-08", { events: [event(null)] })]);
  assert.match(bare, /PR #482 merged/);
  assert.doesNotMatch(bare, /<a /, "no link and no disabled placeholder");
});

test("only the first six events render until they are asked for", () => {
  const events = Array.from({ length: 9 }, (_, index) => ({
    id: `s${index}`,
    type: "log",
    occurred_at: "2026-08-08T14:31:00Z",
    summary: `event ${index}`,
    provider: "slack",
    url: null,
  }));

  const markup = record([day("2026-08-08", { events })]);
  assert.match(markup, /event 5/);
  assert.doesNotMatch(markup, /event 6/);
  assert.match(markup, /Show all 9 events/);
});
