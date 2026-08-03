CREATE TABLE monthly_exchange_rates (
    rate_month TEXT PRIMARY KEY
        CHECK (rate_month GLOB '[12][0-9][0-9][0-9]-[01][0-9]-01'),
    base_currency TEXT NOT NULL DEFAULT 'USD'
        CHECK (base_currency = 'USD'),
    quote_currency TEXT NOT NULL DEFAULT 'TWD'
        CHECK (quote_currency = 'TWD'),
    average_twd_per_usd REAL NOT NULL
        CHECK (average_twd_per_usd BETWEEN 10 AND 100),
    daily_observation_count INTEGER NOT NULL
        CHECK (daily_observation_count > 0),
    first_observation_date TEXT NOT NULL
        CHECK (first_observation_date GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
    last_observation_date TEXT NOT NULL
        CHECK (last_observation_date GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
    average_method TEXT NOT NULL
        CHECK (average_method = 'arithmetic_mean_daily_1600_interbank_spot'),
    source_name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_last_updated_date TEXT,
    retrieved_at_utc TEXT NOT NULL
);

CREATE INDEX idx_monthly_exchange_rates_last_observation
    ON monthly_exchange_rates (last_observation_date DESC);

CREATE VIEW monthly_usd_twd_exchange_rates AS
SELECT
    rate_month,
    average_twd_per_usd,
    daily_observation_count,
    first_observation_date,
    last_observation_date,
    average_method,
    source_name,
    source_url,
    source_last_updated_date,
    retrieved_at_utc
FROM monthly_exchange_rates
ORDER BY rate_month;

PRAGMA user_version = 6;
