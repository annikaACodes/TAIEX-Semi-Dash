import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  aspeedArchivePageUrl,
  matchAspeedRevenueRelease,
  parseAspeedArchivePage,
  parseAspeedRevenueRelease,
  syncAspeedPublicationEvidence,
} from "../src/aspeed.mjs";

const JUNE_RELEASE = {
  success: true,
  data: {
    _id: "6a4b3c60f686eb87d3f83ce8",
    name: "ASPEED Reports June 2026 Revenue",
    type: 3,
    postTime: "2026-07-03T05:25:22.368Z",
    content:
      "<p>ASPEED Technology (TWSE: 5274) today announced its net revenue " +
      "for June 2026. The revenue for June was NT$ 1,310.195 million, an " +
      "increase of 2.19% from May 2026 and an increase of 67.47% compared " +
      "to June 2025. The total revenue for 2026 year-to-date reached NT$ " +
      "7,018.166 million, marking a 62.77% increase compared to the same " +
      "period last year.</p>",
  },
};

test("ASPEED archive URLs request English monthly releases", () => {
  const url = new URL(aspeedArchivePageUrl(2, 20));
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(url.searchParams.get("type"), "3");
  assert.equal(url.searchParams.get("sort"), "-postTime");
  assert.equal(url.searchParams.get("lang"), "en");
});

test("ASPEED archive entries preserve the official timestamp", () => {
  const parsed = parseAspeedArchivePage({
    success: true,
    data: [
      {
        _id: "6a4b3c60f686eb87d3f83ce8",
        name: "ASPEED Reports June 2026 Revenue",
        postTime: "2026-07-03T05:25:22.368Z",
      },
    ],
    pages: { hasNext: true, next: 2 },
  });
  assert.equal(parsed.hasNext, true);
  assert.equal(parsed.nextPage, 2);
  assert.deepEqual(
    {
      ticker: parsed.records[0].ticker,
      reportingMonth: parsed.records[0].reportingMonth,
      publishedAtUtc: parsed.records[0].publishedAtUtc,
      publishedDateLocal: parsed.records[0].publishedDateLocal,
      publishedTimeLocal: parsed.records[0].publishedTimeLocal,
    },
    {
      ticker: "5274",
      reportingMonth: "2026-06-01",
      publishedAtUtc: "2026-07-03T05:25:22.368Z",
      publishedDateLocal: "2026-07-03",
      publishedTimeLocal: "13:25:22",
    },
  );
});

test("ASPEED release details yield all five MOPS-comparable metrics", () => {
  const parsed = parseAspeedRevenueRelease(JUNE_RELEASE);
  assert.deepEqual(
    {
      reportingMonth: parsed.reportingMonth,
      revenueNt: parsed.revenueNt,
      momPercent: parsed.momPercent,
      yoyPercent: parsed.yoyPercent,
      cumulativeYtdRevenueNt: parsed.cumulativeYtdRevenueNt,
      ytdYoyPercent: parsed.ytdYoyPercent,
    },
    {
      reportingMonth: "2026-06-01",
      revenueNt: 1_310_195_000,
      momPercent: 2.19,
      yoyPercent: 67.47,
      cumulativeYtdRevenueNt: 7_018_166_000,
      ytdYoyPercent: 62.77,
    },
  );
});

test("ASPEED decreases are stored with negative signs", () => {
  const parsed = parseAspeedRevenueRelease({
    success: true,
    data: {
      ...JUNE_RELEASE.data,
      _id: "synthetic-decrease",
      name: "ASPEED Reports October 2025 Revenue",
      content:
        "ASPEED Technology (TPEX: 5274) today announced its net revenue for " +
        "October 2025. The revenue for October was NT$ 730.624 million, a " +
        "decrease of 10.28% from September 2025 and a decrease of 6.54% " +
        "compared to October 2024. The total revenue for 2025 year-to-date " +
        "reached NT$ 7,372.373 million, marking a 46.23% decrease compared " +
        "to the same period last year.",
    },
  });
  assert.equal(parsed.momPercent, -10.28);
  assert.equal(parsed.yoyPercent, -6.54);
  assert.equal(parsed.ytdYoyPercent, -46.23);
});

test("ASPEED year-end releases use the annual-total wording", () => {
  const parsed = parseAspeedRevenueRelease({
    success: true,
    data: {
      ...JUNE_RELEASE.data,
      _id: "year-end-wording",
      name: "ASPEED Reports December 2025 Revenue",
      content:
        "ASPEED Technology (TWSE: 5274) today announced its net revenue for " +
        "December 2025. The revenue for December was NT$872.214 million, an " +
        "increase of 3.8% from November 2025 and an increase of 18.37% " +
        "compared to December 2024. The total revenue for 2025 reached " +
        "NT$9,084.875 million, representing a 40.64% increase compared to " +
        "the same period last year.",
    },
  });
  assert.equal(parsed.cumulativeYtdRevenueNt, 9_084_875_000);
  assert.equal(parsed.ytdYoyPercent, 40.64);
});

test("ASPEED evidence must match monthly and cumulative MOPS metrics", () => {
  const release = parseAspeedRevenueRelease(JUNE_RELEASE);
  const matching = {
    observation_id: 1,
    revenueNt: 1_310_195_000,
    momPercent: 2.1854,
    yoyPercent: 67.4707,
    cumulativeYtdRevenueNt: 7_018_166_000,
    ytdYoyPercent: 62.7716,
  };
  assert.equal(
    matchAspeedRevenueRelease(release, [matching]).observation_id,
    1,
  );
  assert.equal(
    matchAspeedRevenueRelease(release, [
      { ...matching, cumulativeYtdRevenueNt: 7_000_000_000 },
    ]),
    null,
  );
});

test("ASPEED exact evidence sync is prioritized and idempotent", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "aspeed-sync-"));
  const databasePath = join(temporaryDirectory, "test.sqlite");
  await copyFile(
    new URL("../taiwan_semiconductor_companies.sqlite", import.meta.url),
    databasePath,
  );

  try {
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = ON");
    const companyId = database
      .prepare("SELECT company_id FROM companies WHERE ticker = '5274'")
      .get().company_id;
    database
      .prepare(`
        DELETE FROM company_monthly_publication_evidence
        WHERE company_id = ? AND reporting_month = '2026-06-01'
          AND evidence_basis = 'company_ir_monthly_revenue'
      `)
      .run(companyId);
    database
      .prepare(`
        DELETE FROM company_monthly_report_dates
        WHERE company_id = ? AND reporting_month = '2026-06-01'
      `)
      .run(companyId);
    database
      .prepare(`
        UPDATE company_monthly_revenue_observations
        SET publication_timestamp_utc = '2026-07-28T06:09:06.000Z',
            publication_timestamp_basis =
              'MOPS_ARCHIVE_HTTP_LAST_MODIFIED_CURRENT_VERSION'
        WHERE company_id = ? AND reporting_month = '2026-06-01'
          AND is_current = 1
      `)
      .run(companyId);

    const release = parseAspeedRevenueRelease(JUNE_RELEASE);
    const nowUtc = "2026-08-06T16:00:00.000Z";
    database.exec("BEGIN IMMEDIATE");
    const first = syncAspeedPublicationEvidence(database, [release], nowUtc);
    database.exec("COMMIT");
    assert.equal(first.matched, 1);
    assert.equal(first.rejected, 0);
    assert.equal(first.evidenceChanged, 1);
    assert.equal(first.reportDatesChanged, 1);
    assert.equal(first.publicationTimestampsChanged, 1);

    const history = database
      .prepare(`
        SELECT report_date_basis, source_priority, exact_original_timestamp
        FROM company_report_date_history
        WHERE company_id = ? AND reporting_month = '2026-06-01'
      `)
      .get(companyId);
    const observation = database
      .prepare(`
        SELECT publication_timestamp_utc, publication_timestamp_basis
        FROM company_monthly_revenue_observations
        WHERE company_id = ? AND reporting_month = '2026-06-01'
          AND is_current = 1
      `)
      .get(companyId);
    assert.deepEqual(
      {
        reportDateBasis: history.report_date_basis,
        sourcePriority: history.source_priority,
        exactOriginalTimestamp: history.exact_original_timestamp,
      },
      {
        reportDateBasis: "company_ir_monthly_revenue",
        sourcePriority: 2,
        exactOriginalTimestamp: 1,
      },
    );
    assert.equal(
      observation.publication_timestamp_utc,
      "2026-07-03T05:25:22.368Z",
    );
    assert.equal(
      observation.publication_timestamp_basis,
      "COMPANY_IR_MONTHLY_REVENUE_EXACT",
    );

    database.exec("BEGIN IMMEDIATE");
    const second = syncAspeedPublicationEvidence(database, [release], nowUtc);
    database.exec("COMMIT");
    assert.equal(second.evidenceChanged, 0);
    assert.equal(second.reportDatesChanged, 0);
    assert.equal(second.publicationTimestampsChanged, 0);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    database.close();
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
