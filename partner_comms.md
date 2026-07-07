I like the enthusiasm. I have recieved further directions from the seniors on what they want this actual tool is for.

 Why this project matter: Taiwan-listed companies disclose sales every monthpthe highest frequency fundamental data avalable in any major equity market. For a semiconductor-heavy market, that means a neat-real-time read on the global chip cycle, and on the AI supply chain, weeks before quarterly earnings are reported and before the sell side updates its models. Our investment process is built on EPS revisions, and monthly sales are the earliest reliable input into whether estimates are heading up or down. A clean aggregated view of this dats by subsector (foundry, substrates, testing, memory, equipment, and so on) is a genuine research edge, and it will feed directly into our earnings-preview workflow>

Scope:
-Universe: Constituents of the TAIEK benchmark (the index ticker list is your starting universe), filtered down to semiconductor and semi-adjacent companies by your classification model in phase 3. 
Optional extension: TPEx (OTC-listed semiconductor names, which sit outside the TAIEX.
-History: Minimum 24 months of backfill. More is better-36 to 60 months enables seasonality and cycle analysos.
-Updates: fully automated. The system should know when each company is likely to report and capture the new figure shortly after it is published, with no manuel intervention.

Phase 1-Disclosure discovery(AI-led research)

Before writing a single scraper, use AI tools to Answer: when are monthly sales officialy disclosed, on what timeline, in what format, and what nuances?
Deliverable a 1-2 page written spec documenting the sources, the disclosure deadline, the data format, and the edge cases. Two things you must get right: (1) companies can publish more than one revenue basis-be explicit about which figure you are capturing and why it is the correct one; (2) figures are occasionally restated- decide how you will detect and handle restatements.

Phase 2- Capture and storage

Build the ingestion pipeline and backfill at least two years of history. Store the data in a queryable database with, at minimum:ticker, company name, month, revenue(NT$), MoM%, YoY%, cumulative YTD revenue and YTD YOY, publication timestamp, and a restatement flag. QC requirement: for a sample of companies, the sum of three months' sales must reconcile (approximately) to reported quarterly revenue-if it doesnt, you have almost certainly captured the wrong revenue basis. Document the reconciliation results.

Phase 3-AI classification

Use an LLM to classify every company in the universe into subsectors- for example:foundry, IC design/fabless memory, OSAT (assembly & test), substrates/PCB/CCL, semiconductor equipment, materials, IP & design services, distribution. The model should propose taxonomy itself and assign each company (multi-label where a company genuinely spans categories), with a one line rationale per company. Human spot-check random sample and report the audit accuracy. Non-semiconductor TAIEX names get filtered out at this stage.

Phase 4- Release date prediction and auto-update
Companies tend to report on consistent schedule month to month. Build a predictor of each companies likely release date from its own reporting history, schedule collection around it, and handle early and late reportiers gracefully. Target: new figures captured within 24hours of publication, with a log/alert when data lands and a flag when an expected release is overdue. 

Phase 5- Dashboard

Design and UX are yours-this part is deliberately open ended. Minimum functionality, however: (i) company level time series with MoM/YoY;(i) subsector agregates, both simple and revenue weighted YOY: (iii) a screen for accelerating vs decelerating names: (iv) freshness indicators showing what has reported this month and what is pending;(V) export to CSV/Excel. Beyond that impress us

Stretch Goals

-Alerting (email/Slack) when a company or subsector inflects meaningfully vs trend
-link monthly trends to each company's next earnings date and flag names tracking ahead of or behind consesus revenue for the quarter-this is the direct EPS-revision hook.
-NT$/USD toggle for comparing against companies that guide in USD.
Seasonality adjusted measures.

Success Criteria

1. Coverage:>95% of the classified semiconductor universe captured within 24 hours of release.
2. Accuracy: spot checked figures match the official source exactly, and the quarterly reconciliation check passes
3. History: at least 24 months backfilled across the whole universe.
4. Classification:>90% agreement with a human audit on a random sample, with rationales that make sense.
5. Usability:the PM can answer "which subsectors accelerated this month, and which companies drove it?" in under a minute, without instructions.

Working notes

Use AI aggresively at every stage: Keep notes on where AI got it write vs wrong
-respect the data sources terms of use and rate limits:build polite scrapers
document everythiing-architechture,data,dictionary runbook-so the tool survives after the internship ends