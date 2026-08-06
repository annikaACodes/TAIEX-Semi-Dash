import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { backfillAspeedReportDates } from "../src/aspeed-backfill.mjs";
import { runLiveUpdate } from "../src/live-update.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const databasePath = resolve(
  argumentValue("--database") ??
    `${repositoryRoot}/taiwan_semiconductor_companies.sqlite`,
);

try {
  const nowUtc = new Date().toISOString();
  const result = await runLiveUpdate({
    databasePath,
    nowUtc,
    enablePublicTimestampFallback: true,
  });
  let aspeedIr = null;
  try {
    aspeedIr = await backfillAspeedReportDates({
      databasePath,
      nowUtc,
      monthCount: 1,
    });
    result.databaseChanged ||= aspeedIr.databaseChanged;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push({ source: "aspeed_ir_monthly_revenue", message });
    console.warn(`ASPEED IR timestamp poll failed non-fatally: ${message}`);
  }
  console.log(JSON.stringify({ ...result, aspeedIr }, null, 2));
  if (result.deferred) {
    console.warn(`Poll deferred safely: ${result.deferredReason}`);
  } else if (result.errors.length > 0) {
    console.warn(
      `Completed with ${result.errors.length} non-fatal source error(s).`,
    );
  }
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
