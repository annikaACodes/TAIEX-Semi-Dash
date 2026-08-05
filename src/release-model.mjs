import {
  addDays,
  differenceInDays,
  minuteToTime,
  regulatoryDeadline,
  reportingMonthEnd,
  taipeiDateTimeToUtc,
} from "./dates.mjs";

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildReleaseProfile(history, updatedAtUtc) {
  const sourceRank = { ir: 0, proxy: 1, actual: 2 };
  const byMonth = new Map();
  for (const item of history) {
    const prior = byMonth.get(item.reportingMonth);
    if (
      !prior ||
      (sourceRank[item.kind] ?? -1) > (sourceRank[prior.kind] ?? -1)
    ) {
      byMonth.set(item.reportingMonth, item);
    }
  }

  const observations = [...byMonth.values()]
    .sort((left, right) =>
      left.reportingMonth.localeCompare(right.reportingMonth),
    )
    .slice(-12);
  if (observations.length === 0) {
    return {
      historySampleCount: 0,
      actualFirstSeenSampleCount: 0,
      irCalendarSampleCount: 0,
      medianReleaseOffsetDays: null,
      medianReleaseMinuteLocal: null,
      medianAbsoluteDeviationDays: null,
      forecastMethod: "regulatory_prior",
      confidence: "low",
      profileAsOfReportingMonth: null,
      updatedAtUtc,
    };
  }

  const offsets = observations.map((item) =>
    differenceInDays(
      item.releaseDateLocal,
      reportingMonthEnd(item.reportingMonth),
    ),
  );
  const offsetMedian = median(offsets);
  const deviations = offsets.map((offset) => Math.abs(offset - offsetMedian));
  const minuteValues = observations
    .map((item) => item.releaseMinuteLocal)
    .filter((value) => value !== null && value !== undefined);
  const sampleCount = observations.length;
  const proxySampleCount = observations.filter(
    (item) => item.kind === "proxy",
  ).length;
  const confidence =
    sampleCount >= 6 && proxySampleCount < sampleCount
      ? "high"
      : sampleCount >= 3
        ? "medium"
        : "low";

  return {
    historySampleCount: sampleCount,
    actualFirstSeenSampleCount: observations.filter(
      (item) => item.kind === "actual",
    ).length,
    irCalendarSampleCount: observations.filter((item) => item.kind === "ir")
      .length,
    medianReleaseOffsetDays: offsetMedian,
    medianReleaseMinuteLocal: median(minuteValues),
    medianAbsoluteDeviationDays: median(deviations),
    forecastMethod: "company_history",
    confidence,
    profileAsOfReportingMonth: observations
      .map((item) => item.reportingMonth)
      .sort()
      .at(-1),
    updatedAtUtc,
  };
}

export function buildHistoricalFallbackProfile(histories, updatedAtUtc) {
  const companyProfiles = [...histories]
    .map((history) => buildReleaseProfile(history, updatedAtUtc))
    .filter(
      (profile) =>
        profile.historySampleCount > 0 &&
        profile.medianReleaseOffsetDays !== null,
    );
  if (companyProfiles.length === 0) {
    return null;
  }

  const offsets = companyProfiles.map(
    (profile) => profile.medianReleaseOffsetDays,
  );
  const offsetMedian = median(offsets);
  const deviations = offsets.map((offset) => Math.abs(offset - offsetMedian));
  const profileMonths = companyProfiles
    .map((profile) => profile.profileAsOfReportingMonth)
    .filter(Boolean)
    .sort();

  return {
    historySampleCount: 0,
    actualFirstSeenSampleCount: 0,
    irCalendarSampleCount: 0,
    medianReleaseOffsetDays: offsetMedian,
    medianReleaseMinuteLocal: null,
    medianAbsoluteDeviationDays: median(deviations),
    forecastMethod: "historical_estimate",
    confidence: "low",
    profileAsOfReportingMonth: profileMonths.at(-1) ?? null,
    fallbackCompanyCount: companyProfiles.length,
    isFallback: true,
    updatedAtUtc,
  };
}

export function resolveHistoricalEstimate(profile, fallbackProfile) {
  if (
    fallbackProfile?.medianReleaseOffsetDays === null ||
    fallbackProfile?.medianReleaseOffsetDays === undefined
  ) {
    return profile;
  }
  if (profile.medianReleaseOffsetDays === null) {
    return fallbackProfile;
  }
  if (profile.historySampleCount >= 3) {
    return profile;
  }

  const companyWeight = profile.historySampleCount / 3;
  const fallbackWeight = 1 - companyWeight;
  return {
    ...profile,
    medianReleaseOffsetDays:
      profile.medianReleaseOffsetDays * companyWeight +
      fallbackProfile.medianReleaseOffsetDays * fallbackWeight,
    medianAbsoluteDeviationDays: Math.max(
      profile.medianAbsoluteDeviationDays ?? 0,
      fallbackProfile.medianAbsoluteDeviationDays ?? 0,
    ),
    forecastMethod: "historical_estimate",
    confidence: "low",
  };
}

export function buildMonthlySchedule({
  reportingMonth,
  profile,
  announcement = null,
  existing = null,
  hasHistoricalBackfill = false,
  nowUtc,
  holidays = new Set(),
}) {
  const monthEnd = reportingMonthEnd(reportingMonth);
  const deadline = regulatoryDeadline(reportingMonth, holidays);
  const hasHistoricalEstimate = profile.medianReleaseOffsetDays !== null;
  const historyOffset =
    hasHistoricalEstimate
      ? Math.round(profile.medianReleaseOffsetDays)
      : differenceInDays(deadline, monthEnd);
  const historyExpectedDate = addDays(monthEnd, historyOffset);
  const historyTime = minuteToTime(profile.medianReleaseMinuteLocal);
  const radius =
    hasHistoricalEstimate
      ? Math.max(
          1,
          Math.ceil(2 * (profile.medianAbsoluteDeviationDays ?? 0)),
        )
      : Math.max(1, differenceInDays(deadline, addDays(monthEnd, 1)));
  const historyWindowStart =
    hasHistoricalEstimate
      ? addDays(historyExpectedDate, -radius)
      : addDays(monthEnd, 1);
  const unboundedHistoryWindowEnd =
    hasHistoricalEstimate
      ? addDays(historyExpectedDate, radius)
      : deadline;
  const historyWindowEnd =
    profile.isFallback && unboundedHistoryWindowEnd > deadline
      ? deadline
      : unboundedHistoryWindowEnd;

  const nowLocalDate = new Date(
    new Date(nowUtc).valueOf() + 8 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);
  const actualDate = existing?.actualFirstSeenDateLocal ?? null;
  const actualTime = existing?.actualFirstSeenTimeLocal ?? null;
  const actualUtc = existing?.actualFirstSeenAtUtc ?? null;

  let effectiveDate = historyExpectedDate;
  let effectiveTime = historyTime;
  let scheduleSource =
    hasHistoricalEstimate ? "company_history" : "regulatory_prior";
  let status = "forecast";
  let unusual = 0;
  let unusualReason = null;

  if (announcement) {
    effectiveDate = announcement.releaseDateLocal;
    effectiveTime = announcement.releaseTimeLocal;
    scheduleSource = "ir_calendar";
    status = "announced";
  }

  if (actualDate) {
    effectiveDate = actualDate;
    effectiveTime = actualTime;
    scheduleSource = "actual_first_seen";
    status = "reported";
  } else if (
    hasHistoricalBackfill &&
    reportingMonth < nowLocalDate.slice(0, 7) + "-01"
  ) {
    status = "historical_backfill";
  } else if (nowLocalDate > historyWindowEnd && !announcement) {
    status = "overdue";
    unusual = 1;
    unusualReason = "LATE_NOT_YET_REPORTED";
  } else if (announcement && nowLocalDate > announcement.releaseDateLocal) {
    status = "overdue";
    unusual = 1;
    unusualReason = "LATE_NOT_YET_REPORTED";
  }

  const observedDate = actualDate ?? announcement?.releaseDateLocal ?? null;
  const deviation = observedDate
    ? differenceInDays(observedDate, historyExpectedDate)
    : status === "overdue"
      ? differenceInDays(nowLocalDate, historyExpectedDate)
      : null;

  if (observedDate) {
    if (observedDate > deadline) {
      unusual = 1;
      unusualReason = "AFTER_REGULATORY_DEADLINE";
    } else if (
      profile.historySampleCount >= 3 &&
      observedDate < historyWindowStart
    ) {
      unusual = 1;
      unusualReason = "EARLY";
    } else if (
      profile.historySampleCount >= 3 &&
      observedDate > historyWindowEnd
    ) {
      unusual = 1;
      unusualReason = "LATE";
    }
  }

  return {
    reportingMonth,
    historyExpectedReleaseDateLocal: historyExpectedDate,
    historyExpectedReleaseTimeLocal: historyTime,
    historyWindowStartDateLocal: historyWindowStart,
    historyWindowEndDateLocal: historyWindowEnd,
    effectiveExpectedReleaseDateLocal: effectiveDate,
    effectiveExpectedReleaseTimeLocal: effectiveTime,
    effectiveExpectedTimestampUtc: taipeiDateTimeToUtc(
      effectiveDate,
      effectiveTime,
    ),
    regulatoryDeadlineDateLocal: deadline,
    scheduleSource,
    announcedReleaseDateLocal: announcement?.releaseDateLocal ?? null,
    announcedReleaseTimeLocal: announcement?.releaseTimeLocal ?? null,
    announcedReleaseTimestampUtc: announcement?.releaseTimestampUtc ?? null,
    actualFirstSeenAtUtc: actualUtc,
    actualFirstSeenDateLocal: actualDate,
    actualFirstSeenTimeLocal: actualTime,
    deviationFromHistoryDays: deviation,
    unusualReportDate: unusual,
    unusualReason,
    releaseStatus: status,
    forecastMethod: profile.forecastMethod,
    forecastConfidence: profile.confidence,
    historySampleCount: profile.historySampleCount,
    lastEvaluatedAtUtc: nowUtc,
    updatedAtUtc: nowUtc,
  };
}
