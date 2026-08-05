import { differenceInDays, reportingMonthEnd } from "./dates.mjs";
import { matchCnyesRevenueArticle } from "./cnyes.mjs";
import { matchMoneydjRevenueArticle } from "./moneydj.mjs";

const SOURCES = {
  cnyes: {
    evidenceBasis: "cnyes_revenue_news",
    observationBasis: "CNYES_PUBLICATION_CORROBORATED_PROXY",
    matcher: matchCnyesRevenueArticle,
  },
  moneydj: {
    evidenceBasis: "moneydj_revenue_news",
    observationBasis: "MONEYDJ_PUBLICATION_CORROBORATED_PROXY",
    matcher: matchMoneydjRevenueArticle,
  },
};

function validPublicationWindow(article) {
  const daysAfterMonthEnd = differenceInDays(
    article.publishedDateLocal,
    reportingMonthEnd(article.reportingMonth),
  );
  return daysAfterMonthEnd >= 0 && daysAfterMonthEnd <= 45;
}

function syncPublicationEvidence(database, articles, nowUtc, source) {
  const companyByTicker = new Map(
    database
      .prepare("SELECT company_id, ticker FROM companies")
      .all()
      .map((row) => [String(row.ticker), Number(row.company_id)]),
  );
  const findObservations = database.prepare(`
    SELECT
      observation_id,
      revenue_nt AS revenueNt,
      mom_percent AS momPercent,
      yoy_percent AS yoyPercent,
      is_current AS isCurrent
    FROM company_monthly_revenue_observations
    WHERE company_id = ? AND reporting_month = ?
    ORDER BY is_current DESC, observation_id
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
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
    ) VALUES (?, ?, ?, ?, ?, ?, 4, ?, ?, ?, ?)
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
         AND excluded.reported_at_utc < company_monthly_report_dates.reported_at_utc
       )
  `);
  const updateObservation = database.prepare(`
    UPDATE company_monthly_revenue_observations
    SET publication_timestamp_utc = ?,
        publication_timestamp_basis = ?
    WHERE observation_id = ?
      AND is_current = 1
      AND (
        publication_timestamp_basis IS NULL
        OR publication_timestamp_basis =
          'MOPS_ARCHIVE_HTTP_LAST_MODIFIED_CURRENT_VERSION'
        OR (
          publication_timestamp_basis IN (
            'CNYES_PUBLICATION_CORROBORATED_PROXY',
            'MONEYDJ_PUBLICATION_CORROBORATED_PROXY'
          )
          AND publication_timestamp_utc > ?
        )
      )
  `);

  const acceptedByCompanyMonth = new Map();
  let matched = 0;
  let evidenceChanged = 0;
  let rejected = 0;
  for (const article of articles) {
    const companyId = companyByTicker.get(article.ticker);
    if (!companyId || !validPublicationWindow(article)) {
      rejected += 1;
      continue;
    }
    const observations = findObservations.all(
      companyId,
      article.reportingMonth,
    );
    const observation = source.matcher(article, observations);
    if (!observation) {
      rejected += 1;
      continue;
    }
    matched += 1;
    evidenceChanged += Number(
      insertEvidence.run(
        companyId,
        article.reportingMonth,
        source.evidenceBasis,
        article.sourceRecordId,
        article.publishedAtUtc,
        article.publishedDateLocal,
        article.publishedTimeLocal,
        article.sourceUrl,
        article.sourceTitle,
        observation.revenueNt,
        observation.momPercent,
        observation.yoyPercent,
        nowUtc,
        nowUtc,
      ).changes,
    );
    const key = `${companyId}|${article.reportingMonth}`;
    const prior = acceptedByCompanyMonth.get(key);
    if (!prior || article.publishedAtUtc < prior.article.publishedAtUtc) {
      acceptedByCompanyMonth.set(key, { article, companyId, observation });
    }
  }

  let reportDatesChanged = 0;
  let publicationTimestampsChanged = 0;
  for (const { article, companyId, observation } of acceptedByCompanyMonth.values()) {
    reportDatesChanged += Number(
      upsertReportDate.run(
        companyId,
        article.reportingMonth,
        article.publishedDateLocal,
        article.publishedTimeLocal,
        article.publishedAtUtc,
        source.evidenceBasis,
        article.sourceUrl,
        article.sourceTitle,
        nowUtc,
        nowUtc,
      ).changes,
    );
    if (Number(observation.isCurrent) === 1) {
      publicationTimestampsChanged += Number(
        updateObservation.run(
          article.publishedAtUtc,
          source.observationBasis,
          observation.observation_id,
          article.publishedAtUtc,
        ).changes,
      );
    }
  }

  return {
    articlesSeen: articles.length,
    matched,
    rejected,
    companyMonthsMatched: acceptedByCompanyMonth.size,
    evidenceChanged,
    reportDatesChanged,
    publicationTimestampsChanged,
  };
}

export function syncCnyesPublicationEvidence(database, articles, nowUtc) {
  return syncPublicationEvidence(database, articles, nowUtc, SOURCES.cnyes);
}

export function syncMoneydjPublicationEvidence(database, articles, nowUtc) {
  return syncPublicationEvidence(database, articles, nowUtc, SOURCES.moneydj);
}

export const publicationEvidenceBasis = {
  cnyesReportDate: SOURCES.cnyes.evidenceBasis,
  cnyesObservation: SOURCES.cnyes.observationBasis,
  moneydjReportDate: SOURCES.moneydj.evidenceBasis,
  moneydjObservation: SOURCES.moneydj.observationBasis,
};
