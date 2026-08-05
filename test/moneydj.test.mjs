import assert from "node:assert/strict";
import test from "node:test";

import {
  assignMoneydjTickers,
  matchMoneydjRevenueArticle,
  moneydjSearchUrl,
  normalizeMoneydjCompanyName,
  parseMoneydjSearchPage,
} from "../src/moneydj.mjs";

function row({
  id = "d81d6a39-e2ea-4613-9f83-2717b4dff5ec",
  title = "\u8302\u8fea 115\u5e746\u6708\u71df\u65363.08\u5104\u3001\u5e74\u589e65.82%",
  timestamp = "2026-07-07   15:39:04",
} = {}) {
  return `<tr bgcolor="White"><td><a href="../news/newsviewer.aspx?a=${id}">${title}</a></td><td align="center" width="100">${timestamp}</td></tr>`;
}

test("MoneyDJ search rows yield company, month, metrics, and Taipei time", () => {
  const parsed = parseMoneydjSearchPage(`${row()}<a href="?index1=2&amp;x=1">2</a>`);
  assert.equal(parsed.lastPage, 2);
  assert.deepEqual(
    {
      companyNameRaw: parsed.records[0].companyNameRaw,
      reportingMonth: parsed.records[0].reportingMonth,
      publishedAtUtc: parsed.records[0].publishedAtUtc,
      revenueNt: parsed.records[0].revenueNt,
      yoyPercent: parsed.records[0].yoyPercent,
    },
    {
      companyNameRaw: "\u8302\u8fea",
      reportingMonth: "2026-06-01",
      publishedAtUtc: "2026-07-07T07:39:04.000Z",
      revenueNt: 308_000_000,
      yoyPercent: 65.82,
    },
  );
});

test("MoneyDJ corrections are excluded", () => {
  const parsed = parseMoneydjSearchPage(
    row({
      title:
        "\u8302\u8fea 115\u5e746\u6708\u71df\u6536\u66f4\u6b63\u516c\u544a",
    }),
  );
  assert.equal(parsed.records.length, 0);
});

test("MoneyDJ names map to MOPS tickers before metric validation", () => {
  const article = parseMoneydjSearchPage(row()).records[0];
  const mapped = assignMoneydjTickers(
    [article],
    new Map([[normalizeMoneydjCompanyName("\u8302\u8fea"), "6244"]]),
  );
  assert.equal(mapped[0].ticker, "6244");
  assert.equal(
    matchMoneydjRevenueArticle(mapped[0], [
      {
        observation_id: 1,
        revenueNt: 307_848_000,
        yoyPercent: 65.82,
      },
    ]).observation_id,
    1,
  );
  assert.equal(
    matchMoneydjRevenueArticle(mapped[0], [
      {
        observation_id: 2,
        revenueNt: 300_000_000,
        yoyPercent: 65.82,
      },
    ]),
    null,
  );
});

test("MoneyDJ requests are bounded to the following release month", () => {
  const url = new URL(
    moneydjSearchUrl({
      reportingMonth: "2026-06-01",
      page: 3,
      startDateLocal: "2026/07/05",
      endDateLocal: "2026/07/07",
    }),
  );
  assert.equal(url.searchParams.get("_Query_"), "115\u5e746\u6708\u71df\u6536");
  assert.equal(url.searchParams.get("last"), "2026/07/05");
  assert.equal(url.searchParams.get("end"), "2026/07/07");
  assert.equal(url.searchParams.get("index1"), "3");
});
