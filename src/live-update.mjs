import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  addMonths,
  differenceInDays,
  parseTwseHolidaySchedule,
  previousTaipeiMonth,
  reportingMonthEnd,
  timeToMinute,
  utcToTaipeiParts,
} from "./dates.mjs";
import { sha256 } from "./hash.mjs";
import { parseIrCalendar } from "./ir-parsers.mjs";
import {
  MOPS_MARKETS,
  mopsArchiveUrl,
  parseMopsArchive,
  selectUniverseRows,
} from "./mops.mjs";
import {
  buildMonthlySchedule,
  buildReleaseProfile,
} from "./release-model.mjs";
import { translateMopsNote } from "./translation.mjs";

const DEFAULT_MIGRATION_PATH = fileURLToPath(
  new URL("../migrations/004_release_scheduler.sql", import.meta.url),
);
const DEFAULT_IR_CONFIG_PATH = fileURLToPath(
  new URL("../config/ir_sources.json", import.meta.url),
);
const HOLIDAY_URL =
  "https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule";
const USER_AGENT = "Taiwan-Monthly-Revenue-Research/1.0";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchTextWithRetry(fetchFn, url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchFn(url, {
        headers: {
          Accept: "text/html,text/csv,application/json;q=0.9,*/*;q=0.8",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }
      return {
        text: await response.text(),
        lastModified: response.headers?.get?.("last-modified") ?? null,
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(500 * 2 ** (attempt - 1));
      }
    }
  }
  throw new Error(`${url}: ${lastError?.message ?? "request failed"}`);
}

function applyMigration(database, migrationSql) {
  const version = Number(database.prepare("PRAGMA user_version").get().user_version);
  if (version === 4) {
    return false;
  }
  if (version !== 3) {
    throw new Error(`Expected SQLite user_version 3 or 4, found ${version}`);
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

function getCompanies(database) {
  const rows = database
    .prepare(`
      SELECT
        c.company_id,
        c.ticker,
        c.company_name_english,
        c.classification_source_text,
        COALESCE(
          (
            SELECT o.source_industry_english
            FROM company_monthly_revenue_observations AS o
            WHERE o.company_id = c.company_id
              AND o.source_industry_english IS NOT NULL
            ORDER BY o.reporting_month DESC, o.observation_id DESC
            LIMIT 1
          ),
          c.classification_source_text
        ) AS source_industry_english
      FROM companies AS c
      ORDER BY c.company_id
    `)
    .all();
  return rows.map((row) => ({
    companyId: Number(row.company_id),
    ticker: row.ticker,
    companyNameEnglish: row.company_name_english,
    classifications: row.classification_source_text,
    sourceIndustryEnglish: row.source_industry_english,
  }));
}

async function collectRemoteInputs({
  fetchFn,
  targetReportingMonth,
  irConfig,
  overrides,
}) {
  const errors = [];

  let holidayPayload = overrides?.holidayPayload ?? null;
  if (holidayPayload === null) {
    try {
      holidayPayload = (await fetchTextWithRetry(fetchFn, HOLIDAY_URL)).text;
    } catch (error) {
      errors.push({ source: "twse_holiday_calendar", message: error.message });
      holidayPayload = "[]";
    }
  }

  const irResults = await Promise.all(
    irConfig
      .filter((source) => source.enabled)
      .map(async (source) => {
        try {
          const override = overrides?.irPayloads?.[source.ticker];
          const html =
            typeof override === "string"
              ? override
              : override?.text ??
                (await fetchTextWithRetry(fetchFn, source.sourceUrl)).text;
          return {
            source,
            events: parseIrCalendar(source.parserName, html),
            error: null,
          };
        } catch (error) {
          return { source, events: [], error: error.message };
        }
      }),
  );
  for (const result of irResults) {
    if (result.error) {
      errors.push({
        source: `ir:${result.source.ticker}`,
        message: result.error,
      });
    }
  }

  const mopsResults = await Promise.all(
    MOPS_MARKETS.map(async (market) => {
      const sourceUrl = mopsArchiveUrl(targetReportingMonth, market.code);
      try {
        const override = overrides?.mopsPayloads?.[market.code];
        const fetched =
          typeof override === "string"
            ? { text: override, lastModified: null }
            : override ??
              (await fetchTextWithRetry(fetchFn, sourceUrl));
        const parsed = parseMopsArchive({
          text: fetched.text,
          marketCode: market.code,
          marketPriority: market.priority,
          sourceUrl,
          observedAtUtc: overrides?.observedAtUtc,
          httpLastModifiedUtc: fetched.lastModified,
        });
        if (
          parsed.reportingMonth &&
          parsed.reportingMonth !== targetReportingMonth
        ) {
          throw new Error(
            `Expected ${targetReportingMonth}, received ${parsed.reportingMonth}`,
          );
        }
        return { market, payload: parsed, error: null };
      } catch (error) {
        return { market, payload: null, error: error.message };
      }
    }),
  );
  for (const result of mopsResults) {
    if (result.error) {
      errors.push({
        source: `mops:${result.market.code}`,
        message: result.error,
      });
    }
  }

  const mopsPayloads = mopsResults
    .map((result) => result.payload)
    .filter(Boolean);
  if (mopsPayloads.length === 0) {
    throw new Error(
      `Every MOPS market request failed: ${errors
        .filter((error) => error.source.startsWith("mops:"))
        .map((error) => error.message)
        .join("; ")}`,
    );
  }

  return {
    holidays: parseTwseHolidaySchedule(holidayPayload),
    irResults,
    mopsPayloads,
    errors,
  };
}

function seedAndSyncIrSources(database, irResults, companiesByTicker, nowUtc) {
  const findSource = database.prepare(`
    SELECT *
    FROM company_reporting_sources
    WHERE company_id = ? AND source_url = ?
  `);
  const insertSource = database.prepare(`
    INSERT INTO company_reporting_sources (
      company_id,
      source_type,
      source_url,
      parser_name,
      source_priority,
      enabled,
      created_at_utc,
      updated_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateSourceDefinition = database.prepare(`
    UPDATE company_reporting_sources
    SET source_type = ?,
        parser_name = ?,
        source_priority = ?,
        enabled = ?,
        updated_at_utc = ?
    WHERE reporting_source_id = ?
  `);
  const updateSourceSuccess = database.prepare(`
    UPDATE company_reporting_sources
    SET last_relevant_content_sha256 = ?,
        last_success_at_utc = ?,
        last_error_at_utc = NULL,
        last_error_message = NULL,
        updated_at_utc = ?
    WHERE reporting_source_id = ?
  `);
  const updateSourceError = database.prepare(`
    UPDATE company_reporting_sources
    SET last_error_at_utc = ?,
        last_error_message = ?,
        updated_at_utc = ?
    WHERE reporting_source_id = ?
  `);
  const deactivateEvents = database.prepare(`
    UPDATE company_release_events
    SET is_current = 0,
        last_detected_at_utc = ?
    WHERE reporting_source_id = ? AND is_current = 1
  `);
  const findEvent = database.prepare(`
    SELECT release_event_id, is_current
    FROM company_release_events
    WHERE company_id = ?
      AND reporting_month = ?
      AND reporting_source_id = ?
      AND event_sha256 = ?
  `);
  const activateEvent = database.prepare(`
    UPDATE company_release_events
    SET is_current = 1,
        last_detected_at_utc = ?
    WHERE release_event_id = ?
  `);
  const insertEvent = database.prepare(`
    INSERT INTO company_release_events (
      company_id,
      reporting_source_id,
      reporting_month,
      announced_release_date_local,
      announced_release_time_local,
      announced_release_timestamp_utc,
      event_title,
      event_sha256,
      first_detected_at_utc,
      last_detected_at_utc,
      is_current
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  let sourcesChanged = 0;
  let eventsChanged = 0;
  for (const result of irResults) {
    const company = companiesByTicker.get(result.source.ticker);
    if (!company) {
      throw new Error(`IR source ticker is not in the universe: ${result.source.ticker}`);
    }
    let existing = findSource.get(company.companyId, result.source.sourceUrl);
    let sourceId;
    if (!existing) {
      sourceId = Number(
        insertSource.run(
          company.companyId,
          result.source.sourceType,
          result.source.sourceUrl,
          result.source.parserName,
          result.source.priority,
          result.source.enabled ? 1 : 0,
          nowUtc,
          nowUtc,
        ).lastInsertRowid,
      );
      sourcesChanged += 1;
      existing = findSource.get(company.companyId, result.source.sourceUrl);
    } else {
      sourceId = Number(existing.reporting_source_id);
      const definitionChanged =
        existing.source_type !== result.source.sourceType ||
        existing.parser_name !== result.source.parserName ||
        Number(existing.source_priority) !== Number(result.source.priority) ||
        Number(existing.enabled) !== (result.source.enabled ? 1 : 0);
      if (definitionChanged) {
        updateSourceDefinition.run(
          result.source.sourceType,
          result.source.parserName,
          result.source.priority,
          result.source.enabled ? 1 : 0,
          nowUtc,
          sourceId,
        );
        sourcesChanged += 1;
        existing = findSource.get(company.companyId, result.source.sourceUrl);
      }
    }

    if (result.error) {
      if (existing.last_error_message !== result.error) {
        updateSourceError.run(nowUtc, result.error, nowUtc, sourceId);
        sourcesChanged += 1;
      }
      continue;
    }

    const normalizedEvents = result.events.map((event) => ({
      reportingMonth: event.reportingMonth,
      releaseDateLocal: event.releaseDateLocal,
      releaseTimeLocal: event.releaseTimeLocal,
      title: event.title,
    }));
    const relevantHash = sha256(JSON.stringify(normalizedEvents));
    const calendarChanged =
      existing.last_relevant_content_sha256 !== relevantHash;
    const errorCleared = Boolean(existing.last_error_message);
    if (!calendarChanged && !errorCleared) {
      continue;
    }

    updateSourceSuccess.run(relevantHash, nowUtc, nowUtc, sourceId);
    sourcesChanged += 1;
    if (!calendarChanged) {
      continue;
    }

    deactivateEvents.run(nowUtc, sourceId);
    for (const event of result.events) {
      const eventHash = sha256(
        JSON.stringify([
          event.reportingMonth,
          event.releaseDateLocal,
          event.releaseTimeLocal,
          event.title,
        ]),
      );
      const found = findEvent.get(
        company.companyId,
        event.reportingMonth,
        sourceId,
        eventHash,
      );
      if (found) {
        activateEvent.run(nowUtc, found.release_event_id);
      } else {
        insertEvent.run(
          company.companyId,
          sourceId,
          event.reportingMonth,
          event.releaseDateLocal,
          event.releaseTimeLocal,
          event.releaseTimestampUtc,
          event.title,
          eventHash,
          nowUtc,
          nowUtc,
        );
      }
      eventsChanged += 1;
    }
  }
  return { sourcesChanged, eventsChanged };
}

async function prepareTranslations(
  database,
  selectedRows,
  fetchFn,
  nowUtc,
) {
  const findTranslation = database.prepare(`
    SELECT source_note_sha256, translation_status
    FROM monthly_revenue_note_translations
    WHERE source_note_sha256 = ?
  `);
  const uniqueNotes = new Map();
  for (const selected of selectedRows) {
    if (!selected.sourceNoteRaw) {
      continue;
    }
    const noteHash = sha256(selected.sourceNoteRaw);
    const existing = findTranslation.get(noteHash);
    if (!existing || existing.translation_status === "pending") {
      uniqueNotes.set(noteHash, selected.sourceNoteRaw);
    }
  }

  const translated = await Promise.all(
    [...uniqueNotes.values()].map((note) =>
      translateMopsNote(note, fetchFn, nowUtc),
    ),
  );
  return translated;
}

function syncTranslations(database, translations) {
  const find = database.prepare(`
    SELECT *
    FROM monthly_revenue_note_translations
    WHERE source_note_sha256 = ?
  `);
  const insert = database.prepare(`
    INSERT INTO monthly_revenue_note_translations (
      source_note_sha256,
      source_note_english,
      translation_provider,
      translated_at_utc,
      translation_status,
      last_translation_attempt_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const update = database.prepare(`
    UPDATE monthly_revenue_note_translations
    SET source_note_english = ?,
        translation_provider = ?,
        translated_at_utc = ?,
        translation_status = ?,
        last_translation_attempt_at_utc = ?
    WHERE source_note_sha256 = ?
  `);

  let changed = 0;
  for (const translation of translations) {
    const existing = find.get(translation.sourceNoteSha256);
    if (!existing) {
      insert.run(
        translation.sourceNoteSha256,
        translation.sourceNoteEnglish,
        translation.translationProvider,
        translation.translatedAtUtc,
        translation.translationStatus,
        translation.lastTranslationAttemptAtUtc,
      );
      changed += 1;
      continue;
    }
    const improved =
      existing.translation_status === "pending" &&
      translation.translationStatus === "complete";
    const changedComplete =
      existing.translation_status === "complete" &&
      translation.translationStatus === "complete" &&
      (existing.source_note_english !== translation.sourceNoteEnglish ||
        existing.translation_provider !== translation.translationProvider);
    if (improved || changedComplete) {
      update.run(
        translation.sourceNoteEnglish,
        translation.translationProvider,
        translation.translatedAtUtc,
        translation.translationStatus,
        translation.lastTranslationAttemptAtUtc,
        translation.sourceNoteSha256,
      );
      changed += 1;
    }
  }
  return changed;
}

function ensureSourceFile(database, payload, reportingMonth) {
  const find = database.prepare(`
    SELECT source_file_id, is_current_version
    FROM monthly_revenue_source_files
    WHERE reporting_month = ?
      AND market_code = ?
      AND source_sha256 = ?
  `);
  const deactivate = database.prepare(`
    UPDATE monthly_revenue_source_files
    SET is_current_version = 0
    WHERE reporting_month = ?
      AND market_code = ?
      AND is_current_version = 1
      AND source_sha256 <> ?
  `);
  const activate = database.prepare(`
    UPDATE monthly_revenue_source_files
    SET is_current_version = 1
    WHERE source_file_id = ?
  `);
  const insert = database.prepare(`
    INSERT INTO monthly_revenue_source_files (
      reporting_month,
      market_code,
      market_priority,
      source_url,
      source_report_date,
      http_last_modified_utc,
      source_sha256,
      source_row_count,
      first_retrieved_at_utc,
      last_retrieved_at_utc,
      is_current_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  deactivate.run(reportingMonth, payload.marketCode, payload.sourceSha256);
  const existing = find.get(
    reportingMonth,
    payload.marketCode,
    payload.sourceSha256,
  );
  if (existing) {
    if (Number(existing.is_current_version) !== 1) {
      activate.run(existing.source_file_id);
    }
    return Number(existing.source_file_id);
  }
  return Number(
    insert.run(
      reportingMonth,
      payload.marketCode,
      payload.marketPriority,
      payload.sourceUrl,
      payload.sourceReportDate,
      payload.httpLastModifiedUtc,
      payload.sourceSha256,
      payload.sourceRowCount,
      payload.observedAtUtc,
      payload.observedAtUtc,
    ).lastInsertRowid,
  );
}

function syncRevenueRows(
  database,
  selectedRows,
  companiesByTicker,
  nowUtc,
) {
  const findCurrent = database.prepare(`
    SELECT
      observation_id,
      row_sha256,
      revenue_nt,
      previous_month_revenue_nt,
      prior_year_month_revenue_nt,
      mom_percent,
      yoy_percent,
      cumulative_ytd_revenue_nt,
      prior_year_cumulative_ytd_revenue_nt,
      ytd_yoy_percent,
      source_note_sha256,
      explicit_correction_flag
    FROM company_monthly_revenue_observations
    WHERE company_id = ? AND reporting_month = ? AND is_current = 1
  `);
  const findMatching = database.prepare(`
    SELECT observation_id
    FROM company_monthly_revenue_observations
    WHERE company_id = ? AND reporting_month = ? AND row_sha256 = ?
  `);
  const deactivate = database.prepare(`
    UPDATE company_monthly_revenue_observations
    SET is_current = 0
    WHERE company_id = ? AND reporting_month = ? AND is_current = 1
  `);
  const reactivate = database.prepare(`
    UPDATE company_monthly_revenue_observations
    SET source_file_id = ?,
        publication_timestamp_utc = ?,
        publication_timestamp_basis = 'MOPS_ARCHIVE_FIRST_OBSERVED',
        explicit_correction_flag = ?,
        is_current = 1,
        last_observed_at_utc = ?
    WHERE observation_id = ?
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
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, 'MOPS_ARCHIVE_FIRST_OBSERVED', ?, ?, 1, ?, ?, ?, ?, ?
    )
  `);

  const sameNullableNumber = (left, right) => {
    if (left === null || left === undefined) {
      return right === null || right === undefined;
    }
    if (right === null || right === undefined) {
      return false;
    }
    return Number(left) === Number(right);
  };
  const sameFinancialDisclosure = (current, row) => {
    const noteHash = row.sourceNoteRaw ? sha256(row.sourceNoteRaw) : null;
    return (
      Number(current.revenue_nt) === row.revenueNt &&
      sameNullableNumber(
        current.previous_month_revenue_nt,
        row.previousMonthRevenueNt,
      ) &&
      sameNullableNumber(
        current.prior_year_month_revenue_nt,
        row.priorYearMonthRevenueNt,
      ) &&
      sameNullableNumber(current.mom_percent, row.momPercent) &&
      sameNullableNumber(current.yoy_percent, row.yoyPercent) &&
      Number(current.cumulative_ytd_revenue_nt) ===
        row.cumulativeYtdRevenueNt &&
      sameNullableNumber(
        current.prior_year_cumulative_ytd_revenue_nt,
        row.priorYearCumulativeYtdRevenueNt,
      ) &&
      sameNullableNumber(current.ytd_yoy_percent, row.ytdYoyPercent) &&
      (current.source_note_sha256 ?? null) === noteHash &&
      Number(current.explicit_correction_flag) ===
        Number(row.explicitCorrectionFlag)
    );
  };

  const changedRows = [];
  for (const row of selectedRows) {
    const company = companiesByTicker.get(row.ticker);
    const current = findCurrent.get(company.companyId, row.reportingMonth);
    if (
      current &&
      (current.row_sha256 === row.rowSha256 ||
        sameFinancialDisclosure(current, row))
    ) {
      continue;
    }
    changedRows.push({ row, company, hadCurrent: Boolean(current) });
  }

  const sourceFileIds = new Map();
  for (const changed of changedRows) {
    const key = `${changed.row.payload.marketCode}|${changed.row.payload.sourceSha256}`;
    if (!sourceFileIds.has(key)) {
      sourceFileIds.set(
        key,
        ensureSourceFile(
          database,
          changed.row.payload,
          changed.row.reportingMonth,
        ),
      );
    }
  }

  let inserted = 0;
  let restatements = 0;
  const firstSeen = new Map();
  for (const { row, company, hadCurrent } of changedRows) {
    const sourceKey = `${row.payload.marketCode}|${row.payload.sourceSha256}`;
    const sourceFileId = sourceFileIds.get(sourceKey);
    deactivate.run(company.companyId, row.reportingMonth);
    const matching = findMatching.get(
      company.companyId,
      row.reportingMonth,
      row.rowSha256,
    );
    if (matching) {
      reactivate.run(
        sourceFileId,
        nowUtc,
        row.explicitCorrectionFlag,
        nowUtc,
        matching.observation_id,
      );
    } else {
      insert.run(
        company.companyId,
        row.reportingMonth,
        sourceFileId,
        row.revenueNt,
        row.previousMonthRevenueNt,
        row.priorYearMonthRevenueNt,
        row.momPercent,
        row.yoyPercent,
        row.cumulativeYtdRevenueNt,
        row.priorYearCumulativeYtdRevenueNt,
        row.ytdYoyPercent,
        nowUtc,
        row.rowSha256,
        row.explicitCorrectionFlag,
        nowUtc,
        nowUtc,
        company.companyNameEnglish,
        company.sourceIndustryEnglish,
        row.sourceNoteRaw ? sha256(row.sourceNoteRaw) : null,
      );
    }
    inserted += 1;
    if (hadCurrent) {
      restatements += 1;
    }
    firstSeen.set(`${company.companyId}|${row.reportingMonth}`, nowUtc);
  }
  return { inserted, restatements, firstSeen };
}

function collectReleaseHistory(database, nowUtc) {
  const nowLocalDate = utcToTaipeiParts(nowUtc).date;
  const historyByCompany = new Map();
  const add = (companyId, item) => {
    if (!historyByCompany.has(companyId)) {
      historyByCompany.set(companyId, []);
    }
    historyByCompany.get(companyId).push(item);
  };

  const actualRows = database
    .prepare(`
      SELECT
        company_id,
        reporting_month,
        actual_first_seen_date_local,
        actual_first_seen_time_local
      FROM monthly_release_schedule
      WHERE actual_first_seen_date_local IS NOT NULL
    `)
    .all();
  for (const row of actualRows) {
    add(Number(row.company_id), {
      kind: "actual",
      reportingMonth: row.reporting_month,
      releaseDateLocal: row.actual_first_seen_date_local,
      releaseMinuteLocal: timeToMinute(row.actual_first_seen_time_local),
    });
  }

  const irRows = database
    .prepare(`
      SELECT
        e.company_id,
        e.reporting_month,
        e.announced_release_date_local,
        e.announced_release_time_local
      FROM company_release_events AS e
      JOIN company_reporting_sources AS s
        ON s.reporting_source_id = e.reporting_source_id
      WHERE e.is_current = 1
        AND s.enabled = 1
        AND e.announced_release_date_local <= ?
      ORDER BY s.source_priority, e.release_event_id
    `)
    .all(nowLocalDate);
  for (const row of irRows) {
    add(Number(row.company_id), {
      kind: "ir",
      reportingMonth: row.reporting_month,
      releaseDateLocal: row.announced_release_date_local,
      releaseMinuteLocal: timeToMinute(row.announced_release_time_local),
    });
  }
  return historyByCompany;
}

function addNewFirstSeenHistory(historyByCompany, firstSeen) {
  for (const [key, firstSeenAtUtc] of firstSeen) {
    const [companyIdText, reportingMonth] = key.split("|");
    const companyId = Number(companyIdText);
    const local = utcToTaipeiParts(firstSeenAtUtc);
    if (!historyByCompany.has(companyId)) {
      historyByCompany.set(companyId, []);
    }
    historyByCompany.get(companyId).push({
      kind: "actual",
      reportingMonth,
      releaseDateLocal: local.date,
      releaseMinuteLocal: timeToMinute(local.time),
    });
  }
}

const PROFILE_FIELDS = [
  ["history_sample_count", "historySampleCount"],
  ["actual_first_seen_sample_count", "actualFirstSeenSampleCount"],
  ["ir_calendar_sample_count", "irCalendarSampleCount"],
  ["median_release_offset_days", "medianReleaseOffsetDays"],
  ["median_release_minute_local", "medianReleaseMinuteLocal"],
  ["median_absolute_deviation_days", "medianAbsoluteDeviationDays"],
  ["forecast_method", "forecastMethod"],
  ["confidence", "confidence"],
  ["profile_as_of_reporting_month", "profileAsOfReportingMonth"],
];

function valuesDiffer(left, right) {
  if (left === null || left === undefined) {
    return right !== null && right !== undefined;
  }
  if (right === null || right === undefined) {
    return true;
  }
  return String(left) !== String(right);
}

function syncProfiles(database, companies, historyByCompany, nowUtc) {
  const find = database.prepare(`
    SELECT * FROM company_release_profiles WHERE company_id = ?
  `);
  const insert = database.prepare(`
    INSERT INTO company_release_profiles (
      company_id,
      history_sample_count,
      actual_first_seen_sample_count,
      ir_calendar_sample_count,
      median_release_offset_days,
      median_release_minute_local,
      median_absolute_deviation_days,
      forecast_method,
      confidence,
      profile_as_of_reporting_month,
      updated_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = database.prepare(`
    UPDATE company_release_profiles
    SET history_sample_count = ?,
        actual_first_seen_sample_count = ?,
        ir_calendar_sample_count = ?,
        median_release_offset_days = ?,
        median_release_minute_local = ?,
        median_absolute_deviation_days = ?,
        forecast_method = ?,
        confidence = ?,
        profile_as_of_reporting_month = ?,
        updated_at_utc = ?
    WHERE company_id = ?
  `);

  const profiles = new Map();
  let changed = 0;
  for (const company of companies) {
    const profile = buildReleaseProfile(
      historyByCompany.get(company.companyId) ?? [],
      nowUtc,
    );
    profiles.set(company.companyId, profile);
    const existing = find.get(company.companyId);
    if (!existing) {
      insert.run(
        company.companyId,
        ...PROFILE_FIELDS.map(([, key]) => profile[key]),
        nowUtc,
      );
      changed += 1;
      continue;
    }
    const different = PROFILE_FIELDS.some(([column, key]) =>
      valuesDiffer(existing[column], profile[key]),
    );
    if (different) {
      update.run(
        ...PROFILE_FIELDS.map(([, key]) => profile[key]),
        nowUtc,
        company.companyId,
      );
      changed += 1;
    }
  }
  return { profiles, changed };
}

function getCurrentAnnouncements(database) {
  const rows = database
    .prepare(`
      SELECT
        e.company_id,
        e.reporting_month,
        e.announced_release_date_local,
        e.announced_release_time_local,
        e.announced_release_timestamp_utc,
        s.source_priority
      FROM company_release_events AS e
      JOIN company_reporting_sources AS s
        ON s.reporting_source_id = e.reporting_source_id
      WHERE e.is_current = 1 AND s.enabled = 1
      ORDER BY s.source_priority, e.release_event_id DESC
    `)
    .all();
  const announcements = new Map();
  for (const row of rows) {
    const key = `${row.company_id}|${row.reporting_month}`;
    if (!announcements.has(key)) {
      announcements.set(key, {
        releaseDateLocal: row.announced_release_date_local,
        releaseTimeLocal: row.announced_release_time_local,
        releaseTimestampUtc: row.announced_release_timestamp_utc,
      });
    }
  }
  return announcements;
}

const SCHEDULE_FIELDS = [
  ["history_expected_release_date_local", "historyExpectedReleaseDateLocal"],
  ["history_expected_release_time_local", "historyExpectedReleaseTimeLocal"],
  ["history_window_start_date_local", "historyWindowStartDateLocal"],
  ["history_window_end_date_local", "historyWindowEndDateLocal"],
  ["effective_expected_release_date_local", "effectiveExpectedReleaseDateLocal"],
  ["effective_expected_release_time_local", "effectiveExpectedReleaseTimeLocal"],
  ["effective_expected_timestamp_utc", "effectiveExpectedTimestampUtc"],
  ["regulatory_deadline_date_local", "regulatoryDeadlineDateLocal"],
  ["schedule_source", "scheduleSource"],
  ["announced_release_date_local", "announcedReleaseDateLocal"],
  ["announced_release_time_local", "announcedReleaseTimeLocal"],
  ["announced_release_timestamp_utc", "announcedReleaseTimestampUtc"],
  ["actual_first_seen_at_utc", "actualFirstSeenAtUtc"],
  ["actual_first_seen_date_local", "actualFirstSeenDateLocal"],
  ["actual_first_seen_time_local", "actualFirstSeenTimeLocal"],
  ["deviation_from_history_days", "deviationFromHistoryDays"],
  ["unusual_report_date", "unusualReportDate"],
  ["unusual_reason", "unusualReason"],
  ["release_status", "releaseStatus"],
  ["forecast_method", "forecastMethod"],
  ["forecast_confidence", "forecastConfidence"],
  ["history_sample_count", "historySampleCount"],
];

function existingScheduleForModel(existing, firstSeenUtc) {
  const actualUtc = existing?.actual_first_seen_at_utc ?? firstSeenUtc ?? null;
  if (!actualUtc) {
    return existing
      ? {
          actualFirstSeenAtUtc: null,
          actualFirstSeenDateLocal: null,
          actualFirstSeenTimeLocal: null,
        }
      : null;
  }
  const parts = utcToTaipeiParts(actualUtc);
  return {
    actualFirstSeenAtUtc: actualUtc,
    actualFirstSeenDateLocal:
      existing?.actual_first_seen_date_local ?? parts.date,
    actualFirstSeenTimeLocal:
      existing?.actual_first_seen_time_local ?? parts.time,
  };
}

function syncSchedules({
  database,
  companies,
  profiles,
  targetReportingMonth,
  scheduleMonthCount,
  holidays,
  nowUtc,
  firstSeen,
}) {
  const announcements = getCurrentAnnouncements(database);
  const find = database.prepare(`
    SELECT * FROM monthly_release_schedule
    WHERE company_id = ? AND reporting_month = ?
  `);
  const hasRevenue = database.prepare(`
    SELECT 1 AS present
    FROM company_monthly_revenue_observations
    WHERE company_id = ? AND reporting_month = ? AND is_current = 1
    LIMIT 1
  `);
  const insert = database.prepare(`
    INSERT INTO monthly_release_schedule (
      company_id,
      reporting_month,
      history_expected_release_date_local,
      history_expected_release_time_local,
      history_window_start_date_local,
      history_window_end_date_local,
      effective_expected_release_date_local,
      effective_expected_release_time_local,
      effective_expected_timestamp_utc,
      regulatory_deadline_date_local,
      schedule_source,
      announced_release_date_local,
      announced_release_time_local,
      announced_release_timestamp_utc,
      actual_first_seen_at_utc,
      actual_first_seen_date_local,
      actual_first_seen_time_local,
      deviation_from_history_days,
      unusual_report_date,
      unusual_reason,
      release_status,
      forecast_method,
      forecast_confidence,
      history_sample_count,
      last_evaluated_at_utc,
      updated_at_utc
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  const update = database.prepare(`
    UPDATE monthly_release_schedule
    SET history_expected_release_date_local = ?,
        history_expected_release_time_local = ?,
        history_window_start_date_local = ?,
        history_window_end_date_local = ?,
        effective_expected_release_date_local = ?,
        effective_expected_release_time_local = ?,
        effective_expected_timestamp_utc = ?,
        regulatory_deadline_date_local = ?,
        schedule_source = ?,
        announced_release_date_local = ?,
        announced_release_time_local = ?,
        announced_release_timestamp_utc = ?,
        actual_first_seen_at_utc = ?,
        actual_first_seen_date_local = ?,
        actual_first_seen_time_local = ?,
        deviation_from_history_days = ?,
        unusual_report_date = ?,
        unusual_reason = ?,
        release_status = ?,
        forecast_method = ?,
        forecast_confidence = ?,
        history_sample_count = ?,
        last_evaluated_at_utc = ?,
        updated_at_utc = ?
    WHERE company_id = ? AND reporting_month = ?
  `);

  let changed = 0;
  for (const company of companies) {
    for (let offset = 0; offset < scheduleMonthCount; offset += 1) {
      const month = addMonths(targetReportingMonth, offset);
      const key = `${company.companyId}|${month}`;
      const existing = find.get(company.companyId, month);
      const schedule = buildMonthlySchedule({
        reportingMonth: month,
        profile: profiles.get(company.companyId),
        announcement: announcements.get(key) ?? null,
        existing: existingScheduleForModel(existing, firstSeen.get(key)),
        hasHistoricalBackfill: Boolean(
          hasRevenue.get(company.companyId, month),
        ),
        nowUtc,
        holidays,
      });
      if (!existing) {
        insert.run(
          company.companyId,
          month,
          ...SCHEDULE_FIELDS.map(([, keyName]) => schedule[keyName]),
          nowUtc,
          nowUtc,
        );
        changed += 1;
        continue;
      }
      const different = SCHEDULE_FIELDS.some(([column, keyName]) =>
        valuesDiffer(existing[column], schedule[keyName]),
      );
      if (different) {
        update.run(
          ...SCHEDULE_FIELDS.map(([, keyName]) => schedule[keyName]),
          nowUtc,
          nowUtc,
          company.companyId,
          month,
        );
        changed += 1;
      }
    }
  }
  return changed;
}

function checkDatabase(database) {
  const foreignKeyFailures = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyFailures.length > 0) {
    throw new Error(
      `Foreign key check failed: ${JSON.stringify(foreignKeyFailures.slice(0, 5))}`,
    );
  }
  const integrity = database.prepare("PRAGMA integrity_check").get();
  if (integrity.integrity_check !== "ok") {
    throw new Error(`SQLite integrity check failed: ${integrity.integrity_check}`);
  }
}

export async function runLiveUpdate({
  databasePath,
  fetchFn = globalThis.fetch,
  nowUtc = new Date().toISOString(),
  migrationPath = DEFAULT_MIGRATION_PATH,
  irConfigPath = DEFAULT_IR_CONFIG_PATH,
  scheduleMonthCount = 13,
  overrides = null,
} = {}) {
  if (!databasePath) {
    throw new Error("databasePath is required");
  }
  const normalizedNowUtc = new Date(nowUtc).toISOString();
  const targetReportingMonth = previousTaipeiMonth(normalizedNowUtc);
  const [migrationSql, irConfigText] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(irConfigPath, "utf8"),
  ]);
  const irConfig = JSON.parse(irConfigText);
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 30000");

  let migrationApplied = false;
  try {
    migrationApplied = applyMigration(database, migrationSql);
    const companies = getCompanies(database);
    const companiesByTicker = new Map(
      companies.map((company) => [company.ticker, company]),
    );
    const remote = await collectRemoteInputs({
      fetchFn,
      targetReportingMonth,
      irConfig,
      overrides: {
        ...overrides,
        observedAtUtc: normalizedNowUtc,
      },
    });
    const selectedRows = selectUniverseRows(
      remote.mopsPayloads,
      new Set(companiesByTicker.keys()),
      targetReportingMonth,
    );
    const translations = await prepareTranslations(
      database,
      selectedRows,
      fetchFn,
      normalizedNowUtc,
    );

    const startedAtUtc = normalizedNowUtc;
    database.exec("BEGIN IMMEDIATE");
    let result;
    try {
      const irSync = seedAndSyncIrSources(
        database,
        remote.irResults,
        companiesByTicker,
        normalizedNowUtc,
      );
      const translationsChanged = syncTranslations(database, translations);
      const revenue = syncRevenueRows(
        database,
        selectedRows,
        companiesByTicker,
        normalizedNowUtc,
      );
      const history = collectReleaseHistory(database, normalizedNowUtc);
      addNewFirstSeenHistory(history, revenue.firstSeen);
      const profileSync = syncProfiles(
        database,
        companies,
        history,
        normalizedNowUtc,
      );
      const schedulesChanged = syncSchedules({
        database,
        companies,
        profiles: profileSync.profiles,
        targetReportingMonth,
        scheduleMonthCount,
        holidays: remote.holidays,
        nowUtc: normalizedNowUtc,
        firstSeen: revenue.firstSeen,
      });

      const meaningfulChanges =
        Number(migrationApplied) +
        irSync.sourcesChanged +
        irSync.eventsChanged +
        translationsChanged +
        revenue.inserted +
        profileSync.changed +
        schedulesChanged;
      if (meaningfulChanges > 0) {
        database
          .prepare(`
            INSERT INTO live_ingestion_runs (
              started_at_utc,
              completed_at_utc,
              target_reporting_month,
              mops_markets_checked,
              ir_sources_checked,
              ir_events_changed,
              revenue_observations_inserted,
              revenue_restatements_inserted,
              schedules_changed,
              translations_changed,
              errors_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            startedAtUtc,
            normalizedNowUtc,
            targetReportingMonth,
            remote.mopsPayloads.length,
            remote.irResults.length,
            irSync.eventsChanged,
            revenue.inserted,
            revenue.restatements,
            schedulesChanged,
            translationsChanged,
            JSON.stringify(remote.errors),
          );
      }
      result = {
        databaseVersion: 4,
        migrationApplied,
        targetReportingMonth,
        companies: companies.length,
        mopsMarketsChecked: remote.mopsPayloads.length,
        mopsUniverseRowsSeen: selectedRows.length,
        irSourcesChecked: remote.irResults.length,
        irEventsChanged: irSync.eventsChanged,
        revenueObservationsInserted: revenue.inserted,
        revenueRestatementsInserted: revenue.restatements,
        profilesChanged: profileSync.changed,
        schedulesChanged,
        translationsChanged,
        databaseChanged: meaningfulChanges > 0,
        errors: remote.errors,
      };
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    checkDatabase(database);
    return result;
  } finally {
    database.close();
  }
}
