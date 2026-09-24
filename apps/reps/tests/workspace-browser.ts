import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { startIntegration } from "./integration-server";

export async function verifyWorkspace(
  page: Page,
  fixture: Awaited<ReturnType<typeof startIntegration>>,
  out: URL,
  checks: string[],
) {
  assert.equal(
    await page.locator(".workspace-navigation a[href='/']").count(),
    1,
  );
  assert.equal(
    await page.locator(".workspace-navigation a[href='/admin']").count(),
    0,
  );
  await page.keyboard.press("Control+k");
  let finder = page.getByRole("dialog", { name: "Find a page", exact: true });
  await finder.getByRole("searchbox").fill("nothing-matches-this");
  await finder.getByText("No matching pages.", { exact: false }).waitFor();
  await finder.getByRole("searchbox").fill("appearance");
  await finder.getByRole("searchbox").press("Enter");
  await page
    .getByRole("heading", { name: "Appearance", exact: true })
    .waitFor();

  const original = await page.locator("html").getAttribute("data-theme");
  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  await page.getByRole("radio", { name: "Teal", exact: true }).check();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page
    .getByRole("button", { name: "Cancel changes", exact: true })
    .click();
  await page.locator('html[data-theme="' + original + '"]').waitFor();
  assert.equal(await page.locator("html").getAttribute("data-theme"), original);
  assert.equal(fixture.userMetadata.get(fixture.owner), undefined);
  checks.push(
    "One home, keyboard page search, empty search and cancelable appearance preview",
  );

  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  await page.getByRole("radio", { name: "Teal", exact: true }).check();
  await page.getByLabel("Spacing", { exact: true }).selectOption("compact");
  await page.getByLabel("Text size", { exact: true }).selectOption("large");
  await page
    .getByLabel("Sidebar style", { exact: true })
    .selectOption("matching");
  await page
    .getByRole("checkbox", { name: "Reduce motion", exact: false })
    .check();
  await page.getByRole("checkbox", { name: "Finance", exact: true }).check();
  await page
    .getByRole("button", { name: "Unpin Finance", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Finance", exact: true })
      .isChecked(),
    false,
  );
  await page.getByRole("checkbox", { name: "Finance", exact: true }).check();
  await page
    .getByRole("checkbox", { name: "Import leads", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Move Import leads up", exact: true })
    .click();

  // A failed real-client request must remain an error, not a locally saved success.
  await page.route("**/auth/v1/user", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ message: "Preference save failed. Try again." }),
    });
  });
  await page
    .getByRole("button", { name: "Save appearance", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({
      hasText: "Your appearance changes weren’t saved. Please try again.",
    })
    .waitFor();
  assert.equal(fixture.userMetadata.get(fixture.owner), undefined);
  await page.unroute("**/auth/v1/user");
  await page
    .getByRole("button", { name: "Save appearance", exact: true })
    .click();
  await page
    .getByText("Appearance saved to your account.", { exact: true })
    .waitFor();
  const stored = fixture.userMetadata.get(fixture.owner)
    ?.pixelalty_workspace as any;
  assert.equal(stored.accent, "teal");
  assert.deepEqual(stored.pinned, ["/admin/imports", "/admin/finance"]);
  await page.reload();
  await page
    .getByRole("heading", { name: "Appearance", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("Text size", { exact: true }).inputValue(),
    "large",
  );
  assert.equal(await page.locator("html").getAttribute("data-compact"), "true");
  assert.equal(
    await page.locator("html").getAttribute("data-sidebar"),
    "matching",
  );
  await page.screenshot({
    path: new URL("appearance-desktop.png", out).pathname,
    fullPage: true,
  });
  checks.push(
    "Owner without rep profile saves appearance through Supabase client; failed saves, retry, ordered pins and reload are verified",
  );

  // Clearing all browser storage proves the account, rather than a local-only draft, restores preferences.
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Valid-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Appearance", exact: true })
    .waitFor();
  assert.equal(await page.locator("html").getAttribute("data-accent"), "teal");
  assert.deepEqual(
    await page.locator(".pinned-navigation .nav-item").allTextContents(),
    ["Import leads", "Finance"],
  );
  await page
    .getByRole("button", { name: "Reset to defaults", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save appearance", exact: true })
    .click();
  await page
    .getByText("Appearance saved to your account.", { exact: true })
    .waitFor();
  checks.push(
    "Saved owner preferences restore after browser storage is cleared and a fresh sign-in",
  );

  await page.goto(fixture.base + "/admin/settings");
  await page
    .getByRole("button", { name: "Recruiting page", exact: true })
    .click();
  await page
    .getByLabel("Headline", { exact: true })
    .fill("Build your sales career with Pixelalty");
  await page
    .getByLabel("Reason for this change", { exact: true })
    .fill("Update the public recruiting headline");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.getByText("Saved successfully.", { exact: true }).waitFor();
  await page.reload();
  await page.getByLabel("Headline", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Headline", { exact: true }).inputValue(),
    "Build your sales career with Pixelalty",
  );
  await page
    .getByRole("button", { name: "Progression & training", exact: true })
    .click();
  await page.getByLabel("XP per level", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Rep activation", exact: true })
    .click();
  await page
    .getByLabel("Accepted current agreement", { exact: true })
    .waitFor();
  await page.goBack();
  await page.getByLabel("XP per level", { exact: true }).waitFor();
  checks.push(
    "Settings sections are directly addressable; recruiting edits persist and browser Back restores the previous section",
  );

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      "/",
      "/appearance",
      "/admin/settings?section=workflow",
      "/admin/settings?section=progression",
    ]) {
      await page.goto(fixture.base + path);
      await page.waitForLoadState("networkidle");
      assert.equal(
        await page.getByText("Sandbox", { exact: true }).isVisible(),
        true,
      );
      assert.equal(await page.getByRole("alert").count(), 0);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "Owner overflow: " + path + " at " + width,
      );
      if (path === "/" || path === "/appearance")
        await page.screenshot({
          path: new URL(
            (path === "/" ? "owner-home-" : "appearance-") + width + ".png",
            out,
          ).pathname,
          fullPage: true,
        });
    }
    if (width < 900) {
      assert.equal(await page.locator(".sidebar").getAttribute("inert"), "");
      await page
        .getByRole("button", { name: "Open menu", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Workspace navigation", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      assert.equal(
        await page
          .getByRole("button", { name: "Open menu", exact: true })
          .getAttribute("aria-expanded"),
        "false",
      );
      assert.equal(
        await page.evaluate(() =>
          document.activeElement?.getAttribute("aria-label"),
        ),
        "Open menu",
      );
      await page
        .getByRole("button", { name: "Find a page", exact: true })
        .click();
      finder = page.getByRole("dialog", { name: "Find a page", exact: true });
      await finder.getByRole("searchbox").fill("commission");
      await finder.getByRole("link", { name: /Finance/ }).click();
      await page
        .getByRole("heading", { name: "Commissions & payouts", exact: true })
        .waitFor();
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(fixture.base);
  await page
    .getByRole("heading", { name: "The business, at a glance.", exact: true })
    .waitFor();
  checks.push(
    "Owner home, appearance and settings verified at 390/768/1440 px; mobile drawer, Escape focus return and search navigation work",
  );
}
