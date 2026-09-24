// Run from apps/reps after verified custom SMTP and both Pixelalty domains work.
// The management credential stays in the shell environment, never in this file.
import { readFile } from "node:fs/promises";
const project = "bqycqmiaacoeulotjyrv";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token)
  throw Error(
    "Set SUPABASE_ACCESS_TOKEN privately in your shell before running this command.",
  );
if (
  process.env.SUPABASE_PROJECT_REF &&
  process.env.SUPABASE_PROJECT_REF !== project
)
  throw Error(
    "This command is restricted to the Pixelalty Sales staging project.",
  );
const endpoint = `https://api.supabase.com/v1/projects/${project}/config/auth`;
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
async function request(method: string, payload?: unknown) {
  const response = await fetch(endpoint, {
    method,
    headers,
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw Error(
      `Auth configuration request failed (${response.status}). No response details or credentials were printed.`,
    );
  return (await response.json()) as Record<string, unknown>;
}
const current = await request("GET");
if (!current.smtp_host || !current.smtp_user || !current.smtp_admin_email)
  throw Error(
    "First configure and verify custom SMTP in staging Authentication > Email > SMTP settings. The default sender cannot provide Pixelalty branding.",
  );
if (
  !/^[^\s@]+@(?:[a-z0-9-]+\.)*pixelalty\.com$/i.test(
    String(current.smtp_admin_email),
  )
)
  throw Error(
    "Configure a verified Pixelalty sender address before installing the branded templates.",
  );
const config = JSON.parse(
  await readFile(
    new URL("../supabase/auth-config.pixelalty.json", import.meta.url),
    "utf8",
  ),
);
for (const domain of [
  "https://reps.pixelalty.com",
  "https://join.pixelalty.com",
]) {
  const response = await fetch(domain + "/api/config", {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw Error(
      "Pixelalty domain readiness check failed. Finish the custom-domain setup first.",
    );
  const publicConfig = (await response.json()) as Record<string, unknown>;
  if (
    publicConfig.appUrl !== config.site_url ||
    publicConfig.recruitingUrl !== "https://join.pixelalty.com" ||
    publicConfig.supabaseUrl !== `https://${project}.supabase.co`
  )
    throw Error(
      "The Pixelalty domains must serve the expected staging application before changing email destinations.",
    );
}
if (process.argv.includes("--apply")) {
  await request("PATCH", config);
  const saved = await request("GET");
  for (const [key, value] of Object.entries(config))
    if (saved[key] !== value)
      throw Error(
        `Saved configuration did not match for ${key}. Review the staging Auth settings.`,
      );
  console.log(
    "Staging Pixelalty domains and ten branded email templates saved and verified. Production was not accessed.",
  );
} else
  console.log(
    "Staging preflight passed. Run again with --apply to install the prepared Auth configuration.",
  );
