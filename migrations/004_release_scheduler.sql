ALTER TABLE monthly_revenue_note_translations
ADD COLUMN translation_status TEXT NOT NULL DEFAULT 'complete'
    CHECK (translation_status IN ('complete', 'pending'));

ALTER TABLE monthly_revenue_note_translations
ADD COLUMN last_translation_attempt_at_utc TEXT;

UPDATE monthly_revenue_note_translations
SET translation_provider = 'original_english',
    translation_status = 'complete',
    last_translation_attempt_at_utc = translated_at_utc
WHERE translation_provider = 'original_source_text';

CREATE TABLE company_reporting_sources (
    reporting_source_id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL
        REFERENCES companies(company_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL
        CHECK (source_type IN ('investor_relations_calendar')),
    source_url TEXT NOT NULL,
    parser_name TEXT NOT NULL,
    source_priority INTEGER NOT NULL DEFAULT 1
        CHECK (source_priority >= 1),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    last_relevant_content_sha256 TEXT
        CHECK (
            last_relevant_content_sha256 IS NULL
            OR length(last_relevant_content_sha256) = 64
        ),
    last_success_at_utc TEXT,
    last_error_at_utc TEXT,
    last_error_message TEXT,
    created_at_utc TEXT NOT NULL,
    updated_at_utc TEXT NOT NULL,
    UNIQUE (company_id, source_url)
);

CREATE TABLE company_release_events (
    release_event_id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL
        REFERENCES companies(company_id) ON DELETE CASCADE,
    reporting_source_id INTEGER NOT NULL
        REFERENCES company_reporting_sources(reporting_source_id)
            ON DELETE CASCADE,
    reporting_month TEXT NOT NULL
        CHECK (reporting_month GLOB '[12][0-9][0-9][0-9]-[01][0-9]-01'),
    announced_release_date_local TEXT NOT NULL
        CHECK (announced_release_date_local GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
    announced_release_time_local TEXT
        CHECK (
            announced_release_time_local IS NULL
            OR announced_release_time_local GLOB '[0-2][0-9]:[0-5][0-9]:[0-5][0-9]'
        ),
    announced_release_timestamp_utc TEXT,
    event_title TEXT NOT NULL,
    event_sha256 TEXT NOT NULL CHECK (length(event_sha256) = 64),
    first_detected_at_utc TEXT NOT NULL,
    last_detected_at_utc TEXT NOT NULL,
    is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
    UNIQUE (
        company_id,
        reporting_month,
        reporting_source_id,
        event_sha256
    )
);

CREATE TABLE company_release_profiles (
    company_id INTEGER PRIMARY KEY
        REFERENCES companies(company_id) ON DELETE CASCADE,
    history_sample_count INTEGER NOT NULL DEFAULT 0
        CHECK (history_sample_count >= 0),
    actual_first_seen_sample_count INTEGER NOT NULL DEFAULT 0
        CHECK (actual_first_seen_sample_count >= 0),
    ir_calendar_sample_count INTEGER NOT NULL DEFAULT 0
        CHECK (ir_calendar_sample_count >= 0),
    median_release_offset_days REAL,
    median_release_minute_local INTEGER
        CHECK (
            median_release_minute_local IS NULL
            OR median_release_minute_local BETWEEN 0 AND 1439
        ),
    median_absolute_deviation_days REAL,
    forecast_method TEXT NOT NULL
        CHECK (
            forecast_method IN (
                'regulatory_prior',
                'company_history'
            )
        ),
    confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
    profile_as_of_reporting_month TEXT,
    updated_at_utc TEXT NOT NULL
);

CREATE TABLE monthly_release_schedule (
    company_id INTEGER NOT NULL
        REFERENCES companies(company_id) ON DELETE CASCADE,
    reporting_month TEXT NOT NULL
        CHECK (reporting_month GLOB '[12][0-9][0-9][0-9]-[01][0-9]-01'),
    history_expected_release_date_local TEXT NOT NULL,
    history_expected_release_time_local TEXT,
    history_window_start_date_local TEXT NOT NULL,
    history_window_end_date_local TEXT NOT NULL,
    effective_expected_release_date_local TEXT NOT NULL,
    effective_expected_release_time_local TEXT,
    effective_expected_timestamp_utc TEXT,
    regulatory_deadline_date_local TEXT NOT NULL,
    schedule_source TEXT NOT NULL
        CHECK (
            schedule_source IN (
                'regulatory_prior',
                'company_history',
                'ir_calendar',
                'late_roll_forward',
                'actual_first_seen'
            )
        ),
    announced_release_date_local TEXT,
    announced_release_time_local TEXT,
    announced_release_timestamp_utc TEXT,
    actual_first_seen_at_utc TEXT,
    actual_first_seen_date_local TEXT,
    actual_first_seen_time_local TEXT,
    deviation_from_history_days INTEGER,
    unusual_report_date INTEGER NOT NULL DEFAULT 0
        CHECK (unusual_report_date IN (0, 1)),
    unusual_reason TEXT
        CHECK (
            unusual_reason IS NULL
            OR unusual_reason IN (
                'EARLY',
                'LATE',
                'AFTER_REGULATORY_DEADLINE',
                'LATE_NOT_YET_REPORTED'
            )
        ),
    release_status TEXT NOT NULL
        CHECK (
            release_status IN (
                'forecast',
                'announced',
                'reported',
                'overdue',
                'historical_backfill'
            )
        ),
    forecast_method TEXT NOT NULL,
    forecast_confidence TEXT NOT NULL
        CHECK (forecast_confidence IN ('low', 'medium', 'high')),
    history_sample_count INTEGER NOT NULL DEFAULT 0
        CHECK (history_sample_count >= 0),
    last_evaluated_at_utc TEXT NOT NULL,
    updated_at_utc TEXT NOT NULL,
    PRIMARY KEY (company_id, reporting_month)
);

CREATE TABLE live_ingestion_runs (
    ingestion_run_id INTEGER PRIMARY KEY,
    started_at_utc TEXT NOT NULL,
    completed_at_utc TEXT NOT NULL,
    target_reporting_month TEXT NOT NULL,
    mops_markets_checked INTEGER NOT NULL DEFAULT 0,
    ir_sources_checked INTEGER NOT NULL DEFAULT 0,
    ir_events_changed INTEGER NOT NULL DEFAULT 0,
    revenue_observations_inserted INTEGER NOT NULL DEFAULT 0,
    revenue_restatements_inserted INTEGER NOT NULL DEFAULT 0,
    schedules_changed INTEGER NOT NULL DEFAULT 0,
    translations_changed INTEGER NOT NULL DEFAULT 0,
    errors_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_reporting_sources_enabled
    ON company_reporting_sources (enabled, source_priority);

CREATE INDEX idx_release_events_company_month
    ON company_release_events (company_id, reporting_month, is_current);

CREATE INDEX idx_release_schedule_effective_date
    ON monthly_release_schedule (
        effective_expected_release_date_local,
        release_status
    );

CREATE INDEX idx_release_schedule_unusual
    ON monthly_release_schedule (
        unusual_report_date,
        reporting_month
    );

DROP VIEW monthly_revenue;

CREATE VIEW monthly_revenue AS
SELECT
    c.company_id,
    c.ticker,
    c.company_name_english,
    c.classification_source_text AS classifications,
    o.reporting_month,
    o.revenue_nt,
    o.mom_percent,
    o.yoy_percent,
    o.cumulative_ytd_revenue_nt,
    o.ytd_yoy_percent,
    o.publication_timestamp_utc AS publication_timestamp,
    CASE
        WHEN o.explicit_correction_flag = 1
          OR EXISTS (
              SELECT 1
              FROM company_monthly_revenue_observations AS prior
              WHERE prior.company_id = o.company_id
                AND prior.reporting_month = o.reporting_month
                AND prior.observation_id <> o.observation_id
          )
        THEN 1
        ELSE 0
    END AS restatement_flag,
    o.publication_timestamp_basis,
    sf.market_code AS source_market,
    sf.source_url,
    sf.source_report_date,
    sf.source_sha256,
    o.source_company_name_english AS source_company_name,
    o.source_industry_english AS source_industry,
    t.source_note_english AS source_note,
    t.translation_provider AS source_note_translation_provider,
    t.translation_status AS source_note_translation_status
FROM company_monthly_revenue_observations AS o
JOIN companies AS c
    ON c.company_id = o.company_id
JOIN monthly_revenue_source_files AS sf
    ON sf.source_file_id = o.source_file_id
LEFT JOIN monthly_revenue_note_translations AS t
    ON t.source_note_sha256 = o.source_note_sha256
WHERE o.is_current = 1;

CREATE VIEW company_release_calendar AS
SELECT
    c.company_id,
    c.ticker,
    c.company_name_english,
    c.classification_source_text AS classifications,
    s.reporting_month,
    s.history_expected_release_date_local,
    s.history_expected_release_time_local,
    s.history_window_start_date_local,
    s.history_window_end_date_local,
    s.effective_expected_release_date_local,
    s.effective_expected_release_time_local,
    s.effective_expected_timestamp_utc,
    s.regulatory_deadline_date_local,
    s.schedule_source,
    s.announced_release_date_local,
    s.announced_release_time_local,
    s.announced_release_timestamp_utc,
    s.actual_first_seen_at_utc,
    s.actual_first_seen_date_local,
    s.actual_first_seen_time_local,
    s.deviation_from_history_days,
    s.unusual_report_date,
    s.unusual_reason,
    s.release_status,
    s.forecast_method,
    s.forecast_confidence,
    s.history_sample_count,
    s.updated_at_utc
FROM monthly_release_schedule AS s
JOIN companies AS c
    ON c.company_id = s.company_id;

CREATE VIEW monthly_revenue_live AS
SELECT
    r.*,
    s.history_expected_release_date_local,
    s.effective_expected_release_date_local,
    s.effective_expected_release_time_local,
    s.regulatory_deadline_date_local,
    s.schedule_source AS release_schedule_source,
    s.announced_release_date_local,
    s.actual_first_seen_at_utc,
    s.deviation_from_history_days AS release_date_deviation_days,
    s.unusual_report_date,
    s.unusual_reason,
    s.release_status,
    s.forecast_confidence AS release_forecast_confidence
FROM monthly_revenue AS r
LEFT JOIN monthly_release_schedule AS s
    ON s.company_id = r.company_id
   AND s.reporting_month = r.reporting_month;

PRAGMA user_version = 4;
