import test from "node:test";
import assert from "node:assert/strict";
import { database, service, rpc } from "./helpers";
test("provider attempts survive retries beyond the idempotency retention window", async (t) => {
  const db = await database();
  try {
    const uid = crypto.randomUUID();
    await db.query("insert into auth.users values($1,$2,now())", [
      uid,
      "retry@example.test",
    ]);
    await db.query(
      "insert into public.px_reps(id,name,status) values($1,'Retry Test','active')",
      [uid],
    );
    const business = (
      await db.query<any>(
        "insert into public.px_businesses(name,phone,timezone,owner_id,expires_at) values('Retry fixture','+12125550999','UTC',$1,now()+interval '1 day') returning id",
        [uid],
      )
    ).rows[0];
    const pkg = (
      await db.query<any>(
        "select * from public.px_packages where code='launch'",
      )
    ).rows[0];
    const deal = (
      await db.query<any>(
        "insert into public.px_deals(rep_id,business_id,package_id,package_name,price_cents,commission_cents,sale_xp,customer_email) values($1,$2,$3,'Launch',79900,12500,100,'customer@example.test') returning id",
        [uid, business.id, pkg.id],
      )
    ).rows[0];
    const srv = (action: string, p: any) => rpc(db, "px_service", action, p);
    await t.test(
      "checkout retries preserve their start time and expire safely",
      async () => {
        await service(db);
        const p = { deal_id: deal.id, rep_id: uid },
          first = await srv("checkout_begin", p),
          second = await srv("checkout_begin", p);
        assert.equal(first.checkout_started_at, second.checkout_started_at);
        await db.exec("reset role");
        await db.query(
          "update public.px_deals set checkout_started_at=now()-interval '25 hours' where id=$1",
          [deal.id],
        );
        await service(db);
        await assert.rejects(srv("checkout_begin", p), /Reconcile/);
      },
    );
    await t.test(
      "reversal reservations prevent over-reversal and permit exact completed retries",
      async () => {
        await db.exec("reset role");
        const comm = (
          await db.query<any>(
            "insert into public.px_commissions(deal_id,rep_id,amount_cents,hold_until,status,transfer_id) values($1,$2,12500,now(),'transferred','tr_retry_fixture') returning id",
            [deal.id, uid],
          )
        ).rows[0];
        await service(db);
        const p = {
          commission_id: comm.id,
          request_id: crypto.randomUUID(),
          amount_cents: 10000,
          reason: "Test reversal guard",
        };
        assert.equal((await srv("reversal_begin", p)).id, p.request_id);
        assert.equal((await srv("reversal_begin", p)).id, p.request_id);
        await assert.rejects(
          srv("reversal_begin", { ...p, amount_cents: 9000 }),
          /cannot be changed/,
        );
        await assert.rejects(
          srv("reversal_begin", {
            ...p,
            request_id: crypto.randomUUID(),
            amount_cents: 3000,
          }),
          /unreserved/,
        );
        await srv("reversal", {
          transfer_id: "tr_retry_fixture",
          reversal_id: "trr_retry_fixture",
          request_id: p.request_id,
          amount_cents: 10000,
          reason: p.reason,
        });
        assert.equal((await srv("reversal_begin", p)).status, "complete");
        const pending = {
          ...p,
          request_id: crypto.randomUUID(),
          amount_cents: 2500,
        };
        await srv("reversal_begin", pending);
        await db.exec("reset role");
        await db.query(
          "update public.px_reversal_requests set created_at=now()-interval '25 hours' where id=$1",
          [pending.request_id],
        );
        await service(db);
        await assert.rejects(srv("reversal_begin", pending), /Reconcile/);
      },
    );
  } finally {
    await db.close();
  }
});
