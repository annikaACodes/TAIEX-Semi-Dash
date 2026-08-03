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
                'mops_first_observed',
                'mops_revenue_announcement',
                'ir_calendar_matched'
            )
        ),
    source_priority INTEGER NOT NULL
        CHECK (source_priority IN (1, 2, 3)),
    first_recorded_at_utc TEXT NOT NULL,
    updated_at_utc TEXT NOT NULL,
    PRIMARY KEY (company_id, reporting_month)
);

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

WITH ranked_ir_dates AS (
    SELECT
        e.company_id,
        e.reporting_month,
        e.announced_release_date_local,
        e.announced_release_time_local,
        e.announced_release_timestamp_utc,
        e.first_detected_at_utc,
        e.last_detected_at_utc,
        ROW_NUMBER() OVER (
            PARTITION BY e.company_id, e.reporting_month
            ORDER BY s.source_priority, e.release_event_id DESC
        ) AS source_rank
    FROM company_release_events AS e
    JOIN company_reporting_sources AS s
        ON s.reporting_source_id = e.reporting_source_id
    WHERE e.is_current = 1
      AND s.enabled = 1
      AND EXISTS (
          SELECT 1
          FROM company_monthly_revenue_observations AS o
          WHERE o.company_id = e.company_id
            AND o.reporting_month = e.reporting_month
            AND o.is_current = 1
      )
)
INSERT INTO company_monthly_report_dates (
    company_id,
    reporting_month,
    reported_date_local,
    reported_time_local,
    reported_at_utc,
    report_date_basis,
    source_priority,
    first_recorded_at_utc,
    updated_at_utc
)
SELECT
    company_id,
    reporting_month,
    announced_release_date_local,
    announced_release_time_local,
    announced_release_timestamp_utc,
    'ir_calendar_matched',
    3,
    first_detected_at_utc,
    last_detected_at_utc
FROM ranked_ir_dates
WHERE source_rank = 1;

INSERT INTO company_monthly_report_dates (
    company_id,
    reporting_month,
    reported_date_local,
    reported_time_local,
    reported_at_utc,
    report_date_basis,
    source_priority,
    first_recorded_at_utc,
    updated_at_utc
)
SELECT
    company_id,
    reporting_month,
    actual_first_seen_date_local,
    actual_first_seen_time_local,
    actual_first_seen_at_utc,
    'mops_first_observed',
    1,
    actual_first_seen_at_utc,
    updated_at_utc
FROM monthly_release_schedule
WHERE actual_first_seen_date_local IS NOT NULL
ON CONFLICT (company_id, reporting_month) DO UPDATE SET
    reported_date_local = excluded.reported_date_local,
    reported_time_local = excluded.reported_time_local,
    reported_at_utc = excluded.reported_at_utc,
    report_date_basis = excluded.report_date_basis,
    source_priority = excluded.source_priority,
    updated_at_utc = excluded.updated_at_utc
WHERE excluded.source_priority < company_monthly_report_dates.source_priority;

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
    d.first_recorded_at_utc,
    d.updated_at_utc
FROM company_monthly_report_dates AS d
JOIN companies AS c
    ON c.company_id = d.company_id;

PRAGMA user_version = 5;
