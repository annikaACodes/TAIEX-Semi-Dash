import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { backfillAspeedReportDates } from "../src/aspeed-backfill.mjs";
import {
  prepareLocalDatabaseUpdate,
  syncLocalDatabaseChanges,
} from "../src/local-git-sync.mjs";

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
const execFileAsync = promisify(execFile);

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
  return new Response(stdout, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

try {
  await prepareLocalDatabaseUpdate({ repositoryRoot, databasePath });
  const result = await backfillAspeedReportDates({
    databasePath,
    monthCount,
    nowUtc,
    fetchFn: useCurl ? curlFetch : globalThis.fetch,
  });
  const gitSync = await syncLocalDatabaseChanges({
    repositoryRoot,
    databasePath,
    commitMessage: "Update ASPEED report-date history",
  });
  console.log(JSON.stringify({ ...result, gitSync }, null, 2));
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
