import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  const result = await runLiveUpdate({ databasePath });
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length > 0) {
    console.warn(
      `Completed with ${result.errors.length} non-fatal source error(s).`,
    );
  }
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
