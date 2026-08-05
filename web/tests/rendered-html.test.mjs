import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gunzipSync } from "node:zlib";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

async function render() {
  const worker = await loadWorker();
  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(new URL(relativePath, import.meta.url), "utf8"),
  );
}

test("static Pages loader fetches historical exchange rates", async () => {
  const source = await readFile(
    new URL("../app/Dashboard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /fetchStaticJson<MonthlyExchangeRate\[\]>\("\.\/data\/exchange-rates\.json"\)/,
  );
  assert.match(source, /return \{ manifest, exchangeRates, subsectors/);
  assert.match(source, /fetch\(path, \{ cache: "no-store" \}\)/);
});

test("server-renders the finance dashboard shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>Taiwan Semiconductor Revenue Monitor<\/title>/i,
  );
  assert.match(html, /Taiwan Semiconductor Revenue Monitor/);
  assert.match(html, /Monthly revenue intelligence/);
  assert.match(html, /Company/);
  assert.match(html, /Subsectors/);
  assert.match(html, /Acceleration/);
  assert.match(html, /Freshness/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("serves and accepts the compressed live dashboard bundle", async () => {
  const worker = await loadWorker();
  const compressedBundle = await readFile(
    new URL("../public/data/dashboard-bundle.json.gz", import.meta.url),
  );
  let storedBundle = null;
  const environment = {
    ASSETS: {
      fetch: async () =>
        new Response(compressedBundle, {
          headers: { "Content-Type": "application/gzip" },
        }),
    },
    DATA: {
      get: async () => null,
      put: async (_key, body) => {
        storedBundle = Buffer.from(await new Response(body).arrayBuffer());
      },
    },
    DASHBOARD_SYNC_TOKEN: "test-token",
  };
  const context = {
    waitUntil() {},
    passThroughOnException() {},
  };

  const getResponse = await worker.fetch(
    new Request("http://localhost/api/dashboard-bundle"),
    environment,
    context,
  );
  assert.equal(getResponse.status, 200);
  assert.equal(getResponse.headers.get("content-encoding"), "gzip");
  assert.deepEqual(
    Buffer.from(await getResponse.arrayBuffer()),
    compressedBundle,
  );

  const unauthorized = await worker.fetch(
    new Request("http://localhost/api/dashboard-bundle", {
      method: "PUT",
      body: compressedBundle,
    }),
    environment,
    context,
  );
  assert.equal(unauthorized.status, 401);

  const updateResponse = await worker.fetch(
    new Request("http://localhost/api/dashboard-bundle", {
      method: "PUT",
      headers: { Authorization: "Bearer test-token" },
      body: compressedBundle,
    }),
    environment,
    context,
  );
  assert.equal(updateResponse.status, 200);
  assert.deepEqual(storedBundle, compressedBundle);
});

test("ships complete, internally consistent dashboard data", async () => {
  const [
    manifest,
    exchangeRates,
    subsectors,
    momentum,
    freshness,
    tsmc,
    compressedBundle,
  ] = await Promise.all([
    readJson("../public/data/manifest.json"),
    readJson("../public/data/exchange-rates.json"),
    readJson("../public/data/subsectors.json"),
    readJson("../public/data/momentum.json"),
    readJson("../public/data/freshness.json"),
    readJson("../public/data/companies/2330.json"),
    readFile(new URL("../public/data/dashboard-bundle.json.gz", import.meta.url)),
  ]);
  const bundle = JSON.parse(gunzipSync(compressedBundle).toString("utf8"));

  assert.equal(manifest.companyCount, 314);
  assert.equal(manifest.companies.length, manifest.companyCount);
  assert.ok(manifest.revenueObservationCount >= 18_446);
  assert.equal(manifest.exchangeRateHistory.baseCurrency, "USD");
  assert.equal(manifest.exchangeRateHistory.quoteCurrency, "TWD");
  assert.equal(
    manifest.exchangeRateHistory.averageMethod,
    "arithmetic_mean_daily_1600_interbank_spot",
  );
  assert.match(manifest.exchangeRateHistory.sourceName, /Central Bank/i);
  assert.equal(
    manifest.exchangeRateHistory.monthlyRateCount,
    exchangeRates.length,
  );
  assert.equal(
    exchangeRates.at(-1).month,
    manifest.exchangeRateHistory.coverageEndMonth,
  );
  assert.equal(
    Object.keys(subsectors.series).length,
    manifest.classificationCount,
  );
  assert.equal(subsectors.monthOptions.length, 3);
  assert.equal(subsectors.monthOptions[0], manifest.latestRevenueMonth);
  assert.deepEqual(
    Object.keys(subsectors.snapshots),
    ["mix", ...subsectors.monthOptions],
  );
  assert.deepEqual(momentum.monthOptions, subsectors.monthOptions);
  assert.deepEqual(Object.keys(momentum.snapshots), [
    "mix",
    ...momentum.monthOptions,
  ]);
  assert.deepEqual(Object.keys(momentum.periods), [
    "mom",
    "yoy",
    "3m",
    "6m",
    "ltm",
  ]);
  assert.deepEqual(
    Object.values(momentum.periods).map((period) => period.controlLabel),
    ["MoM", "YoY", "3M/3M", "6M/6M", "LTM YoY"],
  );
  for (const companies of Object.values(momentum.snapshots)) {
    assert.equal(companies.length, manifest.companyCount);
    assert.equal(
      new Set(companies.map((company) => company.classification)).size,
      manifest.classificationCount,
    );
  }
  assert.equal(freshness.companies.length, manifest.companyCount);
  assert.equal(
    freshness.summary.reported + freshness.summary.pending,
    manifest.companyCount,
  );
  assert.equal(
    freshness.summary.overdue,
    freshness.companies.filter((company) => company.overdue).length,
  );
  assert.ok(
    freshness.companies.every(
      (company) =>
        company.overdue ===
        (!company.reported && company.releaseStatus === "overdue"),
    ),
  );
  assert.equal(tsmc.company.ticker, "2330");
  assert.ok(tsmc.history.length >= 60);
  assert.equal(bundle.manifest.companyCount, manifest.companyCount);
  assert.deepEqual(
    bundle.manifest.exchangeRateHistory,
    manifest.exchangeRateHistory,
  );
  assert.deepEqual(bundle.exchangeRates, exchangeRates);
  assert.equal(Object.keys(bundle.companies).length, manifest.companyCount);
  assert.equal(
    Object.values(bundle.companies).reduce(
      (total, company) => total + company.history.length,
      0,
    ),
    manifest.revenueObservationCount,
  );
  assert.deepEqual(bundle.companies["2330"], tsmc);
  assert.deepEqual(bundle.subsectors, subsectors);
  assert.deepEqual(bundle.momentum, momentum);

  const manifestByTicker = new Map(
    manifest.companies.map((company) => [company.ticker, company]),
  );
  for (const [analysisKey, snapshots] of Object.entries(
    subsectors.snapshots,
  )) {
    assert.deepEqual(
      Object.keys(snapshots).sort(),
      Object.keys(subsectors.series).sort(),
    );
    for (const [classification, snapshot] of Object.entries(snapshots)) {
      assert.equal(snapshot.month, analysisKey);
      assert.equal(
        snapshot.companies.filter((company) => company.revenueNt !== null)
          .length,
        snapshot.reportingCompanies,
      );
      assert.equal(
        snapshot.companies.reduce(
          (total, company) => total + (company.revenueNt ?? 0),
          0,
        ),
        snapshot.aggregateRevenueNt,
      );

      if (analysisKey === "mix") {
        for (const company of snapshot.companies) {
          assert.equal(
            company.reportingMonth,
            manifestByTicker.get(company.ticker)?.latestMonth ?? null,
          );
        }
      } else {
        assert.ok(
          snapshot.companies.every(
            (company) =>
              company.reportingMonth === null ||
              company.reportingMonth === analysisKey,
          ),
        );
        const seriesRow = subsectors.series[classification].find(
          (row) => row.month === analysisKey,
        );
        assert.equal(
          snapshot.aggregateRevenueNt,
          seriesRow?.aggregateRevenueNt ?? 0,
        );
        assert.equal(
          snapshot.reportingCompanies,
          seriesRow?.reportingCompanies ?? 0,
        );
      }

      const companiesWithYoy = snapshot.companies.filter(
        (company) => company.yoyPercent !== null,
      );
      if (companiesWithYoy.length === 0) {
        assert.equal(snapshot.simpleYoyPercent, null);
      } else {
        const calculatedSimpleYoy =
          companiesWithYoy.reduce(
            (total, company) => total + company.yoyPercent,
            0,
          ) / companiesWithYoy.length;
        assert.ok(
          Math.abs(calculatedSimpleYoy - snapshot.simpleYoyPercent) <= 0.01,
          `${analysisKey} ${classification} simple YoY does not reconcile`,
        );
      }

      const companiesWithWeightedYoy = companiesWithYoy.filter(
        (company) => company.revenueNt > 0,
      );
      if (companiesWithWeightedYoy.length === 0) {
        assert.equal(snapshot.revenueWeightedYoyPercent, null);
      } else {
        const weightedRevenue = companiesWithWeightedYoy.reduce(
          (total, company) => total + company.revenueNt,
          0,
        );
        const calculatedWeightedYoy =
          companiesWithWeightedYoy.reduce(
            (total, company) =>
              total + company.yoyPercent * company.revenueNt,
            0,
          ) / weightedRevenue;
        assert.ok(
          Math.abs(
            calculatedWeightedYoy - snapshot.revenueWeightedYoyPercent,
          ) <= 0.01,
          `${analysisKey} ${classification} weighted YoY does not reconcile`,
        );
      }
    }
  }

  assert.ok(
    Object.values(subsectors.snapshots.mix).some((snapshot) =>
      snapshot.companies.some((company) => company.ticker === "2330"),
    ),
  );

  const latest = tsmc.history.at(-1);
  for (const key of [
    "revenueNt",
    "momPercent",
    "yoyPercent",
    "cumulativeYtdRevenueNt",
    "ytdYoyPercent",
    "publicationTimestamp",
    "restatementFlag",
  ]) {
    assert.ok(key in latest, `TSMC history is missing ${key}`);
  }
  assert.equal("revenueUsd" in latest, false);

  const exchangeRateByMonth = new Map(
    exchangeRates.map((rate) => [rate.month, rate]),
  );
  const latestYearRows = tsmc.history.filter((row) =>
    row.month.startsWith(latest.month.slice(0, 4)),
  );
  let cumulativeUsd = 0;
  for (const row of latestYearRows) {
    const rate = exchangeRateByMonth.get(row.month);
    assert.ok(rate, `Missing exchange rate for ${row.month}`);
    cumulativeUsd += row.revenueNt / rate.averageTwdPerUsd;
    assert.ok(cumulativeUsd > 0);
    assert.equal(typeof row.yoyPercent, "number");
    assert.equal(typeof row.ytdYoyPercent, "number");
  }

  for (const [analysisKey, companies] of Object.entries(momentum.snapshots)) {
    for (const company of companies) {
      assert.equal(
        company.analysisMonth,
        analysisKey === "mix"
          ? manifestByTicker.get(company.ticker)?.latestMonth
          : analysisKey,
      );
    }
  }
  const latestFixedMomentum = momentum.snapshots[momentum.monthOptions[0]];
  const pendingLatestCompany = latestFixedMomentum.find(
    (company) =>
      manifestByTicker.get(company.ticker)?.latestMonth !==
      momentum.monthOptions[0],
  );
  assert.ok(pendingLatestCompany);
  assert.equal(pendingLatestCompany.periods.yoy.direction, "unavailable");

  const tsmcMomentum = momentum.snapshots.mix.find(
    (company) => company.ticker === "2330",
  );
  assert.ok(tsmcMomentum);
  for (const period of ["mom", "yoy", "3m", "6m", "ltm"]) {
    assert.ok(
      momentum.snapshots.mix.every((company) => company.periods?.[period]),
      `Momentum data is missing the ${period} period`,
    );
    const result = tsmcMomentum.periods[period];
    for (const key of [
      "currentPeriodRevenueNt",
      "priorPeriodRevenueNt",
      "currentGrowthPercent",
      "previousGrowthPercent",
      "accelerationPercentPoints",
      "direction",
    ]) {
      assert.ok(key in result, `TSMC ${period} momentum is missing ${key}`);
    }
    assert.ok(result.currentPeriodRevenueNt > 0);
    assert.ok(result.priorPeriodRevenueNt > 0);
    assert.ok(
      Math.abs(
        result.currentGrowthPercent -
          result.previousGrowthPercent -
          result.accelerationPercentPoints,
      ) <= 0.02,
    );
    assert.equal(
      result.direction,
      result.accelerationPercentPoints > 0
        ? "accelerating"
        : result.accelerationPercentPoints < 0
          ? "decelerating"
          : "unchanged",
    );
  }
  assert.ok(
    Math.abs(tsmcMomentum.periods.yoy.currentGrowthPercent - latest.yoyPercent) <=
      0.02,
  );
  assert.ok(
    Math.abs(
      tsmcMomentum.periods.yoy.previousGrowthPercent -
        tsmc.history.at(-2).yoyPercent,
    ) <= 0.02,
  );
  assert.match(subsectors.methodology.simple, /Arithmetic mean/i);
  assert.match(subsectors.methodology.revenueWeighted, /weighted/i);
});
