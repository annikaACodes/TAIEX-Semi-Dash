DROP VIEW company_report_date_history;
DROP TRIGGER trim_company_monthly_report_dates_after_insert;
DROP INDEX idx_company_report_dates_local;

ALTER TABLE company_monthly_report_dates
RENAME TO company_monthly_report_dates_v6;

CREATE TABLE company_monthly_report_dates (
    company_id INTEGER NOT NULL
        REFERENCES companies(company_id) ON DELETE CASCADE,
    reporting_month TEXT NOT NULL
        CHECK (reporting_month GLOB '[12][0-9][0-9][0-9]-[01][0-9]-01'),
    reported_date_local TEXT NOT NULL
        CHECK (reported_date_local GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
    reported_time_local TEXT
        CHECK (
            reported_time_local IS NULL
            OR reported_time_local GLOB '[0-2][0-9]:[0-5][0-9]:[0-5][0-9]'
        ),
    reported_at_utc TEXT,
    report_date_basis TEXT NOT NULL
        CHECK (
            report_date_basis IN (
                'mops_current_feed',
                'mops_first_observed',
                'mops_revenue_announcement',
                'ir_calendar_matched'
            )
        ),
    source_priority INTEGER NOT NULL
        CHECK (source_priority IN (1, 2, 3)),
    source_url TEXT,
    source_subject TEXT,
    first_recorded_at_utc TEXT NOT NULL,
    updated_at_utc TEXT NOT NULL,
    PRIMARY KEY (company_id, reporting_month)
);

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
)
SELECT
    company_id,
    reporting_month,
    reported_date_local,
    reported_time_local,
    reported_at_utc,
    report_date_basis,
    CASE report_date_basis
        WHEN 'mops_revenue_announcement' THEN 1
        WHEN 'mops_first_observed' THEN 2
        ELSE 3
    END,
    CASE report_date_basis
        WHEN 'mops_revenue_announcement'
            THEN 'https://mops.twse.com.tw/mops/web/t05st01'
        ELSE NULL
    END,
    NULL,
    first_recorded_at_utc,
    updated_at_utc
FROM company_monthly_report_dates_v6;

DROP TABLE company_monthly_report_dates_v6;

CREATE INDEX idx_company_report_dates_local
    ON company_monthly_report_dates (reported_date_local, company_id);

CREATE TRIGGER trim_company_monthly_report_dates_after_insert
AFTER INSERT ON company_monthly_report_dates
BEGIN
    DELETE FROM company_monthly_report_dates
    WHERE company_id = NEW.company_id
      AND reporting_month NOT IN (
          SELECT reporting_month
          FROM company_monthly_report_dates
          WHERE company_id = NEW.company_id
          ORDER BY reporting_month DESC
          LIMIT 12
      );
END;

CREATE VIEW company_report_date_history AS
SELECT
    c.company_id,
    c.ticker,
    c.company_name_english,
    c.classification_source_text AS classifications,
    d.reporting_month,
    d.reported_date_local,
    d.reported_time_local,
    d.reported_at_utc,
    d.report_date_basis,
    d.source_priority,
    d.source_url,
    d.source_subject,
    d.first_recorded_at_utc,
    d.updated_at_utc
FROM company_monthly_report_dates AS d
JOIN companies AS c
    ON c.company_id = d.company_id;

-- Material-information announcements preserve an exact official timestamp.
-- Promote it only when the stored revenue month has never been restated.
UPDATE company_monthly_revenue_observations
SET publication_timestamp_utc = (
        SELECT d.reported_at_utc
        FROM company_monthly_report_dates AS d
        WHERE d.company_id = company_monthly_revenue_observations.company_id
          AND d.reporting_month = company_monthly_revenue_observations.reporting_month
          AND d.report_date_basis = 'mops_revenue_announcement'
    ),
    publication_timestamp_basis = 'MOPS_MATERIAL_ANNOUNCEMENT_EXACT'
WHERE is_current = 1
  AND explicit_correction_flag = 0
  AND NOT EXISTS (
      SELECT 1
      FROM company_monthly_revenue_observations AS prior
      WHERE prior.company_id = company_monthly_revenue_observations.company_id
        AND prior.reporting_month = company_monthly_revenue_observations.reporting_month
        AND prior.observation_id <> company_monthly_revenue_observations.observation_id
  )
  AND EXISTS (
      SELECT 1
      FROM company_monthly_report_dates AS d
      WHERE d.company_id = company_monthly_revenue_observations.company_id
        AND d.reporting_month = company_monthly_revenue_observations.reporting_month
        AND d.report_date_basis = 'mops_revenue_announcement'
        AND d.reported_at_utc IS NOT NULL
  );

PRAGMA user_version = 7;
