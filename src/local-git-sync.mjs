import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const databaseRelativePath = "taiwan_semiconductor_companies.sqlite";
const dashboardDataPath = "web/public/data";

function pathsMatch(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function runCommand(
  repositoryRoot,
  command,
  argumentsList,
  { relayOutput = false } = {},
) {
  const result = await execFileAsync(command, argumentsList, {
    cwd: repositoryRoot,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  if (relayOutput && result.stdout.trim()) console.log(result.stdout.trim());
  if (relayOutput && result.stderr.trim()) console.warn(result.stderr.trim());
  return result.stdout.trim();
}

function assertDatabaseHealthy(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok") {
      throw new Error(
        `SQLite integrity check failed: ${integrity.integrity_check}`,
      );
    }
    const foreignKeyFailures = database
      .prepare("PRAGMA foreign_key_check")
      .all();
    if (foreignKeyFailures.length > 0) {
      throw new Error(
        `Foreign key check failed: ${JSON.stringify(foreignKeyFailures)}`,
      );
    }
  } finally {
    database.close();
  }
}

export function localGitSyncDecision({
  repositoryRoot,
  databasePath,
  argumentsList = process.argv,
  environment = process.env,
}) {
  if (argumentsList.includes("--no-git-sync")) {
    return { enabled: false, reason: "disabled-by-flag" };
  }
  if (environment.GITHUB_ACTIONS === "true") {
    return { enabled: false, reason: "managed-by-github-actions" };
  }
  const canonicalDatabasePath = resolve(repositoryRoot, databaseRelativePath);
  if (!pathsMatch(resolve(databasePath), canonicalDatabasePath)) {
    return { enabled: false, reason: "database-outside-repository" };
  }
  return { enabled: true, reason: null };
}

export async function prepareLocalDatabaseUpdate({
  repositoryRoot,
  databasePath,
  argumentsList = process.argv,
  environment = process.env,
}) {
  const decision = localGitSyncDecision({
    repositoryRoot,
    databasePath,
    argumentsList,
    environment,
  });
  if (!decision.enabled) {
    return { status: "skipped", reason: decision.reason };
  }

  const branch = await runCommand(repositoryRoot, "git", [
    "branch",
    "--show-current",
  ]);
  if (!branch) {
    throw new Error("Cannot automatically update from a detached Git HEAD.");
  }
  await runCommand(
    repositoryRoot,
    "git",
    ["pull", "--ff-only", "origin", branch],
    { relayOutput: true },
  );
  return { status: "ready", branch };
}

export async function syncLocalDatabaseChanges({
  repositoryRoot,
  databasePath,
  commitMessage = "Update local Taiwan dashboard data",
  argumentsList = process.argv,
  environment = process.env,
}) {
  const decision = localGitSyncDecision({
    repositoryRoot,
    databasePath,
    argumentsList,
    environment,
  });
  if (!decision.enabled) {
    return { status: "skipped", reason: decision.reason };
  }

  const databaseStatus = await runCommand(repositoryRoot, "git", [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    databaseRelativePath,
  ]);
  if (!databaseStatus) return { status: "unchanged" };

  assertDatabaseHealthy(databasePath);
  await runCommand(
    repositoryRoot,
    process.execPath,
    [
      resolve(repositoryRoot, "web/scripts/build-dashboard-data.mjs"),
      "--database",
      databasePath,
    ],
    { relayOutput: true },
  );

  const branch = await runCommand(repositoryRoot, "git", [
    "branch",
    "--show-current",
  ]);
  if (!branch) {
    throw new Error("Cannot automatically publish from a detached Git HEAD.");
  }

  const publishedPaths = [databaseRelativePath, dashboardDataPath];
  await runCommand(repositoryRoot, "git", ["add", "--", ...publishedPaths]);
  const stagedPaths = await runCommand(repositoryRoot, "git", [
    "diff",
    "--cached",
    "--name-only",
    "--",
    ...publishedPaths,
  ]);
  if (!stagedPaths) return { status: "unchanged" };

  await runCommand(
    repositoryRoot,
    "git",
    ["commit", "--only", "-m", commitMessage, "--", ...publishedPaths],
    { relayOutput: true },
  );
  const commit = await runCommand(repositoryRoot, "git", ["rev-parse", "HEAD"]);
  await runCommand(repositoryRoot, "git", ["push", "origin", branch], {
    relayOutput: true,
  });
  return { status: "pushed", branch, commit };
}
