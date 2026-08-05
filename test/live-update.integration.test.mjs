import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  refreshReleaseForecasts,
  runLiveUpdate,
} from "../src/live-update.mjs";

const HEADER = [
  "\u51fa\u8868\u65e5\u671f",
  "\u8cc7\u6599\u5e74\u6708",
  "\u516c\u53f8\u4ee3\u865f",
  "\u516c\u53f8\u540d\u7a31",
  "\u7522\u696d\u5225",
  "\u71df\u696d\u6536\u5165-\u7576\u6708\u71df\u6536",
  "\u71df\u696d\u6536\u5165-\u4e0a\u6708\u71df\u6536",
  "\u71df\u696d\u6536\u5165-\u53bb\u5e74\u7576\u6708\u71df\u6536",
  "\u71df\u696d\u6536\u5165-\u4e0a\u6708\u6bd4\u8f03\u589e\u6e1b(%)",
  "\u71df\u696d\u6536\u5165-\u53bb\u5e74\u540c\u6708\u589e\u6e1b(%)",
  "\u7d2f\u8a08\u71df\u696d\u6536\u5165-\u7576\u6708\u7d2f\u8a08\u71df\u6536",
  "\u7d2f\u8a08\u71df\u696d\u6536\u5165-\u53bb\u5e74\u7d2f\u8a08\u71df\u6536",
  "\u7d2f\u8a08\u71df\u696d\u6536\u5165-\u524d\u671f\u6bd4\u8f03\u589e\u6e1b(%)",
  "\u5099\u8a3b",
].join(",");

const TSMC_ROW = [
  "124/01/03",
  "123/12",
  "2330",
  "source company",
  "source industry",
  "500000000",
  "450000000",
  "400000000",
  "11.1111",
  "25",
  "5000000000",
  "4000000000",
  "25",
  "-",
].join(",");

const IR_PAYLOADS = {
  2330: `
    <var class="atc_date_start">2035-01-10 13:30:00</var>
    <var class="atc_title">TSMC Monthly Sales - December 2034</var>
  `,
  2317:
    '"Hon Hai&#8217;s Unaudited Consolidated December 2034 Revenue","2035/01/05"',
  2303: `
    <strong>December 2034, Monthly Sales Announcement</strong>
    <div class="date">1/6/2035*</div>
  `,
  2454: `
    <div class="events_calendar_item"
      data-title="Monthly Sales - December 2034"
      data-start-date="2035-01-10T17:00:00"></div>
  `,
};

const EMPTY_CURRENT_REPORTS = {
  code: 200,
  datetime: "124/01/03 08:00:00",
  result: { data: [] },
};

const TSMC_CURRENT_REPORT = {
  code: 200,
  datetime: "124/01/03 08:00:00",
  result: {
    data: [
      {
        companyId: "2330",
        time: "07:45:00",
        subject:
          "\u516c\u544a\u672c\u516c\u53f8123\u5e7412\u6708\u71df\u6536",
        url: "/mops/web/t05st10_ifrs",
      },
    ],
  },
};

test(
  "the updater stores the exact MOPS publication time and then becomes a no-op",
  { timeout: 30_000 },
  async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "taiwan-live-test-"));
    const databasePath = join(temporaryDirectory, "test.sqlite");
    const sourceDatabase = new URL(
      "../taiwan_semiconductor_companies.sqlite",
      import.meta.url,
    );
    await copyFile(sourceDatabase, databasePath);

    const mopsPayloads = Object.fromEntries(
      ["sii", "otc", "rotc", "pub"].map((market) => [
        market,
        {
          text:
            market === "sii"
              ? `${HEADER}\n${TSMC_ROW}\n`
              : `${HEADER}\n`,
          lastModified: "Wed, 03 Jan 2035 00:00:00 GMT",
        },
      ]),
    );
    const options = {
      databasePath,
      nowUtc: "2035-01-03T00:00:00.000Z",
      fetchFn: async () => {
        throw new Error("Unexpected network request in integration test");
      },
      overrides: {
        holidayPayload: "[]",
        irPayloads: IR_PAYLOADS,
        mopsPayloads,
        mopsCurrentReportsPayload: TSMC_CURRENT_REPORT,
      },
    };

    try {
      const first = await runLiveUpdate(options);
      assert.equal(first.revenueObservationsInserted, 1);
      assert.equal(first.revenueRestatementsInserted, 0);

      const database = new DatabaseSync(databasePath, { readOnly: true });
      const revenue = database
        .prepare(`
          SELECT
            r.revenue_nt,
            r.publication_timestamp,
            r.publication_timestamp_basis,
            r.release_status,
            r.actual_first_seen_at_utc
          FROM monthly_revenue_live AS r
          WHERE r.ticker = '2330' AND r.reporting_month = '2034-12-01'
        `)
        .get();
      const reportDate = database
        .prepare(`
          SELECT reported_date_local, reported_time_local, report_date_basis,
                 source_priority, source_url
          FROM company_report_date_history
          WHERE ticker = '2330' AND reporting_month = '2034-12-01'
        `)
        .get();
      const scheduleHistory = database
        .prepare(`
          SELECT history_sample_count
          FROM company_release_calendar
          WHERE ticker = '2330' AND reporting_month = '2034-12-01'
        `)
        .get();
      const maximumHistoryRows = database
        .prepare(`
          SELECT MAX(month_count) AS maximum_count
          FROM (
            SELECT company_id, COUNT(*) AS month_count
            FROM company_monthly_report_dates
            GROUP BY company_id
          )
        `)
        .get();
      database.close();
      assert.equal(revenue.revenue_nt, 500_000_000_000);
      assert.equal(revenue.publication_timestamp, "2035-01-02T23:45:00.000Z");
      assert.equal(
        revenue.publication_timestamp_basis,
        "MOPS_CURRENT_REPORT_FEED_EXACT",
      );
      assert.equal(revenue.release_status, "reported");
      assert.equal(
        revenue.actual_first_seen_at_utc,
        "2035-01-02T23:45:00.000Z",
      );
      assert.equal(reportDate.reported_date_local, "2035-01-03");
      assert.equal(reportDate.reported_time_local, "07:45:00");
      assert.equal(reportDate.report_date_basis, "mops_current_feed");
      assert.equal(reportDate.source_priority, 1);
      assert.equal(
        reportDate.source_url,
        "https://mops.twse.com.tw/mops/web/t05st10_ifrs",
      );
      assert.equal(scheduleHistory.history_sample_count, 11);
      assert.ok(maximumHistoryRows.maximum_count <= 12);

      const second = await runLiveUpdate(options);
      assert.equal(second.databaseChanged, false);
      assert.equal(second.revenueObservationsInserted, 0);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  },
);

test(
  "IR fallbacks recover and migrate a calendar URL without duplicate sources",
  { timeout: 30_000 },
  async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "taiwan-ir-test-"));
    const databasePath = join(temporaryDirectory, "test.sqlite");
    await copyFile(
      new URL("../taiwan_semiconductor_companies.sqlite", import.meta.url),
      databasePath,
    );

    const database = new DatabaseSync(databasePath);
    database
      .prepare(`
        UPDATE company_reporting_sources
        SET source_url = 'https://www.umc.com/en/IR/ir_overview',
            last_error_at_utc = '2035-01-02T00:00:00.000Z',
            last_error_message = 'HTTP 403 Forbidden'
        WHERE company_id = (SELECT company_id FROM companies WHERE ticker = '2303')
          AND parser_name = 'umc'
      `)
      .run();
    database.close();

    const mopsPayloads = Object.fromEntries(
      ["sii", "otc", "rotc", "pub"].map((market) => [
        market,
        {
          text:
            market === "sii"
              ? `${HEADER}\n${TSMC_ROW}\n`
              : `${HEADER}\n`,
          lastModified: "Wed, 03 Jan 2035 00:00:00 GMT",
        },
      ]),
    );
    const requested = [];

    try {
      const result = await runLiveUpdate({
        databasePath,
        nowUtc: "2035-01-03T00:00:00.000Z",
        fetchFn: async (url, init) => {
          requested.push({ url, headers: init.headers });
          if (url.endsWith("/english/financial-calendar")) {
            return new Response(null, {
              status: 403,
              statusText: "Forbidden",
            });
          }
          if (url.endsWith("/japanese/financial-calendar")) {
            return new Response(IR_PAYLOADS[2330], { status: 200 });
          }
          throw new Error(`Unexpected URL: ${url}`);
        },
        overrides: {
          holidayPayload: "[]",
          irPayloads: {
            2317: IR_PAYLOADS[2317],
            2303: `
              <div>Monthly Sales Announcement - 2034</div>
              <div class="inner">December：1/6/2035(Sat)*</div>
              <div>Quarterly Earnings Release</div>
            `,
            2454: IR_PAYLOADS[2454],
          },
          mopsPayloads,
          mopsCurrentReportsPayload: EMPTY_CURRENT_REPORTS,
        },
      });

      assert.deepEqual(
        requested.map(({ url }) => url),
        [
          "https://investor.tsmc.com/english/financial-calendar",
          "https://investor.tsmc.com/japanese/financial-calendar",
        ],
      );
      assert.match(requested[0].headers["User-Agent"], /^Mozilla\/5\.0/);
      assert.equal(requested[0].headers["Accept-Language"], "en-US,en;q=0.9");
      assert.equal(result.errors.length, 0);

      const updated = new DatabaseSync(databasePath, { readOnly: true });
      const umcSources = updated
        .prepare(`
          SELECT s.source_url, s.last_error_message, s.last_success_at_utc
          FROM company_reporting_sources AS s
          JOIN companies AS c ON c.company_id = s.company_id
          WHERE c.ticker = '2303' AND s.parser_name = 'umc'
        `)
        .all();
      updated.close();

      assert.equal(umcSources.length, 1);
      assert.equal(
        umcSources[0].source_url,
        "https://www.umc.com/en/IR_Event/ir_events",
      );
      assert.equal(umcSources[0].last_error_message, null);
      assert.equal(umcSources[0].last_success_at_utc, "2035-01-03T00:00:00.000Z");
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  },
);

test(
  "access-denied IR calendars fall back to the historical schedule without errors",
  { timeout: 30_000 },
  async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "taiwan-ir-access-test-"),
    );
    const databasePath = join(temporaryDirectory, "test.sqlite");
    await copyFile(
      new URL("../taiwan_semiconductor_companies.sqlite", import.meta.url),
      databasePath,
    );

    const mopsPayloads = Object.fromEntries(
      ["sii", "otc", "rotc", "pub"].map((market) => [
        market,
        {
          text: `${HEADER}\n`,
          lastModified: "Wed, 03 Jan 2035 00:00:00 GMT",
        },
      ]),
    );
    const requested = [];

    try {
      const result = await runLiveUpdate({
        databasePath,
        nowUtc: "2035-01-03T00:00:00.000Z",
        fetchFn: async (url) => {
          requested.push(url);
          if (url.startsWith("https://investor.tsmc.com/")) {
            return new Response(null, {
              status: 403,
              statusText: "Forbidden",
            });
          }
          throw new Error(`Unexpected URL: ${url}`);
        },
        overrides: {
          holidayPayload: "[]",
          irPayloads: {
            2317: IR_PAYLOADS[2317],
            2303: IR_PAYLOADS[2303],
            2454: IR_PAYLOADS[2454],
          },
          mopsPayloads,
          mopsCurrentReportsPayload: EMPTY_CURRENT_REPORTS,
        },
      });

      assert.deepEqual(requested, [
        "https://investor.tsmc.com/english/financial-calendar",
        "https://investor.tsmc.com/japanese/financial-calendar",
        "https://investor.tsmc.com/schinese/financial-calendar",
      ]);
      assert.equal(result.errors.length, 0);

      const updated = new DatabaseSync(databasePath, { readOnly: true });
      const source = updated
        .prepare(`
          SELECT s.last_error_at_utc, s.last_error_message
          FROM company_reporting_sources AS s
          JOIN companies AS c ON c.company_id = s.company_id
          WHERE c.ticker = '2330' AND s.parser_name = 'tsmc'
        `)
        .get();
      const schedule = updated
        .prepare(`
          SELECT s.schedule_source, s.announced_release_date_local
          FROM monthly_release_schedule AS s
          JOIN companies AS c ON c.company_id = s.company_id
          WHERE c.ticker = '2330' AND s.reporting_month = '2034-12-01'
        `)
        .get();
      updated.close();

      assert.equal(source.last_error_at_utc, null);
      assert.equal(source.last_error_message, null);
      assert.equal(schedule.schedule_source, "company_history");
      assert.equal(schedule.announced_release_date_local, null);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  },
);

test("IR parser failures remain visible instead of using historical fallback", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "taiwan-ir-parser-test-"),
  );
  const databasePath = join(temporaryDirectory, "test.sqlite");
  await copyFile(
    new URL("../taiwan_semiconductor_companies.sqlite", import.meta.url),
    databasePath,
  );

  try {
    const result = await runLiveUpdate({
      databasePath,
      nowUtc: "2035-01-03T00:00:00.000Z",
      fetchFn: async (url) => {
        if (url.startsWith("https://investor.tsmc.com/")) {
          return new Response("<html><title>Financial Calendar</title></html>", {
            status: 200,
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      overrides: {
        holidayPayload: "[]",
        irPayloads: {
          2317: IR_PAYLOADS[2317],
          2303: IR_PAYLOADS[2303],
          2454: IR_PAYLOADS[2454],
        },
        mopsPayloads: Object.fromEntries(
          ["sii", "otc", "rotc", "pub"].map((market) => [
            market,
            {
              text:
                market === "sii"
                  ? `${HEADER}\n${TSMC_ROW}\n`
                  : `${HEADER}\n`,
              lastModified: "Wed, 03 Jan 2035 00:00:00 GMT",
            },
          ]),
        ),
        mopsCurrentReportsPayload: EMPTY_CURRENT_REPORTS,
      },
    });

    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /found no monthly revenue events/i);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("temporary all-market MOPS redirects defer without changing data", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "taiwan-live-defer-"));
  const databasePath = join(temporaryDirectory, "test.sqlite");
  await copyFile(
    new URL("../taiwan_semiconductor_companies.sqlite", import.meta.url),
    databasePath,
  );

  try {
    const before = new DatabaseSync(databasePath, { readOnly: true });
    const runCountBefore = before
      .prepare("SELECT COUNT(*) AS count FROM live_ingestion_runs")
      .get().count;
    before.close();

    let requestCount = 0;
    const result = await runLiveUpdate({
      databasePath,
      nowUtc: "2026-08-04T16:28:53.000Z",
      mopsRetryDelaysMs: [0, 0],
      fetchFn: async () => {
        requestCount += 1;
        return new Response(null, {
          status: 307,
          statusText: "Temporary Redirect",
        });
      },
      overrides: {
        holidayPayload: "[]",
        irPayloads: IR_PAYLOADS,
        mopsCurrentReportsPayload: EMPTY_CURRENT_REPORTS,
      },
    });

    const after = new DatabaseSync(databasePath, { readOnly: true });
    const runCountAfter = after
      .prepare("SELECT COUNT(*) AS count FROM live_ingestion_runs")
      .get().count;
    const integrity = after.prepare("PRAGMA integrity_check").get().integrity_check;
    after.close();

    assert.equal(requestCount, 12);
    assert.equal(result.deferred, true);
    assert.equal(result.databaseChanged, result.migrationApplied);
    assert.equal(result.revenueObservationsInserted, 0);
    assert.equal(result.errors.length, 4);
    assert.match(result.deferredReason, /temporarily unavailable/i);
    assert.equal(runCountAfter, runCountBefore);
    assert.equal(integrity, "ok");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("non-retryable all-market MOPS failures still fail loudly", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "taiwan-live-fail-"));
  const databasePath = join(temporaryDirectory, "test.sqlite");
  await copyFile(
    new URL("../taiwan_semiconductor_companies.sqlite", import.meta.url),
    databasePath,
  );

  try {
    await assert.rejects(
      runLiveUpdate({
        databasePath,
        nowUtc: "2026-08-04T16:28:53.000Z",
        mopsRetryDelaysMs: [0, 0],
        fetchFn: async () =>
          new Response(null, { status: 404, statusText: "Not Found" }),
        overrides: {
          holidayPayload: "[]",
          irPayloads: IR_PAYLOADS,
          mopsCurrentReportsPayload: EMPTY_CURRENT_REPORTS,
        },
      }),
      /Every MOPS market request failed:.*HTTP 404 Not Found/,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("migrations reach version 9 and promote exact announcement timestamps", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "taiwan-v5-test-"));
  const databasePath = join(temporaryDirectory, "test.sqlite");
  const sourceDatabase = new URL(
    "../taiwan_semiconductor_companies.sqlite",
    import.meta.url,
  );
  await copyFile(sourceDatabase, databasePath);

  try {
    const versionFour = new DatabaseSync(databasePath);
    versionFour.exec(`
      DROP VIEW IF EXISTS monthly_usd_twd_exchange_rates;
      DROP TABLE IF EXISTS monthly_exchange_rates;
      DROP TRIGGER IF EXISTS trim_company_monthly_publication_evidence_after_insert;
      DROP TABLE IF EXISTS company_monthly_publication_evidence;
      UPDATE monthly_release_schedule
      SET actual_first_seen_at_utc = NULL,
          actual_first_seen_date_local = NULL,
          actual_first_seen_time_local = NULL;
      DROP VIEW company_report_date_history;
      DROP TRIGGER trim_company_monthly_report_dates_after_insert;
      DROP TABLE company_monthly_report_dates;
      PRAGMA user_version = 4;
    `);
    versionFour.close();

    const result = await refreshReleaseForecasts({
      databasePath,
      nowUtc: "2026-08-03T13:30:00.000Z",
    });
    assert.equal(result.migrationApplied, true);
    assert.equal(result.databaseVersion, 9);

    const database = new DatabaseSync(databasePath, { readOnly: true });
    const mopsSeeds = database
      .prepare(`
        SELECT COUNT(*) AS row_count,
               COUNT(DISTINCT company_id) AS company_count
        FROM company_monthly_report_dates
        WHERE report_date_basis = 'mops_revenue_announcement'
      `)
      .get();
    const tsmc = database
      .prepare(`
        SELECT COUNT(*) AS row_count
        FROM company_monthly_report_dates AS d
        JOIN companies AS c ON c.company_id = d.company_id
        WHERE c.ticker = '2330'
          AND d.report_date_basis = 'mops_revenue_announcement'
      `)
      .get();
    const correctionOnlyCompany = database
      .prepare(`
        SELECT COUNT(*) AS row_count
        FROM company_monthly_report_dates AS d
        JOIN companies AS c ON c.company_id = d.company_id
        WHERE c.ticker = '2392'
      `)
      .get();
    const maximumHistoryRows = database
      .prepare(`
        SELECT MAX(month_count) AS maximum_count
        FROM (
          SELECT company_id, COUNT(*) AS month_count
          FROM company_monthly_report_dates
          GROUP BY company_id
        )
      `)
      .get();
    const exchangeRateTable = database
      .prepare(`
        SELECT COUNT(*) AS row_count
        FROM sqlite_master
        WHERE type = 'table' AND name = 'monthly_exchange_rates'
      `)
      .get();
    const evidenceTrigger = database
      .prepare(`
        SELECT COUNT(*) AS row_count
        FROM sqlite_master
        WHERE type = 'trigger'
          AND name = 'trim_company_monthly_publication_evidence_after_insert'
      `)
      .get();
    const exactPublicationTimestamps = database
      .prepare(`
        SELECT COUNT(*) AS row_count
        FROM company_monthly_revenue_observations
        WHERE is_current = 1
          AND publication_timestamp_basis = 'MOPS_MATERIAL_ANNOUNCEMENT_EXACT'
      `)
      .get();
    const sourcePriorities = database
      .prepare(`
        SELECT report_date_basis, MIN(source_priority) AS source_priority
        FROM company_monthly_report_dates
        GROUP BY report_date_basis
      `)
      .all();
    database.close();

    assert.equal(mopsSeeds.row_count, 197);
    assert.equal(mopsSeeds.company_count, 17);
    assert.equal(tsmc.row_count, 12);
    assert.equal(correctionOnlyCompany.row_count, 0);
    assert.equal(maximumHistoryRows.maximum_count, 12);
    assert.equal(exchangeRateTable.row_count, 1);
    assert.equal(evidenceTrigger.row_count, 1);
    assert.ok(exactPublicationTimestamps.row_count >= 197);
    assert.equal(
      sourcePriorities.find(
        (row) => row.report_date_basis === "mops_revenue_announcement",
      ).source_priority,
      1,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
