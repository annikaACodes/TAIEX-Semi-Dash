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
  const [manifest, subsectors, momentum, freshness, tsmc, compressedBundle] =
    await Promise.all([
    readJson("../public/data/manifest.json"),
    readJson("../public/data/subsectors.json"),
    readJson("../public/data/momentum.json"),
    readJson("../public/data/freshness.json"),
    readJson("../public/data/companies/2330.json"),
    readFile(new URL("../public/data/dashboard-bundle.json.gz", import.meta.url)),
  ]);
  const bundle = JSON.parse(gunzipSync(compressedBundle).toString("utf8"));

  assert.equal(manifest.companyCount, 314);
  assert.equal(manifest.companies.length, manifest.companyCount);
  assert.equal(manifest.revenueObservationCount, 18_446);
  assert.equal(
    Object.keys(subsectors.series).length,
    manifest.classificationCount,
  );
  assert.equal(momentum.companies.length, manifest.companyCount);
  assert.equal(freshness.companies.length, manifest.companyCount);
  assert.equal(
    freshness.summary.reported + freshness.summary.pending,
    manifest.companyCount,
  );
  assert.equal(tsmc.company.ticker, "2330");
  assert.ok(tsmc.history.length >= 60);
  assert.equal(bundle.manifest.companyCount, manifest.companyCount);
  assert.equal(Object.keys(bundle.companies).length, manifest.companyCount);
  assert.deepEqual(bundle.companies["2330"], tsmc);

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

  assert.ok(
    momentum.companies.every(
      (company) => company.accelerationPercentPoints !== null,
    ),
  );
  assert.match(subsectors.methodology.simple, /Arithmetic mean/i);
  assert.match(subsectors.methodology.revenueWeighted, /weighted/i);
});
