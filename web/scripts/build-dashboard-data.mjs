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
    controlLabel: "MoM vs prior month",
  },
  {
    id: "3m",
    months: 3,
    label: "3M",
    controlLabel: "3M vs prior 3M",
  },
  {
    id: "6m",
    months: 6,
    label: "6M",
    controlLabel: "6M vs prior 6M",
  },
  {
    id: "ltm",
    months: 12,
    label: "LTM",
    controlLabel: "LTM vs prior LTM",
  },
];

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
            unusual_reason, release_status, forecast_confidence
       FROM company_release_calendar
      ORDER BY reporting_month, company_id`,
  )
  .all();

database.close();

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
  const item = {
    month: monthKey(row.reporting_month),
    revenueNt: nullableNumber(row.revenue_nt),
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
const previousRevenueMonth = shiftMonth(latestRevenueMonth, -1);

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

function momentumPeriodForCompany(companyId, definition) {
  const currentRevenue = periodRevenue(
    companyId,
    latestRevenueMonth,
    definition.months,
  );
  const priorRevenue = periodRevenue(
    companyId,
    shiftMonth(latestRevenueMonth, -definition.months),
    definition.months,
  );
  const baselineRevenue = periodRevenue(
    companyId,
    shiftMonth(latestRevenueMonth, -definition.months * 2),
    definition.months,
  );
  const currentGrowth = periodGrowth(currentRevenue, priorRevenue);
  const previousGrowth = periodGrowth(priorRevenue, baselineRevenue);
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
  MOMENTUM_PERIOD_DEFINITIONS.map((definition) => {
    const currentEndMonth = latestRevenueMonth;
    const priorEndMonth = shiftMonth(
      latestRevenueMonth,
      -definition.months,
    );
    const baselineEndMonth = shiftMonth(
      latestRevenueMonth,
      -definition.months * 2,
    );
    return [
      definition.id,
      {
        months: definition.months,
        label: definition.label,
        controlLabel: definition.controlLabel,
        currentPeriodStartMonth: shiftMonth(
          currentEndMonth,
          -(definition.months - 1),
        ),
        currentPeriodEndMonth: currentEndMonth,
        priorPeriodStartMonth: shiftMonth(
          priorEndMonth,
          -(definition.months - 1),
        ),
        priorPeriodEndMonth: priorEndMonth,
        baselinePeriodStartMonth: shiftMonth(
          baselineEndMonth,
          -(definition.months - 1),
        ),
        baselinePeriodEndMonth: baselineEndMonth,
      },
    ];
  }),
);

const momentum = companyRows.map((company) => {
  const current = revenueByCompanyMonth.get(
    `${company.company_id}:${latestRevenueMonth}`,
  );
  const previous = revenueByCompanyMonth.get(
    `${company.company_id}:${previousRevenueMonth}`,
  );
  const acceleration =
    current?.yoyPercent !== null &&
    current?.yoyPercent !== undefined &&
    previous?.yoyPercent !== null &&
    previous?.yoyPercent !== undefined
      ? round(current.yoyPercent - previous.yoyPercent)
      : null;
  const direction =
    acceleration === null
      ? "unavailable"
      : acceleration > 0
        ? "accelerating"
        : acceleration < 0
          ? "decelerating"
          : "unchanged";
  return {
    companyId: Number(company.company_id),
    ticker: String(company.ticker),
    name: String(company.company_name_english),
    classification:
      classificationsByCompany.get(company.company_id)?.[0] ?? "Unclassified",
    latestMonth: current?.month ?? null,
    latestRevenueNt: current?.revenueNt ?? null,
    momPercent: current?.momPercent ?? null,
    yoyPercent: current?.yoyPercent ?? null,
    previousYoyPercent: previous?.yoyPercent ?? null,
    ytdYoyPercent: current?.ytdYoyPercent ?? null,
    accelerationPercentPoints: acceleration,
    direction,
    periods: Object.fromEntries(
      MOMENTUM_PERIOD_DEFINITIONS.map((definition) => [
        definition.id,
        momentumPeriodForCompany(company.company_id, definition),
      ]),
    ),
  };
});

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
    forecastConfidence: nullableNumber(schedule?.forecast_confidence),
    releaseStatus: reported
      ? "reported"
      : (schedule?.release_status ?? "pending"),
    overdue: !reported && expectedDate !== null && expectedDate < asOfDateTaipei,
    unusualReportDate: Number(schedule?.unusual_report_date) === 1,
    unusualReason: schedule?.unusual_reason ?? null,
    deviationFromHistoryDays: nullableNumber(
      schedule?.deviation_from_history_days,
    ),
    publicationTimestamp: revenue?.publicationTimestamp ?? null,
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
  companyCount: companies.length,
  classificationCount: Object.keys(subsectorSeries).length,
  revenueObservationCount: revenueRows.length,
  companies,
};
const subsectorData = {
  latestRevenueMonth,
  methodology: {
    simple:
      "Arithmetic mean of reported company YoY percentages in the subsector.",
    revenueWeighted:
      "Mean of reported company YoY percentages weighted by current-month revenue.",
  },
  series: subsectorSeries,
};
const momentumData = {
  latestRevenueMonth,
  previousRevenueMonth,
  periods: momentumPeriods,
  companies: momentum,
};
const freshnessData = {
  asOfDateTaipei,
  targetReportingMonth,
  summary: freshnessSummary,
  companies: freshnessRows,
};
const bundleData = {
  manifest: manifestData,
  subsectors: subsectorData,
  momentum: momentumData,
  freshness: freshnessData,
  companies: companyDataByTicker,
};

await mkdir(outputDirectory, { recursive: true });
await removeFileIfPresent(resolve(outputDirectory, "dashboard-bundle.json"));
await Promise.all([
  writeJson(resolve(outputDirectory, "manifest.json"), manifestData),
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
