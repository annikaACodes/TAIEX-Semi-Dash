import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  buildMonthlyUsdTwdRates,
  fetchMonthlyUsdTwdRates,
  syncMonthlyUsdTwdRates,
} from "../src/exchange-rate.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

function argumentValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const databasePath = resolve(
  argumentValue(
    "--database",
    resolve(scriptDirectory, "../taiwan_semiconductor_companies.sqlite"),
  ),
);
const inputPath = argumentValue("--input");
const migrationPath = resolve(
  argumentValue(
    "--migration",
    resolve(scriptDirectory, "../migrations/006_monthly_exchange_rates.sql"),
  ),
);

function applyMigration(database, migrationSql) {
  const version = Number(
    database.prepare("PRAGMA user_version").get().user_version,
  );
  if (version === 6) return false;
  if (version !== 5) {
    throw new Error(`Expected SQLite user_version 5 or 6, found ${version}`);
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(migrationSql);
    database.exec("COMMIT");
    return true;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function loadRates(nowUtc) {
  if (!inputPath) return fetchMonthlyUsdTwdRates({ nowUtc });
  const payload = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  return buildMonthlyUsdTwdRates(payload, nowUtc);
}

const nowUtc = new Date().toISOString();
const migrationSql = await readFile(migrationPath, "utf8");
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 30000");

try {
  const migrationApplied = applyMigration(database, migrationSql);
  const existingCount = Number(
    database.prepare("SELECT COUNT(*) AS count FROM monthly_exchange_rates").get()
      .count,
  );

  try {
    const rates = await loadRates(nowUtc);
    database.exec("BEGIN IMMEDIATE");
    let changed;
    try {
      changed = syncMonthlyUsdTwdRates(database, rates);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    const latest = rates.at(-1);
    console.log(
      `CBC monthly USD/TWD rates: ${rates.length} months checked, ` +
        `${changed} changed; latest ${latest.rateMonth.slice(0, 7)} ` +
        `${latest.averageTwdPerUsd} from ${latest.dailyObservationCount} days.`,
    );
  } catch (error) {
    if (existingCount === 0) throw error;
    console.warn(
      `CBC rate refresh failed; retaining ${existingCount} verified monthly rates.`,
    );
    console.warn(error instanceof Error ? error.message : String(error));
  }

  const foreignKeyFailures = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyFailures.length > 0) {
    throw new Error(
      `Foreign key check failed: ${JSON.stringify(foreignKeyFailures)}`,
    );
  }
  const integrity = database.prepare("PRAGMA integrity_check").get();
  if (integrity.integrity_check !== "ok") {
    throw new Error(`SQLite integrity check failed: ${integrity.integrity_check}`);
  }
  if (migrationApplied) console.log("Applied SQLite migration 006.");
} finally {
  database.close();
}
