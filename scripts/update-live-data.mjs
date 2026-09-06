import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { backfillAspeedReportDates } from "../src/aspeed-backfill.mjs";
import { runLiveUpdate } from "../src/live-update.mjs";

const execFileAsync = promisify(execFile);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const canonicalDatabasePath = resolve(
  repositoryRoot,
  "taiwan_semiconductor_companies.sqlite",
);
const databasePath = resolve(
  argumentValue("--database") ?? canonicalDatabasePath,
);
const targetMonthArgument = argumentValue("--target-month");
const targetReportingMonth = targetMonthArgument
  ? `${targetMonthArgument}-01`
  : null;

if (
  targetMonthArgument &&
  !/^20\d{2}-(?:0[1-9]|1[0-2])$/u.test(targetMonthArgument)
) {
  throw new Error("--target-month must use YYYY-MM");
}

function pathsMatch(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function runCommand(command, argumentsList, { relayOutput = false } = {}) {
  const result = await execFileAsync(command, argumentsList, {
    cwd: repositoryRoot,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  if (relayOutput && result.stdout.trim()) console.log(result.stdout.trim());
  if (relayOutput && result.stderr.trim()) console.warn(result.stderr.trim());
  return result.stdout.trim();
}

async function syncLocalDatabaseChanges() {
  const databaseRelativePath = "taiwan_semiconductor_companies.sqlite";
  const dashboardDataPath = "web/public/data";
  const databaseStatus = await runCommand("git", [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    databaseRelativePath,
  ]);
  if (!databaseStatus) return { status: "unchanged" };

  await runCommand(
    process.execPath,
    [
      resolve(repositoryRoot, "web/scripts/build-dashboard-data.mjs"),
      "--database",
      databasePath,
    ],
    { relayOutput: true },
  );

  const branch = await runCommand("git", ["branch", "--show-current"]);
  if (!branch) {
    throw new Error("Cannot automatically publish from a detached Git HEAD.");
  }

  const publishedPaths = [databaseRelativePath, dashboardDataPath];
  await runCommand("git", ["add", "--", ...publishedPaths]);
  const stagedStatus = await runCommand("git", [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ...publishedPaths,
  ]);
  if (!stagedStatus) return { status: "unchanged" };

  await runCommand(
    "git",
    [
      "commit",
      "--only",
      "-m",
      "Update live Taiwan monthly revenue",
      "--",
      ...publishedPaths,
    ],
    { relayOutput: true },
  );
  const commit = await runCommand("git", ["rev-parse", "HEAD"]);
  await runCommand("git", ["push", "origin", branch], { relayOutput: true });
  return { status: "pushed", branch, commit };
}

const localGitSyncEnabled =
  !process.argv.includes("--no-git-sync") &&
  process.env.GITHUB_ACTIONS !== "true" &&
  pathsMatch(databasePath, canonicalDatabasePath);

if (
  !process.argv.includes("--no-git-sync") &&
  process.env.GITHUB_ACTIONS !== "true" &&
  !pathsMatch(databasePath, canonicalDatabasePath)
) {
  console.warn(
    "Automatic Git sync is skipped for a database outside the repository.",
  );
}

try {
  if (localGitSyncEnabled) {
    await runCommand(
      process.execPath,
      [
        resolve(repositoryRoot, "scripts/update-exchange-rate.mjs"),
        "--database",
        databasePath,
      ],
      { relayOutput: true },
    );
  }

  const nowUtc = new Date().toISOString();
  const result = await runLiveUpdate({
    databasePath,
    nowUtc,
    targetReportingMonth,
    enablePublicTimestampFallback: true,
  });
  let aspeedIr = null;
  try {
    aspeedIr = await backfillAspeedReportDates({
      databasePath,
      nowUtc,
      monthCount: 1,
    });
    result.databaseChanged ||= aspeedIr.databaseChanged;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push({ source: "aspeed_ir_monthly_revenue", message });
    console.warn(`ASPEED IR timestamp poll failed non-fatally: ${message}`);
  }
  const gitSync = localGitSyncEnabled
    ? await syncLocalDatabaseChanges()
    : { status: "skipped" };
  console.log(JSON.stringify({ ...result, aspeedIr, gitSync }, null, 2));
  if (result.deferred) {
    console.warn(`Poll deferred safely: ${result.deferredReason}`);
  } else if (result.errors.length > 0) {
    console.warn(
      `Completed with ${result.errors.length} non-fatal source error(s).`,
    );
  }
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
