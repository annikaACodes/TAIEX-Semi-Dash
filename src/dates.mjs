const MONTH_NAMES = new Map([
  ["january", 1],
  ["february", 2],
  ["march", 3],
  ["april", 4],
  ["may", 5],
  ["june", 6],
  ["july", 7],
  ["august", 8],
  ["september", 9],
  ["october", 10],
  ["november", 11],
  ["december", 12],
]);

const HOLIDAY_PATTERN =
  /\u653e\u5047|\u88dc\u5047|\u4f11\u5e02|\u7121\u4ea4\u6613/u;

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function isoDate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function reportingMonth(year, month) {
  return `${year}-${pad2(month)}-01`;
}

export function parseReportingMonth(value) {
  const match = /^(\d{4})-(\d{2})-01$/.exec(value);
  if (!match) {
    throw new Error(`Invalid reporting month: ${value}`);
  }
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function reportingMonthFromName(monthName, year) {
  const month = MONTH_NAMES.get(String(monthName).trim().toLowerCase());
  if (!month) {
    throw new Error(`Unknown month name: ${monthName}`);
  }
  return reportingMonth(Number(year), month);
}

export function addMonths(value, amount) {
  const { year, month } = parseReportingMonth(value);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return reportingMonth(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

export function reportingMonthEnd(value) {
  const { year, month } = parseReportingMonth(value);
  const date = new Date(Date.UTC(year, month, 0));
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) {
    throw new Error(`Invalid date: ${dateString}`);
  }
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function differenceInDays(laterDate, earlierDate) {
  const later = new Date(`${laterDate}T00:00:00Z`);
  const earlier = new Date(`${earlierDate}T00:00:00Z`);
  return Math.round((later - earlier) / 86_400_000);
}

export function taipeiDateTimeToUtc(dateLocal, timeLocal) {
  if (!timeLocal) {
    return null;
  }
  return new Date(`${dateLocal}T${timeLocal}+08:00`).toISOString();
}

export function utcToTaipeiParts(utcTimestamp) {
  const instant = new Date(utcTimestamp);
  if (Number.isNaN(instant.valueOf())) {
    throw new Error(`Invalid UTC timestamp: ${utcTimestamp}`);
  }
  const shifted = new Date(instant.valueOf() + 8 * 60 * 60 * 1000);
  return {
    date: shifted.toISOString().slice(0, 10),
    time: shifted.toISOString().slice(11, 19),
  };
}

export function previousTaipeiMonth(utcTimestamp = new Date().toISOString()) {
  const { date } = utcToTaipeiParts(utcTimestamp);
  const [year, month] = date.split("-").map(Number);
  return addMonths(reportingMonth(year, month), -1);
}

export function parseRocMonth(value) {
  const match = /^(\d{2,3})\/(\d{1,2})$/.exec(String(value).trim());
  if (!match) {
    throw new Error(`Invalid ROC reporting month: ${value}`);
  }
  return reportingMonth(Number(match[1]) + 1911, Number(match[2]));
}

export function parseRocDate(value) {
  const slashMatch = /^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/.exec(
    String(value).trim(),
  );
  if (slashMatch) {
    return isoDate(
      Number(slashMatch[1]) + 1911,
      Number(slashMatch[2]),
      Number(slashMatch[3]),
    );
  }

  const compactMatch = /^(\d{3})(\d{2})(\d{2})$/.exec(String(value).trim());
  if (compactMatch) {
    return isoDate(
      Number(compactMatch[1]) + 1911,
      Number(compactMatch[2]),
      Number(compactMatch[3]),
    );
  }

  throw new Error(`Invalid ROC date: ${value}`);
}

export function parseTwseHolidaySchedule(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  const holidays = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const text = `${row.Name ?? ""} ${row.Description ?? ""}`;
    if (!HOLIDAY_PATTERN.test(text)) {
      continue;
    }
    try {
      holidays.add(parseRocDate(row.Date));
    } catch {
      // Ignore malformed rows from the upstream calendar.
    }
  }
  return holidays;
}

export function isTaiwanBusinessDay(dateString, holidays = new Set()) {
  const day = new Date(`${dateString}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6 && !holidays.has(dateString);
}

export function businessDayOnOrBefore(dateString, holidays = new Set()) {
  let candidate = dateString;
  while (!isTaiwanBusinessDay(candidate, holidays)) {
    candidate = addDays(candidate, -1);
  }
  return candidate;
}

export function regulatoryDeadline(reportingMonthValue, holidays = new Set()) {
  const nextMonth = parseReportingMonth(addMonths(reportingMonthValue, 1));
  return businessDayOnOrBefore(
    isoDate(nextMonth.year, nextMonth.month, 10),
    holidays,
  );
}

export function minuteToTime(minute) {
  if (minute === null || minute === undefined) {
    return null;
  }
  const rounded = Math.max(0, Math.min(1439, Math.round(minute)));
  return `${pad2(Math.floor(rounded / 60))}:${pad2(rounded % 60)}:00`;
}

export function timeToMinute(time) {
  if (!time) {
    return null;
  }
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}
