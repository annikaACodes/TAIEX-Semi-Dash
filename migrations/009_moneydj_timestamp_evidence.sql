DROP VIEW company_report_date_history;
DROP TRIGGER trim_company_monthly_report_dates_after_insert;
DROP INDEX idx_company_report_dates_local;
DROP TRIGGER IF EXISTS trim_company_monthly_publication_evidence_after_insert;
DROP INDEX idx_publication_evidence_company_month;

ALTER TABLE company_monthly_report_dates
RENAME TO company_monthly_report_dates_v8;

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
                'ir_calendar_matched',
                'cnyes_revenue_news',
                'moneydj_revenue_news'
            )
        ),
    source_priority INTEGER NOT NULL
        CHECK (source_priority IN (1, 2, 3, 4)),
    source_url TEXT,
    source_subject TEXT,
    first_recorded_at_utc TEXT NOT NULL,
    updated_at_utc TEXT NOT NULL,
    PRIMARY KEY (company_id, reporting_month)
);

INSERT INTO company_monthly_report_dates
SELECT * FROM company_monthly_report_dates_v8;

DROP TABLE company_monthly_report_dates_v8;

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

ALTER TABLE company_monthly_publication_evidence
RENAME TO company_monthly_publication_evidence_v8;

CREATE TABLE company_monthly_publication_evidence (
    evidence_id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL
        REFERENCES companies(company_id) ON DELETE CASCADE,
    reporting_month TEXT NOT NULL
        CHECK (reporting_month GLOB '[12][0-9][0-9][0-9]-[01][0-9]-01'),
    evidence_basis TEXT NOT NULL
        CHECK (
            evidence_basis IN (
                'cnyes_revenue_news',
                'moneydj_revenue_news'
            )
        ),
    source_record_id TEXT NOT NULL,
    published_at_utc TEXT NOT NULL,
    published_date_local TEXT NOT NULL,
    published_time_local TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_title TEXT NOT NULL,
    exact_original_timestamp INTEGER NOT NULL DEFAULT 0
        CHECK (exact_original_timestamp IN (0, 1)),
    matched_revenue_nt INTEGER NOT NULL,
    matched_mom_percent REAL,
    matched_yoy_percent REAL,
    first_recorded_at_utc TEXT NOT NULL,
    updated_at_utc TEXT NOT NULL,
    UNIQUE (evidence_basis, source_record_id)
);

INSERT INTO company_monthly_publication_evidence
SELECT * FROM company_monthly_publication_evidence_v8;

DROP TABLE company_monthly_publication_evidence_v8;

CREATE INDEX idx_publication_evidence_company_month
    ON company_monthly_publication_evidence (
        company_id,
        reporting_month,
        published_at_utc
    );

CREATE TRIGGER trim_company_monthly_publication_evidence_after_insert
AFTER INSERT ON company_monthly_publication_evidence
BEGIN
    DELETE FROM company_monthly_publication_evidence
    WHERE company_id = NEW.company_id
      AND reporting_month NOT IN (
          SELECT DISTINCT reporting_month
          FROM company_monthly_publication_evidence
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
    CASE
        WHEN d.report_date_basis IN (
            'mops_current_feed',
            'mops_revenue_announcement'
        ) THEN 1
        ELSE 0
    END AS exact_original_timestamp,
    d.first_recorded_at_utc,
    d.updated_at_utc
FROM company_monthly_report_dates AS d
JOIN companies AS c
    ON c.company_id = d.company_id;

PRAGMA user_version = 9;
