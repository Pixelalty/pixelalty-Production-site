// Real React + Worker + PostgreSQL; only external provider boundaries are local.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { startIntegration } from "./integration-server";
import { profileImages } from "./fixtures/profile-images";
const f = await startIntegration();
const browser = await chromium.launch({
  executablePath: process.env.PIXELALTY_CHROMIUM_PATH || undefined,
  args: process.env.PIXELALTY_CHROMIUM_ARGS
    ? JSON.parse(process.env.PIXELALTY_CHROMIUM_ARGS)
    : ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000);
const out = new URL("../test-results/profile/", import.meta.url);
await mkdir(out, { recursive: true });
const mediaRequests: string[] = [];
const errors: string[] = [],
  failures: string[] = [],
  checks: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/status of (400|401|403|422)/.test(m.text()))
    errors.push(m.text());
});
page.on("response", (r) => {
  if (r.url().includes("/api/profile/media/") && r.status() === 200)
    mediaRequests.push(r.url());
  if (r.url().includes("/api/") && r.status() >= 500)
    failures.push(r.status() + " " + new URL(r.url()).pathname);
});
const login = async (
  email = "rep@example.test",
  mfa = false,
  password = "Valid-password-123",
) => {
  await page.goto(f.base);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  if (mfa) {
    await page
      .getByRole("heading", { name: "Protect your account", exact: true })
      .waitFor();
    await page.getByLabel("Six-digit authentication code").fill("123456");
    await page
      .getByRole("button", { name: "Verify session", exact: true })
      .click();
  }
  await page.locator(".sidebar").waitFor();
};
const logout = async () => {
  await page.goto(f.base + "/profile");
  await page
    .getByRole("heading", { name: "My account", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .last()
    .click();
  await page
    .getByRole("heading", { name: "Sign in to your workspace" })
    .waitFor();
};
const grant = async (amount: number) => {
  const r = await fetch(f.base + "/api/action", {
    method: "POST",
    headers: {
      authorization:
        "Bearer " +
        f.session(f.users.find((u) => u.id === f.owner)).access_token,
      origin: f.base,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "xp_adjust",
      p: {
        id: f.rep,
        amount,
        reason: "Isolated browser profile acceptance",
        request_id: crypto.randomUUID(),
      },
    }),
  });
  assert.equal(r.status, 200, await r.text());
};
const clickTab = (name: string) =>
  page.getByRole("tab", { name, exact: true }).click();
const saveProfile = async () => {
  await page
    .getByRole("button", { name: "Save profile appearance", exact: true })
    .click();
  await page
    .getByText("Profile saved. Your team will see your new look.", {
      exact: true,
    })
    .waitFor();
};
try {
  await login();
  await page.goto(f.base + "/appearance");
  await page
    .getByRole("heading", { name: "Appearance", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "1,000 XP", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Halo avatar — locked at 1,000 XP",
      exact: true,
    })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByText(/You currently have 0 XP/).waitFor();
  assert.ok(
    await modal.getByRole("button", { name: /more XP to equip/ }).isDisabled(),
  );
  await page.keyboard.press("Escape");
  await grant(50000);
  await page
    .getByRole("button", { name: "Halo avatar", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Halo avatar", exact: true }).click();
  await page.getByRole("button", { name: "Select Halo", exact: true }).click();
  await page.getByRole("button", { name: "Frame", exact: true }).click();
  await page
    .getByRole("button", { name: "Corners frame", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select Corners", exact: true })
    .click();
  await page.getByRole("button", { name: "Banner", exact: true }).click();
  await page.getByRole("button", { name: "50,000 XP", exact: true }).click();
  await page
    .getByRole("button", { name: "Aurora banner", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select Aurora", exact: true })
    .click();
  await saveProfile();
  await page.reload();
  await page.locator(".sidebar-footer .cosmetic-frame-corners").waitFor();
  await page.locator(".profile-surface .cosmetic-banner-aurora").waitFor();
  checks.push(
    "Locked previews cannot equip; server XP award refreshes unlocked styles without sign-out; frame and banner persist after reload",
  );
  await page.getByRole("button", { name: "Avatar", exact: true }).click();
  await page.getByLabel("Choose avatar image", { exact: true }).setInputFiles({
    name: "fake.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("not an image"),
  });
  await page
    .getByRole("alert")
    .filter({ hasText: /readable PNG/ })
    .waitFor();
  await page.getByLabel("Choose avatar image", { exact: true }).setInputFiles({
    name: "avatar.gif",
    mimeType: "image/gif",
    buffer: Buffer.from(profileImages.gif, "base64"),
  });
  await page
    .getByRole("dialog", { name: "Preview your avatar", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Upload image", exact: true }).click();
  await page.getByText(/Upload complete. Position your image/).waitFor();
  await page.getByLabel("Horizontal position", { exact: true }).fill("35");
  await saveProfile();
  await page.locator(".sidebar-footer .avatar-face img").waitFor();
  await page.getByRole("button", { name: "Banner", exact: true }).click();
  await page.getByLabel("Choose banner image", { exact: true }).setInputFiles({
    name: "banner.webp",
    mimeType: "image/webp",
    buffer: Buffer.from(profileImages.animated_webp, "base64"),
  });
  await page.getByRole("button", { name: "Upload image", exact: true }).click();
  await page.getByText(/Upload complete. Position your image/).waitFor();
  await page.getByLabel("Banner fit", { exact: true }).selectOption("contain");
  await saveProfile();
  await clickTab("Motion");
  await page.getByLabel("Motion", { exact: true }).selectOption("off");
  await page
    .getByRole("button", { name: "Save appearance", exact: true })
    .click();
  await page
    .getByText("Appearance saved to your account.", { exact: true })
    .waitFor();
  await page.reload();
  await page.locator('html[data-motion="off"]').waitFor();
  assert.equal(
    await page
      .locator(".sidebar-footer .cosmetic-orbit")
      .first()
      .evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  assert.ok(
    mediaRequests.some((url) => url.includes("still=true")),
    "Reduced motion fetches a static image",
  );
  checks.push(
    "Malformed image rejected; animated avatar and banner uploaded with position and fit; private image proxy and static reduced-motion version rendered",
  );
  await page.goto(f.base + "/profile");
  await page
    .getByRole("heading", { name: "My account", exact: true })
    .waitFor();
  await page.getByLabel("Display name", { exact: true }).fill("Jordan Profile");
  await page
    .getByLabel("Timezone", { exact: true })
    .selectOption("America/Phoenix");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByText("Saved successfully.", { exact: true }).waitFor();
  await page.reload();
  assert.equal(
    await page.getByLabel("Timezone", { exact: true }).inputValue(),
    "America/Phoenix",
  );
  await page.locator(".sidebar-footer .cosmetic-frame-corners").waitFor();
  await page
    .getByLabel("New email address", { exact: true })
    .fill("updated-rep@example.test");
  await page.getByRole("button", { name: "Change email", exact: true }).click();
  await page.getByText(/Verification pending for/).waitFor();
  assert.equal(f.users.find((u) => u.id === f.rep)?.email, "rep@example.test");
  await page.goto(
    f.base +
      "/auth/callback?type=email_change&token_hash=email_change_test_hash_" +
      f.rep,
  );
  await page
    .getByRole("button", { name: "Confirm email", exact: true })
    .click();
  await page.locator(".sidebar").waitFor();
  assert.ok(!page.url().includes("token_hash"));
  await page.goto(f.base + "/profile");
  await page
    .getByText("updated-rep@example.test", { exact: true })
    .first()
    .waitFor();
  await logout();
  await login("updated-rep@example.test");
  await page.goto(f.base + "/profile");
  await page
    .getByRole("heading", { name: "My account", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("Display name", { exact: true }).inputValue(),
    "Jordan Profile",
  );
  assert.equal(
    await page.getByLabel("Timezone", { exact: true }).inputValue(),
    "America/Phoenix",
  );
  checks.push(
    "Actual Auth SDK email update retains the old identity while pending; isolated verification changes Auth and profile email; new sign-in restores name, timezone and cosmetics",
  );
  const groups = page.locator(".workspace-navigation details");
  for (let i = 0; i < (await groups.count()); i++) {
    if (!(await groups.nth(i).getAttribute("open"))) {
      const expanded = await groups
        .nth(i)
        .evaluate((e) => (e as HTMLDetailsElement).open);
      if (!expanded) await groups.nth(i).locator("summary").click();
    }
  }
  await page.locator('.workspace-navigation a[href="/appearance"]').click();
  await page
    .getByRole("heading", { name: "Appearance", exact: true })
    .waitFor();
  await page.reload();
  assert.ok(
    (await groups.evaluateAll(
      (es) => es.filter((e) => (e as HTMLDetailsElement).open).length,
    )) >= 4,
  );
  await clickTab("Navigation");
  await page
    .getByLabel("Navigation section behavior", { exact: true })
    .selectOption("single");
  await page
    .getByRole("button", { name: "Save appearance", exact: true })
    .click();
  await page
    .getByText("Appearance saved to your account.", { exact: true })
    .waitFor();
  await groups.first().locator("summary").click();
  assert.equal(
    await groups.evaluateAll(
      (es) => es.filter((e) => (e as HTMLDetailsElement).open).length,
    ),
    1,
  );
  await clickTab("Workspace");
  await page.getByLabel("Spacing", { exact: true }).selectOption("spacious");
  await page.getByLabel("Font", { exact: true }).selectOption("humanist");
  await page.getByLabel("Card surface", { exact: true }).selectOption("glass");
  await page
    .getByLabel("Workspace background", { exact: true })
    .selectOption("grid");
  await page
    .getByRole("button", { name: "Save appearance", exact: true })
    .click();
  await page
    .getByText("Appearance saved to your account.", { exact: true })
    .waitFor();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    for (const tab of ["Profile", "Workspace", "Navigation", "Motion"]) {
      await clickTab(tab);
      await page.waitForLoadState("networkidle");
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "Overflow " + tab + " at " + width,
      );
      await page.screenshot({
        path: new URL(tab.toLowerCase() + "-" + width + ".png", out).pathname,
        fullPage: true,
      });
    }
    if (width < 900) {
      await page
        .getByRole("button", { name: "Open menu", exact: true })
        .click();
      const before = await groups.evaluateAll((es) =>
        es
          .filter((e) => (e as HTMLDetailsElement).open)
          .map((e) => e.querySelector("summary")?.textContent),
      );
      await page.locator('.workspace-navigation a[href="/"]').click();
      await page
        .getByRole("button", { name: "Open menu", exact: true })
        .click();
      assert.deepEqual(
        await groups.evaluateAll((es) =>
          es
            .filter((e) => (e as HTMLDetailsElement).open)
            .map((e) => e.querySelector("summary")?.textContent),
        ),
        before,
      );
      await page.keyboard.press("Escape");
      await page.goto(f.base + "/appearance");
    }
  }
  checks.push(
    "Multiple navigation groups survive navigation/reload; optional single-section mode and mobile drawer retain state; all appearance tabs fit 390/768/1440",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(f.base + "/profile");
  await page
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  await page
    .getByRole("img", { name: "Authenticator enrollment QR code" })
    .waitFor();
  await page.getByLabel("Six-digit authentication code").fill("123456");
  await page
    .getByRole("button", { name: "Verify session", exact: true })
    .click();
  await page.getByText("Authenticator verified.", { exact: true }).waitFor();
  await page
    .getByLabel("New password", { exact: true })
    .fill("Changed-fixture-123");
  await page
    .getByRole("button", { name: "Update password", exact: true })
    .click();
  await page.getByText("Password updated.", { exact: true }).waitFor();
  await logout();
  await login("updated-rep@example.test", true, "Changed-fixture-123");
  await page.goto(f.base + "/profile");
  await page
    .getByRole("button", { name: "Remove authenticator", exact: true })
    .click();
  await page
    .getByLabel("I want to remove this authenticator", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Confirm removal", exact: true })
    .click();
  await page.getByText("Authenticator removed.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .waitFor();
  checks.push(
    "Optional rep MFA enrolls, requires a verified code on fresh login, and safely unenrolls at AAL2; updated password works on fresh login",
  );
  await logout();
  await login("owner@example.test");
  const repCode = (
    await f.db.query<any>("select code from px_reps where id=$1", [f.rep])
  ).rows[0].code;
  await page.goto(f.base + "/admin/reps?rep_code=" + repCode + "&manage=1");
  await page.locator(".profile-surface .cosmetic-frame-corners").waitFor();
  await page.locator(".profile-surface .avatar-face img").waitFor();
  await page
    .getByLabel("Reason for removal", { exact: true })
    .fill("Isolated profile moderation acceptance");
  await page
    .getByRole("button", {
      name: "Remove profile images & reset style",
      exact: true,
    })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Profile reset and images removed." })
    .waitFor();
  checks.push(
    "Administrator sees shared cosmetics and can remove images through audited moderation",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  await writeFile(
    new URL("report.json", out),
    JSON.stringify({ checks, errors, failures }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors, failures }, null, 2));
} finally {
  await browser.close();
  await f.close();
}
