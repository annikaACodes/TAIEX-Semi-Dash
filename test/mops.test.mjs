import assert from "node:assert/strict";
import test from "node:test";

import {
  parseMopsArchive,
  selectUniverseRows,
} from "../src/mops.mjs";

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

function parse(text, marketCode = "sii", marketPriority = 1) {
  return parseMopsArchive({
    text,
    marketCode,
    marketPriority,
    sourceUrl: "https://example.invalid/source.csv",
    observedAtUtc: "2026-08-01T00:00:00.000Z",
  });
}

test("a header-only current-month MOPS file is a valid empty snapshot", () => {
  const payload = parse(`${HEADER}\n`);
  assert.equal(payload.rows.length, 0);
  assert.equal(payload.reportingMonth, null);
});

test("MOPS values in thousand NT dollars become whole NT dollars", () => {
  const row = [
    "115/08/01",
    "115/7",
    "2330",
    "source company",
    "source industry",
    "442679969",
    "416975163",
    "263708978",
    "6.1645",
    "67.8668",
    "2404483690",
    "1773045533",
    "35.6131",
    "-",
  ].join(",");
  const payload = parse(`${HEADER}\n${row}\n`);
  assert.equal(payload.rows[0].reportingMonth, "2026-07-01");
  assert.equal(payload.rows[0].revenueNt, 442_679_969_000);
  assert.equal(payload.rows[0].cumulativeYtdRevenueNt, 2_404_483_690_000);
  assert.equal(payload.rows[0].sourceNoteRaw, null);
});

test("the daily table-produced date does not change row identity", () => {
  const row = [
    "115/08/01",
    "115/7",
    "2330",
    "source company",
    "source industry",
    "10",
    "9",
    "8",
    "11.11",
    "25",
    "100",
    "80",
    "25",
    "-",
  ].join(",");
  const nextDay = row.replace("115/08/01", "115/08/02");
  assert.equal(
    parse(`${HEADER}\n${row}\n`).rows[0].rowSha256,
    parse(`${HEADER}\n${nextDay}\n`).rows[0].rowSha256,
  );
});

test("market precedence selects the highest-priority official row", () => {
  const row = [
    "115/08/01",
    "115/7",
    "2330",
    "source company",
    "source industry",
    "1",
    "1",
    "1",
    "0",
    "0",
    "1",
    "1",
    "0",
    "-",
  ].join(",");
  const listed = parse(`${HEADER}\n${row}\n`, "sii", 1);
  const otc = parse(`${HEADER}\n${row}\n`, "otc", 2);
  const selected = selectUniverseRows(
    [otc, listed],
    new Set(["2330"]),
    "2026-07-01",
  );
  assert.equal(selected.length, 1);
  assert.equal(selected[0].payload.marketCode, "sii");
});
