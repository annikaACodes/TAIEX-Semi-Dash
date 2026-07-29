# Live Monthly Revenue Updates

## What Runs Automatically

The SQLite file remains the single database. A scheduled GitHub Actions workflow
polls the official sources, validates each response, updates the database, and
commits only meaningful changes.

- Days 1-16: every 30 minutes
- Days 17-31: every 6 hours for late filings and restatements
- Time interpretation: Asia/Taipei (UTC+8)
- Manual fallback: GitHub Actions > Update live monthly revenue > Run workflow

SQLite does not contain a clock or background process. The workflow in
`.github/workflows/live-monthly-revenue.yml` is the unattended scheduler.

## Source Priority

1. MOPS monthly revenue archive files are authoritative for revenue figures,
   first-observed publication times, and restatements.
2. Official company investor-relations calendars override forecast release dates.
3. A company's prospectively observed MOPS filing history drives its forecast.
4. The TWSE filing deadline and holiday calendar provide a low-confidence prior
   until trustworthy company history exists.

The official backfill archive timestamps are not used as historical filing times:
the current archive server timestamp does not show when a company originally
published an old month. The model therefore learns real filing times prospectively
and labels companies with no trustworthy history `low` confidence.

Official inputs:

- MOPS archives:
  `https://mopsov.twse.com.tw/nas/t21/{market}/t21sc03_{roc_year}_{month}.csv`
- TWSE holiday calendar:
  `https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule`
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

For each company, the model uses the median number of days after month-end and
the median Taipei release time. Median absolute deviation defines the normal
date window.

- `high`: at least 6 trustworthy observations
- `medium`: 3-5 observations
- `low`: fewer than 3 observations or only the regulatory prior
- `history_expected_release_date_local`: the unchanged historical forecast
- `effective_expected_release_date_local`: IR override, late roll-forward, or
  actual first-seen date
- `unusual_report_date`: binary `1` for an early, late, overdue, or
  after-deadline month
- `unusual_reason`: `EARLY`, `LATE`, `LATE_NOT_YET_REPORTED`, or
  `AFTER_REGULATORY_DEADLINE`

An official IR date becomes the effective expectation as soon as it is detected.
If no report arrives by the normal window, status becomes `overdue`, the
effective date rolls forward, and the binary unusual flag becomes `1`. The first
new MOPS row resolves the month to `reported` and preserves its first-seen UTC
timestamp.

## Database Interfaces

- `company_release_profiles`: learned cadence and confidence by company
- `company_reporting_sources`: enabled official IR sources and parser health
- `company_release_events`: versioned dates detected on official IR calendars
- `monthly_release_schedule`: forecast, override, actual, status, and anomaly
  fields by company and reporting month
- `live_ingestion_runs`: audit rows for runs that changed the database
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

## Local Operation

Requires Node.js 24 or newer; there are no third-party packages.

```powershell
node --test
node scripts/update-live-data.mjs
```

Numeric ingestion is never blocked by note translation. A failed translation is
stored as an English `pending` placeholder and retried on a later source poll.
Network retries, foreign-key checks, and `PRAGMA integrity_check` run before a
successful update completes.
