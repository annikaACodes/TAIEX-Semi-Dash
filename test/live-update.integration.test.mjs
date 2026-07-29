import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { runLiveUpdate } from "../src/live-update.mjs";

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

test(
  "the updater records first-seen revenue once and then becomes a no-op",
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
      database.close();
      assert.equal(revenue.revenue_nt, 500_000_000_000);
      assert.equal(revenue.publication_timestamp, options.nowUtc);
      assert.equal(
        revenue.publication_timestamp_basis,
        "MOPS_ARCHIVE_FIRST_OBSERVED",
      );
      assert.equal(revenue.release_status, "reported");
      assert.equal(revenue.actual_first_seen_at_utc, options.nowUtc);

      const second = await runLiveUpdate(options);
      assert.equal(second.databaseChanged, false);
      assert.equal(second.revenueObservationsInserted, 0);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  },
);
