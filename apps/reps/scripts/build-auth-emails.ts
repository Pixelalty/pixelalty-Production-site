import { mkdir, writeFile } from "node:fs/promises";
import { authEmail, authEmailTypes } from "../src/shared/email";
const dir = new URL("../supabase/templates/", import.meta.url);
await mkdir(dir, { recursive: true });
const config: Record<string, unknown> = {
  site_url: "https://reps.pixelalty.com",
  uri_allow_list: [
    "/",
    "/welcome",
    "/recover",
    "/auth/confirm",
    "/auth/callback",
  ]
    .map((p) => "https://reps.pixelalty.com" + p)
    .join(","),
  smtp_sender_name: "Pixelalty Sales",
};
for (const type of authEmailTypes) {
  const email = authEmail(type);
  await writeFile(new URL(type + ".html", dir), email.html + "\n");
  config["mailer_subjects_" + type] = email.subject;
  config["mailer_templates_" + type + "_content"] = email.html;
}
for (const event of [
  "password_changed",
  "email_changed",
  "mfa_factor_enrolled",
  "mfa_factor_unenrolled",
])
  config["mailer_notifications_" + event + "_enabled"] = true;
await writeFile(
  new URL("../supabase/auth-config.pixelalty.json", import.meta.url),
  JSON.stringify(config, null, 2) + "\n",
);
console.log(
  "Built ten Pixelalty email templates and hosted Auth configuration. No remote settings changed.",
);
