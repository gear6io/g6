import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DailyRecord } from "./DailyRecord.tsx";
import { MilestonePanel } from "./MilestonePanel.tsx";
import { MilestoneRail } from "./MilestoneRail.tsx";
import { calendarDays } from "./milestones.ts";

const NOW = Date.parse("2026-08-08T12:00:00Z");
const CALENDAR = calendarDays("2026-07-10", "2026-08-08");

function day(date, overrides = {}) {
  return {
    date,
    status: "progress",
    observed_at: `${date}T14:31:00Z`,
    event_count: 4,
    snapshot: {
      open_decisions: 2,
      open_handoffs: 1,
      open_constraints: 3,
      constraint_work_items: 11,
    },
    changes: {
      open_decisions: -1,
      open_handoffs: 1,
      open_constraints: 0,
      constraint_work_items: -2,
    },
    status_evidence: [
      {
        classification: "progress",
        provenance: "deterministic",
        reason: "decision_closed",
        rationale: null,
        confidence: 1,
      },
    ],
    sources: [],
    sources_truncated: false,
    ...overrides,
  };
}

const MILESTONE = {
  id: "0123456789abcdef0123456789abcdef",
  slug: "product-import",
  summary: "Product import pipeline",
  status: "active",
  updated_at: "2026-08-08T14:31:00Z",
  last_activity: {
    date: "2026-08-08",
    status: "progress",
    observed_at: "2026-08-08T14:31:00Z",
  },
  open_decisions: 2,
  open_handoffs: 1,
  open_constraints: 3,
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

function rail(days) {
  return renderToStaticMarkup(
    React.createElement(MilestoneRail, {
      calendar: CALENDAR,
      days,
      onSelect: () => {},
      selected: null,
    }),
  );
}

test("a panel names the milestone and every open count, zero included", () => {
  const markup = panel({
    timeline: { status: "ready", value: { days: [day("2026-08-08")] } },
  });

  assert.match(markup, /Product import pipeline/);
  assert.match(markup, /product-import/);
  assert.match(markup, /2 open decisions/);
  assert.match(markup, /1 open handoff/);
  assert.match(markup, /3 open constraints/);
  // The lifecycle status is `active` for every row v1 asks for, so it is not
  // printed as a badge that can only ever say one thing.
  assert.doesNotMatch(markup, /Pruned/);
  // No completion figure: Cloud derives none.
  assert.doesNotMatch(markup, /\d+%/);
});

test("zero counts stay visible rather than collapsing the row", () => {
  const markup = panel({
    milestone: {
      ...MILESTONE,
      open_decisions: 0,
      open_handoffs: 0,
      open_constraints: 0,
    },
    timeline: { status: "ready", value: { days: [] } },
  });
  assert.match(markup, /0 open decisions/);
  assert.match(markup, /0 open handoffs/);
  assert.match(markup, /0 open constraints/);
});

test("a milestone nothing was derived about says so instead of showing neutral", () => {
  const markup = panel({
    milestone: { ...MILESTONE, last_activity: null },
    timeline: { status: "ready", value: { days: [] } },
  });
  assert.match(markup, /No activity yet/);
  assert.match(markup, /No observed activity in the last 30 days/);
  assert.doesNotMatch(markup, /Neutral/, "a quiet range is not a neutral day");
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
  assert.match(markup, /2 open decisions/);
});

test("the rail draws a cell per calendar day and a node per observed one", () => {
  const markup = rail([day("2026-07-20"), day("2026-08-08")]);

  assert.equal(markup.match(/h-\[58px\]/g).length, 30, "one cell per day");
  assert.equal(markup.match(/<button/g).length, 2, "only observed days");
  // Colour is never the only cue: the accessible name carries the status.
  assert.match(markup, /aria-label="Monday, Jul 20, Progress, 4 observed activities"/);
});

test("a connector is drawn between adjacent days and never across a gap", () => {
  const connectors = (markup) => (markup.match(/style="left:-50%/g) ?? []).length;

  assert.equal(connectors(rail([day("2026-08-07"), day("2026-08-08")])), 1);
  assert.equal(
    connectors(rail([day("2026-08-06"), day("2026-08-08")])),
    0,
    "the 7th was never observed, so nothing may join the 6th to the 8th",
  );
  assert.equal(connectors(rail([day("2026-08-08")])), 0, "a lone day");
});

test("the rail labels the ends and every seventh day", () => {
  const markup = rail([day("2026-08-08")]);
  assert.match(markup, /Jul 10/, "first");
  assert.match(markup, /Aug 8/, "last");
  assert.match(markup, /Jul 17/, "seventh");
  assert.doesNotMatch(markup, /Jul 18/, "not every day");
});

test("a daily record explains the day without colouring the deltas", () => {
  const markup = renderToStaticMarkup(
    React.createElement(DailyRecord, {
      day: day("2026-08-08", {
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
      previousDate: "2026-07-31",
    }),
  );

  assert.match(markup, /Saturday, Aug 8/);
  assert.match(markup, /Decision closed/);
  assert.match(markup, /Workflow fact/);
  // A deterministic entry's confidence is always 1.0 and is never shown as odds.
  assert.doesNotMatch(markup, /100% confidence/);
  assert.match(markup, /Analysis · 86% confidence/);
  assert.match(markup, /Deployment completed successfully/);

  assert.match(markup, /Constraint reach/);
  assert.match(markup, /11 work items/);
  assert.match(markup, /Change since Friday, Jul 31/);
  assert.match(markup, />-1</, "a negative delta is signed");
  assert.match(markup, />\+1</, "a positive delta is signed");
  assert.match(markup, />0</, "and zero is still printed");
  // A falling count is not always good and a rising one is not always bad, so
  // every value is foreground and the evidence above is what explains the day.
  for (const value of markup.match(/<dd class="[^"]*"/g)) {
    assert.match(value, /text-foreground/);
    assert.doesNotMatch(value, /emerald|rose|amber/);
  }
});

test("the first returned day has no previous day to be measured against", () => {
  const markup = renderToStaticMarkup(
    React.createElement(DailyRecord, {
      day: day("2026-07-10"),
      previousDate: null,
    }),
  );
  assert.match(markup, /Change at start of range/);
  assert.doesNotMatch(markup, /Change since/);
});

test("a truncated source list says so and is never mistaken for a quiet day", () => {
  const cut = renderToStaticMarkup(
    React.createElement(DailyRecord, {
      day: day("2026-08-08", { sources: [], sources_truncated: true }),
      previousDate: null,
    }),
  );
  assert.match(cut, /Cloud limited source activities for this date/);
  assert.match(cut, /No source activities were returned/);
  assert.match(cut, /4 observed activities/, "the day's own count is complete");

  const quiet = renderToStaticMarkup(
    React.createElement(DailyRecord, {
      day: day("2026-08-08", { sources: [], event_count: 0 }),
      previousDate: null,
    }),
  );
  assert.match(quiet, /No source activities were recorded/);
  assert.doesNotMatch(quiet, /Cloud limited/);
});

test("a source with no link gets no link, not a dead one", () => {
  const source = (url) => ({
    id: "s1",
    type: "log",
    occurred_at: "2026-08-08T14:31:00Z",
    summary: "PR #482 merged",
    provider: "github",
    url,
  });

  const linked = renderToStaticMarkup(
    React.createElement(DailyRecord, {
      day: day("2026-08-08", { sources: [source("https://example.com/pr/482")] }),
      previousDate: null,
    }),
  );
  assert.match(linked, /href="https:\/\/example\.com\/pr\/482"/);
  assert.match(linked, /rel="noreferrer noopener"/);

  const bare = renderToStaticMarkup(
    React.createElement(DailyRecord, {
      day: day("2026-08-08", { sources: [source(null)] }),
      previousDate: null,
    }),
  );
  assert.match(bare, /PR #482 merged/);
  assert.doesNotMatch(bare, /<a /, "no link and no disabled placeholder");
});

test("only the first six sources render until they are asked for", () => {
  const sources = Array.from({ length: 9 }, (_, index) => ({
    id: `s${index}`,
    type: "log",
    occurred_at: "2026-08-08T14:31:00Z",
    summary: `activity ${index}`,
    provider: "slack",
    url: null,
  }));

  const markup = renderToStaticMarkup(
    React.createElement(DailyRecord, {
      day: day("2026-08-08", { sources }),
      previousDate: null,
    }),
  );
  assert.match(markup, /activity 5/);
  assert.doesNotMatch(markup, /activity 6/);
  assert.match(markup, /Show all 9 source activities/);
});
