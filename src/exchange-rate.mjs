export const CBC_DAILY_FX_URL =
  "https://cpx.cbc.gov.tw/API/DataAPI/Get?FileName=BP01D01";
export const CBC_FX_SOURCE_NAME =
  "Central Bank of the Republic of China (Taiwan)";
export const MONTHLY_FX_METHOD =
  "arithmetic_mean_daily_1600_interbank_spot";

function normalizeCompactDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  const [, year, month, day] = match;
  const date = `${year}-${month}-${day}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date
    ? null
    : date;
}

function normalizeIsoDate(value) {
  const date = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date
    ? null
    : date;
}

function roundRate(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function parseCbcDailyUsdTwdRates(payload) {
  const rows = payload?.data?.dataSets;
  if (!Array.isArray(rows)) {
    throw new TypeError("CBC exchange-rate response is missing data.dataSets.");
  }

  const byDate = new Map();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const date = normalizeCompactDate(row[0]);
    const twdPerUsd = Number(row[1]);
    if (
      date !== null &&
      Number.isFinite(twdPerUsd) &&
      twdPerUsd >= 10 &&
      twdPerUsd <= 100
    ) {
      byDate.set(date, { date, twdPerUsd });
    }
  }

  const dailyRates = [...byDate.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
  if (dailyRates.length === 0) {
    throw new Error("CBC response contains no valid NTD/USD daily rates.");
  }
  return dailyRates;
}

export function buildMonthlyUsdTwdRates(
  payload,
  retrievedAtUtc = new Date().toISOString(),
) {
  const normalizedRetrievedAtUtc = new Date(retrievedAtUtc).toISOString();
  const sourceLastUpdatedDate = normalizeIsoDate(payload?.meta?.last_updated);
  const groups = new Map();

  for (const dailyRate of parseCbcDailyUsdTwdRates(payload)) {
    const rateMonth = `${dailyRate.date.slice(0, 7)}-01`;
    const group = groups.get(rateMonth) ?? {
      rateMonth,
      sum: 0,
      dailyObservationCount: 0,
      firstObservationDate: dailyRate.date,
      lastObservationDate: dailyRate.date,
    };
    group.sum += dailyRate.twdPerUsd;
    group.dailyObservationCount += 1;
    group.lastObservationDate = dailyRate.date;
    groups.set(rateMonth, group);
  }

  return [...groups.values()]
    .sort((left, right) => left.rateMonth.localeCompare(right.rateMonth))
    .map((group) => ({
      rateMonth: group.rateMonth,
      baseCurrency: "USD",
      quoteCurrency: "TWD",
      averageTwdPerUsd: roundRate(
        group.sum / group.dailyObservationCount,
      ),
      dailyObservationCount: group.dailyObservationCount,
      firstObservationDate: group.firstObservationDate,
      lastObservationDate: group.lastObservationDate,
      averageMethod: MONTHLY_FX_METHOD,
      sourceName: CBC_FX_SOURCE_NAME,
      sourceUrl: CBC_DAILY_FX_URL,
      sourceLastUpdatedDate,
      retrievedAtUtc: normalizedRetrievedAtUtc,
    }));
}

export function isMonthlyExchangeRateRecord(value) {
  return (
    /^\d{4}-\d{2}-01$/.test(value?.rateMonth ?? "") &&
    value?.baseCurrency === "USD" &&
    value?.quoteCurrency === "TWD" &&
    Number.isFinite(value?.averageTwdPerUsd) &&
    value.averageTwdPerUsd >= 10 &&
    value.averageTwdPerUsd <= 100 &&
    Number.isInteger(value?.dailyObservationCount) &&
    value.dailyObservationCount > 0 &&
    value?.averageMethod === MONTHLY_FX_METHOD &&
    value?.sourceName === CBC_FX_SOURCE_NAME &&
    value?.sourceUrl === CBC_DAILY_FX_URL
  );
}

export function syncMonthlyUsdTwdRates(database, rates) {
  if (!Array.isArray(rates) || !rates.every(isMonthlyExchangeRateRecord)) {
    throw new TypeError("Every monthly exchange-rate record must be valid.");
  }
  const upsert = database.prepare(`
    INSERT INTO monthly_exchange_rates (
      rate_month,
      base_currency,
      quote_currency,
      average_twd_per_usd,
      daily_observation_count,
      first_observation_date,
      last_observation_date,
      average_method,
      source_name,
      source_url,
      source_last_updated_date,
      retrieved_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (rate_month) DO UPDATE SET
      average_twd_per_usd = excluded.average_twd_per_usd,
      daily_observation_count = excluded.daily_observation_count,
      first_observation_date = excluded.first_observation_date,
      last_observation_date = excluded.last_observation_date,
      average_method = excluded.average_method,
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      source_last_updated_date = excluded.source_last_updated_date,
      retrieved_at_utc = excluded.retrieved_at_utc
    WHERE monthly_exchange_rates.average_twd_per_usd
            IS NOT excluded.average_twd_per_usd
       OR monthly_exchange_rates.daily_observation_count
            IS NOT excluded.daily_observation_count
       OR monthly_exchange_rates.first_observation_date
            IS NOT excluded.first_observation_date
       OR monthly_exchange_rates.last_observation_date
            IS NOT excluded.last_observation_date
       OR monthly_exchange_rates.average_method IS NOT excluded.average_method
       OR monthly_exchange_rates.source_name IS NOT excluded.source_name
       OR monthly_exchange_rates.source_url IS NOT excluded.source_url
  `);

  let changed = 0;
  for (const rate of rates) {
    changed += Number(
      upsert.run(
        rate.rateMonth,
        rate.baseCurrency,
        rate.quoteCurrency,
        rate.averageTwdPerUsd,
        rate.dailyObservationCount,
        rate.firstObservationDate,
        rate.lastObservationDate,
        rate.averageMethod,
        rate.sourceName,
        rate.sourceUrl,
        rate.sourceLastUpdatedDate,
        rate.retrievedAtUtc,
      ).changes,
    );
  }
  return changed;
}

export async function fetchMonthlyUsdTwdRates({
  fetchFn = globalThis.fetch,
  nowUtc = new Date().toISOString(),
  attempts = 3,
  retryDelayMs = 500,
  timeoutMs = 30_000,
} = {}) {
  if (typeof fetchFn !== "function") {
    throw new TypeError("fetchFn must be a function.");
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchFn(CBC_DAILY_FX_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`CBC exchange-rate request returned ${response.status}.`);
      }
      return buildMonthlyUsdTwdRates(await response.json(), nowUtc);
    } catch (error) {
      lastError = error;
      if (attempt < attempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  throw lastError;
}
