import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { addMonths } from "../src/dates.mjs";
import { refreshReleaseForecasts } from "../src/live-update.mjs";
import {
  syncCnyesPublicationEvidence,
  syncMoneydjPublicationEvidence,
} from "../src/publication-evidence.mjs";

test("a corroborated web timestamp is stored as a proxy and is idempotent", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "taiwan-web-evidence-"));
  const databasePath = join(temporaryDirectory, "test.sqlite");
  await copyFile(
    new URL("../taiwan_semiconductor_companies.sqlite", import.meta.url),
    databasePath,
  );

  try {
    await refreshReleaseForecasts({
      databasePath,
      nowUtc: "2026-08-05T12:00:00.000Z",
    });
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = ON");
    const candidate = database
      .prepare(`
        SELECT
          o.observation_id,
          o.company_id,
          c.ticker,
          o.reporting_month,
          o.revenue_nt,
          o.mom_percent,
          o.yoy_percent
        FROM company_monthly_revenue_observations AS o
        JOIN companies AS c ON c.company_id = o.company_id
        LEFT JOIN company_monthly_report_dates AS d
          ON d.company_id = o.company_id
         AND d.reporting_month = o.reporting_month
        WHERE o.is_current = 1
          AND o.reporting_month >= '2025-08-01'
          AND o.publication_timestamp_basis =
            'MOPS_ARCHIVE_HTTP_LAST_MODIFIED_CURRENT_VERSION'
          AND d.company_id IS NULL
        ORDER BY o.reporting_month DESC, o.company_id
        LIMIT 1
      `)
      .get();
    assert.ok(candidate);
    const releaseMonth = addMonths(candidate.reporting_month, 1);
    const article = {
      ticker: candidate.ticker,
      reportingMonth: candidate.reporting_month,
      publishedAtUtc: `${releaseMonth.slice(0, 7)}-05T04:30:00.000Z`,
      publishedDateLocal: `${releaseMonth.slice(0, 7)}-05`,
      publishedTimeLocal: "12:30:00",
      sourceRecordId: "test-article-1",
      sourceUrl: "https://news.cnyes.com/news/id/test-article-1",
      sourceTitle: "Corroborated monthly revenue",
      revenueNt: Number(candidate.revenue_nt),
      revenueToleranceNt: 1,
      momPercent: candidate.mom_percent,
      yoyPercent: candidate.yoy_percent,
    };

    database.exec("BEGIN IMMEDIATE");
    const first = syncCnyesPublicationEvidence(
      database,
      [article],
      "2026-08-05T12:00:00.000Z",
    );
    database.exec("COMMIT");
    assert.equal(first.matched, 1);
    assert.equal(first.evidenceChanged, 1);
    assert.equal(first.reportDatesChanged, 1);
    assert.equal(first.publicationTimestampsChanged, 1);

    const history = database
      .prepare(`
        SELECT report_date_basis, source_priority, source_url,
               exact_original_timestamp
        FROM company_report_date_history
        WHERE company_id = ? AND reporting_month = ?
      `)
      .get(candidate.company_id, candidate.reporting_month);
    const observation = database
      .prepare(`
        SELECT publication_timestamp_utc, publication_timestamp_basis
        FROM company_monthly_revenue_observations
        WHERE observation_id = ?
      `)
      .get(candidate.observation_id);
    assert.equal(history.report_date_basis, "cnyes_revenue_news");
    assert.equal(history.source_priority, 4);
    assert.equal(history.exact_original_timestamp, 0);
    assert.equal(
      observation.publication_timestamp_basis,
      "CNYES_PUBLICATION_CORROBORATED_PROXY",
    );

    database.exec("BEGIN IMMEDIATE");
    const second = syncCnyesPublicationEvidence(
      database,
      [article],
      "2026-08-05T12:05:00.000Z",
    );
    database.exec("COMMIT");
    assert.equal(second.evidenceChanged, 0);
    assert.equal(second.reportDatesChanged, 0);
    assert.equal(second.publicationTimestampsChanged, 0);
    database.close();
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("the earliest corroborated public proxy wins across providers", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "taiwan-proxy-order-"));
  const databasePath = join(temporaryDirectory, "test.sqlite");
  await copyFile(
    new URL("../taiwan_semiconductor_companies.sqlite", import.meta.url),
    databasePath,
  );

  try {
    await refreshReleaseForecasts({
      databasePath,
      nowUtc: "2026-08-05T12:00:00.000Z",
    });
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = ON");
    const candidate = database
      .prepare(`
        SELECT
          o.observation_id,
          o.company_id,
          c.ticker,
          o.reporting_month,
          o.revenue_nt,
          o.mom_percent,
          o.yoy_percent
        FROM company_monthly_revenue_observations AS o
        JOIN companies AS c ON c.company_id = o.company_id
        LEFT JOIN company_monthly_report_dates AS d
          ON d.company_id = o.company_id
         AND d.reporting_month = o.reporting_month
        WHERE o.is_current = 1
          AND o.reporting_month >= '2025-08-01'
          AND o.publication_timestamp_basis =
            'MOPS_ARCHIVE_HTTP_LAST_MODIFIED_CURRENT_VERSION'
          AND d.company_id IS NULL
        ORDER BY o.reporting_month DESC, o.company_id
        LIMIT 1
      `)
      .get();
    assert.ok(candidate);
    const releaseMonth = addMonths(candidate.reporting_month, 1);
    const common = {
      ticker: candidate.ticker,
      reportingMonth: candidate.reporting_month,
      publishedDateLocal: `${releaseMonth.slice(0, 7)}-05`,
      revenueNt: Number(candidate.revenue_nt),
      revenueToleranceNt: 1,
      momPercent: candidate.mom_percent,
      yoyPercent: candidate.yoy_percent,
    };
    const moneydj = {
      ...common,
      publishedAtUtc: `${releaseMonth.slice(0, 7)}-05T04:20:00.000Z`,
      publishedTimeLocal: "12:20:00",
      sourceRecordId: "moneydj-test-1",
      sourceUrl:
        "https://www.moneydj.com/kmdj/news/newsviewer.aspx?a=moneydj-test-1",
      sourceTitle: "Corroborated monthly revenue",
    };
    const cnyes = {
      ...common,
      publishedAtUtc: `${releaseMonth.slice(0, 7)}-05T04:30:00.000Z`,
      publishedTimeLocal: "12:30:00",
      sourceRecordId: "cnyes-test-2",
      sourceUrl: "https://news.cnyes.com/news/id/cnyes-test-2",
      sourceTitle: "Later corroborated monthly revenue",
    };

    database.exec("BEGIN IMMEDIATE");
    syncMoneydjPublicationEvidence(
      database,
      [moneydj],
      "2026-08-05T12:00:00.000Z",
    );
    syncCnyesPublicationEvidence(
      database,
      [cnyes],
      "2026-08-05T12:00:00.000Z",
    );
    database.exec("COMMIT");

    const history = database
      .prepare(`
        SELECT reported_at_utc, report_date_basis
        FROM company_monthly_report_dates
        WHERE company_id = ? AND reporting_month = ?
      `)
      .get(candidate.company_id, candidate.reporting_month);
    const observation = database
      .prepare(`
        SELECT publication_timestamp_utc, publication_timestamp_basis
        FROM company_monthly_revenue_observations
        WHERE observation_id = ?
      `)
      .get(candidate.observation_id);
    assert.equal(history.reported_at_utc, moneydj.publishedAtUtc);
    assert.equal(history.report_date_basis, "moneydj_revenue_news");
    assert.equal(observation.publication_timestamp_utc, moneydj.publishedAtUtc);
    assert.equal(
      observation.publication_timestamp_basis,
      "MONEYDJ_PUBLICATION_CORROBORATED_PROXY",
    );
    database.close();
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
