import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName } from "pdf-lib";
import Stripe from "stripe";
import { startIntegration } from "./integration-server";
import { actor, database, rpc, service } from "./helpers";
import { validateTaxPdf, INTERACTIVE_PDF_MESSAGE } from "../src/shared/tax-pdf";
import { redactPaymentDetail } from "../src/server/diagnostics";

const auth = (f: Awaited<ReturnType<typeof startIntegration>>, id: string) => ({
  authorization:
    "Bearer " + f.session(f.users.find((u) => u.id === id)).access_token,
});
test("staging payment diagnostics remove contact information, credentials, object IDs and URLs", () => {
  const detail = redactPaymentDetail(
    "capabilities[transfers] is invalid for user@example.test, acct_fixture or sk_test_fixture at https://dashboard.stripe.com/secret?token=hidden and 00000000-0000-4000-8000-000000000001. Reference 123456789.",
  );
  assert.match(detail, /capabilities\[transfers\] is invalid/);
  for (const value of [
    "user@example.test",
    "acct_fixture",
    "sk_test_fixture",
    "https://",
    "00000000",
    "123456789",
  ])
    assert.ok(!detail.includes(value));
});
async function post(
  f: Awaited<ReturnType<typeof startIntegration>>,
  id: string,
  path: string,
  p: unknown,
) {
  return fetch(f.base + "/api" + path, {
    method: "POST",
    headers: {
      ...auth(f, id),
      origin: f.base,
      "content-type": "application/json",
    },
    body: JSON.stringify(p),
  });
}

test("tax preflight distinguishes interactive forms and allows harmless printed PDF destinations", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  page.drawText("Synthetic staging PDF. Not a signed tax declaration.");
  pdf.catalog.set(PDFName.of("OpenAction"), pdf.context.obj([page.ref, "Fit"]));
  await validateTaxPdf(await pdf.save(), "application/pdf");
  pdf.catalog.set(
    PDFName.of("AcroForm"),
    pdf.context.obj({ XFA: "interactive fixture", AA: pdf.context.obj({}) }),
  );
  await assert.rejects(validateTaxPdf(await pdf.save(), "application/pdf"), {
    message: INTERACTIVE_PDF_MESSAGE,
  });
});

test("Connect retries create fresh links, status return reuses the account, and signed updates persist", async () => {
  const f = await startIntegration();
  try {
    const first = await post(f, f.newRep, "/connect", {});
    assert.equal(first.status, 200, await first.clone().text());
    assert.equal((await post(f, f.newRep, "/connect", {})).status, 200);
    assert.equal(
      (await post(f, f.newRep, "/connect", { refresh: true })).status,
      200,
    );
    assert.equal(
      f.providerCalls.filter(
        (x) => x.path === "/v1/accounts" && x.method === "POST",
      ).length,
      1,
    );
    assert.equal(
      f.providerCalls.filter((x) => x.path === "/v1/account_links").length,
      2,
    );
    const s = new Stripe(f.env.STRIPE_SECRET_KEY),
      payload = JSON.stringify({
        id: "evt_connect_launch",
        type: "account.updated",
        livemode: false,
        account: "acct_isolated_onboarding",
        data: { object: { id: "acct_isolated_onboarding" } },
      });
    for (let n = 0; n < 2; n++) {
      const response = await fetch(f.base + "/api/webhooks/connect", {
        method: "POST",
        body: payload,
        headers: {
          "stripe-signature": s.webhooks.generateTestHeaderString({
            payload,
            secret: f.env.STRIPE_CONNECT_WEBHOOK_SECRET,
          }),
        },
      });
      assert.equal(response.status, 200, await response.text());
    }
    assert.equal(
      (await f.db.query<any>("select count(*) n from px_connect")).rows[0].n,
      1,
    );
    assert.equal(
      (await f.db.query<any>("select payouts_enabled from px_connect")).rows[0]
        .payouts_enabled,
      true,
    );
    assert.equal(
      (
        await f.db.query<any>(
          "select status from px_stripe_events where id='evt_connect_launch'",
        )
      ).rows[0].status,
      "processed",
    );
  } finally {
    await f.close();
  }
});

test("provider setup failure is safely classified and visible to authorized diagnostics", async () => {
  const f = await startIntegration({ connectError: true });
  try {
    const response = await post(f, f.newRep, "/connect", {});
    assert.equal(response.status, 502);
    const data = (await response.json()) as any;
    assert.ok(data.requestId);
    assert.match(data.error, /finish its payout provider setup/);
    assert.equal(data.category, undefined);
    assert.equal(data.diagnosticDetail, undefined);
    const diag = (
      await f.db.query<any>(
        "select category,provider_request_id,provider_detail from px_diagnostics",
      )
    ).rows;
    assert.equal(diag[0].category, "CONNECT_PLATFORM_PROFILE_REQUIRED");
    assert.equal(diag[0].provider_request_id, "req_fixtureProfile");
    assert.match(
      diag[0].provider_detail,
      /connect_account: Please review the responsibilities/,
    );
    const denied = await fetch(f.base + "/api/table?name=diagnostics", {
      headers: auth(f, f.newRep),
    });
    assert.equal(((await denied.json()) as any).rows.length, 0);
  } finally {
    await f.close();
  }
});

test("authorized sandbox recovery reconciles an expired attempt and prepares one reusable account", async () => {
  const f = await startIntegration();
  try {
    await f.db.query(
      "insert into px_connect_requests(rep_id,started_at) values($1,now()-interval '2 days')",
      [f.newRep],
    );
    assert.equal((await post(f, f.newRep, "/connect", {})).status, 409);
    const denied = await post(f, f.newRep, "/connect/recover", {
      id: f.newRep,
      reason: "Unauthorized recovery",
    });
    assert.equal(denied.status, 403);
    const recovered = await post(f, f.owner, "/connect/recover", {
      id: f.newRep,
      reason: "Reconcile an expired sandbox setup attempt",
    });
    assert.equal(recovered.status, 200, await recovered.clone().text());
    assert.equal(
      f.providerCalls.filter((x) => x.path === "/v1/account_links").length,
      0,
    );
    assert.equal((await post(f, f.newRep, "/connect", {})).status, 200);
    assert.equal(
      f.providerCalls.filter(
        (x) => x.path === "/v1/accounts" && x.method === "POST",
      ).length,
      1,
    );
    assert.equal(
      f.providerCalls.filter((x) => x.path === "/v1/account_links").length,
      1,
    );
    assert.equal(
      (
        await f.db.query<any>(
          "select generation is not null rotated from px_connect_requests where rep_id=$1",
          [f.newRep],
        )
      ).rows[0].rotated,
      true,
    );
  } finally {
    await f.close();
  }
});

test("Owner delete removes Auth and disposable dependencies; normal admin is denied", async () => {
  const f = await startIntegration();
  try {
    const code = (
      await f.db.query<any>("select code from px_reps where id=$1", [f.newRep])
    ).rows[0].code;
    await f.db.query("insert into px_roles values($1,'sales_admin')", [f.rep]);
    const p = {
      id: f.newRep,
      confirmation: "DELETE " + code,
      reason: "Disposable staging acceptance account",
    };
    // The rep has no elevated MFA; both MFA and ownership must hold.
    assert.equal((await post(f, f.rep, "/account/delete", p)).status, 403);
    await actor(f.db, f.rep, "aal2");
    await assert.rejects(
      rpc(f.db, "px_action", "account_delete_begin", p),
      /authorized|MFA/,
    );
    await f.db.exec("reset role");
    const beforeToken = auth(f, f.newRep);
    const removed = await post(f, f.owner, "/account/delete", p);
    assert.equal(removed.status, 200, await removed.clone().text());
    assert.equal(((await removed.json()) as any).mode, "purge");
    assert.equal((await post(f, f.owner, "/account/delete", p)).status, 200);
    for (const table of [
      "auth.users",
      "public.px_reps",
      "public.px_rep_private",
    ]) {
      const column = table.endsWith("px_rep_private") ? "rep_id" : "id";
      assert.equal(
        (
          await f.db.query<any>(
            `select count(*) n from ${table} where ${column}=$1`,
            [f.newRep],
          )
        ).rows[0].n,
        0,
      );
    }
    assert.equal(
      (await fetch(f.base + "/api/me", { headers: beforeToken })).status,
      401,
    );
    assert.ok(
      f.authCalls.some((x) => x.type === "delete" && x.id === f.newRep),
    );
    assert.equal(
      (
        await f.db.query<any>(
          "select count(*) n from px_audit where action='account_deleted'",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await f.close();
  }
});

test("login-only accounts can be removed while final Owner and audit identity are protected", async () => {
  const f = await startIntegration();
  try {
    const account = crypto.randomUUID();
    await f.db.query(
      "insert into auth.users values($1,'disposable-admin@example.test',now())",
      [account],
    );
    await f.db.query("insert into px_roles values($1,'support')", [account]);
    await f.db.query(
      "insert into px_audit(actor_id,action,reason) values($1,'support_review','Synthetic review')",
      [account],
    );
    const p = {
      id: account,
      confirmation: "DELETE ACCOUNT " + account,
      reason: "Disposable non-rep account acceptance",
    };
    const response = await post(f, f.owner, "/account/delete", p);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(
      (await f.db.query("select id from auth.users where id=$1", [account]))
        .rows.length,
      0,
    );
    assert.equal(
      (await f.db.query("select id from px_audit where actor_id=$1", [account]))
        .rows.length,
      1,
    );
    const finalOwner = await post(f, f.owner, "/account/delete", {
      ...p,
      id: f.owner,
      confirmation: "DELETE ACCOUNT " + f.owner,
    });
    assert.equal(finalOwner.status, 403);
    assert.match(await finalOwner.text(), /Assign another Owner/);
  } finally {
    await f.close();
  }
});

test("safe test purge removes an unsubmitted private object through Storage before deleting dependencies", async () => {
  const f = await startIntegration();
  try {
    const code = (
      await f.db.query<any>("select code from px_reps where id=$1", [f.newRep])
    ).rows[0].code;
    await actor(f.db, f.newRep);
    const doc = await rpc(f.db, "px_tax", "upload_begin", {
      request_id: crypto.randomUUID(),
      bytes: 200,
      sha256: "a".repeat(64),
    });
    await f.db.exec("reset role");
    const object = await fetch(
      f.base + "/storage/v1/object/pixelalty-tax-documents/" + doc.object_key,
      {
        method: "POST",
        headers: {
          authorization: "Bearer service_fixture",
          "content-type": "application/pdf",
        },
        body: "Synthetic incomplete private upload",
      },
    );
    assert.equal(object.status, 200);
    const response = await post(f, f.owner, "/account/delete", {
      id: f.newRep,
      confirmation: "PURGE TEST DATA " + code,
      purge: true,
      reason: "Clear an incomplete disposable test upload",
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(
      (await f.db.query("select id from storage.objects")).rows.length,
      0,
    );
    assert.equal(
      (await f.db.query("select id from px_private.tax_documents")).rows.length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("paid account deletion retains exact payment, commission, XP and fulfillment records", async () => {
  const f = await startIntegration();
  try {
    const business = (
      await f.db.query<any>(
        "select id from px_businesses where owner_id=$1 limit 1",
        [f.rep],
      )
    ).rows[0].id;
    const pkg = (
      await f.db.query<any>(
        "select * from px_packages where code='growth' and active",
      )
    ).rows[0];
    await actor(f.db, f.rep);
    const deal = await rpc(f.db, "px_action", "deal", {
      business_id: business,
      package_id: pkg.id,
      customer_email: "buyer@example.test",
      request_id: crypto.randomUUID(),
    });
    await service(f.db);
    await rpc(f.db, "px_service", "checkout_attach", {
      deal_id: deal.id,
      checkout_id: "cs_test_retained",
      url: "https://checkout.stripe.com/test",
    });
    const payment = {
      event_id: "evt_retained",
      event_type: "checkout.session.completed",
      deal_id: deal.id,
      rep_id: f.rep,
      package_id: pkg.id,
      checkout_id: "cs_test_retained",
      payment_intent: "pi_retained",
      charge_id: "ch_retained",
      amount_cents: 129900,
      currency: "usd",
      refunded_cents: 0,
      disputed: false,
      settled: true,
      available_at: new Date().toISOString(),
    };
    await rpc(f.db, "px_service", "payment", payment);
    await rpc(f.db, "px_service", "payment", payment);
    await f.db.exec("reset role");
    const snapshot = async () => {
      const rows = [];
      for (const table of [
        "px_payments",
        "px_commissions",
        "px_xp",
        "px_fulfillment",
        "px_commission_events",
      ])
        rows.push(
          (await f.db.query(`select * from ${table} order by id`)).rows,
        );
      return rows;
    };
    const before = await snapshot();
    assert.equal((before[1][0] as any).amount_cents, 25000);
    assert.equal((before[2][0] as any).amount, 150);
    const code = (
      await f.db.query<any>("select code from px_reps where id=$1", [f.rep])
    ).rows[0].code;
    const p = {
      id: f.rep,
      confirmation: "DELETE " + code,
      reason: "Retention acceptance after verified payment",
    };
    const denied = await post(f, f.owner, "/account/delete", {
      ...p,
      purge: true,
      confirmation: "PURGE TEST DATA " + code,
    });
    assert.equal(denied.status, 403);
    const response = await post(f, f.owner, "/account/delete", p);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(((await response.json()) as any).mode, "retain");
    assert.deepEqual(await snapshot(), before);
    assert.equal(
      (await f.db.query("select id from auth.users where id=$1", [f.rep])).rows
        .length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("deletion with a protected agreement removes login and minimizes PII while retaining immutable evidence", async () => {
  const f = await startIntegration();
  try {
    const content = (
      await f.db.query<any>(
        "insert into px_content(kind,slug,title,body,required) values('agreement','test-retention','Test agreement','Synthetic acceptance evidence',true) returning id",
      )
    ).rows[0].id;
    await f.db.query(
      "insert into px_agreements(rep_id,content_id,signature) values($1,$2,'Synthetic test identity')",
      [f.newRep, content],
    );
    const code = (
      await f.db.query<any>("select code from px_reps where id=$1", [f.newRep])
    ).rows[0].code;
    const token = auth(f, f.newRep);
    const result = await post(f, f.owner, "/account/delete", {
      id: f.newRep,
      confirmation: "DELETE " + code,
      reason: "Protected staging account deletion acceptance",
    });
    assert.equal(result.status, 200, await result.clone().text());
    assert.equal(((await result.json()) as any).mode, "retain");
    assert.equal(
      (
        await f.db.query<any>("select count(*) n from auth.users where id=$1", [
          f.newRep,
        ])
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await f.db.query<any>("select name from px_reps where id=$1", [
          f.newRep,
        ])
      ).rows[0].name,
      "Deleted account",
    );
    assert.equal(
      (
        await f.db.query<any>(
          "select email from px_rep_private where rep_id=$1",
          [f.newRep],
        )
      ).rows[0].email,
      "",
    );
    assert.equal(
      (
        await f.db.query<any>(
          "select count(*) n from px_agreements where rep_id=$1",
          [f.newRep],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (await fetch(f.base + "/api/me", { headers: token })).status,
      401,
    );
  } finally {
    await f.close();
  }
});

test("XP corrections are integer, reasoned, idempotent, isolated and persist in every ledger view", async () => {
  const db = await database(),
    owner = crypto.randomUUID(),
    rep = crypto.randomUUID(),
    other = crypto.randomUUID();
  try {
    for (const id of [owner, rep, other]) {
      await db.query("insert into auth.users values($1,$2,now())", [
        id,
        id + "@example.test",
      ]);
      await db.query(
        "insert into px_reps(id,name,status) values($1,'Test','active')",
        [id],
      );
      await db.query("insert into px_rep_private(rep_id,email) values($1,$2)", [
        id,
        id + "@example.test",
      ]);
    }
    await db.query("insert into px_roles values($1,'owner')", [owner]);
    const p = {
      id: rep,
      amount: 125,
      request_id: crypto.randomUUID(),
      reason: "Verified missing career credit",
    };
    await actor(db, rep);
    await assert.rejects(
      rpc(db, "px_action", "xp_adjust", p),
      /MFA|authorized/,
    );
    await actor(db, owner, "aal2");
    await rpc(db, "px_action", "xp_adjust", p);
    await rpc(db, "px_action", "xp_adjust", p);
    await assert.rejects(
      rpc(db, "px_action", "xp_adjust", { ...p, amount: 126 }),
      /different/,
    );
    await rpc(db, "px_action", "xp_adjust", {
      ...p,
      amount: -25,
      request_id: crypto.randomUUID(),
      reason: "Correct over-awarded credit",
    });
    await actor(db, rep);
    const history = await rpc(db, "px_report", "xp_history");
    assert.equal(history.total, 100);
    assert.equal(history.rows.length, 2);
    assert.equal(history.rows[0].running_total, 100);
    const dashboard = await rpc(db, "px_report", "dashboard");
    assert.equal(dashboard.xp, 100);
    await actor(db, other);
    assert.equal((await rpc(db, "px_report", "xp_history")).total, 0);
    await assert.rejects(
      rpc(db, "px_report", "xp_history", { id: rep }),
      /authorized|MFA/,
    );
    await actor(db, rep);
    assert.equal((await rpc(db, "px_report", "xp_history")).total, 100);
    await actor(db, owner, "aal2");
    await rpc(db, "px_action", "account_revoke", {
      id: rep,
      reason: "Test immediate session revocation",
    });
    await actor(db, rep);
    await assert.rejects(
      rpc(db, "px_report", "xp_history"),
      /session has ended/,
    );
    assert.equal((await db.query("select * from px_xp")).rows.length, 0);
    await service(db);
  } finally {
    await db.close();
  }
});
