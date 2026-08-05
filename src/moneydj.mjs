import {
  parseReportingMonth,
  reportingMonth,
  taipeiDateTimeToUtc,
} from "./dates.mjs";

export const MONEYDJ_SEARCH_URL =
  "https://www.moneydj.com/kmdj/search/list.aspx";

const CORRECTION_PATTERN =
  /\u66f4\u6b63|\u91cd\u7de8|\u4fee\u6b63|correct|restat/iu;
const TITLE_PATTERN =
  /^(.+?)\s+(\d{2,3})\u5e74(\d{1,2})\u6708(?:\u5408\u4f75)?\u71df\u6536(?:\u70ba)?\s*([\d,.]+)\s*(\u5146|\u5104|\u842c)?(?:\u5143)?(?:\u3001\u5e74(\u589e|\u6e1b)([\d.]+)%?)?\s*$/iu;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function parseRevenue(amountText, unit) {
  const normalized = amountText.replace(/,/gu, "");
  const amount = Number(normalized);
  const scale = {
    "\u5146": 1_000_000_000_000,
    "\u5104": 100_000_000,
    "\u842c": 10_000,
  }[unit] ?? 1;
  if (!Number.isFinite(amount)) return null;
  const decimalPlaces = normalized.includes(".")
    ? normalized.split(".")[1].length
    : 0;
  const revenueNt = Math.round(amount * scale);
  const toleranceNt = Math.max(
    1,
    Math.ceil(0.5 * scale * 10 ** -decimalPlaces) + 1,
  );
  if (!Number.isSafeInteger(revenueNt)) return null;
  return { revenueNt, toleranceNt };
}

function lastDateOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function moneydjSearchUrl({
  reportingMonth: month,
  page = 1,
  startDateLocal = null,
  endDateLocal = null,
}) {
  const { year, month: monthNumber } = parseReportingMonth(month);
  const releaseMonthDate = new Date(Date.UTC(year, monthNumber, 1));
  const releaseYear = releaseMonthDate.getUTCFullYear();
  const releaseMonth = releaseMonthDate.getUTCMonth() + 1;
  const startDate = `${releaseYear}/${String(releaseMonth).padStart(2, "0")}/01`;
  const naturalEnd = `${releaseYear}/${String(releaseMonth).padStart(2, "0")}/${String(
    lastDateOfMonth(releaseYear, releaseMonth),
  ).padStart(2, "0")}`;
  const query = `${year - 1911}\u5e74${monthNumber}\u6708\u71df\u6536`;
  return moneydjQueryUrl({
    query,
    page,
    startDateLocal: startDateLocal ?? startDate,
    endDateLocal: endDateLocal ?? naturalEnd,
  });
}

export function moneydjQueryUrl({
  query,
  page = 1,
  startDateLocal,
  endDateLocal,
}) {
  const url = new URL(MONEYDJ_SEARCH_URL);
  url.searchParams.set("_Query_", query);
  url.searchParams.set("_QueryType_", "NW");
  url.searchParams.set("last", startDateLocal);
  url.searchParams.set("end", endDateLocal);
  url.searchParams.set("count", "300");
  url.searchParams.set("index1", String(page));
  return url.href;
}

export function parseMoneydjSearchPage(html) {
  const records = [];
  const rowPattern =
    /<tr[^>]*>\s*<td>\s*<a[^>]+href="(?:\.\.\/|\/kmdj\/)?news\/newsviewer\.aspx\?a=([0-9a-f-]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*>(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})<\/td>\s*<\/tr>/giu;
  for (const match of html.matchAll(rowPattern)) {
    const sourceRecordId = match[1].toLowerCase();
    const sourceTitle = decodeHtml(match[2]);
    if (CORRECTION_PATTERN.test(sourceTitle)) continue;
    const title = TITLE_PATTERN.exec(sourceTitle);
    if (!title) continue;
    const rawYear = Number(title[2]);
    const year = rawYear + 1911;
    const month = Number(title[3]);
    if (year < 2000 || year > 2100 || month < 1 || month > 12) continue;
    const revenue = parseRevenue(title[4], title[5]);
    if (!revenue) continue;
    const publishedDateLocal = match[3];
    const publishedTimeLocal = match[4];
    records.push({
      companyNameRaw: title[1].trim(),
      ticker: null,
      reportingMonth: reportingMonth(year, month),
      publishedAtUtc: taipeiDateTimeToUtc(
        publishedDateLocal,
        publishedTimeLocal,
      ),
      publishedDateLocal,
      publishedTimeLocal,
      sourceRecordId,
      sourceUrl: `https://www.moneydj.com/kmdj/news/newsviewer.aspx?a=${sourceRecordId}`,
      sourceTitle,
      revenueNt: revenue.revenueNt,
      revenueToleranceNt: revenue.toleranceNt,
      momPercent: null,
      yoyPercent:
        title[6] && title[7]
          ? Number(title[7]) * (title[6] === "\u6e1b" ? -1 : 1)
          : null,
    });
  }

  const pageNumbers = [...html.matchAll(/(?:\?|&amp;|&)index1=(\d+)/giu)].map(
    (match) => Number(match[1]),
  );
  return {
    records,
    lastPage: Math.max(1, ...pageNumbers),
  };
}

export function normalizeMoneydjCompanyName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .toLocaleLowerCase("zh-Hant");
}

export function assignMoneydjTickers(records, tickerByCompanyName) {
  return records
    .map((record) => ({
      ...record,
      ticker:
        tickerByCompanyName.get(
          normalizeMoneydjCompanyName(record.companyNameRaw),
        ) ?? null,
    }))
    .filter((record) => record.ticker !== null);
}

export function matchMoneydjRevenueArticle(article, observations) {
  return (
    observations.find(
      (observation) =>
        Math.abs(Number(observation.revenueNt) - article.revenueNt) <=
          article.revenueToleranceNt &&
        (article.yoyPercent === null ||
          observation.yoyPercent === null ||
          observation.yoyPercent === undefined ||
          Math.abs(Number(observation.yoyPercent) - article.yoyPercent) <= 0.06),
    ) ?? null
  );
}

async function fetchPageWithRetry({ fetchFn, url, retryDelaysMs, sleepFn }) {
  let lastError;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const response = await fetchFn(url, {
        headers: {
          Accept: "text/html",
          "Cache-Control": "no-cache",
          "User-Agent": "TAIEX-Semi-Dash/1.0",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const error = new Error(
          `HTTP ${response.status} ${response.statusText}`.trim(),
        );
        error.transient =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        throw error;
      }
      return await response.text();
    } catch (error) {
      const requestError =
        error instanceof Error ? error : new Error(String(error));
      lastError = requestError;
      if (requestError.transient === false || attempt === retryDelaysMs.length) {
        break;
      }
      await sleepFn(retryDelaysMs[attempt]);
    }
  }
  throw new Error(`${url}: ${lastError?.message ?? "request failed"}`);
}

export async function fetchMoneydjRevenueWindow({
  fetchFn = globalThis.fetch,
  reportingMonth: month,
  startDateLocal = null,
  endDateLocal = null,
  retryDelaysMs = [500, 1_000],
  sleepFn = sleep,
  pageDelayMs = 100,
  maxPages = 20,
  payloads = null,
}) {
  const records = [];
  let page = 1;
  let lastPage = 1;
  do {
    if (page > maxPages) {
      throw new Error(`MoneyDJ revenue query exceeded ${maxPages} pages`);
    }
    const url = moneydjSearchUrl({
      reportingMonth: month,
      page,
      startDateLocal,
      endDateLocal,
    });
    const override = Array.isArray(payloads) ? payloads[page - 1] : null;
    const html =
      override === null || override === undefined
        ? await fetchPageWithRetry({ fetchFn, url, retryDelaysMs, sleepFn })
        : String(override);
    const parsed = parseMoneydjSearchPage(html);
    records.push(
      ...parsed.records.filter((record) => record.reportingMonth === month),
    );
    lastPage = parsed.lastPage;
    page += 1;
    if (page <= lastPage && pageDelayMs > 0) {
      await sleepFn(pageDelayMs);
    }
  } while (page <= lastPage);

  const unique = new Map();
  for (const record of records) {
    const prior = unique.get(record.sourceRecordId);
    if (!prior || record.publishedAtUtc < prior.publishedAtUtc) {
      unique.set(record.sourceRecordId, record);
    }
  }
  return {
    records: [...unique.values()].sort((left, right) =>
      left.publishedAtUtc.localeCompare(right.publishedAtUtc),
    ),
    requests: Math.max(1, page - 1),
  };
}
