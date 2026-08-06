import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  buildMonthlyUsdTwdRates,
  CBC_DAILY_FX_URL,
  fetchMonthlyUsdTwdRates,
  parseCbcDailyUsdTwdRates,
  syncMonthlyUsdTwdRates,
} from "../src/exchange-rate.mjs";
import { translateRevenueHistory } from "../web/app/fx-calculations.ts";

const execFileAsync = promisify(execFile);

function payload(rows) {
  return {
    meta: { last_updated: "2026-08-03" },
    data: { dataSets: rows },
  };
}

test("CBC parser extracts valid NTD/USD daily rates", () => {
  const dailyRates = parseCbcDailyUsdTwdRates(
    payload([
      ["20260702", "32.500", "unused"],
      ["invalid", "32.000"],
      ["20260701", "32.300"],
      ["20260701", "32.400"],
      ["20260703", "-"],
    ]),
  );

  assert.deepEqual(dailyRates, [
    { date: "2026-07-01", twdPerUsd: 32.4 },
    { date: "2026-07-02", twdPerUsd: 32.5 },
  ]);
});

test("CBC daily rates become arithmetic monthly averages", () => {
  const rates = buildMonthlyUsdTwdRates(
    payload([
      ["20260630", "31.000"],
      ["20260701", "32.000"],
      ["20260702", "34.000"],
    ]),
    "2026-08-03T15:00:00Z",
  );

  assert.equal(rates.length, 2);
  assert.deepEqual(rates[1], {
    rateMonth: "2026-07-01",
    baseCurrency: "USD",
    quoteCurrency: "TWD",
    averageTwdPerUsd: 33,
    dailyObservationCount: 2,
    firstObservationDate: "2026-07-01",
    lastObservationDate: "2026-07-02",
    averageMethod: "arithmetic_mean_daily_1600_interbank_spot",
    sourceName: "Central Bank of the Republic of China (Taiwan)",
    sourceUrl: CBC_DAILY_FX_URL,
    sourceLastUpdatedDate: "2026-08-03",
    retrievedAtUtc: "2026-08-03T15:00:00.000Z",
  });
});

test("historical conversion sums individually translated months and keeps growth", () => {
  const history = [
    { month: "2026-01", revenueNt: 3_200, yoyPercent: 10 },
    { month: "2026-02", revenueNt: 3_400, yoyPercent: 20 },
    { month: "2027-01", revenueNt: 3_600, yoyPercent: 30 },
  ];
  const rates = [
    {
      month: "2026-01",
      averageTwdPerUsd: 32,
      dailyObservationCount: 20,
      lastObservationDate: "2026-01-30",
    },
    {
      month: "2026-02",
      averageTwdPerUsd: 34,
      dailyObservationCount: 18,
      lastObservationDate: "2026-02-27",
    },
    {
      month: "2027-01",
      averageTwdPerUsd: 36,
      dailyObservationCount: 21,
      lastObservationDate: "2027-01-29",
    },
  ];

  const translated = translateRevenueHistory(history, rates);
  assert.deepEqual(
    translated.map((row) => ({
      month: row.month,
      revenueUsd: row.revenueUsd,
      cumulativeYtdRevenueUsd: row.cumulativeYtdRevenueUsd,
      yoyPercent: row.yoyPercent,
    })),
    [
      {
        month: "2026-01",
        revenueUsd: 100,
        cumulativeYtdRevenueUsd: 100,
        yoyPercent: 10,
      },
      {
        month: "2026-02",
        revenueUsd: 100,
        cumulativeYtdRevenueUsd: 200,
        yoyPercent: 20,
      },
      {
        month: "2027-01",
        revenueUsd: 100,
        cumulativeYtdRevenueUsd: 100,
        yoyPercent: 30,
      },
    ],
  );
});

test("monthly exchange-rate sync is idempotent and updates corrections", async () => {
  const database = new DatabaseSync(":memory:");
  const migrationSql = await readFile(
    new URL("../migrations/006_monthly_exchange_rates.sql", import.meta.url),
    "utf8",
  );
  database.exec(migrationSql);
  const rates = buildMonthlyUsdTwdRates(
    payload([
      ["20260701", "32.000"],
      ["20260702", "34.000"],
    ]),
    "2026-08-03T15:00:00Z",
  );

  assert.equal(syncMonthlyUsdTwdRates(database, rates), 1);
  assert.equal(syncMonthlyUsdTwdRates(database, rates), 0);

  const corrected = buildMonthlyUsdTwdRates(
    payload([
      ["20260701", "32.000"],
      ["20260702", "35.000"],
    ]),
    "2026-08-04T15:00:00Z",
  );
  assert.equal(syncMonthlyUsdTwdRates(database, corrected), 1);
  assert.deepEqual(
    {
      ...database
      .prepare(`
        SELECT average_twd_per_usd, daily_observation_count,
               last_observation_date
        FROM monthly_exchange_rates
      `)
      .get(),
    },
    {
      average_twd_per_usd: 33.5,
      daily_observation_count: 2,
      last_observation_date: "2026-07-02",
    },
  );
  database.close();
});

test("exchange-rate updater accepts schemas newer than migration 006", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "taiwan-fx-schema-"));
  const databasePath = join(temporaryDirectory, "companies.sqlite");
  const inputPath = join(temporaryDirectory, "rates.json");

  try {
    await copyFile(
      new URL("../taiwan_semiconductor_companies.sqlite", import.meta.url),
      databasePath,
    );
    await writeFile(
      inputPath,
      JSON.stringify(payload([["20260731", "32.292"]])),
      "utf8",
    );

    const { stdout } = await execFileAsync(process.execPath, [
      fileURLToPath(
        new URL("../scripts/update-exchange-rate.mjs", import.meta.url),
      ),
      "--database",
      databasePath,
      "--input",
      inputPath,
    ]);
    assert.match(stdout, /CBC monthly USD\/TWD rates/);

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(database.prepare("PRAGMA user_version").get().user_version, 10);
      assert.ok(
        database
          .prepare("SELECT 1 FROM monthly_exchange_rates LIMIT 1")
          .get(),
      );
    } finally {
      database.close();
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("CBC exchange-rate fetch retries and parses JSON", async () => {
  let calls = 0;
  const rates = await fetchMonthlyUsdTwdRates({
    nowUtc: "2026-08-03T15:00:00Z",
    retryDelayMs: 0,
    fetchFn: async (url) => {
      calls += 1;
      assert.equal(url, CBC_DAILY_FX_URL);
      if (calls === 1) return new Response("unavailable", { status: 503 });
      return new Response(
        JSON.stringify(payload([["20260731", "32.292"]])),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  });

  assert.equal(calls, 2);
  assert.equal(rates.at(-1).rateMonth, "2026-07-01");
  assert.equal(rates.at(-1).averageTwdPerUsd, 32.292);
});

test("CBC parser rejects a response without a plausible NTD/USD rate", () => {
  assert.throws(
    () => buildMonthlyUsdTwdRates(payload([["20260731", "-"]])),
    /no valid NTD\/USD daily rates/i,
  );
});
