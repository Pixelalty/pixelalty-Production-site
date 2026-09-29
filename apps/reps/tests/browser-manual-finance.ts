// Actual UI, Worker and migrated SQL. Stripe is an isolated HTTP boundary.
// This does not certify real provider delivery or money movement.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import Stripe from "stripe";
import { startIntegration } from "./integration-server";
import { actor, rpc } from "./helpers";

const paymentFixture = { code: "JORDAN2", refund: 0 };
const f = await startIntegration({ ownerMfa: true, paymentFixture });
await actor(f.db, f.owner, "aal2");
await rpc(f.db, "px_action", "sales_code_save", { id: f.rep, code: "JORDAN2" });
await f.db.exec("reset role");
await f.db.query(
  "insert into px_payout_setup(rep_id,email,phone,legal_first_name,legal_last_name,status) values($1,'rep@example.test','+12125550198','Jordan','Test','ready')",
  [f.rep],
);
await f.db.query(
  "update px_rep_private set tax_status='verified' where rep_id=$1",
  [f.rep],
);
const stripe = new Stripe(f.env.STRIPE_SECRET_KEY);
async function event(type: string, id: string) {
  const payload = JSON.stringify({
    id,
    type,
    livemode: false,
    data: {
      object: {
        id: type === "charge.refunded" ? "ch_manual_http" : "cs_manual_http",
      },
    },
  });
  const response = await fetch(f.base + "/api/webhooks/stripe", {
    method: "POST",
    body: payload,
    headers: {
      "stripe-signature": stripe.webhooks.generateTestHeaderString({
        payload,
        secret: f.env.STRIPE_WEBHOOK_SECRET,
      }),
    },
  });
  assert.equal(response.status, 200, await response.text());
}
await event("checkout.session.completed", "evt_browser_paid");
await f.db.query(
  "update px_commissions set hold_until=now()-interval '1 day',status='payable'",
);
const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const out = new URL("../test-results/manual-finance/", import.meta.url);
await mkdir(out, { recursive: true });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.status() >= 500)
    errors.push(r.status() + " " + new URL(r.url()).pathname);
});
try {
  await page.goto(f.base);
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Valid-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Six-digit authentication code").fill("123456");
  await page
    .getByRole("button", { name: "Verify session", exact: true })
    .click();
  await page.locator(".sidebar").waitFor();
  await page.goto(f.base + "/admin/finance");
  await page
    .getByRole("heading", { name: "Commission ledger", exact: true })
    .waitFor();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: new URL(`finance-${width}.png`, out).pathname,
      fullPage: true,
    });
  }
  await page
    .getByRole("checkbox", { name: /Select Jordan Launch commission/ })
    .check();
  await page.getByRole("button", { name: "Mark Paid", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Actual payment date and time")
    .fill(new Date(Date.now() - 60000).toISOString().slice(0, 16));
  await dialog
    .getByLabel("Stripe payout reference (optional)")
    .fill("op_browserfixture");
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Confirm $125.00 paid", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByText("op_browserfixture", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("op_browserfixture", { exact: true }).waitFor();
  assert.equal(
    (await f.db.query("select * from px_manual_payout_items")).rows.length,
    1,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Mark Paid", exact: true })
      .isDisabled(),
    true,
  );
  paymentFixture.refund = 78302;
  await event("charge.refunded", "evt_browser_refund");
  await page.reload();
  await page.getByText("Recovery review", { exact: true }).waitFor();
  assert.equal(
    (await f.db.query("select * from px_manual_payouts")).rows.length,
    1,
  );
  assert.equal(f.providerCalls.filter((x) => x.method === "POST").length, 0);
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("results.json", out),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "Owner MFA",
          "verified sale and fixed commission",
          "responsive finance",
          "manual payment confirmation",
          "persistence and duplicate prevention",
          "refund preserves paid history",
          "no money-moving provider calls",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Manual finance browser checks passed");
} finally {
  await browser.close();
  await f.close();
}
