export const TAIFEX_DAILY_FX_URL =
  "https://openapi.taifex.com.tw/v1/DailyForeignExchangeRates";

const SOURCE_NAME = "Taiwan Futures Exchange (TAIFEX)";

function normalizeRateDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  const [, year, month, day] = match;
  const date = `${year}-${month}-${day}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date
    ? null
    : date;
}

export function isExchangeRateRecord(value) {
  return (
    value?.baseCurrency === "USD" &&
    value?.quoteCurrency === "TWD" &&
    Number.isFinite(value?.twdPerUsd) &&
    value.twdPerUsd > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(value?.rateDate ?? "") &&
    typeof value?.retrievedAtUtc === "string" &&
    value?.sourceName === SOURCE_NAME &&
    value?.sourceUrl === TAIFEX_DAILY_FX_URL
  );
}

export function selectLatestUsdTwdRate(
  rows,
  retrievedAtUtc = new Date().toISOString(),
) {
  if (!Array.isArray(rows)) {
    throw new TypeError("TAIFEX exchange-rate response must be an array.");
  }

  const candidates = rows
    .map((row) => ({
      rateDate: normalizeRateDate(row?.Date),
      twdPerUsd: Number(row?.["USD/NTD"]),
    }))
    .filter(
      (row) =>
        row.rateDate !== null &&
        Number.isFinite(row.twdPerUsd) &&
        row.twdPerUsd >= 10 &&
        row.twdPerUsd <= 100,
    )
    .sort((left, right) => left.rateDate.localeCompare(right.rateDate));

  const latest = candidates.at(-1);
  if (!latest) {
    throw new Error("TAIFEX response contains no valid USD/NTD daily rate.");
  }

  return {
    baseCurrency: "USD",
    quoteCurrency: "TWD",
    twdPerUsd: latest.twdPerUsd,
    rateDate: latest.rateDate,
    retrievedAtUtc: new Date(retrievedAtUtc).toISOString(),
    sourceName: SOURCE_NAME,
    sourceUrl: TAIFEX_DAILY_FX_URL,
  };
}

export async function fetchLatestUsdTwdRate({
  fetchFn = globalThis.fetch,
  nowUtc = new Date().toISOString(),
  attempts = 3,
  retryDelayMs = 500,
  timeoutMs = 20_000,
} = {}) {
  if (typeof fetchFn !== "function") {
    throw new TypeError("fetchFn must be a function.");
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchFn(TAIFEX_DAILY_FX_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`TAIFEX exchange-rate request returned ${response.status}.`);
      }
      return selectLatestUsdTwdRate(await response.json(), nowUtc);
    } catch (error) {
      lastError = error;
      if (attempt < attempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  throw lastError;
}
