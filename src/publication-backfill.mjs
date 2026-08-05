import { DatabaseSync } from "node:sqlite";

import {
  addMonths,
  parseReportingMonth,
  previousTaipeiMonth,
  utcToTaipeiParts,
} from "./dates.mjs";
import { fetchCnyesRevenueWindow } from "./cnyes.mjs";
import { refreshReleaseForecasts } from "./live-update.mjs";
import {
  MOPS_MARKETS,
  mopsArchiveUrl,
  parseMopsArchive,
} from "./mops.mjs";
import {
  assignMoneydjTickers,
  fetchMoneydjRevenueWindow,
  normalizeMoneydjCompanyName,
} from "./moneydj.mjs";
import {
  syncCnyesPublicationEvidence,
  syncMoneydjPublicationEvidence,
} from "./publication-evidence.mjs";

function taipeiMonthStartUtc(month) {
  const { year, month: monthNumber } = parseReportingMonth(month);
  return new Date(
    `${year}-${String(monthNumber).padStart(2, "0")}-01T00:00:00+08:00`,
  ).toISOString();
}

function moneydjReleaseWindows(releaseMonth, currentTaipeiDate) {
  const { year, month } = parseReportingMonth(releaseMonth);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const currentMonth = currentTaipeiDate.startsWith(releaseMonth.slice(0, 7));
  const availableLastDay = currentMonth
    ? Math.min(lastDay, Number(currentTaipeiDate.slice(-2)))
    : lastDay;
  return [
    [1, 4],
    [5, 7],
    [8, 10],
    [11, 15],
    [16, lastDay],
  ]
    .filter(([start]) => start <= availableLastDay)
    .map(([start, end]) => ({
      startDateLocal: `${year}/${String(month).padStart(2, "0")}/${String(
        start,
      ).padStart(2, "0")}`,
      endDateLocal: `${year}/${String(month).padStart(2, "0")}/${String(
        Math.min(end, availableLastDay),
      ).padStart(2, "0")}`,
    }));
}

export function rollingReportingMonths(nowUtc, count = 12) {
  const latest = previousTaipeiMonth(nowUtc);
  return Array.from({ length: count }, (_, index) =>
    addMonths(latest, index - count + 1),
  );
}

async function fetchMopsCompanyNames({
  fetchFn,
  reportingMonths,
  observedAtUtc,
}) {
  const tickerByName = new Map();
  let requests = 0;
  const errors = [];
  for (const month of reportingMonths) {
    const results = await Promise.all(
      MOPS_MARKETS.map(async (market) => {
        const sourceUrl = mopsArchiveUrl(month, market.code);
        requests += 1;
        try {
          const response = await fetchFn(sourceUrl, {
            headers: {
              Accept: "text/csv",
              "User-Agent": "TAIEX-Semi-Dash/1.0",
            },
            signal: AbortSignal.timeout(30_000),
          });
          if (!response.ok) {
            throw new Error(
              `HTTP ${response.status} ${response.statusText}`.trim(),
            );
          }
          return parseMopsArchive({
            text: await response.text(),
            marketCode: market.code,
            marketPriority: market.priority,
            sourceUrl,
            observedAtUtc,
          });
        } catch (error) {
          errors.push(`${sourceUrl}: ${error.message}`);
          return null;
        }
      }),
    );
    for (const result of results.filter(Boolean)) {
      for (const row of result.rows) {
        const key = normalizeMoneydjCompanyName(row.sourceCompanyNameRaw);
        const prior = tickerByName.get(key);
        if (!prior || prior === row.ticker) {
          tickerByName.set(key, row.ticker);
        }
      }
    }
  }
  if (tickerByName.size === 0) {
    throw new Error(
      `Could not build the MOPS company-name map: ${errors.join("; ")}`,
    );
  }
  return { tickerByName, requests, errors };
}

export async function backfillPublicationDates({
  databasePath,
  nowUtc = new Date().toISOString(),
  monthCount = 12,
  fetchFn = globalThis.fetch,
  pageDelayMs = 100,
  includeCnyes = true,
  includeMoneydj = true,
  onProgress = null,
} = {}) {
  if (!databasePath) throw new Error("databasePath is required");
  if (!includeCnyes && !includeMoneydj) {
    throw new Error("At least one publication source must be enabled");
  }
  const normalizedNowUtc = new Date(nowUtc).toISOString();
  const reportingMonths = rollingReportingMonths(normalizedNowUtc, monthCount);
  const currentTaipeiDate = utcToTaipeiParts(normalizedNowUtc).date;

  await refreshReleaseForecasts({
    databasePath,
    nowUtc: normalizedNowUtc,
  });

  let mopsNameMap = {
    tickerByName: new Map(),
    requests: 0,
    errors: [],
  };
  if (includeMoneydj) {
    mopsNameMap = await fetchMopsCompanyNames({
      fetchFn,
      reportingMonths: reportingMonths.slice(-2),
      observedAtUtc: normalizedNowUtc,
    });
  }

  const cnyesRecords = [];
  const moneydjRecords = [];
  let cnyesRequests = 0;
  let moneydjRequests = 0;
  let moneydjUnmappedArticles = 0;
  for (const month of reportingMonths) {
    const releaseMonth = addMonths(month, 1);
    const startAtUtc = taipeiMonthStartUtc(releaseMonth);
    const unboundedEndAtUtc = taipeiMonthStartUtc(addMonths(releaseMonth, 1));
    const endAtUtc =
      unboundedEndAtUtc < normalizedNowUtc
        ? unboundedEndAtUtc
        : normalizedNowUtc;
    if (startAtUtc >= endAtUtc) continue;

    if (includeCnyes) {
      const fetched = await fetchCnyesRevenueWindow({
        fetchFn,
        startAtUtc,
        endAtUtc,
        pageDelayMs,
        maxPages: 60,
      });
      const monthRecords = fetched.records.filter(
        (record) => record.reportingMonth === month,
      );
      cnyesRecords.push(...monthRecords);
      cnyesRequests += fetched.requests;
      onProgress?.({
        source: "cnyes",
        reportingMonth: month,
        requests: fetched.requests,
        articlesSeen: fetched.records.length,
        candidateArticles: monthRecords.length,
      });
    }

    if (includeMoneydj) {
      const windows = moneydjReleaseWindows(releaseMonth, currentTaipeiDate);
      const fetchedWindows = [];
      for (const window of windows) {
        fetchedWindows.push(
          await fetchMoneydjRevenueWindow({
            fetchFn,
            reportingMonth: month,
            ...window,
            pageDelayMs,
            maxPages: 20,
          }),
        );
      }
      const uniqueRecords = new Map();
      for (const fetched of fetchedWindows) {
        for (const record of fetched.records) {
          uniqueRecords.set(record.sourceRecordId, record);
        }
      }
      const records = [...uniqueRecords.values()];
      const requestCount = fetchedWindows.reduce(
        (total, fetched) => total + fetched.requests,
        0,
      );
      const mapped = assignMoneydjTickers(
        records,
        mopsNameMap.tickerByName,
      );
      moneydjUnmappedArticles += records.length - mapped.length;
      moneydjRecords.push(...mapped);
      moneydjRequests += requestCount;
      onProgress?.({
        source: "moneydj",
        reportingMonth: month,
        requests: requestCount,
        articlesSeen: records.length,
        candidateArticles: mapped.length,
      });
    }
  }

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 30000");
  let cnyesSync = null;
  let moneydjSync = null;
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      if (includeCnyes) {
        cnyesSync = syncCnyesPublicationEvidence(
          database,
          cnyesRecords,
          normalizedNowUtc,
        );
      }
      if (includeMoneydj) {
        moneydjSync = syncMoneydjPublicationEvidence(
          database,
          moneydjRecords,
          normalizedNowUtc,
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }

  const forecasts = await refreshReleaseForecasts({
    databasePath,
    nowUtc: normalizedNowUtc,
  });
  return {
    databaseVersion: forecasts.databaseVersion,
    reportingMonths,
    mopsNameMapRequests: mopsNameMap.requests,
    mopsNameMapSize: mopsNameMap.tickerByName.size,
    mopsNameMapErrors: mopsNameMap.errors,
    cnyes: includeCnyes
      ? {
          requests: cnyesRequests,
          candidateArticles: cnyesRecords.length,
          ...cnyesSync,
        }
      : null,
    moneydj: includeMoneydj
      ? {
          requests: moneydjRequests,
          candidateArticles: moneydjRecords.length,
          unmappedArticles: moneydjUnmappedArticles,
          ...moneydjSync,
        }
      : null,
    profilesChanged: forecasts.profilesChanged,
    schedulesChanged: forecasts.schedulesChanged,
  };
}
