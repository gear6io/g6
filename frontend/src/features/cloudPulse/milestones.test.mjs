import assert from "node:assert/strict";
import test from "node:test";

import {
  RANGE_DAYS,
  calendarDays,
  confidenceLabel,
  countLabel,
  crossesYears,
  dayLabel,
  defaultRange,
  humanizeReason,
  isConsecutive,
  isLabelled,
  longDayLabel,
  nodeLabel,
  observedLabel,
  signed,
  utcToday,
} from "./milestones.ts";

test("the calendar domain is every day in the range, observed or not", () => {
  const days = calendarDays("2026-07-10", "2026-08-08");
  assert.equal(days.length, RANGE_DAYS);
  assert.equal(days[0], "2026-07-10");
  assert.equal(days.at(-1), "2026-08-08");
  // Month ends and leap days are boundaries a naive +1 gets wrong.
  assert.deepEqual(calendarDays("2026-07-31", "2026-08-01"), [
    "2026-07-31",
    "2026-08-01",
  ]);
  assert.equal(calendarDays("2024-02-28", "2024-03-01").length, 3);

  assert.deepEqual(calendarDays("2026-08-08", "2026-07-10"), [], "reversed");
  assert.deepEqual(calendarDays("2026-8-8", "2026-08-09"), [], "loose date");
});

test("the default range is Cloud's own: today and the 29 days before it", () => {
  const now = Date.parse("2026-08-08T23:59:00Z");
  assert.deepEqual(defaultRange(now), { from: "2026-07-10", to: "2026-08-08" });
  assert.equal(calendarDays(...Object.values(defaultRange(now))).length, 30);
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

test("first, last, every seventh, and whatever is selected get a label", () => {
  const labelled = [];
  for (let i = 0; i < 30; i += 1) {
    if (isLabelled(i, 30, 25)) {
      labelled.push(i);
    }
  }
  assert.deepEqual(labelled, [0, 7, 14, 21, 25, 28, 29]);
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
  assert.equal(confidenceLabel(0.86), "86%");
});

test("a node names its date, status and count without relying on colour", () => {
  const label = nodeLabel({
    date: "2026-08-08",
    status: "regression",
    event_count: 1,
  });
  assert.match(label, /Saturday, Aug 8/);
  assert.match(label, /Regression/);
  assert.match(label, /1 observed activity$/);
});
