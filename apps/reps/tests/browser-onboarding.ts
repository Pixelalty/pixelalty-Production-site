// Real React/Worker/SQL flow with isolated Auth, Storage and Stripe transports.
// This is regression coverage, not proof of hosted SMTP or Stripe acceptance.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { startIntegration } from "./integration-server";
const f = await startIntegration({ ownerMfa: true });
await f.db.query(
  "update px_rep_private set classification='unconfigured' where rep_id=$1",
  [f.newRep],
);
const code = (
  await f.db.query<any>("select code from px_reps where id=$1", [f.newRep])
).rows[0].code;
const training = (
  await f.db.query<any>(
    "select c.title,c.kind,c.body,k.answers from px_content c left join px_private.quiz_keys k on k.content_id=c.id where c.active and c.required and c.kind in ('lesson','quiz')",
  )
).rows;
const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const out = new URL("../test-results/onboarding/", import.meta.url);
await mkdir(out, { recursive: true });
const errors: string[] = [],
  failures: string[] = [],
  checks: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.status() >= 500)
    failures.push(r.status() + " " + new URL(r.url()).pathname);
});
page.on("console", (m) => {
  if (m.type() === "error" && !/status of (400|403|409)/.test(m.text()))
    errors.push(m.text());
});
async function login(owner = false) {
  await page.goto(f.base);
  await page
    .getByLabel("Email", { exact: true })
    .fill(owner ? "owner@example.test" : "new@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Valid-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  if (owner) {
    await page.getByLabel("Six-digit authentication code").fill("123456");
    await page
      .getByRole("button", { name: "Verify session", exact: true })
      .click();
  }
  await page.locator(".sidebar").waitFor();
}
async function logout() {
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
}
async function reasoned(button: string, reason: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason for this change").fill(reason);
  await dialog.getByRole("button", { name: button, exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}
async function submitPdf(replace = false) {
  const pdf = await PDFDocument.create();
  pdf
    .addPage()
    .drawText(
      "SYNTHETIC TEST ONLY. No personal tax information. " +
        (replace ? "Corrected" : "Initial"),
    );
  await page
    .getByLabel("Completed, signed W-9 PDF")
    .setInputFiles({
      name: "isolated-test.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await pdf.save()),
    });
  await page
    .locator("#onboarding-tax")
    .getByRole("button", {
      name: replace ? "Replace W-9 securely" : "Submit W-9 securely",
      exact: true,
    })
    .click();
  await page
    .locator("#onboarding-tax .tax-status")
    .getByText("Submitted", { exact: true })
    .waitFor();
}
try {
  await login();
  await page.goto(f.base + "/onboarding");
  await page
    .getByText("Waiting for Pixelalty to publish your agreement.")
    .first()
    .waitFor();
  assert.equal(
    await page.getByText("Test environment", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Set Up Payouts Securely", exact: true })
      .count(),
    0,
  );
  assert.equal(await page.getByLabel("Completed, signed W-9 PDF").count(), 0);
  await page
    .locator(".onboarding-checklist")
    .getByRole("button", { name: "Complete profile", exact: true })
    .click();
  await page.getByLabel("Display name", { exact: true }).fill("Alex Test");
  await page.getByLabel("Timezone", { exact: true }).fill("UTC");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByText("Saved successfully.", { exact: true }).waitFor();
  await logout();
  await login(true);
  await page.goto(f.base + "/admin/reps?rep_code=" + code);
  await page
    .getByRole("heading", { name: "Can’t activate yet", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Activate Rep", exact: true })
      .isEnabled(),
    false,
  );
  await page
    .getByRole("button", { name: "Review worker classification", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Worker classification")
    .selectOption("contractor");
  await reasoned(
    "Review worker classification",
    "Isolated contractor classification reviewed",
  );
  await page
    .getByRole("link", { name: "Publish required agreement", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Publish required agreement", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Reference name", { exact: true })
    .fill("isolated-onboarding-agreement");
  await dialog
    .getByLabel("Title", { exact: true })
    .fill("Isolated onboarding agreement");
  await dialog
    .getByLabel("Content", { exact: true })
    .fill(
      "Synthetic test content only. This is not a legal agreement and creates no obligation.",
    );
  await dialog.getByLabel("Required for onboarding", { exact: true }).check();
  await dialog
    .getByLabel("Publication reason", { exact: true })
    .fill("Publish isolated automated test content");
  await dialog
    .getByRole("button", { name: "Publish version", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  checks.push(
    "Real checklist links, classification review, blocked activation and required-agreement publication work through the UI",
  );
  await logout();
  await login();
  await page.goto(f.base + "/onboarding?step=agreement");
  await page
    .locator("#onboarding-agreement")
    .getByRole("button", { name: "Review & Accept Agreement", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your full legal name").fill("Alex Test");
  await dialog.getByLabel("I have read and agree to this version.").check();
  await dialog
    .getByRole("button", { name: "Accept agreement", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .locator(".onboarding-checklist")
    .getByRole("button", { name: "Submit W-9 securely", exact: true })
    .click();
  await page
    .getByLabel("Completed, signed W-9 PDF")
    .setInputFiles({
      name: "invalid.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("This is not a PDF document."),
    });
  await page
    .locator("#onboarding-tax")
    .getByRole("button", { name: "Submit W-9 securely", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Choose a readable PDF" })
    .waitFor();
  await submitPdf();
  await page.reload();
  await page
    .locator("#onboarding-tax .tax-status")
    .getByText("Submitted", { exact: true })
    .waitFor();
  await logout();
  await login(true);
  await page.goto(f.base + "/admin/tax?rep_code=" + code);
  let download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download PDF for review", exact: true })
    .click();
  await download;
  await page
    .getByRole("button", { name: "Request correction", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason", { exact: true }).selectOption("signature");
  await dialog
    .getByRole("button", { name: "Send correction request", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await logout();
  await login();
  await page.goto(f.base + "/onboarding?step=tax");
  await page
    .locator("#onboarding-tax")
    .getByText("Please add the required signature and date.", { exact: true })
    .waitFor();
  await submitPdf(true);
  // The button invokes the production account creation and account-link code;
  // the isolated Stripe transport returns to the actual hosted-return handler.
  await page
    .locator("#onboarding-payout")
    .getByRole("button", { name: "Set Up Payouts Securely", exact: true })
    .click();
  await page
    .getByText("Your payout account is ready.", { exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).search, "?step=payout");
  assert.ok(f.providerCalls.some((x) => x.path === "/v1/account_links"));
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: new URL("rep-onboarding-" + width + ".png", out).pathname,
      fullPage: true,
    });
  }
  await page.goto(f.base + "/academy");
  for (const item of training) {
    await page
      .locator("section.card")
      .filter({
        has: page.getByRole("heading", { name: item.title, exact: true }),
      })
      .getByRole("button", { name: "Open", exact: true })
      .click();
    if (item.kind === "lesson") {
      await page
        .getByRole("button", { name: "Mark complete", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    } else {
      for (const [i, q] of JSON.parse(item.body).entries())
        await page
          .getByLabel(q.question, { exact: true })
          .selectOption(String(item.answers[i]));
      await page
        .getByRole("button", { name: "Submit answers", exact: true })
        .click();
      await page.getByText("Score: 100% · Passed", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
    }
  }
  await logout();
  await login(true);
  await page.goto(f.base + "/admin/tax?rep_code=" + code);
  download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download PDF for review", exact: true })
    .click();
  await download;
  await page
    .getByRole("button", { name: "Verify tax document", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("I have reviewed this submitted document").check();
  await dialog
    .getByRole("button", { name: "Verify document", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: "Verified", exact: true }).waitFor();
  await page.goto(f.base + "/admin/reps?rep_code=" + code);
  await page
    .getByRole("heading", { name: "Ready for activation", exact: true })
    .waitFor();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: new URL("admin-readiness-" + width + ".png", out).pathname,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Activate Rep", exact: true }).click();
  await reasoned("Activate Rep", "All isolated onboarding gates completed");
  await page
    .getByText("This rep can use the active sales workspace.", { exact: true })
    .waitFor();
  await logout();
  await login();
  await page
    .getByRole("heading", { name: "Hello, Alex.", exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("Test environment", { exact: true }).count(),
    0,
  );
  await page.reload();
  await page
    .getByRole("heading", { name: "Hello, Alex.", exact: true })
    .waitFor();
  checks.push(
    "PDF rejection, private submission, download audit, correction/replacement, Finance verification, Connect callback, training, activation and fresh-login persistence pass",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  await writeFile(
    new URL("acceptance.json", out),
    JSON.stringify(
      {
        checks,
        errors,
        failures,
        boundary:
          "Auth/email/Stripe/Storage transports are simulated. Hosted acceptance remains required.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors, failures }, null, 2));
} catch (e) {
  await page.screenshot({
    path: new URL("failure.png", out).pathname,
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
  await f.close();
}
