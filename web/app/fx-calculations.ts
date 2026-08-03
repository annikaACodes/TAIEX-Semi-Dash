export interface MonthlyExchangeRate {
  month: string;
  baseCurrency: "USD";
  quoteCurrency: "TWD";
  averageTwdPerUsd: number;
  dailyObservationCount: number;
  firstObservationDate: string;
  lastObservationDate: string;
  averageMethod: "arithmetic_mean_daily_1600_interbank_spot";
  sourceName: string;
  sourceUrl: string;
  sourceLastUpdatedDate: string | null;
  retrievedAtUtc: string;
}

interface RevenueHistoryRow {
  month: string;
  revenueNt: number | null;
}

export type TranslatedRevenueRow<T extends RevenueHistoryRow> = T & {
  revenueUsd: number | null;
  cumulativeYtdRevenueUsd: number | null;
  averageTwdPerUsd: number;
  exchangeRateObservationCount: number;
  exchangeRateLastObservationDate: string;
};

function roundUsd(value: number) {
  return Math.round(value * 100) / 100;
}

export function translateRevenueHistory<T extends RevenueHistoryRow>(
  history: T[],
  exchangeRates: MonthlyExchangeRate[],
): Array<TranslatedRevenueRow<T>> {
  const ratesByMonth = new Map(
    exchangeRates.map((rate) => [rate.month, rate]),
  );
  const ytdByYear = new Map<string, number>();
  let previousMonth: string | null = null;

  return history.map((row) => {
    if (previousMonth !== null && row.month <= previousMonth) {
      throw new Error("Revenue history must contain unique ascending months.");
    }
    previousMonth = row.month;

    const exchangeRate = ratesByMonth.get(row.month);
    if (!exchangeRate) {
      throw new Error(`Missing monthly USD/TWD exchange rate for ${row.month}.`);
    }

    const revenueUsdExact =
      row.revenueNt === null
        ? null
        : row.revenueNt / exchangeRate.averageTwdPerUsd;
    const year = row.month.slice(0, 4);
    const cumulativeYtdRevenueUsdExact =
      revenueUsdExact === null
        ? null
        : (ytdByYear.get(year) ?? 0) + revenueUsdExact;
    if (cumulativeYtdRevenueUsdExact !== null) {
      ytdByYear.set(year, cumulativeYtdRevenueUsdExact);
    }

    return {
      ...row,
      revenueUsd:
        revenueUsdExact === null ? null : roundUsd(revenueUsdExact),
      cumulativeYtdRevenueUsd:
        cumulativeYtdRevenueUsdExact === null
          ? null
          : roundUsd(cumulativeYtdRevenueUsdExact),
      averageTwdPerUsd: exchangeRate.averageTwdPerUsd,
      exchangeRateObservationCount: exchangeRate.dailyObservationCount,
      exchangeRateLastObservationDate: exchangeRate.lastObservationDate,
    };
  });
}
