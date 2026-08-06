# Taiwan Monthly Sales Dashboard — Sources and Disclosures

Last reviewed: Draft — date to be updated  
Project status: Prototype / internal research tool

## 1. Purpose

This dashboard is intended to track Taiwan monthly sales / revenue momentum and compare those trends with selected Taiwan equity benchmarks.

The dashboard focuses on reported monthly operating revenue / sales data and related trend indicators, including year-over-year growth, month-over-month growth, rolling growth rates, breadth, sector contribution, and benchmark comparison.

This project is not intended to produce investment recommendations.

## 2. Primary Data Source: Taiwan Monthly Sales / Operating Revenue

### Source

Dataset name: Monthly Summary of Operating Income of Listed Companies  
Provider: Securities and Futures Bureau, Financial Supervisory Commission, Executive Yuan, R.O.C.  
Platform: Taiwan Government Open Data Platform  
Resource format: CSV  
Update frequency listed by provider: Daily  
License: Open Government Data License, version 1.0  
Charge: Free  

Source page:  
https://data.gov.tw/en/datasets/18420

CSV resource referenced by the source page:  
https://mopsfin.twse.com.tw/opendata/t187ap05_L.csv

### Intended Use in Dashboard

The dashboard will use this dataset to measure Taiwan listed-company monthly operating revenue trends.

Core metrics may include:

- Latest reported monthly revenue
- Year-over-year revenue growth
- Month-over-month revenue growth
- Three-month rolling year-over-year growth
- Revenue growth breadth
- Sector-level aggregation
- Top positive and negative contributors
- Concentration-adjusted views, including ex-largest-company analysis where appropriate

### Important Limitations

Monthly revenue is not earnings, profit, margin, cash flow, or valuation.

Monthly revenue may be affected by seasonality, Lunar New Year timing, company-specific reporting differences, product cycles, foreign exchange effects, and revisions.

The dashboard should clearly label all metrics as revenue / sales momentum indicators, not earnings indicators.

## 3. Benchmark Sources

### 3.1 TAIEX / Taiwan Capitalization Weighted Stock Index

Proposed benchmark name: TAIEX  
Also known as: Taiwan Capitalization Weighted Stock Index / TWSE Capitalization Weighted Stock Index  

Primary intended role:  
Broad local Taiwan equity benchmark.

Preferred source:  
Official TWSE / Taiwan Index Plus source, subject to validation before production use.

Prototype fallback:  
Publicly available market-data source may be used only for development and testing, subject to terms of use and licensing review.

Disclosure:  
TAIEX is used as a market benchmark for context only. Dashboard sales data is not index data and should not be interpreted as a direct replication of TAIEX performance.

### 3.2 MSCI Taiwan Index

Proposed benchmark name: MSCI Taiwan Index  
Provider: MSCI  

Primary intended role:  
Global institutional Taiwan equity benchmark.

Source page:  
https://www.msci.com/indexes/index/915800/msci-taiwan-index

Important licensing note:  
MSCI index data, constituent data, weights, history, and redistribution rights may be subject to MSCI licensing restrictions. MSCI data should not be downloaded, stored, redistributed, or displayed in production unless usage rights are confirmed.

Important concentration note:  
MSCI Taiwan Index may be highly concentrated in a small number of large companies. Dashboard commentary should avoid implying that MSCI Taiwan represents an equally weighted view of Taiwan corporate revenue trends.

## 4. Source Hierarchy

For revenue data, use the following priority:

1. Official Taiwan government / exchange / MOPS source
2. Company filings or company investor-relations data, if company-level validation is needed
3. Licensed data vendor data, if approved
4. Explicitly approved public web sources only as corroborating metadata; never
   as the authority for revenue figures

For ticker 5274, ASPEED's official monthly-revenue archive may supply the exact
company publication timestamp after its reporting month, revenue, MoM, YoY,
cumulative YTD revenue, and YTD YoY all match the stored MOPS observation. MOPS
remains authoritative for every revenue figure and restatement.

Approved narrow exceptions: the Cnyes structured `tw_revenue` feed and MoneyDJ's
date-bounded revenue-news search may supply publication-time proxies for the
latest 12 reporting months. Accept a record only after its company identity,
reporting month, rounded revenue, and available growth metrics match a stored
MOPS observation. Store the article URL and label the provider as a public-web
proxy; neither is an original filing timestamp, and neither may override exact
MOPS, MOPS first-observed, or an official IR calendar date. Do not use generic
news search or earnings-call dates for monthly-report timing.

If a company IR site denies automated access, retain the last verified
announcement and use the company's rolling historical release estimate for
uncovered months. Do not substitute any other public web source.

For benchmark data, use the following priority:

1. Licensed official benchmark-provider data
2. Licensed market-data vendor data
3. Public delayed benchmark data for prototype testing only, subject to terms of use

For USD translation, use the Central Bank of the Republic of China (Taiwan)
daily NTD/USD interbank spot series as the authoritative source:
https://cpx.cbc.gov.tw/API/DataAPI/Get?FileName=BP01D01

Revenue is translated using the arithmetic average of each calendar month's
published daily 16:00 rates. USD cumulative periods sum the individually
translated months. Source NT$ MoM, YoY, and YTD YoY rates are not recalculated.

## 5. Data Refresh and Timestamping

Every dashboard run should show:

- Data source
- Data retrieval date and time
- Latest reporting month included
- Number of companies included
- Number of companies excluded or missing
- Benchmark data date
- Whether the view includes or excludes the largest contributors

The dashboard should not say “latest” unless the latest available reporting month has been verified from the source file.

## 6. AI Commentary Rules

AI commentary, if used, must be based only on calculated dashboard metrics and documented sources.

AI commentary may describe:

- Acceleration or deceleration in revenue growth
- Sector leadership or weakness
- Breadth improvement or deterioration
- Concentration effects
- Divergence between revenue momentum and benchmark performance
- Data-quality caveats

AI commentary must not:

- Recommend buying, selling, or holding securities
- Predict future performance as fact
- Present unsupported causal explanations
- Use non-sourced market rumors
- Imply that revenue growth equals earnings growth
- Ignore concentration effects in Taiwan benchmarks

Suggested safe wording:

- “The latest reported monthly revenue data indicates...”
- “The dashboard shows...”
- “Revenue momentum improved / deteriorated based on...”
- “This should be interpreted as a sales trend indicator, not an earnings or valuation signal.”

Avoid:

- “This stock / index should rise.”
- “This proves earnings will improve.”
- “This is a buy / sell signal.”
- “The market is wrong.”

## 7. General Disclosures

This dashboard is a research and monitoring tool.

The information shown is derived from third-party and public data sources believed to be reliable, but accuracy, completeness, and timeliness are not guaranteed.

Revenue data may be revised or restated.

Benchmark data may be delayed, licensed, or subject to provider terms of use.

The dashboard does not provide investment advice, a recommendation, or an offer to buy or sell securities.

Past performance and historical revenue trends do not guarantee future results.

Any external distribution requires review and approval under applicable firm policies.

## 8. Open Data Attribution

Revenue data source attribution:

Securities and Futures Bureau, Financial Supervisory Commission, Executive Yuan, R.O.C. — Monthly Summary of Operating Income of Listed Companies.

The data is made available through the Taiwan Government Open Data Platform under the Open Government Data License, version 1.0.

License page:  
https://data.gov.tw/license

## 9. Items Requiring Review Before Production

- Confirm official source and permitted use for TAIEX historical data.
- Confirm whether MSCI Taiwan data can be used, stored, displayed, or redistributed.
- Confirm whether OTC / TPEx monthly revenue data should be included.
- Confirm company-to-sector mapping source.
- Confirm whether the dashboard is for personal/internal use only or broader internal distribution.
- Confirm approved disclosure language for firm use.
- Confirm whether AI-generated commentary requires review before display.
