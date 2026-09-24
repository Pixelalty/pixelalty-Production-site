// Opt-in cutover. Cloudflare must already own the active pixelalty.com zone.
// Only staging is changed; existing runtime secrets remain in Cloudflare.
import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
const path = new URL("../wrangler.jsonc", import.meta.url);
const parsed = ts.parseConfigFileTextToJson(
  "wrangler.jsonc",
  await readFile(path, "utf8"),
);
if (parsed.error) throw Error("Unable to read the Worker configuration.");
const config = parsed.config,
  staging = config.env?.staging;
if (staging?.name !== "pixelalty-sales-staging")
  throw Error("Refusing to change an unexpected Worker.");
const domains = ["reps.pixelalty.com", "join.pixelalty.com"];
if (
  (staging.routes || []).some(
    (route: { pattern: string }) => !domains.includes(route.pattern),
  )
)
  throw Error(
    "An existing staging route needs review before the Pixelalty cutover.",
  );
staging.routes = domains.map((pattern) => ({ pattern, custom_domain: true }));
staging.workers_dev = true;
staging.vars = {
  ...staging.vars,
  APP_URL: "https://reps.pixelalty.com",
  RECRUITING_URL: "https://join.pixelalty.com",
  INTERNAL_APP_ORIGIN:
    "https://pixelalty-sales-staging.elore-marketing.workers.dev",
};
await writeFile(path, JSON.stringify(config, null, 2) + "\n");
console.log(
  "Prepared the staging Pixelalty domain configuration. No production configuration or secrets changed.",
);
