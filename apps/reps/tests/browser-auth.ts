// Exercises the real React screens, Worker, SDK and migrated SQL.
// Auth/email transport is isolated. This is not evidence of real inbox delivery.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { startIntegration } from "./integration-server";
import { authEmail } from "../src/shared/email";
const fixture = await startIntegration({ ownerMfa: true });
const browser = await chromium.launch({
  executablePath: process.env.PIXELALTY_CHROMIUM_PATH || undefined,
  args: process.env.PIXELALTY_CHROMIUM_ARGS
    ? JSON.parse(process.env.PIXELALTY_CHROMIUM_ARGS)
    : ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10000);
const out = new URL("../test-results/auth/", import.meta.url);
await mkdir(out, { recursive: true });
const errors: string[] = [],
  unexpected: string[] = [],
  checks: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/status of (400|401|403|422|429)/.test(m.text()))
    errors.push(m.text());
});
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.status() >= 500)
    unexpected.push(r.status() + " " + new URL(r.url()).pathname);
});
const login = async (email: string, password = "Valid-password-123") => {
  await page.goto(fixture.base);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
};
const signedApi = async (path: string, data?: unknown) =>
  page.evaluate(
    async ({ path, data }) => {
      const key = Object.keys(sessionStorage).find((k) =>
        k.endsWith("-auth-token"),
      )!;
      const token = JSON.parse(sessionStorage.getItem(key)!).access_token;
      const response = await fetch("/api" + path, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      return { status: response.status, body: (await response.json()) as any };
    },
    { path, data },
  );
const verify = async () => {
  await page.getByLabel("Six-digit authentication code").fill("123456");
  await page
    .getByRole("button", { name: "Verify session", exact: true })
    .click();
  await page.locator(".sidebar").waitFor();
};
try {
  await fixture.db.query(
    "insert into px_content(kind,slug,title,body,required) values('agreement','auth-agreement','Test agreement','Agreement for this isolated test. No real contract is created.',true),('lesson','auth-lesson','Getting started','Record truthful activity and respect contact preferences.',true)",
  );
  const quiz = await fixture.db.query<{ id: string }>(
    "insert into px_content(kind,slug,title,body,required) values('quiz','auth-quiz','Readiness check',$1,true) returning id",
    [
      JSON.stringify([
        {
          question: "What verifies a sale?",
          options: ["A reported sale", "A verified payment"],
        },
      ]),
    ],
  );
  await fixture.db.query("insert into px_private.quiz_keys values($1,'[1]')", [
    quiz.rows[0].id,
  ]);
  const requiredTraining = (
    await fixture.db.query<any>(
      "select c.title,c.kind,c.body,k.answers from px_content c left join px_private.quiz_keys k on k.content_id=c.id where c.active and c.required and c.kind in ('lesson','quiz')",
    )
  ).rows;
  // Exercise the hosted failure: the Worker receives a workspace request
  // without a session header after the sign-in screen has already advanced.
  await page.route(
    "**/api/me",
    async (route) => {
      const headers = { ...route.request().headers() };
      delete headers.authorization;
      await route.continue({ headers });
    },
    { times: 1 },
  );
  await login("owner@example.test");
  await page
    .getByText("Your session has ended. Please sign in again.")
    .waitFor();
  await page
    .getByRole("heading", { name: "Sign in to your workspace" })
    .waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Workspace unavailable" }).count(),
    0,
  );
  checks.push(
    "Missing-session workspace responses return to a usable sign-in form with an explicit session-ended message",
  );
  await login("owner@example.test", "incorrect-password");
  await page
    .getByText("The email or password is incorrect. Please try again.")
    .waitFor();
  await page.getByLabel("Password", { exact: true }).fill("Valid-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Protect your admin access" })
    .waitFor();
  assert.equal((await signedApi("/table?name=applicants")).body.rows.length, 0);
  assert.equal(
    (
      await signedApi("/invite/resend", {
        id: fixture.newRep,
        reason: "MFA is required for this action",
      })
    ).status,
    403,
  );
  await page.getByLabel("Six-digit authentication code").fill("111111");
  await page
    .getByRole("button", { name: "Verify session", exact: true })
    .click();
  await page
    .getByText(
      "That code didn’t match. Use the latest six-digit code from your authenticator app.",
    )
    .waitFor();
  for (const theme of ["light", "dark", "system"]) {
    await page.evaluate(
      (theme) => localStorage.setItem("pixelalty-theme", theme),
      theme,
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await page.getByLabel("Six-digit authentication code").waitFor();
    for (const width of [390, 768, 1440]) {
      for (const height of [900, 520, 760]) {
        await page.setViewportSize({ width, height });
        const layout = await page.evaluate(() => {
          const shell = document.querySelector(".auth-shell")!,
            card = document.querySelector(".auth-card")!,
            inner = document.querySelector(".auth-shell-inner")!;
          const r = shell.getBoundingClientRect(),
            c = card.getBoundingClientRect(),
            i = inner.getBoundingClientRect();
          return {
            theme: document.documentElement.dataset.theme,
            width: innerWidth,
            height: innerHeight,
            scroll: document.documentElement.scrollWidth,
            top: r.top,
            bottom: r.bottom,
            cardLeft: c.left,
            cardRight: c.right,
            cardTop: c.top,
            center: i.top + i.height / 2,
            bg: getComputedStyle(shell).backgroundColor,
            body: getComputedStyle(document.body).backgroundColor,
            root: getComputedStyle(document.documentElement).backgroundColor,
          };
        });
        assert.equal(layout.theme, theme === "system" ? "dark" : theme);
        assert.equal(layout.top, 0);
        assert.ok(layout.bottom >= height);
        assert.equal(layout.bg, layout.body);
        assert.equal(layout.bg, layout.root);
        assert.ok(layout.scroll <= width + 1);
        assert.ok(
          layout.cardLeft >= 0 &&
            layout.cardRight <= width + 1 &&
            layout.cardTop >= 0,
        );
        if (height > 620) assert.ok(Math.abs(layout.center - height / 2) < 2);
      }
      if (theme !== "system")
        await page.screenshot({
          path: new URL(`mfa-${theme}-${width}.png`, out).pathname,
          fullPage: true,
        });
    }
    if (theme === "system") {
      await page.emulateMedia({ colorScheme: "light" });
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "light",
      );
    }
  }
  checks.push(
    "Login reaches MFA; invalid password/code feedback is safe; admin API denied until MFA; light/dark/system and viewport resizing at 390/768/1440 verified",
  );
  // A response started before sign-out must not replace the new signed-out
  // screen or another session. Hold one real context request across sign-out.
  let releaseContext: () => void = () => {};
  const contextGate = new Promise<void>((resolve) => {
    releaseContext = resolve;
  });
  await page.route(
    "**/api/me",
    async (route) => {
      await contextGate;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Sign in to continue." }),
      });
    },
    { times: 1 },
  );
  const contextStarted = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/me",
  );
  await page.getByLabel("Six-digit authentication code").fill("123456");
  await page
    .getByRole("button", { name: "Verify session", exact: true })
    .click();
  await contextStarted;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("heading", { name: "Sign in to your workspace" })
    .waitFor();
  releaseContext();
  await page.waitForLoadState("networkidle");
  assert.equal(
    await page.getByRole("heading", { name: "Workspace unavailable" }).count(),
    0,
  );
  assert.ok(
    await page
      .getByRole("heading", { name: "Sign in to your workspace" })
      .isVisible(),
  );
  checks.push(
    "Delayed workspace failures after MFA/sign-out cannot overwrite the current authentication state",
  );
  await login("owner@example.test");
  await verify();
  assert.equal((await signedApi("/table?name=applicants")).status, 200);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "window.turnstile={render:function(s,p){p.callback('isolated-token');return 1;},remove:function(){},reset:function(){}};",
    }),
  );
  await page.goto(fixture.base + "/apply");
  for (const [label, value] of [
    ["Full name", "Applicant Auth"],
    ["Email", "auth-flow@example.test"],
    ["Phone with country code", "+13035550145"],
    ["State / province", "Colorado"],
    ["Country", "United States"],
    ["Hours available per week", "20"],
    [
      "Why would you like to join Pixelalty?",
      "I enjoy helping small businesses and learning sales.",
    ],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel("I confirm that I am at least 18 years old.").check();
  await page
    .getByLabel(
      "I understand commissions are conditional and earnings are not guaranteed.",
    )
    .check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await page.getByRole("heading", { name: "Application received" }).waitFor();
  await login("owner@example.test");
  await verify();
  await page.goto(fixture.base + "/admin/recruiting");
  const applicant = page.getByRole("row").filter({ hasText: "Applicant Auth" });
  await applicant.getByRole("button", { name: "Approve & invite" }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Reason for this change")
    .fill("Approved for isolated auth test");
  await dialog
    .getByRole("button", { name: "Approve & invite", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await applicant.getByText("Onboarding", { exact: true }).waitFor();
  assert.equal(
    fixture.authCalls.find((c) => c.type === "invite").redirect,
    fixture.base + "/welcome",
  );
  await page.goto(fixture.base + "/admin/reps");
  const repRow = page.getByRole("row").filter({ hasText: "Applicant Auth" });
  await repRow.getByRole("button", { name: "Send setup email" }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Reason for this change")
    .fill("Requested replacement setup link");
  await dialog
    .getByRole("button", { name: "Send account setup email", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    fixture.authCalls.find((c) => c.type === "recovery").redirect,
    fixture.base + "/recover",
  );
  const [hash, invitation] = Array.from(fixture.emailLinks).find(
    ([, v]) => v.type === "invite",
  )!;
  const email = authEmail("invite");
  assert.ok(
    email.html.includes(
      "https://reps.pixelalty.com/auth/confirm#token_hash={{ .TokenHash }}",
    ),
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto(
    fixture.base +
      "/auth/confirm#token_hash=expired_invitation_hash_12345&type=invite",
  );
  await page
    .getByRole("button", { name: "Continue to password setup" })
    .click();
  await page
    .getByRole("heading", { name: "This invitation is no longer valid" })
    .waitFor();
  assert.equal(page.url(), fixture.base + "/auth/confirm");
  assert.equal(
    await page
      .getByRole("link", { name: "Request a new invitation" })
      .getAttribute("href"),
    "https://pixelalty.com/contact.html",
  );
  await page.goto(
    fixture.base + "/auth/confirm#token_hash=" + hash + "&type=invite",
  );
  await page
    .getByRole("heading", { name: "Your Pixelalty invitation" })
    .waitFor();
  assert.equal(page.url(), fixture.base + "/auth/confirm");
  assert.ok(
    fixture.emailLinks.has(hash),
    "Email scanner/page load must not consume the token",
  );
  await page.route(
    "**/auth/v1/verify",
    (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error_code: "over_request_rate_limit",
          msg: "Do not expose this provider error",
        }),
      }),
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "Continue to password setup" })
    .click();
  await page.getByText("Please wait a moment before trying again.").waitFor();
  await page
    .getByRole("button", { name: "Continue to password setup" })
    .click();
  await page
    .getByRole("heading", { name: "Welcome to Pixelalty", exact: true })
    .waitFor();
  await page
    .getByLabel("New password", { exact: true })
    .fill("Invited-password-123");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("Different-password-123");
  await page
    .getByRole("button", { name: "Save password and continue" })
    .click();
  await page.getByText("The passwords do not match.").waitFor();
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("Invited-password-123");
  await page
    .getByRole("button", { name: "Save password and continue" })
    .click();
  await page
    .getByRole("heading", { name: "Welcome to Pixelalty.", exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).pathname, "/onboarding");
  assert.equal((await signedApi("/table?name=applicants")).body.rows.length, 0);
  assert.equal(
    (
      await signedApi("/invite/resend", {
        id: invitation.id,
        reason: "Rep attempting admin action",
      })
    ).status,
    403,
  );
  await page.goto(fixture.base + "/profile");
  await page.getByLabel("Display name", { exact: true }).fill("Applicant Auth");
  await page.getByLabel("Timezone", { exact: true }).fill("UTC");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByText("Saved successfully.").first().waitFor();
  await page.goto(fixture.base + "/onboarding");
  await page
    .locator("#onboarding-agreement")
    .getByRole("button", { name: "Review & Accept Agreement" })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your full legal name").fill("Applicant Auth");
  await dialog.getByLabel("I have read and agree to this version.").check();
  await dialog.getByRole("button", { name: "Accept agreement" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.goto(fixture.base + "/academy");
  for (const item of requiredTraining) {
    await page
      .locator("section.card")
      .filter({
        has: page.getByRole("heading", { name: item.title, exact: true }),
      })
      .getByRole("button", { name: "Open", exact: true })
      .click();
    if (item.kind === "lesson") {
      await page.getByRole("button", { name: "Mark complete" }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    } else {
      for (const [i, question] of JSON.parse(item.body).entries())
        await page
          .getByLabel(question.question, { exact: true })
          .selectOption(String(item.answers[i]));
      await page.getByRole("button", { name: "Submit answers" }).click();
      await page.getByText("Score: 100% · Passed").waitFor();
      await page.keyboard.press("Escape");
    }
  }
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login("owner@example.test");
  await verify();
  await page.goto(fixture.base + "/admin/reps");
  await repRow
    .getByRole("button", { name: "Manage onboarding & readiness", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review worker classification", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Worker classification").selectOption("employee");
  await dialog
    .getByLabel("Reason for this change")
    .fill("Isolated employee classification test");
  await dialog
    .getByRole("button", { name: "Review worker classification", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Review employee tax & payroll", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Employee tax setup verified through the approved process")
    .check();
  await dialog.getByLabel("Approved payroll setup verified").check();
  await dialog
    .getByLabel("Reason for this change")
    .fill("Isolated employee onboarding test, no real payroll");
  await dialog
    .getByRole("button", { name: "Verify employee tax & payroll", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Activate Rep", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Reason for this change")
    .fill("All isolated onboarding requirements reviewed");
  await dialog
    .getByRole("button", { name: "Activate Rep", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByText("This rep can use the active sales workspace.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login("auth-flow@example.test", "Invited-password-123");
  await page.getByRole("heading", { name: "Hello, Applicant." }).waitFor();
  assert.equal((await signedApi("/table?name=businesses")).body.rows.length, 0);
  await page.goto(fixture.base + "/admin");
  await page.getByText("This page is not available for your role.").waitFor();
  checks.push(
    "Application → approval → email transport → single-use callback → password validation → profile/agreement/training → admin activation → fresh sign-in; rep/admin RLS remains separated",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto(fixture.base + "/?reset=1");
  await page
    .getByLabel("Email", { exact: true })
    .fill("auth-flow@example.test");
  await page.getByRole("button", { name: "Send reset email" }).click();
  await page.getByText("Check your email for the next step.").waitFor();
  const recovery = Array.from(fixture.emailLinks).find(
    ([, v]) => v.type === "recovery",
  )!;
  await page.goto(
    fixture.base + "/auth/confirm#token_hash=" + recovery[0] + "&type=recovery",
  );
  await page
    .getByRole("button", { name: "Continue to reset password" })
    .click();
  await page
    .getByLabel("New password", { exact: true })
    .fill("Recovered-password-123");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("Recovered-password-123");
  await page
    .getByRole("button", { name: "Save password and continue" })
    .click();
  await page.getByRole("heading", { name: "Hello, Applicant." }).waitFor();
  checks.push(
    "Password recovery and admin replacement setup email use canonical callbacks and persist the new password",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  await writeFile(
    new URL("results.json", out),
    JSON.stringify(
      {
        checks,
        runtimeErrors: errors,
        unexpectedFailures: unexpected,
        externalEmailDelivery: "Not tested by this isolated suite",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { checks, runtimeErrors: errors, unexpectedFailures: unexpected },
      null,
      2,
    ),
  );
} catch (error) {
  await page
    .screenshot({ path: new URL("failure.png", out).pathname, fullPage: true })
    .catch(() => {});
  console.error(
    "Auth browser failure",
    String(error),
    "Page:",
    await page.locator("body").innerText(),
  );
  throw error;
} finally {
  await browser.close();
  await fixture.close();
}
