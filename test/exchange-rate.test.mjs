import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchLatestUsdTwdRate,
  isExchangeRateRecord,
  selectLatestUsdTwdRate,
  TAIFEX_DAILY_FX_URL,
} from "../src/exchange-rate.mjs";

test("TAIFEX parser selects the latest valid USD/NTD business-day rate", () => {
  const result = selectLatestUsdTwdRate(
    [
      { Date: "20260731", "USD/NTD": "32.292" },
      { Date: "invalid", "USD/NTD": "500" },
      { Date: "20260730", "USD/NTD": "32.454" },
    ],
    "2026-08-03T14:30:00Z",
  );

  assert.deepEqual(result, {
    baseCurrency: "USD",
    quoteCurrency: "TWD",
    twdPerUsd: 32.292,
    rateDate: "2026-07-31",
    retrievedAtUtc: "2026-08-03T14:30:00.000Z",
    sourceName: "Taiwan Futures Exchange (TAIFEX)",
    sourceUrl: TAIFEX_DAILY_FX_URL,
  });
  assert.equal(isExchangeRateRecord(result), true);
});

test("TAIFEX parser rejects a response without a plausible USD/NTD rate", () => {
  assert.throws(
    () => selectLatestUsdTwdRate([{ Date: "20260731", "USD/NTD": "-" }]),
    /no valid USD\/NTD daily rate/i,
  );
});

test("exchange-rate fetch retries and parses octet-stream JSON responses", async () => {
  let calls = 0;
  const result = await fetchLatestUsdTwdRate({
    nowUtc: "2026-08-03T14:30:00Z",
    retryDelayMs: 0,
    fetchFn: async (url) => {
      calls += 1;
      assert.equal(url, TAIFEX_DAILY_FX_URL);
      if (calls === 1) return new Response("unavailable", { status: 503 });
      return new Response(
        JSON.stringify([{ Date: "20260731", "USD/NTD": "32.292" }]),
        { headers: { "Content-Type": "application/octet-stream" } },
      );
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.twdPerUsd, 32.292);
  assert.equal(result.rateDate, "2026-07-31");
});
