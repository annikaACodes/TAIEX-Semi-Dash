# Taiwan Semiconductor Revenue Monitor

Public research dashboard for monthly revenue reported by Taiwan-listed
semiconductor companies.

## Dashboard Views

- **Company:** Five-year company histories with revenue, MoM, YoY, cumulative
  YTD revenue, YTD YoY, publication timestamp, restatement status, and source.
- **Subsectors:** Classification-level aggregate revenue with simple or
  current-revenue-weighted YoY.
- **Acceleration:** Company rankings across MoM, rolling 3M, rolling 6M, and
  LTM revenue-growth acceleration for all names or a selected subsector.
- **Freshness:** Reported, pending, overdue, and unusual release timing for the
  active reporting month.
- **Exports:** CSV and Excel downloads for the data displayed in each view.

## Local Development

```bash
npm install
npm run dev
```

Run the complete validation suite:

```bash
npm test
npm run lint
```

## Data Generation

The dashboard assets are generated directly from the repository's SQLite
database:

```bash
node scripts/build-dashboard-data.mjs
```

The generator writes individual company histories, aggregate datasets, and
compressed/uncompressed application bundles under `public/data`.

## Publishing

`deploy-dashboard.yml` builds and deploys the static website to GitHub Pages on
every relevant `main` branch update. The monthly revenue updater regenerates
the dashboard assets before committing official-source changes, which then
triggers a fresh public deployment.
