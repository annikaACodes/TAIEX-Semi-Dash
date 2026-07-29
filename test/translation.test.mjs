import assert from "node:assert/strict";
import test from "node:test";

import { translateMopsNote } from "../src/translation.mjs";

test("an incomplete machine translation remains an English pending record", async () => {
  const result = await translateMopsNote(
    "\u539f\u59cb\u5099\u8a3b",
    async () => ({
      ok: true,
      json: async () => [[["\u4ecd\u662f\u4e2d\u6587"]]],
    }),
    "2026-08-01T00:00:00.000Z",
  );
  assert.equal(result.translationStatus, "pending");
  assert.match(result.sourceNoteEnglish, /^Translation pending;/);
  assert.doesNotMatch(result.sourceNoteEnglish, /[^\x00-\x7F]/);
});

test("ROC years are converted before requesting an English translation", async () => {
  let translatedInput;
  const result = await translateMopsNote(
    "115\u5e74\u8cc7\u6599",
    async (url) => {
      translatedInput = url.searchParams.get("q");
      return {
        ok: true,
        json: async () => [[["2026 data"]]],
      };
    },
    "2026-08-01T00:00:00.000Z",
  );
  assert.match(translatedInput, /^2026 /);
  assert.equal(result.sourceNoteEnglish, "2026 data");
  assert.equal(result.translationStatus, "complete");
});
