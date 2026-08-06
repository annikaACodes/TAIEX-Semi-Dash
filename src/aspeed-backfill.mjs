import { DatabaseSync } from "node:sqlite";

import { addMonths, previousTaipeiMonth } from "./dates.mjs";
import { refreshReleaseForecasts } from "./live-update.mjs";
import {
  fetchAspeedRevenueReleases,
  syncAspeedPublicationEvidence,
} from "./aspeed.mjs";

function rollingReportingMonths(nowUtc, count) {
  const latest = previousTaipeiMonth(nowUtc);
  return Array.from({ length: count }, (_, index) =>
    addMonths(latest, index - count + 1),
  );
}

function checkDatabase(database) {
  const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length > 0) {
    throw new Error(
      `Foreign key check failed: ${JSON.stringify(foreignKeys.slice(0, 5))}`,
    );
  }
  const integrity = database.prepare("PRAGMA integrity_check").get();
  if (integrity.integrity_check !== "ok") {
    throw new Error(`SQLite integrity check failed: ${integrity.integrity_check}`);
  }
}

export async function backfillAspeedReportDates({
  databasePath,
  nowUtc = new Date().toISOString(),
  monthCount = 12,
  fetchFn = globalThis.fetch,
} = {}) {
  if (!databasePath) throw new Error("databasePath is required");
  if (!Number.isInteger(monthCount) || monthCount < 1 || monthCount > 51) {
    throw new Error("monthCount must be an integer from 1 through 51");
  }
  const normalizedNowUtc = new Date(nowUtc).toISOString();
  await refreshReleaseForecasts({ databasePath, nowUtc: normalizedNowUtc });

  const reportingMonths = rollingReportingMonths(normalizedNowUtc, monthCount);
  const fetched = await fetchAspeedRevenueReleases({
    reportingMonths,
    fetchFn,
  });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 30000");
  let sync;
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      sync = syncAspeedPublicationEvidence(
        database,
        fetched.releases,
        normalizedNowUtc,
      );
      if (sync.matched !== reportingMonths.length) {
        throw new Error(
          `Validated ${sync.matched} of ${reportingMonths.length} ASPEED releases`,
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    checkDatabase(database);
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
    requests: fetched.requests,
    ...sync,
    profilesChanged: forecasts.profilesChanged,
    schedulesChanged: forecasts.schedulesChanged,
    databaseChanged:
      sync.evidenceChanged > 0 ||
      sync.reportDatesChanged > 0 ||
      sync.publicationTimestampsChanged > 0 ||
      forecasts.databaseChanged,
  };
}
