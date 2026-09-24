// Browser acceptance against the real UI, Worker and migrated PostgreSQL engine.
// External identity/payment providers are explicitly simulated by integration-server.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { startIntegration } from "./integration-server";
const out = new URL("../test-results/v1/", import.meta.url);
await mkdir(out, { recursive: true });
const fixture = await startIntegration();
const browser = await chromium.launch({
  executablePath: process.env.PIXELALTY_CHROMIUM_PATH || undefined,
  args: process.env.PIXELALTY_CHROMIUM_ARGS
    ? JSON.parse(process.env.PIXELALTY_CHROMIUM_ARGS)
    : ["--no-sandbox", "--disable-dev-shm-usage"],
});
const errors: string[] = [],
  failures: string[] = [],
  checks: string[] = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(12000);
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("status of 400"))
    errors.push(m.text());
});
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.status() >= 400)
    failures.push(r.status() + " " + r.url());
});
const login = async (email: string) => {
  await page.goto(fixture.base);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Valid-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator(".sidebar").waitFor();
};
const settle = async () => {
  await page.waitForLoadState("networkidle");
};
const go = async (path: string) => {
  console.log("Checking", path);
  await page.goto(fixture.base + path);
  await settle();
  assert.equal(
    await page.getByText("This page is not available for your role.").count(),
    0,
    "Unexpected route denial: " + path,
  );
  assert.equal(
    await page.getByRole("alert").count(),
    0,
    "Page error at " + path + ": " + (await page.locator("body").innerText()),
  );
};
try {
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "window.turnstile={render:function(s,p){this.callback=p.callback;p.callback('isolated-verified-token');return 1;},remove:function(){},reset:function(){this.callback&&this.callback('isolated-verified-token');}};",
    }),
  );
  await page.goto(fixture.base + "/apply");
  await page.getByLabel("Full name").fill("Applicant Browser");
  await page
    .getByLabel("Email", { exact: true })
    .fill("applicant@example.test");
  await page.getByLabel("Phone with country code").fill("+13035550144");
  await page.getByLabel("State / province").fill("Colorado");
  await page.getByLabel("Country", { exact: true }).fill("United States");
  await page.getByLabel("Hours available per week").fill("20");
  await page
    .getByLabel("Why would you like to join Pixelalty?")
    .fill("I enjoy helping businesses and learning practical sales skills.");
  await page.getByLabel("I confirm that I am at least 18 years old.").check();
  await page
    .getByLabel(
      "I understand commissions are conditional and earnings are not guaranteed.",
    )
    .check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await page.getByRole("heading", { name: "Application received" }).waitFor();
  checks.push(
    "Public application persists with explicit Turnstile boundary simulation",
  );
  await login("owner@example.test");
  await page
    .getByRole("heading", { name: "The business, at a glance." })
    .waitFor();
  console.log("Owner signed in");
  await page.goto(fixture.base + "/profile?reset=1");
  await page
    .getByLabel("New password", { exact: true })
    .fill("Replacement-password-123");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("Replacement-password-123");
  await page
    .getByRole("button", { name: "Save password and continue" })
    .click();
  await page
    .getByRole("heading", { name: "The business, at a glance." })
    .waitFor();
  checks.push(
    "Legacy recovery link completes password form and returns admin to the dashboard",
  );
  checks.push("Owner-only dashboard and actual sign-in form");
  for (const path of [
    "/admin/recruiting",
    "/admin/reps",
    "/admin/leads",
    "/admin/pipeline",
    "/admin/imports",
    "/admin/finance",
    "/admin/content",
    "/admin/settings",
    "/admin/compliance",
    "/admin/fulfillment",
    "/admin/audit",
    "/admin/health",
    "/notifications",
    "/profile",
  ])
    await go(path);
  await go("/admin/recruiting");
  const applicant = page
    .getByRole("row")
    .filter({ hasText: "Applicant Browser" });
  await applicant.getByRole("button", { name: "Approve & invite" }).click();
  const approval = page.getByRole("dialog");
  await approval
    .getByLabel("Reason for this change")
    .fill("Review completed for isolated applicant");
  await approval
    .getByRole("button", { name: "Approve & invite", exact: true })
    .click();
  await approval.waitFor({ state: "hidden" });
  await applicant.getByText("Onboarding", { exact: true }).waitFor();
  checks.push(
    "Applicant review and idempotent approval create a real rep record; email provider is simulated",
  );
  checks.push("Every admin page loads through Worker and RLS database");
  await go("/admin/settings");
  const workflow = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Workflow policy" }) });
  await workflow.getByLabel("Leads per claim").fill("7");
  await workflow
    .getByLabel("Reason for changing policy")
    .fill("Set a manageable lead claim");
  await workflow.getByRole("button", { name: "Save policy" }).click();
  await workflow.getByText("Saved successfully.").waitFor();
  await page.reload();
  await settle();
  assert.equal(await page.getByLabel("Leads per claim").inputValue(), "7");
  checks.push("Validated workspace settings persist on reload");
  await go("/admin/content");
  await page
    .getByRole("button", { name: "Publish content", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Content type").selectOption("lesson");
  await dialog.getByLabel("Reference name").fill("browser-lesson");
  await dialog
    .getByLabel("Title", { exact: true })
    .fill("Browser verified training");
  await dialog
    .getByLabel("Content", { exact: true })
    .fill(
      "Practice clear introductions and record truthful outcomes for every conversation.",
    );
  await dialog
    .getByLabel("Publication reason")
    .fill("Publish acceptance test lesson");
  await dialog.getByRole("button", { name: "Publish version" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByText("Browser verified training", { exact: true }).waitFor();
  checks.push("Admin publishes versioned content");
  await page
    .getByRole("button", { name: "Publish content", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Content type").selectOption("quiz");
  await dialog
    .getByLabel("Question", { exact: true })
    .fill("What verifies a sale?");
  await dialog.getByLabel("Answer 1", { exact: true }).fill("A reported sale");
  await dialog
    .getByLabel("Answer 2", { exact: true })
    .fill("A verified payment");
  await dialog
    .getByLabel("Correct answer 1", { exact: true })
    .selectOption("1");
  await dialog.getByLabel("Reference name").fill("browser-quiz");
  await dialog
    .getByLabel("Title", { exact: true })
    .fill("Browser readiness quiz");
  await dialog.getByLabel("Publication reason").fill("Publish a reviewed quiz");
  await dialog.getByRole("button", { name: "Publish version" }).click();
  await dialog.waitFor({ state: "hidden" });
  checks.push("Quiz builder publishes questions and a private answer key");

  await go("/admin/imports");
  await page.locator("input[type=file]").setInputFiles({
    name: "acceptance.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Business,Phone,Timezone\nAlder QA,3035550123,UTC\nAlder Duplicate,3035550123,UTC\nBad QA,broken,UTC",
    ),
  });
  await page.getByRole("button", { name: "Validate & stage import" }).click();
  await page
    .getByRole("heading", { name: "Review before importing" })
    .waitFor();
  await page.getByRole("button", { name: "Import clean records" }).click();
  await page.getByRole("heading", { name: "Import complete" }).waitFor();
  checks.push(
    "CSV upload, mapping, real normalization, review, dedup and commit",
  );
  await go("/admin/pipeline");
  await page.getByRole("button", { name: "Create deal", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Rep", { exact: true })
    .selectOption({ label: "Jordan · PXL-00001" });
  await (async () => {
    const value = await dialog
      .getByLabel("Assigned business", { exact: true })
      .locator("option")
      .filter({ hasText: "Beacon" })
      .getAttribute("value");
    await dialog
      .getByLabel("Assigned business", { exact: true })
      .selectOption(value!);
  })();
  const pkgValue = await dialog
    .getByLabel("Package", { exact: true })
    .locator("option")
    .filter({ hasText: "Launch" })
    .getAttribute("value");
  await dialog.getByLabel("Package", { exact: true }).selectOption(pkgValue!);
  await dialog.getByLabel("Customer email").fill("customer@example.test");
  await dialog.getByLabel("Reason").fill("Customer accepted standard package");
  await dialog
    .getByRole("button", { name: "Create an attributed deal", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Create / view checkout" }).click();
  await page.getByRole("dialog").waitFor();
  assert.equal(
    fixture.providerCalls.filter(
      (c) => c.method === "POST" && c.path === "/v1/checkout/sessions",
    ).length,
    1,
  );
  checks.push(
    "Admin deal attribution and sandbox checkout request at provider boundary",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login("rep@example.test");
  await page.getByRole("heading", { name: "Hello, Jordan." }).waitFor();
  await go("/profile");
  await page.getByLabel("Monthly income goal ($)").fill("2500.75");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByLabel("Monthly verified sales goal").fill("5");
  await page.getByLabel("Monthly qualifying call goal").fill("100");
  await page.getByLabel("Profile frame").selectOption("auto");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await settle();
  await page.reload();
  await settle();
  assert.equal(
    await page.getByLabel("Monthly income goal ($)").inputValue(),
    "2500.75",
  );
  checks.push("Profile, decimal money inputs and personal goals persist");
  await go("/leads");
  const beacon = page.getByRole("row").filter({ hasText: "Beacon Services" });
  await beacon.getByRole("button", { name: "Open business" }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Add a note")
    .fill("Browser note stored in PostgreSQL");
  await dialog.getByRole("button", { name: "Save note", exact: true }).click();
  await dialog
    .getByText("Browser note stored in PostgreSQL", { exact: true })
    .first()
    .waitFor();
  await dialog.getByRole("button", { name: "Favorite", exact: true }).click();
  await dialog.getByRole("button", { name: "Remove favorite" }).waitFor();
  await page.keyboard.press("Escape");
  checks.push("Business timeline, persistent note and favorite");
  await go("/focus");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
  await page.reload();
  await settle();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await page
    .getByPlaceholder("What mattered? What happens next?")
    .fill("Decision maker requested a proposal");
  await page.getByRole("button", { name: "Save outcome", exact: true }).click();
  await page.getByText("Call outcome saved.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await page.getByRole("heading", { name: "Session complete" }).waitFor();
  checks.push(
    "Persistent focus session, pause/reload/resume, actual call record and summary",
  );
  await go("/academy");
  const lesson = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Browser verified training" }),
  });
  await lesson.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: "Mark complete" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await lesson
    .getByRole("button", { name: "Review completed lesson" })
    .waitFor();
  const quiz = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Browser readiness quiz" }),
  });
  await quiz.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByLabel("What verifies a sale?").selectOption("1");
  await page.getByRole("button", { name: "Submit answers" }).click();
  await page.getByText("Score: 100% · Passed").waitFor();
  await page.keyboard.press("Escape");
  checks.push("Lesson completion and server-graded quiz through rep UI");
  for (const path of [
    "/",
    "/leads",
    "/followups",
    "/pipeline",
    "/money",
    "/academy",
    "/leaderboard",
    "/notifications",
    "/support",
    "/onboarding",
  ])
    await go(path);
  checks.push("Every rep V1 page loads without API or runtime failures");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      "/",
      "/leads",
      "/focus",
      "/pipeline",
      "/money",
      "/onboarding",
    ]) {
      await go(path);
      const dimensions = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: innerWidth,
      }));
      assert.ok(
        dimensions.scroll <= dimensions.width + 1,
        `Horizontal overflow at ${path} / ${width}`,
      );
    }
    await page.screenshot({
      path: new URL("onboarding-" + width + ".png", out).pathname,
      fullPage: true,
      timeout: 5000,
    });
  }
  checks.push("Mobile, tablet and desktop layout / overflow review");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go("/");
  await page.screenshot({
    path: new URL("dashboard-desktop.png", out).pathname,
    fullPage: true,
    timeout: 5000,
  });
  await page.getByRole("button", { name: "Switch appearance" }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.screenshot({
    path: new URL("dashboard-dark.png", out).pathname,
    fullPage: true,
    timeout: 5000,
  });
  assert.deepEqual(failures, []);
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("results.json", out),
    JSON.stringify(
      {
        checks,
        errors,
        failures,
        externalProviders:
          "Simulated boundaries; hosted verification is separate",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors, failures }, null, 2));
} catch (e) {
  console.error("Browser failure:", e);
  await page
    .screenshot({
      path: new URL("failure.png", out).pathname,
      fullPage: true,
      timeout: 5000,
    })
    .catch(() => {});
  console.error("PAGE", await page.locator("body").innerText());
  console.error({ errors, failures });
  throw e;
} finally {
  await browser.close();
  await fixture.close();
}
