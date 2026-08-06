# Live Monthly Revenue Updates

## What Runs Automatically

The SQLite file remains the single database. A scheduled GitHub Actions workflow
polls the official sources plus one validated public-web timestamp fallback,
updates the database, and commits only meaningful changes.

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

MOPS requests use a longer staggered retry window for temporary redirects, rate
limits, timeouts, and server errors. If every MOPS market remains temporarily
unavailable, that poll is safely deferred without changing SQLite or failing the
workflow; the next scheduled poll tries again. Non-transient HTTP responses,
parser failures, database failures, and test failures still stop the workflow.

Each revenue month is converted with its own monthly-average rate. USD cumulative
YTD revenue is the sum of the individually converted monthly amounts. MoM, YoY,
and YTD YoY remain the official NT$ growth rates in either currency view.

SQLite does not contain a clock or background process. The workflow in
`.github/workflows/live-monthly-revenue.yml` is the unattended scheduler.

## Source Priority

Revenue figures and restatements always come from the official MOPS current feed
or monthly archives. Publication-time evidence uses this order:

1. Exact MOPS current-feed or material-announcement timestamp.
2. An exact official company monthly-revenue release timestamp whose metrics
   match the stored MOPS observation.
3. The updater's first observation of a new MOPS filing.
4. An official company investor-relations calendar date.
5. A Cnyes or MoneyDJ monthly-revenue article timestamp, labeled as a
   public-web proxy and accepted only when its identity and rounded metrics
   corroborate a stored MOPS observation. The earlier validated proxy wins.

An official IR calendar date overrides the forecast when available. Otherwise,
the company's rolling 12-month report-date history drives the forecast; a
cross-company median provides a low-confidence cold-start estimate.

MOPS archive server timestamps are not used as historical filing times because
they do not show when a company originally published an old month. MOPS does not
expose a free public historical receipt-time endpoint for all monthly revenue
filings. Exact history is backfilled only from official MOPS announcements or an
official company monthly-revenue release that matches the MOPS figures. A
corroborated Cnyes or MoneyDJ article can fill an otherwise unavailable date,
but it remains explicitly labeled as a non-original proxy and never overrides
MOPS or official IR evidence. Generic web search and earnings-call dates are not
used. A full-universe exact historical backfill still requires an approved
licensed source, such as a TEJ export, or TWSE's paid MOPS push data.

Official inputs:

- MOPS archives:
  `https://mopsov.twse.com.tw/nas/t21/{market}/t21sc03_{roc_year}_{month}.csv`
- MOPS latest financial/revenue reports:
  `https://mops.twse.com.tw/mops/api/home_page/t51sb10`
- MOPS historical material information:
  `https://mops.twse.com.tw/mops/api/t05st01`
- TWSE holiday calendar:
  `https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule`
- Central Bank daily NTD/USD interbank spot rates:
  `https://cpx.cbc.gov.tw/API/DataAPI/Get?FileName=BP01D01`
- ASPEED official monthly-revenue archive for ticker 5274 timestamps:
  `https://www.aspeedtech.com/app/1/news_title`

Validated timing fallback:

- Cnyes structured monthly-revenue category feed:
  `https://api.cnyes.com/media/api/v1/newslist/category/tw_revenue`
- MoneyDJ date-bounded revenue-news search, used only by the 12-month backfill:
  `https://www.moneydj.com/kmdj/search/list.aspx`
- TSMC calendar:
  `https://investor.tsmc.com/english/financial-calendar`
  (official Japanese and simplified-Chinese pages are transport fallbacks)
- Hon Hai calendar:
  `https://www.honhai.com/en-us/investor-relations/investor-relations-activities/event-calendar`
- UMC calendar: `https://www.umc.com/en/IR_Event/ir_events`
- MediaTek calendar:
  `https://www.mediatek.com/investor-relations/ir-events`

More official IR calendars can be added to `config/ir_sources.json` after adding a
matching parser in `src/ir-parsers.mjs`. Use `fallbackUrls` for equivalent pages
on the same company's official site when the primary page is intermittently
blocked. If every configured URL returns an access-denied response,
`historicalFallbackOnAccessDenied` preserves the last verified announcements
and uses the rolling historical estimate for uncovered months. Parse failures
and other unexpected responses remain ingestion errors.

## Forecast And Anomaly Logic

For each company, the model uses the median number of calendar days after
month-end across its latest 12 report dates. Median absolute deviation defines
the normal date window. One- and two-month company histories are blended toward
the median of company-level historical patterns; from three observations onward,
the company's own median is used without shrinkage. A reporting month's forecast
uses only dates from earlier reporting months, so the actual filing cannot leak
into its own expected date.

- `high`: at least 6 observations with at least one non-proxy date
- `medium`: 3-5 observations
- proxy-only history is capped at `medium`
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
to `reported`; an exact current-feed time supersedes the updater's first-observed
time when available. The oldest row is removed automatically once a company
exceeds 12 reporting months.

## Database Interfaces

- `company_release_profiles`: learned cadence and confidence by company
- `company_monthly_report_dates`: at most 12 report dates per company
- `company_report_date_history`: searchable English report-date history view
- `company_monthly_publication_evidence`: validated official IR and proxy
  publication provenance
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
node scripts/backfill-publication-dates.mjs --months 12
node scripts/backfill-aspeed-report-dates.mjs --months 12
```

The one-time backfill requests one bounded release-month window at a time and
uses MOPS company names to resolve MoneyDJ headlines to tickers. Live polls use
only Cnyes, with a two-minute overlap from the latest match and a seven-day
maximum lookback, so normal runs usually need one small feed request. On Windows,
`--curl` is available if the local Node network stack cannot reach Cnyes.

Numeric ingestion is never blocked by note translation. A failed translation is
stored as an English `pending` placeholder and retried on a later source poll.
Network retries, foreign-key checks, and `PRAGMA integrity_check` run before a
successful update completes.
