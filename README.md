# Taiwan Monthly Sales Dashboard

Research database and dashboard project for Taiwan-listed semiconductor-company
monthly revenue.

## Current Data

`taiwan_semiconductor_companies.sqlite` contains:

- 314 companies searchable by English company name, ticker, or classification
- Monthly revenue history in whole New Taiwan dollars
- Month-over-month, year-over-year, cumulative YTD, and YTD YoY metrics
- Publication timestamps and restatement flags
- A rolling 12-month company report-date history with source basis
- Release forecasts, official IR date overrides, first-seen times, confidence,
  status, and unusual-date flags

The database schema is version 7 and all user-facing tables and views are in
English.

## Automatic Updates

The GitHub workflow polls official MOPS and investor-relations sources without a
manual prompt. It checks every 30 minutes during the normal reporting window and
continues less frequently for late reports and restatements.

See `LIVE_UPDATES.md` for source precedence, forecast behavior, table definitions,
and local commands.

## Key Files

- `SOURCES_AND_DISCLOSURES.md`: approved source hierarchy
- `LIVE_UPDATES.md`: live collection and release-forecast specification
- `scripts/update-live-data.mjs`: updater entry point
- `config/ir_sources.json`: official IR calendar registry
- `migrations/005_rolling_report_dates.sql`: version-5 schema migration
- `migrations/005_mops_announcement_seeds.sql`: official historical date seeds
- `migrations/007_original_publication_timestamps.sql`: exact-time provenance
  and backfill migration
- `test/`: source parser and forecasting tests
