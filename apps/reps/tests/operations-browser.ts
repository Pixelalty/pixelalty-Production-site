import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { startIntegration } from "./integration-server";
type Fixture = Awaited<ReturnType<typeof startIntegration>>;
export async function verifyOperationsAdmin(
  page: Page,
  fixture: Fixture,
  out: URL,
  checks: string[],
) {
  await page.goto(fixture.base + "/admin/sales-settings");
  const growth = page.getByRole("row").filter({ hasText: "Growth" });
  await growth.getByRole("button", { name: "Edit package" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Fixed rep commission ($)").fill("251");
  await dialog
    .getByLabel("Reason for update")
    .fill("Prospective commission acceptance");
  await dialog.getByRole("button", { name: "Save package settings" }).click();
  await dialog.waitFor({ state: "hidden" });
  await growth.getByRole("cell", { name: "$251.00", exact: true }).waitFor();
  assert.equal(
    (
      await fixture.db.query<any>(
        "select count(*)::int n from px_packages where code='growth'",
      )
    ).rows[0].n,
    2,
  );
  const launch = page.getByRole("row").filter({ hasText: "Launch" });
  await launch.getByRole("button", { name: "Edit package" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Customer price ($)").fill("849");
  await dialog.getByLabel("Fixed rep commission ($)").fill("130");
  await dialog
    .getByLabel("Reason for update")
    .fill("Prospective price acceptance");
  await dialog.getByRole("button", { name: "Save package settings" }).click();
  await dialog.waitFor({ state: "hidden" });
  checks.push(
    "Admin package price and commission edits publish prospective catalog versions",
  );

  await page.goto(fixture.base + "/admin/support");
  await page
    .getByRole("button", { name: "Support hub settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add support option", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Card title").fill("Pixelalty Discord test");
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Acceptance-test community option");
  await dialog
    .getByLabel("HTTPS destination URL")
    .fill("https://discord.com/invite/pixelalty");
  await dialog.getByLabel("Button text").fill("Open demo community");
  await dialog
    .getByLabel("QR image description")
    .fill("Demo QR image for support acceptance");
  await dialog
    .locator('input[type="file"]')
    .setInputFiles(
      new URL("../public/support/whatsapp-direct.png", import.meta.url)
        .pathname,
    );
  await dialog.getByText("QR image selected.", { exact: false }).waitFor();
  await dialog
    .getByRole("button", { name: "Save support option", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  const card = page
    .getByRole("row")
    .filter({ hasText: "Pixelalty Discord test" });
  await card
    .getByRole("button", {
      name: "Move Pixelalty Discord test up",
      exact: true,
    })
    .click();
  await card
    .getByRole("button", {
      name: "Move Pixelalty Discord test down",
      exact: true,
    })
    .click();
  await card.getByRole("button", { name: "Hide", exact: true }).click();
  await card.getByRole("button", { name: "Reactivate", exact: true }).click();
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Remove QR image", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save support option", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    [...fixture.storedFiles.keys()].filter((x) =>
      x.startsWith("pixelalty-profile-media/support/"),
    ).length,
    0,
  );
  const direct = page
    .getByRole("row")
    .filter({ hasText: "Message Pixelalty Support" });
  await direct.getByRole("button", { name: "Edit", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Card title")
    .fill("Direct Pixelalty support updated");
  await dialog
    .locator('input[type="file"]')
    .setInputFiles(
      new URL("../public/support/whatsapp-direct.png", import.meta.url)
        .pathname,
    );
  await dialog.getByText("Uploading image…").waitFor({ state: "hidden" });
  await dialog
    .getByRole("button", { name: "Save support option", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  checks.push(
    "Support titles, QR replacement/removal, new cards, hide/reactivate and safe storage cleanup work through the UI",
  );

  await page.goto(fixture.base + "/admin/imports");
  await page
    .getByLabel("Choose lead spreadsheet")
    .setInputFiles(
      new URL("./fixtures/demo-business-leads.xlsx", import.meta.url).pathname,
    );
  await page
    .getByRole("heading", { name: "demo-business-leads.xlsx" })
    .waitFor();
  await page
    .getByText("25 rows pass format validation", { exact: false })
    .waitFor();
  assert.equal(
    await page.getByLabel("Default timezone for rows without one").isVisible(),
    false,
  );
  await page.getByRole("button", { name: "Validate & stage import" }).click();
  await page
    .getByRole("heading", { name: "Review before importing" })
    .waitFor();
  await page.getByRole("button", { name: "Import clean records" }).click();
  await page.getByRole("heading", { name: "Import complete" }).waitFor();
  const imported = await fixture.db.query<any>(
    "select id from px_imports where filename='demo-business-leads.xlsx'",
  );
  assert.equal(
    (
      await fixture.db.query<any>(
        "select count(*)::int n from px_businesses where import_id=$1",
        [imported.rows[0].id],
      )
    ).rows[0].n,
    25,
  );
  await page.screenshot({
    path: new URL("exact-workbook-import.png", out).pathname,
    fullPage: true,
  });
  checks.push(
    "Exact uploaded XLSX imports all 25 rows with automatic header mapping and ZIP timezones",
  );

  await page.goto(fixture.base + "/admin/leads");
  const selectAll = page.getByRole("checkbox", { name: /^Select all/ });
  await selectAll.check();
  assert.equal((await page.getByRole("checkbox").count()) > 1, true);
  await selectAll.uncheck();
  const remove = async (names: string[]) => {
    for (const name of names)
      await page.getByLabel("Select " + name, { exact: true }).check();
    await page
      .getByRole("button", { name: "Delete permanently", exact: true })
      .first()
      .click();
    const modal = page.getByRole("dialog");
    await modal
      .getByLabel("Reason", { exact: true })
      .fill("Remove explicitly disposable acceptance leads");
    await modal
      .getByLabel(`Type DELETE ${names.length} LEADS`)
      .fill(`DELETE ${names.length} LEADS`);
    await modal
      .getByRole("button", { name: "Confirm permanent deletion" })
      .click();
    await modal.waitFor({ state: "hidden" });
    for (const name of names)
      assert.equal(
        (
          await fixture.db.query("select id from px_businesses where name=$1", [
            name,
          ])
        ).rows.length,
        0,
      );
  };
  await remove(["Example Towing & Recovery"]);
  await remove(["Demo Remodeling Group", "Placeholder Junk Removal"]);
  const archive = page
    .getByRole("row")
    .filter({ hasText: "Sample Window & Door" });
  await archive.getByRole("button", { name: "Archive", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Archive one disposable demo lead");
  await dialog.getByRole("button", { name: "Archive leads" }).click();
  await dialog.waitFor({ state: "hidden" });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForFunction(
      () =>
        innerWidth > 900 ||
        (document.querySelector(".sidebar")?.getBoundingClientRect().right ??
          0) <= 1,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `Lead controls overflow at ${width}px`,
    );
    await page.screenshot({
      path: new URL(`lead-management-${width}.png`, out).pathname,
      fullPage: true,
      animations: "disabled",
    });
  }
  checks.push(
    "Single and multi-select permanent deletion remove real rows; archiving is separate and responsive",
  );
  await page.goto(fixture.base + "/team");
  await page
    .getByRole("heading", { name: "Rep management", exact: true })
    .waitFor();
  await page.getByRole("link").filter({ hasText: "Jordan" }).first().click();
  await page.getByRole("heading", { name: "Manage Jordan" }).waitFor();
  checks.push(
    "Old My Team redirects to Rep Management; rep names open the exact account",
  );
}
export async function verifyOperationsRep(
  page: Page,
  fixture: Fixture,
  out: URL,
  checks: string[],
) {
  await page.goto(fixture.base + "/academy");
  const growth = page
    .locator(".package-list article")
    .filter({ hasText: "Growth" });
  await growth.getByText("$251.00", { exact: true }).waitFor();
  const launch = page
    .locator(".package-list article")
    .filter({ hasText: "Launch" });
  await launch.getByText("$849.00", { exact: true }).waitFor();
  await launch.getByText("$130.00", { exact: true }).waitFor();
  await page.goto(fixture.base + "/support");
  await page
    .getByRole("link", { name: "Open demo community", exact: false })
    .waitFor();
  await page
    .getByRole("heading", { name: "Direct Pixelalty support updated" })
    .waitFor();
  const qr = page.getByAltText(/direct Pixelalty Support WhatsApp/);
  await qr.waitFor();
  assert.match((await qr.getAttribute("src")) || "", /^blob:/);
  await page.waitForFunction(() =>
    [...document.images].some(
      (i) =>
        i.alt.includes("direct Pixelalty Support WhatsApp") &&
        i.naturalWidth === 640,
    ),
  );
  await page.goto(fixture.base + "/leads");
  const demo = page.getByRole("row").filter({ hasText: "Demo Plumbing Co." });
  await demo.getByRole("button", { name: "Inspect", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByText("America/New_York", { exact: true }).waitFor();
  await dialog
    .getByRole("button", { name: "Claim this lead", exact: false })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Add a note")
    .fill("Exact workbook lead claimed and reviewed");
  await dialog.getByRole("button", { name: "Save note", exact: true }).click();
  await dialog
    .getByText("Exact workbook lead claimed and reviewed", { exact: true })
    .first()
    .waitFor();
  await page.keyboard.press("Escape");
  const saved = (
    await fixture.db.query<any>(
      "select owner_id from px_businesses where name='Demo Plumbing Co.'",
    )
  ).rows[0];
  assert.equal(saved.owner_id, fixture.rep);
  await page.screenshot({
    path: new URL("demo-lead-claimed.png", out).pathname,
    fullPage: true,
  });
  checks.push(
    "Rep sees updated packages/support, inspects and claims an exact-workbook lead, and saves a persistent note",
  );
}
