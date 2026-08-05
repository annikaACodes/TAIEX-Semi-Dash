import assert from "node:assert/strict";
import test from "node:test";

import {
  parseHonHaiCalendar,
  parseMediaTekCalendar,
  parseTsmcCalendar,
  parseUmcCalendar,
} from "../src/ir-parsers.mjs";

test("TSMC calendar parser extracts the reporting month and Taipei time", () => {
  const events = parseTsmcCalendar(`
    <var class="atc_event">
      <var class="atc_date_start">2026-08-10 13:30:00</var>
      <var class="atc_title">TSMC Monthly Sales - July 2026</var>
    </var>
  `);
  assert.deepEqual(events, [
    {
      reportingMonth: "2026-07-01",
      releaseDateLocal: "2026-08-10",
      releaseTimeLocal: "13:30:00",
      releaseTimestampUtc: "2026-08-10T05:30:00.000Z",
      title: "TSMC Monthly Sales - July 2026",
    },
  ]);
});

test("Hon Hai calendar parser rejects a title/date year mismatch", () => {
  const events = parseHonHaiCalendar(`
    "Hon Hai&#8217;s Unaudited Consolidated July 2026 Revenue","2026/08/05"
    "Hon Hai&#8217;s Unaudited Consolidated April 2025 Revenue","2026/05/05"
  `);
  assert.equal(events.length, 1);
  assert.equal(events[0].reportingMonth, "2026-07-01");
  assert.equal(events[0].releaseDateLocal, "2026-08-05");
});

test("UMC and MediaTek calendar parsers extract official overrides", () => {
  const umc = parseUmcCalendar(`
    <strong>July 2026, Monthly Sales Announcement</strong>
    <div class="date">8/6/2026*</div>
  `);
  const mediatek = parseMediaTekCalendar(`
    <div class="events_calendar_item"
      data-title="Monthly Sales - July 2026"
      data-location="Online"
      data-start-date="2026-08-10T17:00:00">
    </div>
  `);
  assert.equal(umc[0].releaseDateLocal, "2026-08-06");
  assert.equal(mediatek[0].releaseTimestampUtc, "2026-08-10T09:00:00.000Z");
});

test("UMC parser reads the dedicated annual events calendar", () => {
  const events = parseUmcCalendar(`
    <div class="table_title">Monthly Sales Announcement - 2026</div>
    <div class="inner">January：2/5/2026(Thu)</div>
    <div class="inner">July：8/6/2026(Thu)*</div>
    <div class="inner">December：1/7/2027(Thu)*</div>
    <div>Quarterly Earnings Release &amp; Investor Conference Call</div>
  `);

  assert.deepEqual(
    events.map((event) => [
      event.reportingMonth,
      event.releaseDateLocal,
      event.title,
    ]),
    [
      [
        "2026-01-01",
        "2026-02-05",
        "January 2026, Monthly Sales Announcement",
      ],
      [
        "2026-07-01",
        "2026-08-06",
        "July 2026, Monthly Sales Announcement",
      ],
      [
        "2026-12-01",
        "2027-01-07",
        "December 2026, Monthly Sales Announcement",
      ],
    ],
  );
});
