import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { backfillPublicationDates } from "../src/publication-backfill.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const databasePath = resolve(
  argumentValue("--database") ??
    `${repositoryRoot}/taiwan_semiconductor_companies.sqlite`,
);
const monthCount = Number(argumentValue("--months") ?? 12);
const nowUtc = argumentValue("--now") ?? new Date().toISOString();
const useCurl = process.argv.includes("--curl");
const cnyesOnly = process.argv.includes("--cnyes-only");
const moneydjOnly = process.argv.includes("--moneydj-only");
const execFileAsync = promisify(execFile);

if ([cnyesOnly, moneydjOnly].filter(Boolean).length > 1) {
  throw new Error("Use only one source-selection flag at a time");
}

async function curlFetch(url) {
  const { stdout } = await execFileAsync(
    process.platform === "win32" ? "curl.exe" : "curl",
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--connect-timeout",
      "15",
      "--max-time",
      "30",
      "--header",
      "Accept: application/json",
      "--header",
      "User-Agent: TAIEX-Semi-Dash/1.0",
      url,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  return new Response(stdout, { status: 200 });
}

try {
  const result = await backfillPublicationDates({
    databasePath,
    monthCount,
    nowUtc,
    fetchFn: useCurl ? curlFetch : globalThis.fetch,
    includeCnyes: !moneydjOnly,
    includeMoneydj: !cnyesOnly,
    onProgress: (progress) => {
      console.error(
        `${progress.source} ${progress.reportingMonth}: ${progress.candidateArticles} candidate articles in ${progress.requests} request(s)`,
      );
    },
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
