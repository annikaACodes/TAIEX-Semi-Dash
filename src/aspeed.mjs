import { reportingMonthFromName, utcToTaipeiParts } from "./dates.mjs";

export const ASPEED_TICKER = "5274";
export const ASPEED_ARCHIVE_API_URL =
  "https://www.aspeedtech.com/app/1/news_title";

const TITLE_PATTERN =
  /^ASPEED Reports (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4}) Revenue$/i;
const REVENUE_TOLERANCE_NT = 1_000;
const PERCENT_TOLERANCE = 0.06;

function payloadObject(payload) {
  return typeof payload === "string" ? JSON.parse(payload) : payload;
}

function successfulPayload(payload, label) {
  const parsed = payloadObject(payload);
  if (!parsed || parsed.success !== true) {
    throw new Error(`${label} returned an unsuccessful response`);
  }
  return parsed;
}

function parseTitle(title) {
  const match = TITLE_PATTERN.exec(String(title ?? "").trim());
  if (!match) return null;
  return {
    title: String(title).trim(),
    reportingMonth: reportingMonthFromName(match[1], Number(match[2])),
  };
}

function normalizeTimestamp(value, label) {
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf())) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return instant.toISOString();
}

function publicReleaseUrl(sourceRecordId) {
  return `https://www.aspeedtech.com/monthly_revenue_content/?id=${encodeURIComponent(
    sourceRecordId,
  )}`;
}

function htmlToText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function ntMillions(value, label) {
  const number = Number(String(value).replaceAll(",", ""));
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return Math.round(number * 1_000_000);
}

function signedPercent(direction, value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return direction.toLowerCase() === "decrease" ? -number : number;
}

function requiredMatch(text, pattern, label) {
  const match = pattern.exec(text);
  if (!match) throw new Error(`ASPEED release is missing ${label}`);
  return match;
}

export function aspeedArchivePageUrl(page = 1, limit = 20) {
  const url = new URL(ASPEED_ARCHIVE_API_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("type", "3");
  url.searchParams.set("sort", "-postTime");
  url.searchParams.set("lang", "en");
  return url.toString();
}

export function aspeedReleaseApiUrl(sourceRecordId) {
  return `https://www.aspeedtech.com/app/1/news/${encodeURIComponent(
    sourceRecordId,
  )}`;
}

export function parseAspeedArchivePage(payload) {
  const parsed = successfulPayload(payload, "ASPEED archive");
  if (!Array.isArray(parsed.data)) {
    throw new Error("ASPEED archive data is not an array");
  }
  const records = [];
  for (const row of parsed.data) {
    const title = parseTitle(row?.name);
    if (!title) continue;
    const sourceRecordId = String(row?._id ?? "").trim();
    if (!sourceRecordId) {
      throw new Error(`ASPEED archive entry has no id: ${title.title}`);
    }
    const publishedAtUtc = normalizeTimestamp(
      row.postTime,
      "ASPEED archive timestamp",
    );
    const local = utcToTaipeiParts(publishedAtUtc);
    records.push({
      ticker: ASPEED_TICKER,
      ...title,
      sourceRecordId,
      publishedAtUtc,
      publishedDateLocal: local.date,
      publishedTimeLocal: local.time,
      sourceUrl: publicReleaseUrl(sourceRecordId),
    });
  }
  return {
    records,
    hasNext: Boolean(parsed.pages?.hasNext),
    nextPage: parsed.pages?.next ? Number(parsed.pages.next) : null,
  };
}

export function parseAspeedRevenueRelease(payload) {
  const parsed = successfulPayload(payload, "ASPEED release");
  const data = parsed.data;
  if (!data || Number(data.type) !== 3) {
    throw new Error("ASPEED response is not a monthly revenue release");
  }
  const title = parseTitle(data.name);
  if (!title) throw new Error(`Unexpected ASPEED release title: ${data.name}`);
  const sourceRecordId = String(data._id ?? "").trim();
  if (!sourceRecordId) throw new Error("ASPEED release has no id");

  const content = htmlToText(data.content);
  if (!/(?:TWSE|TPEX)\s*:\s*5274\b/i.test(content)) {
    throw new Error("ASPEED release does not identify ticker 5274");
  }
  const revenue = requiredMatch(
    content,
    /\brevenue for [A-Za-z]+ was NT\$\s*([\d,]+(?:\.\d+)?)\s+million\b/i,
    "monthly revenue",
  );
  const mom = requiredMatch(
    content,
    /,\s+an?\s+(increase|decrease)\s+of\s+([\d.]+)%\s+from\b/i,
    "month-over-month change",
  );
  const yoy = requiredMatch(
    content,
    /\band\s+an?\s+(increase|decrease)\s+of\s+([\d.]+)%\s+compared to\b/i,
    "year-over-year change",
  );
  const ytd = requiredMatch(
    content,
    /\btotal revenue for \d{4}(?: year-to-date)? reached NT\$\s*([\d,]+(?:\.\d+)?)\s+million,\s+(?:marking|representing)\s+an?\s+([\d.]+)%\s+(increase|decrease)\b/i,
    "year-to-date revenue",
  );
  const publishedAtUtc = normalizeTimestamp(
    data.postTime,
    "ASPEED release timestamp",
  );
  const local = utcToTaipeiParts(publishedAtUtc);
  return {
    ticker: ASPEED_TICKER,
    ...title,
    sourceRecordId,
    publishedAtUtc,
    publishedDateLocal: local.date,
    publishedTimeLocal: local.time,
    sourceUrl: publicReleaseUrl(sourceRecordId),
    revenueNt: ntMillions(revenue[1], "monthly revenue"),
    momPercent: signedPercent(mom[1], mom[2], "month-over-month change"),
    yoyPercent: signedPercent(yoy[1], yoy[2], "year-over-year change"),
    cumulativeYtdRevenueNt: ntMillions(ytd[1], "year-to-date revenue"),
    ytdYoyPercent: signedPercent(ytd[3], ytd[2], "year-to-date change"),
  };
}

async function fetchJsonWithRetry(
  fetchFn,
  url,
  retryDelaysMs = [500, 1_000],
) {
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
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retryDelaysMs.length) {
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelaysMs[attempt]),
        );
      }
    }
  }
  throw new Error(`${url}: ${lastError?.message ?? "request failed"}`);
}

export async function fetchAspeedRevenueReleases({
  reportingMonths,
  fetchFn = globalThis.fetch,
  maxPages = 3,
} = {}) {
  const wanted = new Set(reportingMonths ?? []);
  if (wanted.size === 0) throw new Error("reportingMonths is required");

  const archiveByMonth = new Map();
  let page = 1;
  let requests = 0;
  while (page <= maxPages) {
    const payload = await fetchJsonWithRetry(
      fetchFn,
      aspeedArchivePageUrl(page),
    );
    requests += 1;
    const parsed = parseAspeedArchivePage(payload);
    for (const record of parsed.records) {
      if (wanted.has(record.reportingMonth)) {
        archiveByMonth.set(record.reportingMonth, record);
      }
    }
    if (
      [...wanted].every((month) => archiveByMonth.has(month)) ||
      !parsed.hasNext
    ) {
      break;
    }
    page = parsed.nextPage ?? page + 1;
  }

  const missing = [...wanted].filter((month) => !archiveByMonth.has(month));
  if (missing.length > 0) {
    throw new Error(`ASPEED archive is missing: ${missing.join(", ")}`);
  }

  const releases = [];
  for (const reportingMonth of [...wanted].sort()) {
    const archive = archiveByMonth.get(reportingMonth);
    const payload = await fetchJsonWithRetry(
      fetchFn,
      aspeedReleaseApiUrl(archive.sourceRecordId),
    );
    requests += 1;
    const release = parseAspeedRevenueRelease(payload);
    if (
      release.reportingMonth !== reportingMonth ||
      release.sourceRecordId !== archive.sourceRecordId ||
      release.publishedAtUtc !== archive.publishedAtUtc
    ) {
      throw new Error(`ASPEED archive/detail mismatch for ${reportingMonth}`);
    }
    releases.push(release);
  }
  return { releases, requests };
}

function percentMatches(left, right) {
  return (
    left === null ||
    left === undefined ||
    right === null ||
    right === undefined ||
    Math.abs(Number(left) - Number(right)) <= PERCENT_TOLERANCE
  );
}

export function matchAspeedRevenueRelease(release, observations) {
  return (
    observations.find(
      (observation) =>
        Math.abs(Number(observation.revenueNt) - release.revenueNt) <=
          REVENUE_TOLERANCE_NT &&
        Math.abs(
          Number(observation.cumulativeYtdRevenueNt) -
            release.cumulativeYtdRevenueNt,
        ) <= REVENUE_TOLERANCE_NT &&
        percentMatches(observation.momPercent, release.momPercent) &&
        percentMatches(observation.yoyPercent, release.yoyPercent) &&
        percentMatches(observation.ytdYoyPercent, release.ytdYoyPercent),
    ) ?? null
  );
}

export function syncAspeedPublicationEvidence(database, releases, nowUtc) {
  const company = database
    .prepare("SELECT company_id FROM companies WHERE ticker = ?")
    .get(ASPEED_TICKER);
  if (!company) throw new Error("Ticker 5274 is not in the database");
  const companyId = Number(company.company_id);
  const findObservations = database.prepare(`
    SELECT
      observation_id,
      revenue_nt AS revenueNt,
      mom_percent AS momPercent,
      yoy_percent AS yoyPercent,
      cumulative_ytd_revenue_nt AS cumulativeYtdRevenueNt,
      ytd_yoy_percent AS ytdYoyPercent,
      explicit_correction_flag AS explicitCorrectionFlag,
      (
        SELECT COUNT(*)
        FROM company_monthly_revenue_observations AS versions
        WHERE versions.company_id = observations.company_id
          AND versions.reporting_month = observations.reporting_month
      ) AS versionCount
    FROM company_monthly_revenue_observations AS observations
    WHERE company_id = ? AND reporting_month = ? AND is_current = 1
  `);
  const insertEvidence = database.prepare(`
    INSERT INTO company_monthly_publication_evidence (
      company_id,
      reporting_month,
      evidence_basis,
      source_record_id,
      published_at_utc,
      published_date_local,
      published_time_local,
      source_url,
      source_title,
      exact_original_timestamp,
      matched_revenue_nt,
      matched_mom_percent,
      matched_yoy_percent,
      first_recorded_at_utc,
      updated_at_utc
    ) VALUES (?, ?, 'company_ir_monthly_revenue', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT (evidence_basis, source_record_id) DO UPDATE SET
      company_id = excluded.company_id,
      reporting_month = excluded.reporting_month,
      published_at_utc = excluded.published_at_utc,
      published_date_local = excluded.published_date_local,
      published_time_local = excluded.published_time_local,
      source_url = excluded.source_url,
      source_title = excluded.source_title,
      matched_revenue_nt = excluded.matched_revenue_nt,
      matched_mom_percent = excluded.matched_mom_percent,
      matched_yoy_percent = excluded.matched_yoy_percent,
      updated_at_utc = excluded.updated_at_utc
    WHERE company_monthly_publication_evidence.company_id <> excluded.company_id
       OR company_monthly_publication_evidence.reporting_month <> excluded.reporting_month
       OR company_monthly_publication_evidence.published_at_utc <> excluded.published_at_utc
       OR company_monthly_publication_evidence.source_url <> excluded.source_url
       OR company_monthly_publication_evidence.source_title <> excluded.source_title
       OR company_monthly_publication_evidence.matched_revenue_nt <> excluded.matched_revenue_nt
       OR company_monthly_publication_evidence.matched_mom_percent IS NOT excluded.matched_mom_percent
       OR company_monthly_publication_evidence.matched_yoy_percent IS NOT excluded.matched_yoy_percent
  `);
  const upsertReportDate = database.prepare(`
    INSERT INTO company_monthly_report_dates (
      company_id,
      reporting_month,
      reported_date_local,
      reported_time_local,
      reported_at_utc,
      report_date_basis,
      source_priority,
      source_url,
      source_subject,
      first_recorded_at_utc,
      updated_at_utc
    ) VALUES (?, ?, ?, ?, ?, 'company_ir_monthly_revenue', 2, ?, ?, ?, ?)
    ON CONFLICT (company_id, reporting_month) DO UPDATE SET
      reported_date_local = excluded.reported_date_local,
      reported_time_local = excluded.reported_time_local,
      reported_at_utc = excluded.reported_at_utc,
      report_date_basis = excluded.report_date_basis,
      source_priority = excluded.source_priority,
      source_url = excluded.source_url,
      source_subject = excluded.source_subject,
      updated_at_utc = excluded.updated_at_utc
    WHERE excluded.source_priority < company_monthly_report_dates.source_priority
       OR (
         excluded.source_priority = company_monthly_report_dates.source_priority
         AND company_monthly_report_dates.report_date_basis NOT IN (
           'mops_current_feed',
           'mops_revenue_announcement'
         )
         AND (
           company_monthly_report_dates.report_date_basis <> excluded.report_date_basis
           OR company_monthly_report_dates.reported_at_utc IS NOT excluded.reported_at_utc
           OR company_monthly_report_dates.source_url IS NOT excluded.source_url
           OR company_monthly_report_dates.source_subject IS NOT excluded.source_subject
         )
       )
  `);
  const updateObservation = database.prepare(`
    UPDATE company_monthly_revenue_observations
    SET publication_timestamp_utc = ?,
        publication_timestamp_basis = 'COMPANY_IR_MONTHLY_REVENUE_EXACT'
    WHERE observation_id = ?
      AND is_current = 1
      AND explicit_correction_flag = 0
      AND publication_timestamp_basis NOT IN (
        'MOPS_CURRENT_REPORT_FEED_EXACT',
        'MOPS_MATERIAL_ANNOUNCEMENT_EXACT'
      )
      AND (
        publication_timestamp_utc IS NOT ?
        OR publication_timestamp_basis <> 'COMPANY_IR_MONTHLY_REVENUE_EXACT'
      )
  `);

  let matched = 0;
  let rejected = 0;
  let evidenceChanged = 0;
  let reportDatesChanged = 0;
  let publicationTimestampsChanged = 0;
  for (const release of releases) {
    if (release.ticker !== ASPEED_TICKER) {
      rejected += 1;
      continue;
    }
    const observations = findObservations.all(companyId, release.reportingMonth);
    const observation = matchAspeedRevenueRelease(release, observations);
    if (!observation) {
      rejected += 1;
      continue;
    }
    matched += 1;
    evidenceChanged += Number(
      insertEvidence.run(
        companyId,
        release.reportingMonth,
        release.sourceRecordId,
        release.publishedAtUtc,
        release.publishedDateLocal,
        release.publishedTimeLocal,
        release.sourceUrl,
        release.title,
        observation.revenueNt,
        observation.momPercent,
        observation.yoyPercent,
        nowUtc,
        nowUtc,
      ).changes,
    );
    reportDatesChanged += Number(
      upsertReportDate.run(
        companyId,
        release.reportingMonth,
        release.publishedDateLocal,
        release.publishedTimeLocal,
        release.publishedAtUtc,
        release.sourceUrl,
        release.title,
        nowUtc,
        nowUtc,
      ).changes,
    );
    if (
      Number(observation.explicitCorrectionFlag) === 0 &&
      Number(observation.versionCount) === 1
    ) {
      publicationTimestampsChanged += Number(
        updateObservation.run(
          release.publishedAtUtc,
          observation.observation_id,
          release.publishedAtUtc,
        ).changes,
      );
    }
  }
  return {
    articlesSeen: releases.length,
    matched,
    rejected,
    evidenceChanged,
    reportDatesChanged,
    publicationTimestampsChanged,
  };
}
