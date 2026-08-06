import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DatabaseSync } from "node:sqlite";

import { sha256 } from "../src/hash.mjs";
import { MOPS_MARKETS, parseCsv, parseMopsArchive } from "../src/mops.mjs";
import { translateMopsNote } from "../src/translation.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function monthStart(value, label) {
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(value ?? "")) {
    throw new Error(`${label} must use YYYY-MM`);
  }
  return `${value}-01`;
}

function csvValue(row, index, label) {
  const value = String(row[index] ?? "").trim();
  if (!value) throw new Error(`Missing ${label} in the universe CSV`);
  return value;
}

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/csv",
          "Cache-Control": "no-cache",
          "User-Agent": "TAIEX-Semi-Dash/1.0",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, attempt * 1_000),
        );
      }
    }
  }
  throw new Error(`${url}: ${lastError?.message ?? "request failed"}`);
}

function prepareUniverse(csvText, ticker) {
  const rows = parseCsv(csvText);
  const headers = rows[0] ?? [];
  const nameIndex = headers.indexOf("Company Name (English)");
  const tickerIndex = headers.indexOf("Ticker");
  const classificationIndex = headers.indexOf("Classification");
  if ([nameIndex, tickerIndex, classificationIndex].includes(-1)) {
    throw new Error("The universe CSV headers are not recognized");
  }

  const companies = rows.slice(1).map((row, index) => ({
    companyNameEnglish: csvValue(row, nameIndex, "company name"),
    ticker: csvValue(row, tickerIndex, "ticker"),
    classificationSourceText: csvValue(
      row,
      classificationIndex,
      "classification",
    ),
    sourceRowNumber: index + 2,
  }));
  const company = companies.find((candidate) => candidate.ticker === ticker);
  if (!company) throw new Error(`Ticker ${ticker} is not in the universe CSV`);
  return { companies, company };
}

function readSourceFiles(database, marketCode, startMonth, endMonth) {
  const rows = database
    .prepare(`
      SELECT *
      FROM monthly_revenue_source_files
      WHERE market_code = ?
        AND reporting_month BETWEEN ? AND ?
        AND is_current_version = 1
      ORDER BY reporting_month
    `)
    .all(marketCode, startMonth, endMonth);
  if (rows.length === 0) {
    throw new Error(
      `No current ${marketCode} MOPS source files from ${startMonth} to ${endMonth}`,
    );
  }
  return rows;
}

async function collectRevenueRows({ ticker, market, sourceFiles }) {
  const collected = [];
  for (const [index, sourceFile] of sourceFiles.entries()) {
    const text = await fetchText(sourceFile.source_url);
    const payload = parseMopsArchive({
      text,
      marketCode: market.code,
      marketPriority: market.priority,
      sourceUrl: sourceFile.source_url,
      observedAtUtc: sourceFile.first_retrieved_at_utc,
      httpLastModifiedUtc: sourceFile.http_last_modified_utc,
    });
    const row = payload.rows.find((candidate) => candidate.ticker === ticker);
    if (!row) {
      throw new Error(
        `Ticker ${ticker} is absent from ${sourceFile.reporting_month} ${market.code}`,
      );
    }
    if (row.reportingMonth !== sourceFile.reporting_month) {
      throw new Error(
        `Expected ${sourceFile.reporting_month}, received ${row.reportingMonth}`,
      );
    }
    collected.push({ row, sourceFile });
    console.error(
      `[${index + 1}/${sourceFiles.length}] ${sourceFile.reporting_month}`,
    );
  }
  return collected;
}

async function prepareTranslations(databasePath, collected, nowUtc) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const find = database.prepare(`
    SELECT translation_status
    FROM monthly_revenue_note_translations
    WHERE source_note_sha256 = ?
  `);
  const notes = new Map();
  try {
    for (const { row } of collected) {
      if (!row.sourceNoteRaw) continue;
      const noteHash = sha256(row.sourceNoteRaw);
      const existing = find.get(noteHash);
      if (!existing || existing.translation_status === "pending") {
        notes.set(noteHash, row.sourceNoteRaw);
      }
    }
  } finally {
    database.close();
  }
  return Promise.all(
    [...notes.values()].map((note) => translateMopsNote(note, fetch, nowUtc)),
  );
}

function syncTranslations(database, translations) {
  const upsert = database.prepare(`
    INSERT INTO monthly_revenue_note_translations (
      source_note_sha256,
      source_note_english,
      translation_provider,
      translated_at_utc,
      translation_status,
      last_translation_attempt_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (source_note_sha256) DO UPDATE SET
      source_note_english = excluded.source_note_english,
      translation_provider = excluded.translation_provider,
      translated_at_utc = excluded.translated_at_utc,
      translation_status = excluded.translation_status,
      last_translation_attempt_at_utc = excluded.last_translation_attempt_at_utc
    WHERE monthly_revenue_note_translations.translation_status = 'pending'
  `);
  for (const translation of translations) {
    upsert.run(
      translation.sourceNoteSha256,
      translation.sourceNoteEnglish,
      translation.translationProvider,
      translation.translatedAtUtc,
      translation.translationStatus,
      translation.lastTranslationAttemptAtUtc,
    );
  }
}

function syncCompany({
  database,
  csvText,
  universe,
  company,
  sourceFileName,
  nowUtc,
}) {
  const sourceImport = database
    .prepare("SELECT * FROM source_imports WHERE source_file_name = ?")
    .get(sourceFileName);
  if (!sourceImport) {
    throw new Error(`No source_import row for ${sourceFileName}`);
  }

  const databaseTickers = new Set(
    database.prepare("SELECT ticker FROM companies").all().map((row) => row.ticker),
  );
  const csvTickers = new Set(universe.map((row) => row.ticker));
  const missingFromCsv = [...databaseTickers].filter(
    (candidate) => !csvTickers.has(candidate),
  );
  const missingFromDatabase = universe.filter(
    (candidate) => !databaseTickers.has(candidate.ticker),
  );
  if (missingFromCsv.length > 0) {
    throw new Error(`Database tickers missing from CSV: ${missingFromCsv.join(", ")}`);
  }
  if (
    missingFromDatabase.length > 1 ||
    (missingFromDatabase.length === 1 &&
      missingFromDatabase[0].ticker !== company.ticker)
  ) {
    throw new Error(
      `Unexpected CSV additions: ${missingFromDatabase
        .map((candidate) => candidate.ticker)
        .join(", ")}`,
    );
  }

  database
    .prepare(`
      UPDATE source_imports
      SET source_sha256 = ?, imported_at_utc = ?, source_row_count = ?
      WHERE import_id = ?
    `)
    .run(sha256(csvText), nowUtc, universe.length, sourceImport.import_id);

  database
    .prepare(`
      UPDATE companies
      SET source_row_number = source_row_number + 1000
      WHERE source_import_id = ?
    `)
    .run(sourceImport.import_id);
  const updateRow = database.prepare(`
    UPDATE companies
    SET source_row_number = ?, updated_at_utc = ?
    WHERE ticker = ? AND source_import_id = ?
  `);
  for (const candidate of universe) {
    if (databaseTickers.has(candidate.ticker)) {
      updateRow.run(
        candidate.sourceRowNumber,
        nowUtc,
        candidate.ticker,
        sourceImport.import_id,
      );
    }
  }

  let stored = database
    .prepare("SELECT * FROM companies WHERE ticker = ?")
    .get(company.ticker);
  if (!stored) {
    const inserted = database
      .prepare(`
        INSERT INTO companies (
          ticker,
          company_name_english,
          classification_source_text,
          source_import_id,
          source_row_number,
          created_at_utc,
          updated_at_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        company.ticker,
        company.companyNameEnglish,
        company.classificationSourceText,
        sourceImport.import_id,
        company.sourceRowNumber,
        nowUtc,
        nowUtc,
      );
    stored = { company_id: Number(inserted.lastInsertRowid) };
  }

  const findClassification = database.prepare(`
    SELECT classification_id FROM classifications WHERE classification_name = ?
  `);
  const linkClassification = database.prepare(`
    INSERT OR IGNORE INTO company_classifications (
      company_id, classification_id, classification_order
    ) VALUES (?, ?, ?)
  `);
  const classifications = company.classificationSourceText
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const [index, classification] of classifications.entries()) {
    const found = findClassification.get(classification);
    if (!found) throw new Error(`Unknown classification: ${classification}`);
    linkClassification.run(stored.company_id, found.classification_id, index + 1);
  }
  return Number(stored.company_id);
}

function syncObservations(database, companyId, company, collected) {
  const findCurrent = database.prepare(`
    SELECT observation_id, row_sha256
    FROM company_monthly_revenue_observations
    WHERE company_id = ? AND reporting_month = ? AND is_current = 1
  `);
  const insert = database.prepare(`
    INSERT INTO company_monthly_revenue_observations (
      company_id,
      reporting_month,
      source_file_id,
      revenue_nt,
      previous_month_revenue_nt,
      prior_year_month_revenue_nt,
      mom_percent,
      yoy_percent,
      cumulative_ytd_revenue_nt,
      prior_year_cumulative_ytd_revenue_nt,
      ytd_yoy_percent,
      publication_timestamp_utc,
      publication_timestamp_basis,
      row_sha256,
      explicit_correction_flag,
      is_current,
      first_observed_at_utc,
      last_observed_at_utc,
      source_company_name_english,
      source_industry_english,
      source_note_sha256
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      'MOPS_ARCHIVE_HTTP_LAST_MODIFIED_CURRENT_VERSION',
      ?, ?, 1, ?, ?, ?, 'Semiconductor', ?
    )
  `);

  let inserted = 0;
  for (const { row, sourceFile } of collected) {
    const current = findCurrent.get(companyId, row.reportingMonth);
    if (current?.row_sha256 === row.rowSha256) continue;
    if (current) {
      throw new Error(
        `Ticker ${company.ticker} already has different data for ${row.reportingMonth}`,
      );
    }
    insert.run(
      companyId,
      row.reportingMonth,
      sourceFile.source_file_id,
      row.revenueNt,
      row.previousMonthRevenueNt,
      row.priorYearMonthRevenueNt,
      row.momPercent,
      row.yoyPercent,
      row.cumulativeYtdRevenueNt,
      row.priorYearCumulativeYtdRevenueNt,
      row.ytdYoyPercent,
      sourceFile.http_last_modified_utc,
      row.rowSha256,
      row.explicitCorrectionFlag,
      sourceFile.first_retrieved_at_utc,
      sourceFile.last_retrieved_at_utc,
      company.companyNameEnglish,
      row.sourceNoteRaw ? sha256(row.sourceNoteRaw) : null,
    );
    inserted += 1;
  }
  return inserted;
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const databasePath = resolve(
  argumentValue("--database") ??
    `${repositoryRoot}/taiwan_semiconductor_companies.sqlite`,
);
const universePath = resolve(
  argumentValue("--universe") ??
    `${repositoryRoot}/taiex_semiconductor_universe_classification_no_exclude.csv`,
);
const ticker = String(argumentValue("--ticker") ?? "").trim();
const marketCode = String(argumentValue("--market") ?? "").trim();
const startMonth = monthStart(argumentValue("--start"), "--start");
const endMonth = monthStart(argumentValue("--end"), "--end");
const market = MOPS_MARKETS.find((candidate) => candidate.code === marketCode);
if (!/^\d{4,5}$/.test(ticker)) throw new Error("--ticker is required");
if (!market) throw new Error(`Unsupported --market: ${marketCode}`);
if (startMonth > endMonth) throw new Error("--start must not follow --end");

const csvText = await readFile(universePath, "utf8");
const { companies: universe, company } = prepareUniverse(csvText, ticker);
const sourceDatabase = new DatabaseSync(databasePath, { readOnly: true });
const databaseVersion = Number(
  sourceDatabase.prepare("PRAGMA user_version").get().user_version,
);
if (databaseVersion < 9) {
  sourceDatabase.close();
  throw new Error(
    `Expected SQLite user_version 9 or newer, found ${databaseVersion}`,
  );
}
const sourceFiles = readSourceFiles(
  sourceDatabase,
  marketCode,
  startMonth,
  endMonth,
);
sourceDatabase.close();

const collected = await collectRevenueRows({ ticker, market, sourceFiles });
const nowUtc = new Date().toISOString();
const translations = await prepareTranslations(databasePath, collected, nowUtc);
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 30000");
try {
  database.exec("BEGIN IMMEDIATE");
  try {
    syncTranslations(database, translations);
    const companyId = syncCompany({
      database,
      csvText,
      universe,
      company,
      sourceFileName: universePath.split(/[\\/]/).at(-1),
      nowUtc,
    });
    const observationsInserted = syncObservations(
      database,
      companyId,
      company,
      collected,
    );
    database.exec("COMMIT");
    console.log(
      JSON.stringify(
        {
          companyId,
          ticker,
          companyNameEnglish: company.companyNameEnglish,
          classification: company.classificationSourceText,
          marketCode,
          observationsInserted,
          firstReportingMonth: collected[0]?.row.reportingMonth ?? null,
          lastReportingMonth: collected.at(-1)?.row.reportingMonth ?? null,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
} finally {
  database.close();
}
