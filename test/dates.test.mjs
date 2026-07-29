import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTwseHolidaySchedule,
  previousTaipeiMonth,
  regulatoryDeadline,
} from "../src/dates.mjs";

test("Taiwan substitute holidays move the operational deadline earlier", () => {
  const holidays = parseTwseHolidaySchedule([
    {
      Name: "\u570b\u6176\u65e5",
      Date: "1151009",
      Description:
        "10\u670810\u65e5\u9069\u9022\u661f\u671f\u516d\uff0c10\u67089\u65e5\u88dc\u5047\u3002",
    },
  ]);
  assert.equal(regulatoryDeadline("2026-09-01", holidays), "2026-10-08");
});

test("the MOPS target is the previous month in Taipei", () => {
  assert.equal(previousTaipeiMonth("2026-08-01T00:30:00.000Z"), "2026-07-01");
  assert.equal(previousTaipeiMonth("2026-07-31T15:30:00.000Z"), "2026-06-01");
  assert.equal(previousTaipeiMonth("2026-07-31T16:30:00.000Z"), "2026-07-01");
});
