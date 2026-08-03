import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchLatestUsdTwdRate,
  isExchangeRateRecord,
} from "../src/exchange-rate.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(
  scriptDirectory,
  "../web/public/data/exchange-rate.json",
);

async function readExistingRate() {
  try {
    const value = JSON.parse(await readFile(outputPath, "utf8"));
    return isExchangeRateRecord(value) ? value : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const existing = await readExistingRate();

try {
  const latest = await fetchLatestUsdTwdRate();
  if (
    existing?.rateDate === latest.rateDate &&
    existing?.twdPerUsd === latest.twdPerUsd
  ) {
    console.log(
      `USD/TWD rate is unchanged at ${latest.twdPerUsd} as of ${latest.rateDate}.`,
    );
  } else {
    await writeFile(outputPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8");
    console.log(
      `Updated USD/TWD rate to ${latest.twdPerUsd} as of ${latest.rateDate}.`,
    );
  }
} catch (error) {
  if (!existing) throw error;
  console.warn(
    `TAIFEX rate refresh failed; retaining ${existing.twdPerUsd} from ${existing.rateDate}.`,
  );
  console.warn(error instanceof Error ? error.message : String(error));
}
