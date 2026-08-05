import assert from "node:assert/strict";
import test from "node:test";

import {
  cnyesRevenueFeedUrl,
  matchCnyesRevenueArticle,
  parseCnyesRevenueFeed,
} from "../src/cnyes.mjs";

function payload(articleOverrides = {}) {
  return {
    statusCode: 200,
    message: "success",
    items: {
      total: 1,
      current_page: 1,
      last_page: 1,
      data: [
        {
          newsId: 6500001,
          publishAt: Date.parse("2026-07-13T06:34:55.000Z") / 1000,
          title: "Revenue flash - TSMC (2330) June revenue",
          content:
            "&lt;p&gt;\u53f0\u7a4d\u96fb(2330-TW)\u4eca\u5929\u516c\u544a2026\u5e746\u6708\u71df\u6536\u70ba\u65b0\u53f0\u5e634,426.80\u5104\u5143\uff0c\u5e74\u589e\u738767.87%\uff0c\u6708\u589e\u73876.16%\u3002&lt;/p&gt;",
          market: [{ code: "2330", name: "TSMC" }],
          ...articleOverrides,
        },
      ],
    },
  };
}

test("Cnyes revenue articles yield a ticker, month, and Taipei timestamp", () => {
  const parsed = parseCnyesRevenueFeed(payload());
  assert.equal(parsed.records.length, 1);
  assert.deepEqual(
    {
      ticker: parsed.records[0].ticker,
      reportingMonth: parsed.records[0].reportingMonth,
      publishedAtUtc: parsed.records[0].publishedAtUtc,
      publishedDateLocal: parsed.records[0].publishedDateLocal,
      publishedTimeLocal: parsed.records[0].publishedTimeLocal,
      revenueNt: parsed.records[0].revenueNt,
      momPercent: parsed.records[0].momPercent,
      yoyPercent: parsed.records[0].yoyPercent,
    },
    {
      ticker: "2330",
      reportingMonth: "2026-06-01",
      publishedAtUtc: "2026-07-13T06:34:55.000Z",
      publishedDateLocal: "2026-07-13",
      publishedTimeLocal: "14:34:55",
      revenueNt: 442_680_000_000,
      momPercent: 6.16,
      yoyPercent: 67.87,
    },
  );
});

test("rounded article figures must corroborate a stored revenue row", () => {
  const article = parseCnyesRevenueFeed(payload()).records[0];
  const matching = matchCnyesRevenueArticle(article, [
    {
      observation_id: 1,
      revenueNt: 442_679_969_000,
      momPercent: 6.1645,
      yoyPercent: 67.8668,
    },
  ]);
  assert.equal(matching.observation_id, 1);
  assert.equal(
    matchCnyesRevenueArticle(article, [
      {
        observation_id: 2,
        revenueNt: 440_000_000_000,
        momPercent: 6.1645,
        yoyPercent: 67.8668,
      },
    ]),
    null,
  );
});

test("corrections and aggregate articles are not timestamp evidence", () => {
  const correction = parseCnyesRevenueFeed(
    payload({
      content:
        "&lt;p&gt;\u53f0\u7a4d\u96fb(2330-TW)\u66f4\u6b63\u516c\u544a2026\u5e746\u6708\u71df\u6536\u70ba\u65b0\u53f0\u5e634,426.80\u5104\u5143\u3002&lt;/p&gt;",
    }),
  );
  assert.equal(correction.records.length, 0);

  const aggregate = parseCnyesRevenueFeed(
    payload({
      market: [],
      content: "&lt;p&gt;2026\u5e746\u6708\u4e0a\u5e02\u6ac3\u516c\u53f8\u71df\u6536\u4e00\u89bd&lt;/p&gt;",
    }),
  );
  assert.equal(aggregate.records.length, 0);
});

test("the category request uses a bounded epoch window", () => {
  const url = new URL(
    cnyesRevenueFeedUrl({
      startAtUtc: "2026-07-01T00:00:00.000Z",
      endAtUtc: "2026-08-01T00:00:00.000Z",
      page: 2,
    }),
  );
  assert.equal(url.pathname, "/media/api/v1/newslist/category/tw_revenue");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("limit"), "30");
  assert.equal(url.searchParams.get("startAt"), "1782864000");
  assert.equal(url.searchParams.get("endAt"), "1785542400");
});
