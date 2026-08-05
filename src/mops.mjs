import {
  parseRocDate,
  parseRocMonth,
  reportingMonth,
  taipeiDateTimeToUtc,
  utcToTaipeiParts,
} from "./dates.mjs";
import { sha256 } from "./hash.mjs";

const HEADERS = {
  reportDate: "\u51fa\u8868\u65e5\u671f",
  reportingMonth: "\u8cc7\u6599\u5e74\u6708",
  ticker: "\u516c\u53f8\u4ee3\u865f",
  companyName: "\u516c\u53f8\u540d\u7a31",
  industry: "\u7522\u696d\u5225",
  revenue: "\u71df\u696d\u6536\u5165-\u7576\u6708\u71df\u6536",
  previousMonthRevenue:
    "\u71df\u696d\u6536\u5165-\u4e0a\u6708\u71df\u6536",
  priorYearMonthRevenue:
    "\u71df\u696d\u6536\u5165-\u53bb\u5e74\u7576\u6708\u71df\u6536",
  momPercent:
    "\u71df\u696d\u6536\u5165-\u4e0a\u6708\u6bd4\u8f03\u589e\u6e1b(%)",
  yoyPercent:
    "\u71df\u696d\u6536\u5165-\u53bb\u5e74\u540c\u6708\u589e\u6e1b(%)",
  cumulativeYtdRevenue:
    "\u7d2f\u8a08\u71df\u696d\u6536\u5165-\u7576\u6708\u7d2f\u8a08\u71df\u6536",
  priorYearCumulativeYtdRevenue:
    "\u7d2f\u8a08\u71df\u696d\u6536\u5165-\u53bb\u5e74\u7d2f\u8a08\u71df\u6536",
  ytdYoyPercent:
    "\u7d2f\u8a08\u71df\u696d\u6536\u5165-\u524d\u671f\u6bd4\u8f03\u589e\u6e1b(%)",
  note: "\u5099\u8a3b",
};

export const MOPS_MARKETS = [
  { code: "sii", priority: 1 },
  { code: "otc", priority: 2 },
  { code: "rotc", priority: 3 },
  { code: "pub", priority: 4 },
];

export const MOPS_CURRENT_REPORTS_URL =
  "https://mops.twse.com.tw/mops/api/home_page/t51sb10";

const CORRECTION_PATTERN =
  /\u66f4\u6b63|\u91cd\u65b0\u516c\u544a|\u4fee\u6b63|\u91cd\u7de8|correct|restat|revis/iu;
const CURRENT_REVENUE_PATTERN =
  /\u6708(?:\u4efd)?(?:\u81ea\u7d50)?(?:\u5408\u4f75)?(?:\u71df\u6536|\u71df\u696d\u6536\u5165)|monthly\s+(?:sales|revenue|operating\s+revenue)/iu;

function normalizedFeedDate(value, fallbackDate) {
  const text = String(value ?? "").trim();
  const match = /^(\d{2,4})[\/-](\d{1,2})[\/-](\d{1,2})/.exec(text);
  if (!match) return fallbackDate;
  const rawYear = Number(match[1]);
  const year = rawYear < 1911 ? rawYear + 1911 : rawYear;
  return `${year}-${String(Number(match[2])).padStart(2, "0")}-${String(
    Number(match[3]),
  ).padStart(2, "0")}`;
}

function exactFeedTimestamp(value, fallbackDate) {
  const text = String(value ?? "").trim();
  const date = normalizedFeedDate(text, fallbackDate);
  const timeMatch = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (!timeMatch) return null;
  const time = `${String(Number(timeMatch[1])).padStart(2, "0")}:${timeMatch[2]}:${
    timeMatch[3] ?? "00"
  }`;
  const reportedAtUtc = taipeiDateTimeToUtc(date, time);
  if (!reportedAtUtc || Number.isNaN(new Date(reportedAtUtc).valueOf())) {
    return null;
  }
  return { date, time, reportedAtUtc };
}

function reportingMonthFromSubject(subject, fallback) {
  const text = String(subject ?? "");
  const chineseMatch = /(\d{2,4})\s*\u5e74\s*(\d{1,2})\s*\u6708/u.exec(text);
  if (chineseMatch) {
    const rawYear = Number(chineseMatch[1]);
    return reportingMonth(
      rawYear < 1911 ? rawYear + 1911 : rawYear,
      Number(chineseMatch[2]),
    );
  }
  const numericMatch = /\b(20\d{2})[\/-](\d{1,2})\b/.exec(text);
  return numericMatch
    ? reportingMonth(Number(numericMatch[1]), Number(numericMatch[2]))
    : fallback;
}

function absoluteMopsUrl(value) {
  if (!value) return MOPS_CURRENT_REPORTS_URL;
  try {
    return new URL(String(value), "https://mops.twse.com.tw").href;
  } catch {
    return MOPS_CURRENT_REPORTS_URL;
  }
}

export function parseMopsCurrentReports({
  payload,
  expectedReportingMonth,
  observedAtUtc,
}) {
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (Number(parsed?.code) !== 200) {
    throw new Error(
      `MOPS current reports query failed: ${parsed?.message ?? "unknown error"}`,
    );
  }
  const rows = parsed?.result?.data;
  if (!Array.isArray(rows)) {
    throw new Error("MOPS current reports response has no data array");
  }

  const observedDate = utcToTaipeiParts(observedAtUtc).date;
  const feedDate = normalizedFeedDate(parsed?.datetime, observedDate);
  const records = new Map();
  for (const row of rows) {
    const ticker = String(row?.companyId ?? "").trim();
    const subject = String(row?.subject ?? "").trim();
    if (
      !ticker ||
      !CURRENT_REVENUE_PATTERN.test(subject) ||
      CORRECTION_PATTERN.test(subject)
    ) {
      continue;
    }
    const month = reportingMonthFromSubject(subject, expectedReportingMonth);
    if (!month) continue;
    const timestamp = exactFeedTimestamp(row?.time, feedDate);
    if (!timestamp) continue;

    const record = {
      ticker,
      reportingMonth: month,
      reportedDateLocal: timestamp.date,
      reportedTimeLocal: timestamp.time,
      reportedAtUtc: timestamp.reportedAtUtc,
      sourceUrl: absoluteMopsUrl(row?.url),
      sourceSubject: subject,
    };
    const key = `${ticker}|${month}`;
    const prior = records.get(key);
    if (!prior || record.reportedAtUtc < prior.reportedAtUtc) {
      records.set(key, record);
    }
  }
  return [...records.values()].sort((left, right) =>
    left.ticker.localeCompare(right.ticker),
  );
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(text).replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((candidate) =>
    candidate.some((value) => value.trim().length > 0),
  );
}

function parseIntegerThousands(value, required = false) {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized || normalized === "-" || normalized === "--") {
    if (required) {
      throw new Error(`Missing required revenue value: ${value}`);
    }
    return null;
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid revenue value: ${value}`);
  }
  const numeric = Number(normalized) * 1000;
  if (!Number.isSafeInteger(numeric)) {
    throw new Error(`Revenue exceeds safe SQLite input range: ${value}`);
  }
  return numeric;
}

function parsePercent(value) {
  const normalized = String(value ?? "")
    .replace(/,/g, "")
    .replace(/%$/, "")
    .trim();
  if (!normalized || normalized === "-" || normalized === "--") {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid percentage value: ${value}`);
  }
  return parsed;
}

export function mopsArchiveUrl(reportingMonth, marketCode) {
  const [year, month] = reportingMonth.split("-").map(Number);
  const rocYear = year - 1911;
  return `https://mopsov.twse.com.tw/nas/t21/${marketCode}/t21sc03_${rocYear}_${month}.csv`;
}

export function parseMopsArchive({
  text,
  marketCode,
  marketPriority,
  sourceUrl,
  observedAtUtc,
  httpLastModifiedUtc = null,
}) {
  const csvRows = parseCsv(text);
  if (csvRows.length === 0) {
    throw new Error(`Empty MOPS CSV for ${marketCode}`);
  }
  const headers = csvRows[0].map((value) => value.trim());
  for (const required of [
    HEADERS.reportingMonth,
    HEADERS.ticker,
    HEADERS.revenue,
    HEADERS.cumulativeYtdRevenue,
  ]) {
    if (!headers.includes(required)) {
      throw new Error(`Missing MOPS column ${required} in ${marketCode}`);
    }
  }

  const records = csvRows.slice(1).map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = String(values[index] ?? "").trim();
    });
    return { record };
  });
  const firstRecord = records[0]?.record ?? null;
  const reportingMonthValue = firstRecord
    ? parseRocMonth(firstRecord[HEADERS.reportingMonth])
    : null;
  const sourceReportDate = firstRecord
    ? parseRocDate(firstRecord[HEADERS.reportDate])
    : utcToTaipeiParts(observedAtUtc).date;

  return {
    marketCode,
    marketPriority,
    sourceUrl,
    sourceSha256: sha256(text),
    sourceRowCount: records.length,
    sourceReportDate,
    httpLastModifiedUtc: httpLastModifiedUtc ?? observedAtUtc,
    observedAtUtc,
    reportingMonth: reportingMonthValue,
    rows: records.map(({ record }) => {
      const noteRaw = record[HEADERS.note]?.trim() ?? "";
      const stableRowIdentity = [
        record[HEADERS.reportingMonth],
        record[HEADERS.ticker],
        record[HEADERS.revenue],
        record[HEADERS.previousMonthRevenue],
        record[HEADERS.priorYearMonthRevenue],
        record[HEADERS.momPercent],
        record[HEADERS.yoyPercent],
        record[HEADERS.cumulativeYtdRevenue],
        record[HEADERS.priorYearCumulativeYtdRevenue],
        record[HEADERS.ytdYoyPercent],
        noteRaw,
      ];
      return {
        ticker: record[HEADERS.ticker],
        reportingMonth: parseRocMonth(record[HEADERS.reportingMonth]),
        sourceCompanyNameRaw: record[HEADERS.companyName],
        sourceIndustryRaw: record[HEADERS.industry],
        revenueNt: parseIntegerThousands(record[HEADERS.revenue], true),
        previousMonthRevenueNt: parseIntegerThousands(
          record[HEADERS.previousMonthRevenue],
        ),
        priorYearMonthRevenueNt: parseIntegerThousands(
          record[HEADERS.priorYearMonthRevenue],
        ),
        momPercent: parsePercent(record[HEADERS.momPercent]),
        yoyPercent: parsePercent(record[HEADERS.yoyPercent]),
        cumulativeYtdRevenueNt: parseIntegerThousands(
          record[HEADERS.cumulativeYtdRevenue],
          true,
        ),
        priorYearCumulativeYtdRevenueNt: parseIntegerThousands(
          record[HEADERS.priorYearCumulativeYtdRevenue],
        ),
        ytdYoyPercent: parsePercent(record[HEADERS.ytdYoyPercent]),
        sourceNoteRaw:
          noteRaw && noteRaw !== "-" && noteRaw !== "--" ? noteRaw : null,
        explicitCorrectionFlag: CORRECTION_PATTERN.test(noteRaw) ? 1 : 0,
        // The MOPS "table produced" date changes every day even when a
        // company's disclosed values do not. It is intentionally excluded.
        rowSha256: sha256(JSON.stringify(stableRowIdentity)),
      };
    }),
  };
}

export function selectUniverseRows(payloads, tickerSet, expectedReportingMonth) {
  const selected = new Map();
  for (const payload of [...payloads].sort(
    (a, b) => a.marketPriority - b.marketPriority,
  )) {
    for (const row of payload.rows) {
      if (
        row.reportingMonth === expectedReportingMonth &&
        tickerSet.has(row.ticker) &&
        !selected.has(row.ticker)
      ) {
        selected.set(row.ticker, { ...row, payload });
      }
    }
  }
  return [...selected.values()];
}
