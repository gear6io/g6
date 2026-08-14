import assert from "node:assert/strict";
import test from "node:test";

import {
  countLabel,
  crossesYears,
  dayGap,
  dayLabel,
  defaultRange,
  gapLabel,
  humanizeReason,
  isConsecutive,
  longDayLabel,
  observedLabel,
  openParts,
  openTotal,
  railStages,
  rangeLabel,
  selectedRange,
  signed,
  stageEvents,
  stageLabel,
  timelineRange,
  utcToday,
} from "./milestones.ts";

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

test("the total covers every kind, including the ones left out of the parts", () => {
  assert.equal(openTotal(counts({ review: 4, unblock: 3 })), 7);
  assert.equal(openTotal(counts()), 0);
  // Signed movement sums the same way: closing more than opening is negative.
  assert.equal(openTotal(counts({ review: 2, unblock: -3 })), -1);
});

test("the parts drop the zeros and keep Cloud's key order", () => {
  assert.deepEqual(
    openParts(counts({ unblock: 3, review: 4, approval: 0 })),
    [
      { kind: "review", value: 4 },
      { kind: "unblock", value: 3 },
    ],
    "review precedes unblock regardless of the order the keys arrived in",
  );
  assert.deepEqual(openParts(counts()), [], "nothing open is no parts at all");
  // A negative delta moved, so it is part of what moved.
  assert.deepEqual(openParts(counts({ decision: -1 })), [
    { kind: "decision", value: -1 },
  ]);
});

test("the gap between two observed days counts the days nobody looked at", () => {
  assert.equal(dayGap("2026-08-07", "2026-08-08"), 0, "adjacent");
  assert.equal(dayGap("2026-07-20", "2026-08-08"), 18);
  // Month ends and leap days are boundaries a naive +1 gets wrong.
  assert.equal(dayGap("2026-07-31", "2026-08-01"), 0);
  assert.equal(dayGap("2024-02-28", "2024-03-01"), 1, "leap day");
  // Out of order or the same day: no gap the rail could draw.
  assert.ok(dayGap("2026-08-08", "2026-08-08") < 0);
  assert.ok(dayGap("2026-08-08", "2026-07-20") < 0);
  assert.ok(Number.isNaN(dayGap("2026-8-8", "2026-08-09")), "loose date");
});

test("the default range is Cloud's own: today and the 29 days before it", () => {
  const now = Date.parse("2026-08-08T23:59:00Z");
  assert.deepEqual(defaultRange(now), { from: "2026-07-10", to: "2026-08-08" });
});

test("selected windows end on Cloud's generated UTC day", () => {
  assert.deepEqual(selectedRange("2026-08-14T09:12:00Z", 7), {
    from: "2026-08-08",
    to: "2026-08-14",
  });
  assert.deepEqual(selectedRange("2026-08-14T09:12:00Z", 30), {
    from: "2026-07-16",
    to: "2026-08-14",
  });
  assert.deepEqual(selectedRange("not-a-date", 90), undefined);
});

test("the rendered window shifts onto a milestone last seen before it", () => {
  const now = Date.parse("2026-08-08T12:00:00Z");

  // Inside the default window, and on its first day: no shift, and no dates
  // sent, so Cloud derives the range itself.
  assert.deepEqual(timelineRange(now, "2026-07-20"), {
    from: "2026-07-10",
    to: "2026-08-08",
    shifted: false,
  });
  assert.deepEqual(timelineRange(now, "2026-07-10"), {
    from: "2026-07-10",
    to: "2026-08-08",
    shifted: false,
  });

  // Older than the window: the 30 days ending on the day Cloud last observed.
  assert.deepEqual(timelineRange(now, "2026-05-10"), {
    from: "2026-04-11",
    to: "2026-05-10",
    shifted: true,
  });

  // Nothing observed at all, or a date Cloud never sent: the default window.
  for (const last of [null, undefined, "", "not-a-date"]) {
    assert.deepEqual(timelineRange(now, last), {
      from: "2026-07-10",
      to: "2026-08-08",
      shifted: false,
    });
  }
});

test("a UTC day is a UTC day west of Greenwich too", () => {
  // 16:30 in Los Angeles on the 7th is already the 8th in UTC, and Cloud's day
  // is the UTC one.
  assert.equal(utcToday(Date.parse("2026-08-08T00:30:00Z")), "2026-08-08");
  assert.equal(dayLabel("2026-08-08"), "Aug 8");
  assert.equal(longDayLabel("2026-08-08"), "Saturday, Aug 8");
  assert.equal(dayLabel("2025-12-31", true), "Dec 31, 2025");
});

test("only adjacent days are connected", () => {
  assert.ok(isConsecutive("2026-07-31", "2026-08-01"));
  assert.ok(!isConsecutive("2026-07-30", "2026-08-01"), "a missing day");
  assert.ok(!isConsecutive("2026-08-01", "2026-08-01"), "the same day");
  assert.ok(!isConsecutive("2026-08-01", "2026-07-31"), "backwards");
});

test("a year boundary is the only reason to print a year", () => {
  assert.ok(crossesYears(["2025-12-20", "2026-01-05"]));
  assert.ok(!crossesYears(["2026-07-10", "2026-08-08"]));
  assert.ok(!crossesYears([]));
});

test("observed labels stay relative for the first two days only", () => {
  const now = Date.parse("2026-08-08T09:00:00Z");
  assert.equal(observedLabel("2026-08-08", now), "today");
  assert.equal(observedLabel("2026-08-07", now), "yesterday");
  assert.equal(observedLabel("2026-08-02", now), "6 days ago");
  // Cloud generated the page a moment ago; a future-dated day is still "today".
  assert.equal(observedLabel("2026-08-09", now), "today");
});

test("counts and deltas are singular, plural and signed correctly", () => {
  assert.equal(countLabel(0, "decision"), "0 open decisions");
  assert.equal(countLabel(1, "handoff"), "1 open handoff");
  assert.equal(countLabel(3, "constraint"), "3 open constraints");

  assert.equal(signed(1), "+1");
  assert.equal(signed(0), "0");
  assert.equal(signed(-2), "-2");
});

test("a reason is humanized rather than mapped, since Cloud adds rules", () => {
  assert.equal(humanizeReason("decision_closed"), "Decision closed");
  assert.equal(humanizeReason("wait_failed"), "Wait failed");
  assert.equal(humanizeReason("model_finding"), "Model finding");
  // A rule this build has never heard of still reads as a sentence.
  assert.equal(humanizeReason("some_future_rule"), "Some future rule");
  assert.equal(humanizeReason(""), "Classified");
});

/** Cloud always sends all six keys, so every fixture does too. */
function timelineDay(date, overrides = {}) {
  return {
    date,
    status: "neutral",
    observed_at: `${date}T10:00:00Z`,
    event_count: 2,
    snapshot: counts({ review: 3 }),
    changes: counts(),
    status_evidence: [],
    events: [],
    events_truncated: false,
    ...overrides,
  };
}

test("adjacent neutral days fold into one stage; nothing else folds", () => {
  const moved = {
    status: "progress",
    status_evidence: [
      {
        classification: "progress",
        provenance: "deterministic",
        reason: "decision_closed",
        rationale: null,
        confidence: 1,
      },
    ],
  };

  const stages = railStages([
    timelineDay("2026-08-01", { changes: counts({ review: 2 }) }),
    timelineDay("2026-08-02", { changes: counts({ review: -1 }) }),
    timelineDay("2026-08-03", {
      snapshot: counts({ review: 4 }),
      changes: counts({ review: 1 }),
    }),
    timelineDay("2026-08-04", moved),
    timelineDay("2026-08-05", moved),
    timelineDay("2026-08-20"),
  ]);

  assert.deepEqual(
    stages.map((stage) => [stage.key, stage.days.length, stage.gapBefore]),
    [
      ["2026-08-01", 3, 0],
      ["2026-08-04", 1, 0],
      ["2026-08-05", 1, 0],
      ["2026-08-20", 1, 14],
    ],
    "two progress days are two things that happened, not one",
  );

  const [run] = stages;
  assert.equal(run.status, "neutral");
  assert.equal(run.to, "2026-08-03");
  assert.equal(run.eventCount, 6, "the run's events are the days' events");
  assert.equal(run.snapshot.review, 4, "the snapshot is where the run ended");
  assert.equal(run.changes.review, 2, "movement nets across the run");
  // A stage no longer carries Cloud's evidence: nothing draws it.
  assert.equal(run.evidence, undefined);

  // A quiet day the next quiet day does not run into stays its own stage.
  const split = railStages([
    timelineDay("2026-08-01"),
    timelineDay("2026-08-03"),
  ]);
  assert.equal(split.length, 2);
  assert.equal(split[1].gapBefore, 1);

  assert.deepEqual(railStages([]), []);
});

test("a stage names its dates, status and count without relying on colour", () => {
  const [one] = railStages([
    timelineDay("2026-08-08", { status: "regression", event_count: 1 }),
  ]);
  assert.equal(
    stageLabel(one),
    "Saturday, Aug 8, Regression, 1 observed event",
  );

  const [run] = railStages([
    timelineDay("2026-08-01"),
    timelineDay("2026-08-02"),
  ]);
  assert.equal(
    stageLabel(run),
    "Saturday, Aug 1 to Sunday, Aug 2, 2 days, Neutral, 4 observed events",
  );

  assert.equal(gapLabel(1), "1 day with nothing observed");
  assert.equal(gapLabel(14), "14 days with nothing observed");
});

test("a stage's label shortens a range that stays inside one month", () => {
  assert.equal(rangeLabel("2026-08-08", "2026-08-08"), "Aug 8");
  assert.equal(rangeLabel("2026-07-20", "2026-07-26"), "Jul 20-26");
  assert.equal(rangeLabel("2026-07-28", "2026-08-03"), "Jul 28-Aug 3");
  // Across a year boundary both ends carry theirs, so neither is guessed at.
  assert.equal(
    rangeLabel("2025-12-30", "2026-01-02", true),
    "Dec 30, 2025-Jan 2, 2026",
  );
});

test("a stage's events carry the day and the state they were observed under", () => {
  const event = (id) => ({
    id,
    type: "log",
    occurred_at: "2026-08-01T09:00:00Z",
    summary: id,
    provider: "slack",
    url: null,
  });

  const [run] = railStages([
    timelineDay("2026-08-01", { events: [event("a"), event("b")] }),
    timelineDay("2026-08-02", { events: [event("c")] }),
  ]);

  assert.deepEqual(
    stageEvents(run).map((row) => [row.event.id, row.date, row.status]),
    [
      ["a", "2026-08-01", "neutral"],
      ["b", "2026-08-01", "neutral"],
      ["c", "2026-08-02", "neutral"],
    ],
  );
});
