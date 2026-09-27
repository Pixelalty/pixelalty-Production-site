import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { startIntegration } from "./integration-server";

// The UI, Worker, authorization and migrated SQL are real. External Auth is a fixture.
export async function verifyAccounts(
  page: Page,
  f: Awaited<ReturnType<typeof startIntegration>>,
  code: string,
  out: URL,
  checks: string[],
  login: (owner?: boolean) => Promise<void>,
  logout: () => Promise<void>,
) {
  await page.goto(f.base + "/xp");
  await page
    .getByRole("heading", { name: "Career XP history", exact: true })
    .waitFor();
  const initial = (
    await f.db.query<any>(
      "select coalesce(sum(amount),0) total from px_xp where rep_id=$1",
      [f.newRep],
    )
  ).rows[0].total;
  assert.ok(initial > 0, "Required training awards XP");
  await logout();
  await login(true);
  await page.goto(f.base + "/admin/reps?rep_code=" + code + "&manage=1");
  await page
    .getByRole("heading", { name: "Manage Alex Test", exact: true })
    .waitFor();
  await page
    .getByLabel("Legal / admin name", { exact: true })
    .fill("Alex Acceptance");
  await page.getByLabel("Monthly sales goal", { exact: true }).fill("8");
  await page
    .getByLabel("Reason for this change", { exact: true })
    .fill("Verify mutable account details persist");
  await page
    .getByRole("button", { name: "Save account changes", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Account changes saved." })
    .waitFor();
  await page.reload();
  await page.getByLabel("Legal / admin name", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Legal / admin name", { exact: true }).inputValue(),
    "Alex Acceptance",
  );
  assert.equal(
    await page.getByLabel("Monthly sales goal", { exact: true }).inputValue(),
    "8",
  );
  await page.getByRole("button", { name: "Adjust XP", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("XP adjustment (+ or −)", { exact: true })
    .fill("125");
  await dialog
    .getByLabel("Reason for this change")
    .fill("Browser acceptance audited XP correction");
  await dialog.getByRole("button", { name: "Adjust XP", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByText((Number(initial) + 125).toLocaleString() + " career XP", {
      exact: true,
    })
    .waitFor();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForLoadState("networkidle");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: new URL("manage-account-" + width + ".png", out).pathname,
      fullPage: true,
    });
  }
  await logout();
  await login();
  await page.goto(f.base + "/xp");
  await page
    .getByText((Number(initial) + 125).toLocaleString() + " career XP", {
      exact: true,
    })
    .waitFor();
  await page
    .getByText("Browser acceptance audited XP correction", { exact: true })
    .waitFor();
  checks.push(
    "Account profile/goals edits and audited XP correction persist after reload and fresh rep sign-in; account management fits mobile, tablet and desktop",
  );
  await logout();
  await login(true);
  await page.goto(f.base + "/admin/reps?rep_code=" + code + "&manage=1");
  await page
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Type DELETE " + code, { exact: true })
    .fill("DELETE " + code);
  await dialog
    .getByLabel("Reason for deletion", { exact: true })
    .fill("Browser acceptance protected account deletion");
  await dialog
    .getByRole("button", { name: "Delete account permanently", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("heading", { name: "ACCOUNT DELETED", exact: true })
    .waitFor();
  assert.equal(
    (await f.db.query("select id from auth.users where id=$1", [f.newRep])).rows
      .length,
    0,
  );
  assert.equal(
    (
      await f.db.query("select id from px_agreements where rep_id=$1", [
        f.newRep,
      ])
    ).rows.length,
    1,
  );
  const disposable = (
    await f.db.query<any>("select code from px_reps where id=$1", [f.rep])
  ).rows[0].code;
  await page.goto(f.base + "/admin/reps?rep_code=" + disposable + "&manage=1");
  await page
    .getByRole("button", { name: "Purge test data", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Type PURGE TEST DATA " + disposable, { exact: true })
    .fill("PURGE TEST DATA " + disposable);
  await dialog
    .getByLabel("Reason for deletion", { exact: true })
    .fill("Browser acceptance disposable test purge");
  await dialog
    .getByRole("button", { name: "Permanently purge test data", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("heading", { name: "Rep management", exact: true })
    .waitFor();
  assert.equal(
    (await f.db.query("select id from px_reps where id=$1", [f.rep])).rows
      .length,
    0,
  );
  assert.equal(
    (await f.db.query("select id from auth.users where id=$1", [f.rep])).rows
      .length,
    0,
  );
  await page
    .getByRole("heading", {
      name: "Accounts without a rep profile",
      exact: true,
    })
    .waitFor();
  checks.push(
    "Owner confirmation modals execute protected deletion and safe test purge; Auth access is removed, protected agreement survives, disposable profile is removed",
  );
}
