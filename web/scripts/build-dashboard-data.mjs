import { DatabaseSync } from "node:sqlite";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");

function argumentValue(name, fallback) {
  const argumentsList = typeof process === "undefined" ? [] : process.argv;
  const index = argumentsList.indexOf(name);
  return index === -1 ? fallback : argumentsList[index + 1];
}

const databasePath = resolve(
  argumentValue(
    "--database",
    resolve(projectDirectory, "..", "taiwan_semiconductor_companies.sqlite"),
  ),
);
const outputDirectory = resolve(
  argumentValue("--output", resolve(projectDirectory, "public", "data")),
);
const companiesDirectory = resolve(outputDirectory, "companies");

function nullableNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function shiftMonth(month, offset) {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(
    shifted.getUTCMonth() + 1,
  ).padStart(2, "0")}`;
}

function monthKey(value) {
  return String(value).slice(0, 7);
}

const MOMENTUM_PERIOD_DEFINITIONS = [
  {
    id: "mom",
    months: 1,
    label: "MoM",
    controlLabel: "MoM",
  },
  {
    id: "yoy",
    months: 1,
    label: "YoY",
    controlLabel: "YoY",
  },
  {
    id: "3m",
    months: 3,
    label: "3M",
    controlLabel: "3M/3M",
  },
  {
    id: "6m",
    months: 6,
    label: "6M",
    controlLabel: "6M/6M",
  },
  {
    id: "ltm",
    months: 12,
    label: "LTM",
    controlLabel: "LTM YoY",
  },
];

const ANALYSIS_MIX_KEY = "mix";

function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function removeFileIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const database = new DatabaseSync(databasePath, { readOnly: true });

const companyRows = database
  .prepare(
    `SELECT company_id, ticker, company_name_english
       FROM companies
      ORDER BY CAST(ticker AS INTEGER), ticker`,
  )
  .all();
const classificationRows = database
  .prepare(
    `SELECT company_id, classification_name, classification_order
       FROM company_search
      ORDER BY company_id, classification_order, classification_name`,
  )
  .all();
const revenueRows = database
  .prepare(
    `SELECT company_id, ticker, company_name_english, reporting_month,
            revenue_nt, mom_percent, yoy_percent,
            cumulative_ytd_revenue_nt, ytd_yoy_percent,
            publication_timestamp, restatement_flag,
            publication_timestamp_basis, source_market, source_url,
            source_report_date, source_note_translation_status
       FROM monthly_revenue
      ORDER BY company_id, reporting_month`,
  )
  .all();
const calendarRows = database
  .prepare(
    `SELECT company_id, reporting_month,
            history_expected_release_date_local,
            effective_expected_release_date_local,
            effective_expected_release_time_local,
            regulatory_deadline_date_local,
            schedule_source, announced_release_date_local,
            announced_release_time_local, actual_first_seen_at_utc,
            deviation_from_history_days, unusual_report_date,
            unusual_reason, release_status, forecast_confidence,
            history_sample_count
       FROM company_release_calendar
      ORDER BY reporting_month, company_id`,
  )
  .all();
const exchangeRateRows = database
  .prepare(
    `SELECT rate_month, base_currency, quote_currency,
            average_twd_per_usd, daily_observation_count,
            first_observation_date, last_observation_date,
            average_method, source_name, source_url,
            source_last_updated_date, retrieved_at_utc
       FROM monthly_exchange_rates
      ORDER BY rate_month`,
  )
  .all();

database.close();

const exchangeRates = exchangeRateRows.map((row) => ({
  month: monthKey(row.rate_month),
  baseCurrency: row.base_currency,
  quoteCurrency: row.quote_currency,
  averageTwdPerUsd: Number(row.average_twd_per_usd),
  dailyObservationCount: Number(row.daily_observation_count),
  firstObservationDate: row.first_observation_date,
  lastObservationDate: row.last_observation_date,
  averageMethod: row.average_method,
  sourceName: row.source_name,
  sourceUrl: row.source_url,
  sourceLastUpdatedDate: row.source_last_updated_date,
  retrievedAtUtc: row.retrieved_at_utc,
}));
if (exchangeRates.length === 0) {
  throw new Error("The database contains no monthly USD/TWD exchange rates.");
}
const exchangeRateByMonth = new Map(
  exchangeRates.map((rate) => [rate.month, rate]),
);

const classificationsByCompany = new Map();
for (const row of classificationRows) {
  const values = classificationsByCompany.get(row.company_id) ?? [];
  values.push(String(row.classification_name));
  classificationsByCompany.set(row.company_id, values);
}

const historyByCompany = new Map();
const revenueByCompanyMonth = new Map();
for (const row of revenueRows) {
  const history = historyByCompany.get(row.company_id) ?? [];
  const month = monthKey(row.reporting_month);
  const revenueNt = nullableNumber(row.revenue_nt);
  const item = {
    month,
    revenueNt,
    momPercent: nullableNumber(row.mom_percent),
    yoyPercent: nullableNumber(row.yoy_percent),
    cumulativeYtdRevenueNt: nullableNumber(row.cumulative_ytd_revenue_nt),
    ytdYoyPercent: nullableNumber(row.ytd_yoy_percent),
    publicationTimestamp: row.publication_timestamp,
    restatementFlag: Number(row.restatement_flag) === 1,
    publicationTimestampBasis: row.publication_timestamp_basis,
    sourceMarket: row.source_market,
    sourceUrl: row.source_url,
    sourceReportDate: row.source_report_date,
    sourceNoteTranslationStatus: row.source_note_translation_status,
  };
  history.push(item);
  historyByCompany.set(row.company_id, history);
  revenueByCompanyMonth.set(`${row.company_id}:${item.month}`, item);
}

const allRevenueMonths = [
  ...new Set(revenueRows.map((row) => monthKey(row.reporting_month))),
].sort();
const latestRevenueMonth = allRevenueMonths.at(-1);
if (!latestRevenueMonth) {
  throw new Error("The database contains no monthly revenue data.");
}
const missingExchangeRateMonths = allRevenueMonths.filter(
  (month) => !exchangeRateByMonth.has(month),
);
if (missingExchangeRateMonths.length > 0) {
  throw new Error(
    `Missing monthly USD/TWD exchange rates for ${missingExchangeRateMonths.join(
      ", ",
    )}.`,
  );
}
const revenueExchangeRates = exchangeRates.filter(
  (rate) =>
    rate.month >= allRevenueMonths[0] && rate.month <= latestRevenueMonth,
);
const latestRevenueExchangeRate = exchangeRateByMonth.get(latestRevenueMonth);
const analysisMonths = [0, -1, -2].map((offset) =>
  shiftMonth(latestRevenueMonth, offset),
);

const companyDirectoryEntries = await readdir(companiesDirectory, {
  withFileTypes: true,
}).catch(() => []);
const expectedCompanyFiles = new Set(
  companyRows.map((company) => `${company.ticker}.json`),
);
await mkdir(companiesDirectory, { recursive: true });
for (const entry of companyDirectoryEntries) {
  if (
    entry.isFile() &&
    entry.name.endsWith(".json") &&
    !expectedCompanyFiles.has(entry.name)
  ) {
    await unlink(resolve(companiesDirectory, entry.name));
  }
}

const companies = [];
const companyDataByTicker = {};
for (const company of companyRows) {
  const history = historyByCompany.get(company.company_id) ?? [];
  const latest = history.at(-1) ?? null;
  const classifications = classificationsByCompany.get(company.company_id) ?? [];
  const companyData = {
    company: {
      id: Number(company.company_id),
      ticker: String(company.ticker),
      name: String(company.company_name_english),
      classifications,
    },
    history,
  };
  companyDataByTicker[company.ticker] = companyData;
  await writeJson(
    resolve(companiesDirectory, `${company.ticker}.json`),
    companyData,
  );
  companies.push({
    ...companyData.company,
    latestMonth: latest?.month ?? null,
    latestRevenueNt: latest?.revenueNt ?? null,
    latestMomPercent: latest?.momPercent ?? null,
    latestYoyPercent: latest?.yoyPercent ?? null,
    latestYtdRevenueNt: latest?.cumulativeYtdRevenueNt ?? null,
    latestYtdYoyPercent: latest?.ytdYoyPercent ?? null,
    latestPublicationTimestamp: latest?.publicationTimestamp ?? null,
    restatementFlag: latest?.restatementFlag ?? false,
  });
}

const subsectorBuckets = new Map();
for (const row of revenueRows) {
  const classifications = classificationsByCompany.get(row.company_id) ?? [];
  for (const classification of classifications) {
    const month = monthKey(row.reporting_month);
    const key = `${classification}\u0000${month}`;
    const bucket = subsectorBuckets.get(key) ?? {
      classification,
      month,
      aggregateRevenueNt: 0,
      reportingCompanies: 0,
      simpleYoyTotal: 0,
      simpleYoyCount: 0,
      weightedYoyTotal: 0,
      weightedRevenueTotal: 0,
    };
    const revenue = nullableNumber(row.revenue_nt);
    const yoy = nullableNumber(row.yoy_percent);
    if (revenue !== null) {
      bucket.aggregateRevenueNt += revenue;
      bucket.reportingCompanies += 1;
    }
    if (yoy !== null) {
      bucket.simpleYoyTotal += yoy;
      bucket.simpleYoyCount += 1;
      if (revenue !== null && revenue > 0) {
        bucket.weightedYoyTotal += yoy * revenue;
        bucket.weightedRevenueTotal += revenue;
      }
    }
    subsectorBuckets.set(key, bucket);
  }
}

const subsectorSeries = {};
for (const bucket of subsectorBuckets.values()) {
  const series = subsectorSeries[bucket.classification] ?? [];
  series.push({
    month: bucket.month,
    aggregateRevenueNt: Math.round(bucket.aggregateRevenueNt),
    simpleYoyPercent:
      bucket.simpleYoyCount > 0
        ? round(bucket.simpleYoyTotal / bucket.simpleYoyCount)
        : null,
    revenueWeightedYoyPercent:
      bucket.weightedRevenueTotal > 0
        ? round(bucket.weightedYoyTotal / bucket.weightedRevenueTotal)
        : null,
    reportingCompanies: bucket.reportingCompanies,
  });
  subsectorSeries[bucket.classification] = series;
}
for (const series of Object.values(subsectorSeries)) {
  series.sort((left, right) => left.month.localeCompare(right.month));
}

const subsectorMembers = Object.fromEntries(
  Object.keys(subsectorSeries).map((classification) => [
    classification,
    companyRows.filter((company) =>
      (classificationsByCompany.get(company.company_id) ?? []).includes(
        classification,
      ),
    ),
  ]),
);

function observationForAnalysis(companyId, analysisKey) {
  return analysisKey === ANALYSIS_MIX_KEY
    ? (historyByCompany.get(companyId) ?? []).at(-1)
    : revenueByCompanyMonth.get(`${companyId}:${analysisKey}`);
}

function buildSubsectorSnapshot(classification, analysisKey) {
  const members = (subsectorMembers[classification] ?? []).map((company) => {
    const observation = observationForAnalysis(company.company_id, analysisKey);
    return {
      ticker: String(company.ticker),
      name: String(company.company_name_english),
      reportingMonth: observation?.month ?? null,
      revenueNt: observation?.revenueNt ?? null,
      yoyPercent: observation?.yoyPercent ?? null,
    };
  });
  const aggregateRevenueNt = Math.round(
    members.reduce(
      (total, company) => total + (company.revenueNt ?? 0),
      0,
    ),
  );
  const reportingCompanies = members.filter(
    (company) => company.revenueNt !== null,
  ).length;
  const simpleYoyCount = members.filter(
    (company) => company.yoyPercent !== null,
  ).length;
  const simpleYoyTotal = members.reduce(
    (total, company) => total + (company.yoyPercent ?? 0),
    0,
  );
  const weightedRevenueTotal = members.reduce(
    (total, company) =>
      company.yoyPercent !== null &&
      company.revenueNt !== null &&
      company.revenueNt > 0
        ? total + company.revenueNt
        : total,
    0,
  );
  const weightedYoyTotal = members.reduce(
    (total, company) =>
      company.yoyPercent !== null &&
      company.revenueNt !== null &&
      company.revenueNt > 0
        ? total + company.yoyPercent * company.revenueNt
        : total,
    0,
  );

  const companiesForSnapshot = members
    .map((company) => ({
      ...company,
      revenueWeightPercent:
        company.revenueNt !== null && aggregateRevenueNt > 0
          ? round((company.revenueNt / aggregateRevenueNt) * 100)
          : null,
      simpleYoyContributionPercentPoints:
        company.yoyPercent !== null && simpleYoyCount > 0
          ? round(company.yoyPercent / simpleYoyCount)
          : null,
      revenueWeightedYoyContributionPercentPoints:
        company.yoyPercent !== null &&
        company.revenueNt !== null &&
        company.revenueNt > 0 &&
        weightedRevenueTotal > 0
          ? round(
              (company.yoyPercent * company.revenueNt) /
                weightedRevenueTotal,
            )
          : null,
    }))
    .sort((left, right) => {
      if (left.revenueNt === null && right.revenueNt === null) {
        return left.ticker.localeCompare(right.ticker);
      }
      if (left.revenueNt === null) return 1;
      if (right.revenueNt === null) return -1;
      if (left.revenueNt !== right.revenueNt) {
        return right.revenueNt - left.revenueNt;
      }
      return left.ticker.localeCompare(right.ticker);
    });

  return {
    month: analysisKey,
    aggregateRevenueNt,
    simpleYoyPercent:
      simpleYoyCount > 0 ? round(simpleYoyTotal / simpleYoyCount) : null,
    revenueWeightedYoyPercent:
      weightedRevenueTotal > 0
        ? round(weightedYoyTotal / weightedRevenueTotal)
        : null,
    reportingCompanies,
    companies: companiesForSnapshot,
  };
}

const subsectorSnapshots = Object.fromEntries(
  [ANALYSIS_MIX_KEY, ...analysisMonths].map((analysisKey) => [
    analysisKey,
    Object.fromEntries(
      Object.keys(subsectorSeries).map((classification) => [
        classification,
        buildSubsectorSnapshot(classification, analysisKey),
      ]),
    ),
  ]),
);

function periodRevenue(companyId, endMonth, months) {
  let total = 0;
  for (let offset = 0; offset < months; offset += 1) {
    const observation = revenueByCompanyMonth.get(
      `${companyId}:${shiftMonth(endMonth, -offset)}`,
    );
    if (
      observation?.revenueNt === null ||
      observation?.revenueNt === undefined
    ) {
      return null;
    }
    total += observation.revenueNt;
  }
  return Math.round(total);
}

function periodGrowth(currentRevenue, comparisonRevenue) {
  if (
    currentRevenue === null ||
    comparisonRevenue === null ||
    comparisonRevenue === 0
  ) {
    return null;
  }
  return ((currentRevenue / comparisonRevenue) - 1) * 100;
}

function momentumPeriodForCompany(companyId, endMonth, definition) {
  if (!endMonth) {
    return {
      currentPeriodRevenueNt: null,
      priorPeriodRevenueNt: null,
      currentGrowthPercent: null,
      previousGrowthPercent: null,
      accelerationPercentPoints: null,
      direction: "unavailable",
    };
  }

  let currentRevenue;
  let priorRevenue;
  let currentGrowth;
  let previousGrowth;
  if (definition.id === "yoy") {
    currentRevenue = periodRevenue(companyId, endMonth, 1);
    priorRevenue = periodRevenue(companyId, shiftMonth(endMonth, -12), 1);
    const previousMonthRevenue = periodRevenue(
      companyId,
      shiftMonth(endMonth, -1),
      1,
    );
    const previousYearMonthRevenue = periodRevenue(
      companyId,
      shiftMonth(endMonth, -13),
      1,
    );
    currentGrowth = periodGrowth(currentRevenue, priorRevenue);
    previousGrowth = periodGrowth(
      previousMonthRevenue,
      previousYearMonthRevenue,
    );
  } else {
    currentRevenue = periodRevenue(companyId, endMonth, definition.months);
    priorRevenue = periodRevenue(
      companyId,
      shiftMonth(endMonth, -definition.months),
      definition.months,
    );
    const baselineRevenue = periodRevenue(
      companyId,
      shiftMonth(endMonth, -definition.months * 2),
      definition.months,
    );
    currentGrowth = periodGrowth(currentRevenue, priorRevenue);
    previousGrowth = periodGrowth(priorRevenue, baselineRevenue);
  }
  const acceleration =
    currentGrowth === null || previousGrowth === null
      ? null
      : round(currentGrowth - previousGrowth);
  const direction =
    acceleration === null
      ? "unavailable"
      : acceleration > 0
        ? "accelerating"
        : acceleration < 0
          ? "decelerating"
          : "unchanged";
  return {
    currentPeriodRevenueNt: currentRevenue,
    priorPeriodRevenueNt: priorRevenue,
    currentGrowthPercent: round(currentGrowth),
    previousGrowthPercent: round(previousGrowth),
    accelerationPercentPoints: acceleration,
    direction,
  };
}

const momentumPeriods = Object.fromEntries(
  MOMENTUM_PERIOD_DEFINITIONS.map((definition) => [
    definition.id,
    {
      months: definition.months,
      label: definition.label,
      controlLabel: definition.controlLabel,
    },
  ]),
);

function buildMomentumCompany(company, analysisKey) {
  const latestHistoryMonth = (historyByCompany.get(company.company_id) ?? [])
    .at(-1)?.month;
  const analysisMonth =
    analysisKey === ANALYSIS_MIX_KEY ? latestHistoryMonth : analysisKey;
  const current = revenueByCompanyMonth.get(
    `${company.company_id}:${analysisMonth}`,
  );
  const previous = analysisMonth
    ? revenueByCompanyMonth.get(
        `${company.company_id}:${shiftMonth(analysisMonth, -1)}`,
      )
    : undefined;
  const periods = Object.fromEntries(
    MOMENTUM_PERIOD_DEFINITIONS.map((definition) => [
      definition.id,
      momentumPeriodForCompany(
        company.company_id,
        analysisMonth,
        definition,
      ),
    ]),
  );
  const yoyMomentum = periods.yoy;
  return {
    companyId: Number(company.company_id),
    ticker: String(company.ticker),
    name: String(company.company_name_english),
    classification:
      classificationsByCompany.get(company.company_id)?.[0] ?? "Unclassified",
    analysisMonth,
    latestMonth: current?.month ?? null,
    latestRevenueNt: current?.revenueNt ?? null,
    momPercent: current?.momPercent ?? null,
    yoyPercent: current?.yoyPercent ?? null,
    previousYoyPercent: previous?.yoyPercent ?? null,
    ytdYoyPercent: current?.ytdYoyPercent ?? null,
    accelerationPercentPoints: yoyMomentum.accelerationPercentPoints,
    direction: yoyMomentum.direction,
    periods,
  };
}

const momentumSnapshots = Object.fromEntries(
  [ANALYSIS_MIX_KEY, ...analysisMonths].map((analysisKey) => [
    analysisKey,
    companyRows.map((company) => buildMomentumCompany(company, analysisKey)),
  ]),
);

const scheduleByMonth = new Map();
for (const row of calendarRows) {
  const month = monthKey(row.reporting_month);
  const rows = scheduleByMonth.get(month) ?? [];
  rows.push(row);
  scheduleByMonth.set(month, rows);
}
const scheduleMonths = [...scheduleByMonth.keys()]
  .filter((month) => month >= latestRevenueMonth)
  .sort();
const targetReportingMonth =
  scheduleMonths.find((month) => {
    const schedules = scheduleByMonth.get(month) ?? [];
    const reported = schedules.filter((row) =>
      revenueByCompanyMonth.has(`${row.company_id}:${month}`),
    ).length;
    return reported < companyRows.length;
  }) ?? shiftMonth(latestRevenueMonth, 1);
const targetSchedules = new Map(
  (scheduleByMonth.get(targetReportingMonth) ?? []).map((row) => [
    row.company_id,
    row,
  ]),
);
const asOfDateTaipei = taipeiDate();

const freshnessRows = companyRows.map((company) => {
  const schedule = targetSchedules.get(company.company_id);
  const revenue = revenueByCompanyMonth.get(
    `${company.company_id}:${targetReportingMonth}`,
  );
  const expectedDate =
    schedule?.announced_release_date_local ??
    schedule?.effective_expected_release_date_local ??
    schedule?.history_expected_release_date_local ??
    null;
  const reported = Boolean(revenue);
  return {
    companyId: Number(company.company_id),
    ticker: String(company.ticker),
    name: String(company.company_name_english),
    classification:
      classificationsByCompany.get(company.company_id)?.[0] ?? "Unclassified",
    reported,
    expectedDate,
    expectedTime: schedule?.announced_release_time_local ??
      schedule?.effective_expected_release_time_local ??
      null,
    regulatoryDeadline: schedule?.regulatory_deadline_date_local ?? null,
    scheduleSource: schedule?.schedule_source ?? null,
    forecastConfidence: schedule?.forecast_confidence ?? null,
    historySampleCount: nullableNumber(schedule?.history_sample_count) ?? 0,
    releaseStatus: reported
      ? "reported"
      : (schedule?.release_status ?? "pending"),
    overdue: !reported && schedule?.release_status === "overdue",
    unusualReportDate: Number(schedule?.unusual_report_date) === 1,
    unusualReason: schedule?.unusual_reason ?? null,
    deviationFromHistoryDays: nullableNumber(
      schedule?.deviation_from_history_days,
    ),
    publicationTimestamp: revenue?.publicationTimestamp ?? null,
    publicationTimestampBasis:
      revenue?.publicationTimestampBasis ?? null,
    latestRevenueMonth:
      historyByCompany.get(company.company_id)?.at(-1)?.month ?? null,
  };
});

const freshnessSummary = {
  reported: freshnessRows.filter((row) => row.reported).length,
  pending: freshnessRows.filter((row) => !row.reported).length,
  overdue: freshnessRows.filter((row) => row.overdue).length,
  unusual: freshnessRows.filter((row) => row.unusualReportDate).length,
};

const manifestData = {
  generatedDateTaipei: asOfDateTaipei,
  latestRevenueMonth,
  targetReportingMonth,
  exchangeRateHistory: {
    baseCurrency: "USD",
    quoteCurrency: "TWD",
    averageMethod: latestRevenueExchangeRate.averageMethod,
    sourceName: latestRevenueExchangeRate.sourceName,
    sourceUrl: latestRevenueExchangeRate.sourceUrl,
    coverageStartMonth: revenueExchangeRates[0].month,
    coverageEndMonth: latestRevenueExchangeRate.month,
    monthlyRateCount: revenueExchangeRates.length,
    latestAverageTwdPerUsd: latestRevenueExchangeRate.averageTwdPerUsd,
    latestObservationDate: latestRevenueExchangeRate.lastObservationDate,
    sourceLastUpdatedDate: latestRevenueExchangeRate.sourceLastUpdatedDate,
  },
  companyCount: companies.length,
  classificationCount: Object.keys(subsectorSeries).length,
  revenueObservationCount: revenueRows.length,
  companies,
};
const subsectorData = {
  latestRevenueMonth,
  monthOptions: analysisMonths,
  methodology: {
    simple:
      "Arithmetic mean of reported company YoY percentages in the subsector.",
    revenueWeighted:
      "Mean of reported company YoY percentages weighted by each selected observation's revenue.",
  },
  series: subsectorSeries,
  snapshots: subsectorSnapshots,
};
const momentumData = {
  latestRevenueMonth,
  monthOptions: analysisMonths,
  periods: momentumPeriods,
  snapshots: momentumSnapshots,
};
const freshnessData = {
  asOfDateTaipei,
  targetReportingMonth,
  summary: freshnessSummary,
  companies: freshnessRows,
};
const bundleData = {
  manifest: manifestData,
  exchangeRates: revenueExchangeRates,
  subsectors: subsectorData,
  momentum: momentumData,
  freshness: freshnessData,
  companies: companyDataByTicker,
};

await mkdir(outputDirectory, { recursive: true });
await removeFileIfPresent(resolve(outputDirectory, "dashboard-bundle.json"));
await removeFileIfPresent(resolve(outputDirectory, "exchange-rate.json"));
await Promise.all([
  writeJson(resolve(outputDirectory, "manifest.json"), manifestData),
  writeJson(
    resolve(outputDirectory, "exchange-rates.json"),
    revenueExchangeRates,
  ),
  writeJson(resolve(outputDirectory, "subsectors.json"), subsectorData),
  writeJson(resolve(outputDirectory, "momentum.json"), momentumData),
  writeJson(resolve(outputDirectory, "freshness.json"), freshnessData),
  writeFile(
    resolve(outputDirectory, "dashboard-bundle.json.gz"),
    gzipSync(JSON.stringify(bundleData), { level: 9 }),
  ),
]);

console.log(
  `Built dashboard data for ${companies.length} companies, ` +
    `${Object.keys(subsectorSeries).length} subsectors, and ` +
    `${revenueRows.length} monthly observations.`,
);
