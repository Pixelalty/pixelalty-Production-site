import test from "node:test";
import assert from "node:assert/strict";
import { database, actor, service, rpc, submitTaxFixture } from "./helpers";
import { payoutInput } from "../src/shared/payouts";
import { verifiedCheckout } from "../src/server/payments";
import Stripe from "stripe";
import { startIntegration } from "./integration-server";

test("payout intake accepts only four safe fields and an acknowledgment", () => {
  const p = {
    email: "rep@example.test",
    phone: "(212) 555-0198",
    legal_first_name: " Alex ",
    legal_last_name: "Jones",
    acknowledged: true,
  };
  assert.equal(payoutInput.parse(p).phone, "+12125550198");
  assert.equal(payoutInput.parse(p).legal_first_name, "Alex");
  for (const field of ["email", "phone", "legal_first_name", "legal_last_name"])
    assert.equal(payoutInput.safeParse({ ...p, [field]: "" }).success, false);
  assert.equal(
    payoutInput.safeParse({ ...p, email: "invalid" }).success,
    false,
  );
  assert.equal(
    payoutInput.safeParse({ ...p, legal_first_name: "Alex\u0001" }).success,
    false,
  );
  assert.equal(
    payoutInput.safeParse({ ...p, acknowledged: false }).success,
    false,
  );
  for (const field of [
    "account_number",
    "routing_number",
    "ssn",
    "bank_password",
    "stripe_code",
    "status",
  ])
    assert.equal(
      payoutInput.safeParse({ ...p, [field]: "forbidden" }).success,
      false,
    );
});

test("verified Checkout resolves Stripe's actual customer-facing code and rejects wrong discounts", async () => {
  const session: any = {
    id: "cs_test",
    livemode: false,
    amount_subtotal: 79900,
    discounts: [{ promotion_code: "promo_123" }],
    total_details: { amount_discount: 1598 },
  };
  let discount = 2;
  const stripe: any = {
    checkout: {
      sessions: {
        listLineItems: async () => ({
          data: [{ quantity: 1, description: "Launch Website" }],
          has_more: false,
        }),
      },
    },
    promotionCodes: {
      retrieve: async () => ({
        id: "promo_123",
        code: "fsc2",
        livemode: false,
        promotion: { coupon: { percent_off: discount, amount_off: null } },
      }),
    },
  };
  assert.deepEqual(await verifiedCheckout(stripe, session), {
    package_code: "launch",
    promotion_code: "FSC2",
    promotion_code_id: "promo_123",
    discount_valid: true,
  });
  discount = 20;
  assert.equal((await verifiedCheckout(stripe, session)).discount_valid, false);
  assert.equal(
    (await verifiedCheckout(stripe, { ...session, discounts: [] }))
      .promotion_code,
    null,
  );
});

test("manual payout, code attribution, ledger, security and archive workflows use real SQL", async (t) => {
  const db = await database(),
    owner = crypto.randomUUID(),
    rep = crypto.randomUUID(),
    other = crypto.randomUUID();
  const act = (a: string, p: any = {}) => rpc(db, "px_action", a, p);
  const report = (k: string, p: any = {}) => rpc(db, "px_report", k, p);
  const srv = (a: string, p: any = {}) => rpc(db, "px_service", a, p);
  const contact = {
    email: "rep@example.test",
    phone: "+12125550198",
    legal_first_name: "Alex",
    legal_last_name: "Jones",
    acknowledged: true,
  };
  let sale: any, commission: string;
  try {
    for (const id of [owner, rep, other]) {
      await db.query("insert into auth.users values($1,$2,now())", [
        id,
        id + "@example.test",
      ]);
      await db.query(
        "insert into public.px_reps(id,name,status,timezone) values($1,'Test','onboarding','UTC')",
        [id],
      );
      await db.query(
        "insert into public.px_rep_private(rep_id,email,classification,tax_status) values($1,$2,'contractor','verified')",
        [id, id + "@example.test"],
      );
    }
    await db.query("insert into public.px_roles values($1,'owner')", [owner]);
    await db.query(
      "insert into public.px_training(rep_id,content_id,passed,score) select $1,id,true,100 from public.px_content where kind in ('lesson','quiz') and active and required",
      [rep],
    );
    await db.query(
      "insert into public.px_connect(rep_id,account_id,transfers_enabled,payouts_enabled) values($1,'acct_legacy',true,true)",
      [rep],
    );
    await db.exec(
      'update public.px_settings set value=value||\'{"require_profile":false,"require_agreement":false,"require_tax":false,"require_payout":true}\'',
    );
    await t.test(
      "intake validates server-side and is idempotent, RLS keeps others private",
      async () => {
        await actor(db, rep);
        assert.equal((await report("payout_setup")).setup, null);
        for (const k of [
          "email",
          "phone",
          "legal_first_name",
          "legal_last_name",
        ])
          await assert.rejects(act("payout_submit", { ...contact, [k]: "" }));
        await assert.rejects(
          act("payout_submit", { ...contact, routing_number: "invalid" }),
          /Only contact/,
        );
        const first = await act("payout_submit", contact);
        assert.equal(first.status, "submitted");
        assert.equal(
          (await act("payout_submit", contact)).submitted_at,
          first.submitted_at,
        );
        await assert.rejects(
          act("payout_ready", { id: rep, confirmed: true }),
          /administrator/,
        );
        await actor(db, other);
        assert.equal(
          (await db.query("select * from public.px_payout_setup")).rows.length,
          0,
        );
        await assert.rejects(
          report("payout_setup", { id: rep }),
          /administrator/,
        );
        await assert.rejects(
          act("sales_code_save", { id: other, code: "FSC2" }),
          /administrator/,
        );
        await actor(db, owner, "aal1");
        await assert.rejects(report("payout_setup_queue"), /administrator/);
      },
    );
    await t.test(
      "Finance correction, resubmission, sent, and approval persist and audit",
      async () => {
        await actor(db, owner, "aal2");
        assert.equal((await report("payout_setup_queue")).total, 1);
        await act("payout_correction", {
          id: rep,
          expected_status: "submitted",
          confirmed: true,
          reason: "Use your full legal last name.",
        });
        await actor(db, rep);
        assert.equal(
          (await report("payout_setup")).setup.status,
          "needs_correction",
        );
        await act("payout_submit", {
          ...contact,
          legal_last_name: "Jones Smith",
        });
        await actor(db, owner, "aal2");
        await assert.rejects(
          act("payout_ready", {
            id: rep,
            expected_status: "submitted",
            confirmed: true,
          }),
          /transition/,
        );
        await act("payout_sent", {
          id: rep,
          expected_status: "submitted",
          confirmed: true,
        });
        await actor(db, rep);
        assert.equal(
          (await report("payout_setup")).setup.status,
          "stripe_setup_pending",
        );
        await actor(db, owner, "aal2");
        await act("payout_ready", {
          id: rep,
          expected_status: "stripe_setup_pending",
          confirmed: true,
        });
        await actor(db, rep);
        assert.equal((await report("payout_setup")).setup.status, "ready");
        assert.equal((await report("onboarding")).payout.ready, true);
        await actor(db, owner, "aal2");
        assert.equal(
          (
            await db.query(
              "select * from public.px_audit where action='payout_ready'",
            )
          ).rows.length,
          1,
        );
        const cols = (
          await db.query<{ column_name: string }>(
            "select column_name from information_schema.columns where table_name='px_payout_setup'",
          )
        ).rows.map((x) => x.column_name);
        assert.equal(
          cols.some((c) => /routing|bank|ssn|tin|password|token/.test(c)),
          false,
        );
      },
    );
    await t.test(
      "manual unique codes gate new activation; legacy Connect does not",
      async () => {
        await actor(db, owner, "aal2");
        await assert.rejects(
          act("rep_activate", { id: rep, reason: "Ready for test" }),
          /sales-code/,
        );
        await act("sales_code_save", { id: rep, code: " fsc2 " });
        await assert.rejects(
          act("sales_code_save", { id: other, code: "FSC2" }),
          /already assigned/,
        );
        await act("rep_activate", { id: rep, reason: "Manual setup complete" });
        await actor(db, rep);
        assert.equal((await report("sales_code")).code.code, "FSC2");
        assert.equal((await report("onboarding")).ready, true);
      },
    );
    await t.test(
      "one verified discounted payment makes one sale, fixed commission, and XP",
      async () => {
        await service(db);
        sale = {
          payment_intent: "pi_manualtest",
          charge_id: "ch_manualtest",
          checkout_id: "cs_manualtest",
          package_code: "launch",
          promotion_code: "FSC2",
          promotion_code_id: "promo_test",
          discount_valid: true,
          currency: "usd",
          subtotal_cents: 79900,
          discount_cents: 1598,
          amount_cents: 78302,
          paid_at: new Date().toISOString(),
          settled: true,
          available_at: new Date().toISOString(),
          refunded_cents: 0,
          disputed: false,
          event_id: "evt_manual1",
          event_type: "checkout.session.completed",
        };
        const first = await srv("verified_sale", sale);
        assert.equal(first.attribution, "attributed");
        for (let n = 0; n < 3; n++)
          assert.equal(
            (
              await srv("verified_sale", {
                ...sale,
                event_id: "evt_replay" + n,
              })
            ).sale_id,
            first.sale_id,
          );
        const rows = (
          await db.query<any>("select * from public.px_commissions")
        ).rows;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].amount_cents, 12500);
        commission = rows[0].id;
        assert.equal(
          (await db.query("select * from public.px_xp where source='sale'"))
            .rows.length,
          1,
        );
        await actor(db, rep);
        assert.equal((await report("dashboard")).sales, 1);
        assert.equal(
          (await report("leaderboard", { period: "all" }))[0].sales,
          1,
        );
      },
    );
    await t.test(
      "direct, unmatched, deactivated and invalid-discount purchases never guess a rep",
      async () => {
        await actor(db, owner, "aal2");
        await act("sales_code_remove", { id: rep });
        await actor(db, rep);
        assert.equal((await report("sales_code")).code, null);
        assert.equal(
          (await report("onboarding")).steps.find(
            (s: any) => s.key === "sales_code",
          ).complete,
          false,
        );
        await service(db);
        for (const [suffix, extra, attribution] of [
          ["direct", { promotion_code: null }, "direct"],
          ["inactive", {}, "code_unmapped"],
          ["wrong", { discount_valid: false }, "discount_mismatch"],
          ["unknown", { package_code: "unknown" }, "package_unmapped"],
        ] as const) {
          const result = await srv("verified_sale", {
            ...sale,
            ...extra,
            payment_intent: "pi_" + suffix,
            charge_id: "ch_" + suffix,
            checkout_id: "cs_" + suffix,
            event_id: "evt_" + suffix,
          });
          assert.equal(result.attribution, attribution);
        }
        assert.equal(
          (await db.query("select * from public.px_commissions")).rows.length,
          1,
        );
      },
    );
    await t.test(
      "Mark Paid checks authorization, eligibility, exact amount and repeated requests",
      async () => {
        await service(db);
        await db.query(
          "update public.px_commissions set hold_until=now()-interval '1 day' where id=$1",
          [commission],
        );
        await srv("tick");
        const p = {
          commission_ids: [commission],
          amount_cents: 12500,
          request_id: crypto.randomUUID(),
          paid_at: new Date().toISOString(),
          confirmed: true,
        };
        await actor(db, rep);
        await assert.rejects(act("manual_mark_paid", p), /administrator/);
        await actor(db, owner, "aal2");
        await assert.rejects(
          act("manual_mark_paid", { ...p, confirmed: false }),
          /Confirm/,
        );
        await assert.rejects(
          act("manual_mark_paid", { ...p, amount_cents: 123 }),
          /amount changed/,
        );
        const result = await act("manual_mark_paid", p);
        assert.equal(result.amount_cents, 12500);
        assert.equal((await act("manual_mark_paid", p)).id, result.id);
        await assert.rejects(
          act("manual_mark_paid", { ...p, request_id: crypto.randomUUID() }),
          /no longer payable/,
        );
        assert.equal(
          (await db.query("select * from public.px_manual_payout_items")).rows
            .length,
          1,
        );
        await service(db);
        await srv("verified_sale", {
          ...sale,
          event_id: "evt_refund",
          refunded_cents: 78302,
        });
        assert.equal(
          (await db.query<any>("select status from public.px_commissions"))
            .rows[0].status,
          "recovery_review",
        );
        assert.equal(
          (await db.query("select * from public.px_manual_payouts")).rows
            .length,
          1,
        );
        assert.equal(
          (await db.query("select * from public.px_connect")).rows.length,
          1,
        );
      },
    );
    await t.test(
      "W-9 download is not archive; explicit encrypted-storage acknowledgment disables future download",
      async () => {
        const doc = await submitTaxFixture(db, rep);
        await actor(db, owner, "aal2");
        await rpc(db, "px_tax", "download", { id: doc.id });
        await rpc(db, "px_tax", "verify", { id: doc.id });
        assert.equal(
          (await rpc(db, "px_tax", "summary", { rep_id: rep })).document
            .securely_archived,
          false,
        );
        await assert.rejects(
          rpc(db, "px_tax", "confirm_secure_archive", { id: doc.id }),
          /confirm/,
        );
        await rpc(db, "px_tax", "confirm_secure_archive", {
          id: doc.id,
          confirmed: true,
        });
        assert.equal(
          (await rpc(db, "px_tax", "summary", { rep_id: rep })).document
            .securely_archived,
          true,
        );
        await assert.rejects(
          rpc(db, "px_tax", "download_authorize", { id: doc.id }),
          /downloads are disabled/,
        );
      },
    );
    await t.test(
      "every package including custom Advanced earns its fixed commission after 2% off",
      async () => {
        await actor(db, owner, "aal2");
        await act("sales_code_save", { id: rep, code: "FIXED2" });
        await act("rep_activate", {
          id: rep,
          reason: "Verify full package coverage",
        });
        await service(db);
        for (const [pkg, price, expected] of [
          ["launch", 79900, 12500],
          ["growth", 129900, 25000],
          ["premium", 199900, 40000],
          ["advanced", 299900, 60000],
          ["advanced", 459900, 60000],
        ] as const) {
          const key = pkg + price,
            discount = Math.round(price * 0.02);
          const result = await srv("verified_sale", {
            ...sale,
            package_code: pkg,
            promotion_code: "FIXED2",
            payment_intent: "pi_" + key,
            charge_id: "ch_" + key,
            checkout_id: "cs_" + key,
            event_id: "evt_" + key,
            subtotal_cents: price,
            discount_cents: discount,
            amount_cents: price - discount,
          });
          assert.equal(
            (
              await db.query<any>(
                "select amount_cents from px_commissions where sale_id=$1",
                [result.sale_id],
              )
            ).rows[0].amount_cents,
            expected,
          );
        }
      },
    );
    await t.test(
      "refund before payout holds the commission and cannot be released or marked paid",
      async () => {
        const refund = {
          ...sale,
          payment_intent: "pi_launch79900",
          charge_id: "ch_launch79900",
          checkout_id: "cs_launch79900",
          event_id: "evt_earlyrefund",
          refunded_cents: 78302,
        };
        await srv("verified_sale", refund);
        const row = (
          await db.query<any>(
            "select c.* from px_commissions c join px_verified_sales s on s.id=c.sale_id where s.payment_intent='pi_launch79900'",
          )
        ).rows[0];
        assert.equal(row.status, "hold");
        assert.equal(row.manual_hold, true);
        await actor(db, owner, "aal2");
        await assert.rejects(
          act("commission_release", {
            id: row.id,
            reason: "May not release refunded payment",
          }),
          /refund or dispute/,
        );
        await assert.rejects(
          act("manual_mark_paid", {
            commission_ids: [row.id],
            amount_cents: row.amount_cents,
            confirmed: true,
            paid_at: new Date().toISOString(),
            request_id: crypto.randomUUID(),
          }),
          /no longer payable/,
        );
      },
    );
  } finally {
    await db.close();
  }
});

test("signed Checkout and refund webhooks exercise actual Worker retrieval, SQL attribution and retries", async () => {
  const paymentFixture = { code: "HTTP2", refund: 0 },
    f = await startIntegration({ paymentFixture });
  try {
    await actor(f.db, f.owner, "aal2");
    await rpc(f.db, "px_action", "sales_code_save", {
      id: f.rep,
      code: "HTTP2",
    });
    await f.db.exec("reset role");
    const stripe = new Stripe(f.env.STRIPE_SECRET_KEY);
    const send = async (type: string, id: string) => {
      const payload = JSON.stringify({
        id,
        type,
        livemode: false,
        data: {
          object: {
            id:
              type === "charge.refunded" ? "ch_manual_http" : "cs_manual_http",
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
    };
    await send("checkout.session.completed", "evt_http_paid");
    await send("checkout.session.completed", "evt_http_paid");
    const rows = (await f.db.query<any>("select * from px_commissions")).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rep_id, f.rep);
    assert.equal(rows[0].amount_cents, 12500);
    const ledger = await fetch(
      f.base + "/api/table?name=commissions&own=true",
      {
        headers: {
          authorization:
            "Bearer " +
            f.session(f.users.find((u) => u.id === f.rep)).access_token,
        },
      },
    );
    assert.equal(ledger.status, 200);
    const ledgerBody = (await ledger.json()) as any;
    assert.equal(ledgerBody.rows.length, 1);
    assert.equal(ledgerBody.rows[0].package_name, "Launch");
    assert.equal(ledgerBody.rows[0].sale_cents, 78302);
    assert.equal(
      (await f.db.query("select * from px_xp where source='sale'")).rows.length,
      1,
    );
    paymentFixture.refund = 78302;
    await send("charge.refunded", "evt_http_refund");
    assert.equal(
      (await f.db.query<any>("select manual_hold from px_commissions")).rows[0]
        .manual_hold,
      true,
    );
    assert.equal(
      f.providerCalls.filter((x) => x.method === "POST").length,
      0,
      "Reconciliation does not create codes or send money",
    );
  } finally {
    await f.close();
  }
});
