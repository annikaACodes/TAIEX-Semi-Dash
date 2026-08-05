import { reportingMonth, utcToTaipeiParts } from "./dates.mjs";

export const CNYES_REVENUE_FEED_URL =
  "https://api.cnyes.com/media/api/v1/newslist/category/tw_revenue";

const PAGE_LIMIT = 30;
const CORRECTION_PATTERN = /\u66f4\u6b63|\u91cd\u7de8|\u4fee\u6b63|correct|restat/iu;
const TICKER_PATTERN = /(\d{4,5})-TW/iu;
const DISCLOSURE_PATTERN =
  /(?:\u516c\u544a|\u516c\u4f48|\u516c\u5e03)\s*(\d{2,4})\s*\u5e74\s*(\d{1,2})\s*\u6708(?:\u5408\u4f75)?\u71df\u6536(?:\u70ba|\u9054)\s*(?:\u65b0\u53f0\u5e63)?\s*([\d,.]+)\s*(\u5146\u5143|\u5104\u5143|\u842c\u5143|\u5143)/iu;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function decodeArticleText(value) {
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

function stripSearchMarkup(value) {
  return decodeArticleText(String(value ?? "").replace(/<\/?mark>/giu, ""));
}

function parsePercent(text, label) {
  const pattern = new RegExp(`${label}(?:\\u9ad8\\u9054)?\\s*(-?\\d+(?:\\.\\d+)?)\\s*[%\\uff05]`, "iu");
  const match = pattern.exec(text);
  return match ? Number(match[1]) : null;
}

function parseRevenue(amountText, unit) {
  const normalized = amountText.replace(/,/gu, "");
  const amount = Number(normalized);
  const scale = {
    "\u5146\u5143": 1_000_000_000_000,
    "\u5104\u5143": 100_000_000,
    "\u842c\u5143": 10_000,
    "\u5143": 1,
  }[unit];
  if (!Number.isFinite(amount) || !scale) return null;
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

function epochSeconds(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const timestamp = new Date(value).valueOf();
  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid Cnyes date boundary: ${value}`);
  }
  return Math.floor(timestamp / 1000);
}

export function cnyesRevenueFeedUrl({
  startAtUtc,
  endAtUtc,
  page = 1,
  limit = PAGE_LIMIT,
}) {
  const url = new URL(CNYES_REVENUE_FEED_URL);
  url.searchParams.set("startAt", String(epochSeconds(startAtUtc)));
  url.searchParams.set("endAt", String(epochSeconds(endAtUtc)));
  url.searchParams.set("limit", String(Math.min(PAGE_LIMIT, limit)));
  url.searchParams.set("page", String(page));
  return url.href;
}

export function parseCnyesRevenueFeed(payload) {
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (Number(parsed?.statusCode) !== 200) {
    throw new Error(
      `Cnyes revenue query failed: ${parsed?.message ?? "unknown error"}`,
    );
  }
  const items = parsed?.items;
  if (!items || !Array.isArray(items.data)) {
    throw new Error("Cnyes revenue response has no items.data array");
  }

  const records = [];
  for (const article of items.data) {
    const text = decodeArticleText(article?.content);
    if (!text || CORRECTION_PATTERN.test(text)) continue;
    const disclosure = DISCLOSURE_PATTERN.exec(text);
    if (!disclosure) continue;

    const marketTickers = Array.isArray(article?.market)
      ? article.market
          .map((market) => String(market?.code ?? "").trim())
          .filter((ticker) => /^\d{4,5}$/u.test(ticker))
      : [];
    const textTicker = TICKER_PATTERN.exec(text)?.[1] ?? null;
    const ticker = marketTickers.includes(textTicker)
      ? textTicker
      : marketTickers.length === 1
        ? marketTickers[0]
        : textTicker;
    if (!ticker || !text.includes(`(${ticker}-TW)`)) continue;

    const rawYear = Number(disclosure[1]);
    const year = rawYear < 1911 ? rawYear + 1911 : rawYear;
    const month = Number(disclosure[2]);
    if (year < 2000 || year > 2100 || month < 1 || month > 12) continue;

    const revenue = parseRevenue(disclosure[3], disclosure[4]);
    if (!revenue) continue;
    const publishedAtSeconds = Number(article?.publishAt);
    if (!Number.isFinite(publishedAtSeconds)) continue;
    const publishedAtUtc = new Date(publishedAtSeconds * 1000).toISOString();
    const local = utcToTaipeiParts(publishedAtUtc);
    const sourceRecordId = String(article?.newsId ?? "").trim();
    if (!sourceRecordId) continue;

    records.push({
      ticker,
      reportingMonth: reportingMonth(year, month),
      publishedAtUtc,
      publishedDateLocal: local.date,
      publishedTimeLocal: local.time,
      sourceRecordId,
      sourceUrl: `https://news.cnyes.com/news/id/${sourceRecordId}`,
      sourceTitle: stripSearchMarkup(article?.title),
      revenueNt: revenue.revenueNt,
      revenueToleranceNt: revenue.toleranceNt,
      momPercent: parsePercent(text, "\u6708\u589e\u7387"),
      yoyPercent: parsePercent(text, "\u5e74\u589e\u7387"),
    });
  }

  return {
    records,
    page: Number(items.current_page ?? 1),
    lastPage: Number(items.last_page ?? 1),
    total: Number(items.total ?? records.length),
  };
}

export function matchCnyesRevenueArticle(article, observations) {
  const percentMatches = (articleValue, databaseValue) =>
    articleValue === null ||
    databaseValue === null ||
    databaseValue === undefined ||
    Math.abs(Number(databaseValue) - articleValue) <= 0.06;

  return (
    observations.find(
      (observation) =>
        Math.abs(Number(observation.revenueNt) - article.revenueNt) <=
          article.revenueToleranceNt &&
        percentMatches(article.momPercent, observation.momPercent) &&
        percentMatches(article.yoyPercent, observation.yoyPercent),
    ) ?? null
  );
}

async function fetchPageWithRetry({
  fetchFn,
  url,
  retryDelaysMs,
  sleepFn,
}) {
  let lastError;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const response = await fetchFn(url, {
        headers: {
          Accept: "application/json",
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

export async function fetchCnyesRevenueWindow({
  fetchFn = globalThis.fetch,
  startAtUtc,
  endAtUtc,
  retryDelaysMs = [500, 1_000],
  sleepFn = sleep,
  pageDelayMs = 0,
  maxPages = 60,
  payloads = null,
}) {
  const records = [];
  let page = 1;
  let lastPage = 1;
  let total = 0;
  do {
    if (page > maxPages) {
      throw new Error(`Cnyes revenue query exceeded ${maxPages} pages`);
    }
    const url = cnyesRevenueFeedUrl({ startAtUtc, endAtUtc, page });
    const override = Array.isArray(payloads) ? payloads[page - 1] : null;
    const text =
      override === null || override === undefined
        ? await fetchPageWithRetry({
            fetchFn,
            url,
            retryDelaysMs,
            sleepFn,
          })
        : typeof override === "string"
          ? override
          : JSON.stringify(override);
    const parsed = parseCnyesRevenueFeed(text);
    records.push(...parsed.records);
    lastPage = parsed.lastPage;
    total = parsed.total;
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
    total,
  };
}
