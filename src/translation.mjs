import { sha256 } from "./hash.mjs";

const HAN_PATTERN = /[\u3400-\u9FFF]/u;
const CORRECTION_PATTERN =
  /\u66f4\u6b63|\u91cd\u65b0\u516c\u544a|\u4fee\u6b63|\u91cd\u7de8/iu;

function asciiClean(value) {
  return String(value)
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u00A0/g, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function expandRocYears(value) {
  return String(value).replace(/(?<!\d)(\d{2,3})\s*\u5e74/gu, (match, year) => {
    const numeric = Number(year);
    return numeric >= 1 && numeric <= 199 ? `${numeric + 1911} ` : match;
  });
}

function normalizeUnits(value) {
  return value
    .replace(/\bthousand yuan\b/gi, "thousand New Taiwan dollars")
    .replace(/\bNTD thousand\b/gi, "thousand New Taiwan dollars");
}

function pendingText(sourceNote) {
  return CORRECTION_PATTERN.test(sourceNote)
    ? "Translation pending; the official MOPS note indicates a correction or restatement."
    : "Translation pending; consult the official MOPS source record.";
}

export async function translateMopsNote(
  sourceNote,
  fetchFn = globalThis.fetch,
  nowUtc = new Date().toISOString(),
) {
  const sourceNoteSha256 = sha256(sourceNote);
  const prepared = expandRocYears(sourceNote);
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "zh-TW");
  url.searchParams.set("tl", "en");
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", prepared);

  try {
    const response = await fetchFn(url, {
      headers: { "User-Agent": "Taiwan-Monthly-Revenue-Research/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Translation HTTP ${response.status}`);
    }
    const payload = await response.json();
    const rawTranslated = (payload?.[0] ?? [])
      .map((segment) => segment?.[0] ?? "")
      .join(" ");
    if (!rawTranslated || HAN_PATTERN.test(rawTranslated)) {
      throw new Error("Translation response was incomplete");
    }
    const translated = normalizeUnits(asciiClean(rawTranslated));
    if (!translated) {
      throw new Error("Translation response was empty after normalization");
    }
    return {
      sourceNoteSha256,
      sourceNoteEnglish: translated,
      translationProvider: "google_translate_public_endpoint",
      translationStatus: "complete",
      translatedAtUtc: nowUtc,
      lastTranslationAttemptAtUtc: nowUtc,
    };
  } catch {
    return {
      sourceNoteSha256,
      sourceNoteEnglish: pendingText(sourceNote),
      translationProvider: "english_pending_placeholder",
      translationStatus: "pending",
      translatedAtUtc: nowUtc,
      lastTranslationAttemptAtUtc: nowUtc,
    };
  }
}
