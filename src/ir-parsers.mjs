import {
  differenceInDays,
  reportingMonthEnd,
  reportingMonthFromName,
  taipeiDateTimeToUtc,
} from "./dates.mjs";

function decodeEntities(value) {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x2019;|&#8217;/gi, "'")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTime(value) {
  if (!value) {
    return null;
  }
  const match = /(?:T|\s)(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  return match ? `${match[1]}:${match[2]}:${match[3] ?? "00"}` : null;
}

function normalizeIsoDate(value) {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(value.trim());
  if (!match) {
    return null;
  }
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function normalizeUsDate(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value.trim());
  if (!match) {
    return null;
  }
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function makeEvent(monthName, year, dateValue, timeValue, title) {
  let month;
  try {
    month = reportingMonthFromName(monthName, year);
  } catch {
    return null;
  }
  const releaseDateLocal = normalizeIsoDate(dateValue);
  if (!releaseDateLocal) {
    return null;
  }
  const offset = differenceInDays(releaseDateLocal, reportingMonthEnd(month));
  if (offset < 0 || offset > 31) {
    return null;
  }
  const releaseTimeLocal = normalizeTime(timeValue);
  return {
    reportingMonth: month,
    releaseDateLocal,
    releaseTimeLocal,
    releaseTimestampUtc: taipeiDateTimeToUtc(
      releaseDateLocal,
      releaseTimeLocal,
    ),
    title: decodeEntities(title),
  };
}

function deduplicate(events) {
  const unique = new Map();
  for (const event of events.filter(Boolean)) {
    const key = [
      event.reportingMonth,
      event.releaseDateLocal,
      event.releaseTimeLocal ?? "",
    ].join("|");
    unique.set(key, event);
  }
  return [...unique.values()].sort((a, b) =>
    `${a.reportingMonth}|${a.releaseDateLocal}`.localeCompare(
      `${b.reportingMonth}|${b.releaseDateLocal}`,
    ),
  );
}

export function parseTsmcCalendar(html) {
  const events = [];
  const pattern =
    /<var\s+class=["']atc_date_start["']>\s*([^<]+)<\/var>[\s\S]{0,1200}?<var\s+class=["']atc_title["']>\s*([^<]+)<\/var>/gi;
  for (const match of html.matchAll(pattern)) {
    const title = decodeEntities(match[2]);
    const titleMatch =
      /TSMC Monthly Sales\s*-\s*([A-Za-z]+)\s+(\d{4})/i.exec(title);
    if (titleMatch) {
      events.push(
        makeEvent(
          titleMatch[1],
          titleMatch[2],
          match[1],
          match[1],
          title,
        ),
      );
    }
  }

  return deduplicate(events);
}

export function parseMediaTekCalendar(html) {
  const events = [];
  const tagPattern = /<div\b[^>]*class=["'][^"']*events_calendar_item[^"']*["'][^>]*>/gi;
  for (const tagMatch of html.matchAll(tagPattern)) {
    const tag = tagMatch[0];
    const title = /\bdata-title=["']([^"']+)["']/i.exec(tag)?.[1];
    const start = /\bdata-start-date=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!title || !start) {
      continue;
    }
    const titleMatch = /Monthly Sales\s*-\s*([A-Za-z]+)\s+(\d{4})/i.exec(
      decodeEntities(title),
    );
    if (titleMatch) {
      events.push(
        makeEvent(
          titleMatch[1],
          titleMatch[2],
          start,
          start,
          title,
        ),
      );
    }
  }
  return deduplicate(events);
}

export function parseUmcCalendar(html) {
  const events = [];
  const overviewPattern =
    /<strong>\s*([A-Za-z]+)\s+(\d{4}),\s*Monthly Sales Announcement\s*<\/strong>[\s\S]{0,600}?<div\s+class=["']date["']>\s*(\d{1,2}\/\d{1,2}\/\d{4})\*?/gi;
  for (const match of html.matchAll(overviewPattern)) {
    const isoDate = normalizeUsDate(match[3]);
    if (isoDate) {
      events.push(
        makeEvent(
          match[1],
          match[2],
          isoDate,
          null,
          `${match[1]} ${match[2]}, Monthly Sales Announcement`,
        ),
      );
    }
  }

  const eventsPagePattern =
    /Monthly Sales Announcement\s*-\s*(\d{4})([\s\S]{0,5000}?)(?=Quarterly Earnings Release|Monthly Sales Announcement\s*-\s*\d{4}|$)/gi;
  const monthPattern =
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s*(?:\uFF1A|:|&#(?:x?ff1a|65306);)\s*(\d{1,2}\/\d{1,2}\/\d{4})/gi;
  for (const section of html.matchAll(eventsPagePattern)) {
    for (const match of section[2].matchAll(monthPattern)) {
      const isoDate = normalizeUsDate(match[2]);
      if (isoDate) {
        events.push(
          makeEvent(
            match[1],
            section[1],
            isoDate,
            null,
            `${match[1]} ${section[1]}, Monthly Sales Announcement`,
          ),
        );
      }
    }
  }
  return deduplicate(events);
}

export function parseHonHaiCalendar(html) {
  const events = [];
  const pattern =
    /["'](Hon Hai[^"']*?Unaudited Consolidated\s+([A-Za-z]+)\s+(\d{4})\s+Revenue)["']\s*,\s*["'](\d{4}\/\d{1,2}\/\d{1,2})["']/gi;
  for (const match of html.matchAll(pattern)) {
    events.push(
      makeEvent(match[2], match[3], match[4], null, match[1]),
    );
  }
  return deduplicate(events);
}

const PARSERS = {
  tsmc: parseTsmcCalendar,
  honhai: parseHonHaiCalendar,
  umc: parseUmcCalendar,
  mediatek: parseMediaTekCalendar,
};

export function parseIrCalendar(parserName, html) {
  const parser = PARSERS[parserName];
  if (!parser) {
    throw new Error(`Unknown IR calendar parser: ${parserName}`);
  }
  const events = parser(html);
  if (events.length === 0) {
    throw new Error(`IR parser ${parserName} found no monthly revenue events`);
  }
  return events;
}
