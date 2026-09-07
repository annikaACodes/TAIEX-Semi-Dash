import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { promisify } from "node:util";

import {
  localGitSyncDecision,
  syncLocalDatabaseChanges,
} from "../src/local-git-sync.mjs";

const execFileAsync = promisify(execFile);

const repositoryRoot = resolve("fixture-repository");
const databasePath = resolve(
  repositoryRoot,
  "taiwan_semiconductor_companies.sqlite",
);

test("local database Git sync is enabled for the canonical database", () => {
  assert.deepEqual(
    localGitSyncDecision({
      repositoryRoot,
      databasePath,
      argumentsList: [],
      environment: {},
    }),
    { enabled: true, reason: null },
  );
});

test("local database Git sync honors explicit and hosted-workflow opt-outs", () => {
  assert.equal(
    localGitSyncDecision({
      repositoryRoot,
      databasePath,
      argumentsList: ["--no-git-sync"],
      environment: {},
    }).reason,
    "disabled-by-flag",
  );
  assert.equal(
    localGitSyncDecision({
      repositoryRoot,
      databasePath,
      argumentsList: [],
      environment: { GITHUB_ACTIONS: "true" },
    }).reason,
    "managed-by-github-actions",
  );
});

test("local database Git sync never publishes a custom database", () => {
  assert.deepEqual(
    localGitSyncDecision({
      repositoryRoot,
      databasePath: resolve(repositoryRoot, "scratch.sqlite"),
      argumentsList: [],
      environment: {},
    }),
    { enabled: false, reason: "database-outside-repository" },
  );
});

test("local database changes are rebuilt, committed, and pushed", async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "taiex-git-sync-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const remotePath = join(temporaryRoot, "origin.git");
  const checkoutPath = join(temporaryRoot, "checkout");
  const checkoutDatabasePath = join(
    checkoutPath,
    "taiwan_semiconductor_companies.sqlite",
  );
  const dashboardScriptPath = join(
    checkoutPath,
    "web",
    "scripts",
    "build-dashboard-data.mjs",
  );
  const dashboardDataPath = join(
    checkoutPath,
    "web",
    "public",
    "data",
    "snapshot.json",
  );

  await execFileAsync("git", ["init", "--bare", remotePath]);
  await execFileAsync("git", [
    "init",
    "--initial-branch=main",
    checkoutPath,
  ]);
  await mkdir(join(checkoutPath, "web", "scripts"), { recursive: true });
  await mkdir(join(checkoutPath, "web", "public", "data"), {
    recursive: true,
  });
  await writeFile(
    dashboardScriptPath,
    [
      'import { writeFile } from "node:fs/promises";',
      'import { fileURLToPath } from "node:url";',
      "await writeFile(",
      '  fileURLToPath(new URL("../public/data/snapshot.json", import.meta.url)),',
      '  "{\\\"built\\\":true}\\n",',
      ");",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(dashboardDataPath, '{"built":false}\n', "utf8");

  const database = new DatabaseSync(checkoutDatabasePath);
  database.exec("CREATE TABLE observations (value INTEGER NOT NULL)");
  database.close();

  const git = (argumentsList) =>
    execFileAsync("git", argumentsList, { cwd: checkoutPath });
  await git(["config", "user.name", "Test User"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["remote", "add", "origin", remotePath]);
  await git(["add", "."]);
  await git(["commit", "-m", "Initial data"]);
  await git(["push", "-u", "origin", "main"]);

  const changedDatabase = new DatabaseSync(checkoutDatabasePath);
  changedDatabase.exec("INSERT INTO observations VALUES (1)");
  changedDatabase.close();

  const result = await syncLocalDatabaseChanges({
    repositoryRoot: checkoutPath,
    databasePath: checkoutDatabasePath,
    commitMessage: "Publish test data",
    argumentsList: [],
    environment: {},
  });

  assert.equal(result.status, "pushed");
  assert.equal((await git(["status", "--porcelain"])).stdout, "");
  const { stdout: remoteHead } = await execFileAsync("git", [
    "--git-dir",
    remotePath,
    "rev-parse",
    "main",
  ]);
  assert.equal(result.commit, remoteHead.trim());
});
