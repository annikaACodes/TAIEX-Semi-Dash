import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMonthlySchedule,
  buildReleaseProfile,
} from "../src/release-model.mjs";

const NOW = "2026-07-29T12:00:00.000Z";

function history(months, dayOffsets) {
  return months.map((reportingMonth, index) => ({
    kind: "actual",
    reportingMonth,
    releaseDateLocal: dayOffsets[index],
    releaseMinuteLocal: 17 * 60,
  }));
}

test("a consistent company history produces a high-confidence forecast", () => {
  const profile = buildReleaseProfile(
    history(
      [
        "2026-01-01",
        "2026-02-01",
        "2026-03-01",
        "2026-04-01",
        "2026-05-01",
        "2026-06-01",
      ],
      [
        "2026-02-05",
        "2026-03-05",
        "2026-04-05",
        "2026-05-05",
        "2026-06-05",
        "2026-07-05",
      ],
    ),
    NOW,
  );
  assert.equal(profile.historySampleCount, 6);
  assert.equal(profile.medianReleaseOffsetDays, 5);
  assert.equal(profile.confidence, "high");
});

test("an announced date overrides history and flags an early month", () => {
  const profile = {
    historySampleCount: 12,
    medianReleaseOffsetDays: 10,
    medianReleaseMinuteLocal: 17 * 60,
    medianAbsoluteDeviationDays: 0,
    forecastMethod: "company_history",
    confidence: "high",
  };
  const schedule = buildMonthlySchedule({
    reportingMonth: "2026-09-01",
    profile,
    announcement: {
      releaseDateLocal: "2026-10-08",
      releaseTimeLocal: "17:00:00",
      releaseTimestampUtc: "2026-10-08T09:00:00.000Z",
    },
    nowUtc: NOW,
    holidays: new Set(["2026-10-09"]),
  });
  assert.equal(schedule.effectiveExpectedReleaseDateLocal, "2026-10-08");
  assert.equal(schedule.scheduleSource, "ir_calendar");
  assert.equal(schedule.unusualReportDate, 1);
  assert.equal(schedule.unusualReason, "EARLY");
});

test("a missing report rolls its effective expectation forward", () => {
  const profile = {
    historySampleCount: 10,
    medianReleaseOffsetDays: 5,
    medianReleaseMinuteLocal: null,
    medianAbsoluteDeviationDays: 0,
    forecastMethod: "company_history",
    confidence: "high",
  };
  const schedule = buildMonthlySchedule({
    reportingMonth: "2026-06-01",
    profile,
    nowUtc: NOW,
  });
  assert.equal(schedule.releaseStatus, "overdue");
  assert.equal(schedule.effectiveExpectedReleaseDateLocal, "2026-07-29");
  assert.equal(schedule.unusualReportDate, 1);
  assert.equal(schedule.unusualReason, "LATE_NOT_YET_REPORTED");
});

test("companies without trustworthy history keep a low-confidence prior", () => {
  const profile = buildReleaseProfile([], NOW);
  const schedule = buildMonthlySchedule({
    reportingMonth: "2026-07-01",
    profile,
    nowUtc: NOW,
  });
  assert.equal(profile.forecastMethod, "regulatory_prior");
  assert.equal(profile.confidence, "low");
  assert.equal(schedule.historyExpectedReleaseDateLocal, "2026-08-10");
});
