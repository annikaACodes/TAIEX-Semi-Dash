# Live Monthly Revenue Updates

## What Runs Automatically

The SQLite file remains the single database. A scheduled GitHub Actions workflow
polls the official sources, validates each response, updates the database, and
commits only meaningful changes.

- Days 1-16: every 30 minutes
- Days 17-31: every 6 hours for late filings and restatements
- Time interpretation: Asia/Taipei (UTC+8)
- Manual fallback: GitHub Actions > Update live monthly revenue > Run workflow

The same workflow checks the official Central Bank of Taiwan daily NTD/USD
series on every run. The database stores the arithmetic mean of the published
16:00 interbank spot rates for each calendar month. The current month's average
is revised as new business-day observations appear; completed months change only
if the Central Bank corrects its history. A no-change poll creates no commit, and
a temporary API failure preserves the verified monthly history.

Each revenue month is converted with its own monthly-average rate. USD cumulative
YTD revenue is the sum of the individually converted monthly amounts. MoM, YoY,
and YTD YoY remain the official NT$ growth rates in either currency view.

SQLite does not contain a clock or background process. The workflow in
`.github/workflows/live-monthly-revenue.yml` is the unattended scheduler.

## Source Priority

1. MOPS monthly revenue archive files are authoritative for revenue figures,
   first-observed publication times, and restatements.
2. Explicit monthly revenue announcements in the official MOPS historical
   material-information feed provide exact backfill dates when they match a
   stored revenue month; corrections and multi-month summaries are excluded.
3. Official company investor-relations calendars override forecast release dates.
4. A company's rolling 12-month report-date history drives its forecast.
5. A cross-company historical median provides a low-confidence cold-start
   estimate until the company has enough of its own observations.

The official backfill archive timestamps are not used as historical filing times:
the current archive server timestamp does not show when a company originally
published an old month. The rolling table is seeded from explicit MOPS revenue
announcements, official IR dates that match an existing MOPS revenue month, and
MOPS rows observed live by the updater. Live observations replace announcement
or IR seed dates for the same month.

Official inputs:

- MOPS archives:
  `https://mopsov.twse.com.tw/nas/t21/{market}/t21sc03_{roc_year}_{month}.csv`
- MOPS historical material information:
  `https://mops.twse.com.tw/mops/api/t05st01`
- TWSE holiday calendar:
  `https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule`
- Central Bank daily NTD/USD interbank spot rates:
  `https://cpx.cbc.gov.tw/API/DataAPI/Get?FileName=BP01D01`
- TSMC calendar:
  `https://investor.tsmc.com/english/financial-calendar`
- Hon Hai calendar:
  `https://www.honhai.com/en-us/investor-relations/investor-relations-activities/event-calendar`
- UMC calendar: `https://www.umc.com/en/IR/ir_overview`
- MediaTek calendar:
  `https://www.mediatek.com/investor-relations/ir-events`

More official IR calendars can be added to `config/ir_sources.json` after adding a
matching parser in `src/ir-parsers.mjs`.

## Forecast And Anomaly Logic

For each company, the model uses the median number of calendar days after
month-end across its latest 12 report dates. Median absolute deviation defines
the normal date window. One- and two-month company histories are blended toward
the median of company-level historical patterns; from three observations onward,
the company's own median is used without shrinkage.

- `high`: at least 6 trustworthy observations
- `medium`: 3-5 observations
- `low`: fewer than 3 observations or only the regulatory prior
- `history_expected_release_date_local`: the unchanged historical forecast
- `effective_expected_release_date_local`: historical estimate, IR override, or
  actual first-seen date
- `unusual_report_date`: binary `1` for an early, late, overdue, or
  after-deadline month
- `unusual_reason`: `EARLY`, `LATE`, `LATE_NOT_YET_REPORTED`, or
  `AFTER_REGULATORY_DEADLINE`

An official IR date becomes the effective expectation as soon as it is detected.
If no report arrives by the normal window, status becomes `overdue` while the
original expected date remains visible. The first new MOPS row resolves the month
to `reported`, preserves its first-seen UTC timestamp, and records the date in the
rolling history. The oldest row is removed automatically once a company exceeds
12 reporting months.

## Database Interfaces

- `company_release_profiles`: learned cadence and confidence by company
- `company_monthly_report_dates`: at most 12 report dates per company
- `company_report_date_history`: searchable English report-date history view
- `company_reporting_sources`: enabled official IR sources and parser health
- `company_release_events`: versioned dates detected on official IR calendars
- `monthly_release_schedule`: forecast, override, actual, status, and anomaly
  fields by company and reporting month
- `live_ingestion_runs`: audit rows for runs that changed the database
- `monthly_exchange_rates`: official monthly-average USD/TWD rates and source
  observation counts
- `monthly_usd_twd_exchange_rates`: searchable English monthly FX view
- `company_release_calendar`: searchable English release-calendar view
- `monthly_revenue_live`: revenue and release status in one English view

Example:

```sql
SELECT
    ticker,
    company_name_english,
    reporting_month,
    effective_expected_release_date_local,
    release_status,
    unusual_report_date,
    unusual_reason
FROM company_release_calendar
WHERE reporting_month = '2026-07-01'
ORDER BY effective_expected_release_date_local, ticker;
```

```sql
SELECT ticker, company_name_english, reporting_month,
       reported_date_local, report_date_basis
FROM company_report_date_history
ORDER BY ticker, reporting_month DESC;
```

## Local Operation

Requires Node.js 24 or newer; there are no third-party packages.

```powershell
node --test
node scripts/update-exchange-rate.mjs
node scripts/update-live-data.mjs
```

Numeric ingestion is never blocked by note translation. A failed translation is
stored as an English `pending` placeholder and retried on a later source poll.
Network retries, foreign-key checks, and `PRAGMA integrity_check` run before a
successful update completes.
