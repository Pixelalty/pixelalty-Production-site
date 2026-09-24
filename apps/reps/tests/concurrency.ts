// Full PostgreSQL, separate connections and real row-lock contention.
// This is deliberately restricted to a fresh, disposable local test database.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { Client } from "pg";
import { storageSchema } from "./helpers";

const connectionString = process.env.PIXELALTY_TEST_DATABASE_URL;
assert.ok(
  connectionString,
  "Set PIXELALTY_TEST_DATABASE_URL to a fresh local test database",
);
const target = new URL(connectionString);
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname),
  "Concurrency tests require a local database",
);
assert.match(
  target.pathname,
  /^\/pixelalty_test(?:_[a-z0-9]+)?$/,
  "Concurrency tests require a pixelalty_test database",
);
const connect = async (application_name: string) => {
  const client = new Client({
    connectionString,
    application_name,
    statement_timeout: 15000,
  });
  await client.connect();
  return client;
};
const identity = async (client: Client, id: string | null) => {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify(
      id
        ? { sub: id, role: "authenticated", aal: "aal2" }
        : { role: "service_role" },
    ),
  ]);
  await client.query(id ? "set role authenticated" : "set role service_role");
};
const rpc = async (
  client: Client,
  fn: "px_action" | "px_service" | "px_mail" | "px_tax",
  action: string,
  p: unknown = {},
) =>
  (
    await client.query(`select public.${fn}($1,$2::jsonb) result`, [
      action,
      JSON.stringify(p),
    ])
  ).rows[0].result;

test("PostgreSQL contention preserves assignment and financial invariants", async (t) => {
  const control = await connect("pixelalty-test-control"),
    clients: Client[] = [];
  const [owner, rep, second, third] = Array.from({ length: 4 }, () =>
    crypto.randomUUID(),
  );
  // Wait until every request is blocked on the intentional row lock, then
  // release them together. A sequential run cannot satisfy this barrier.
  const contend = async (
    lock: string,
    args: unknown[],
    work: (client: Client, i: number) => Promise<any>,
  ) => {
    await control.query("begin");
    try {
      await control.query(lock, args);
      const pending = Promise.allSettled(clients.map(work));
      const deadline = Date.now() + 5000;
      let blocked = 0;
      while (Date.now() < deadline) {
        blocked = Number(
          (
            await control.query(
              "select count(*) n from pg_stat_activity where application_name='pixelalty-concurrency' and wait_event_type='Lock'",
            )
          ).rows[0].n,
        );
        if (blocked === clients.length) break;
        await delay(20);
      }
      await control.query("commit");
      const results = await pending;
      assert.equal(
        blocked,
        clients.length,
        "All requests must have overlapped under a real PostgreSQL row lock",
      );
      return results;
    } catch (error) {
      await control.query("rollback");
      throw error;
    }
  };
  const successful = (results: PromiseSettledResult<any>[]) =>
    results.map((r) => {
      if (r.status === "rejected") throw r.reason;
      return r.value;
    });
  try {
    assert.equal(
      (
        await control.query(
          "select count(*)::int n from information_schema.tables where table_schema in ('public','auth','px_private')",
        )
      ).rows[0].n,
      0,
      "Refusing to modify a nonempty database",
    );
    await control.query(
      "create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$; create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$; grant usage on schema auth to anon,authenticated,service_role; grant execute on all functions in schema auth to anon,authenticated,service_role;",
    );
    await control.query(storageSchema);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(dir))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await control.query(await readFile(new URL(name, dir), "utf8"));
    console.log(
      "PostgreSQL",
      (await control.query("show server_version")).rows[0].server_version,
    );
    for (const [i, id] of [owner, rep, second, third].entries()) {
      await control.query("insert into auth.users values($1,$2,now())", [
        id,
        `concurrent${i}@example.test`,
      ]);
      if (id === owner)
        await control.query("insert into public.px_roles values($1,'owner')", [
          id,
        ]);
      else {
        await control.query(
          "insert into public.px_reps(id,name,status,timezone,capacity) values($1,'Concurrent rep','active','UTC',$2)",
          [id, id === rep ? 7 : 20],
        );
        await control.query(
          "insert into public.px_rep_private(rep_id,email,classification,tax_status) values($1,$2,'contractor','verified')",
          [id, `concurrent${i}@example.test`],
        );
      }
    }
    await control.query(
      "insert into public.px_businesses(name,phone,timezone) select 'Concurrent business '||n,'+1212555'||lpad(n::text,4,'0'),'UTC' from generate_series(1,60) n",
    );
    for (let i = 0; i < 12; i++)
      clients.push(await connect("pixelalty-concurrency"));
    await t.test(
      "twelve simultaneous claims cannot exceed one rep's capacity",
      async () => {
        await Promise.all(clients.map((c) => identity(c, rep)));
        const results = successful(
          await contend(
            "select id from public.px_reps where id=$1 for update",
            [rep],
            (c) => rpc(c, "px_action", "claim", { count: 5 }),
          ),
        );
        assert.equal(
          results.reduce((n, r) => n + r.claimed, 0),
          7,
        );
        assert.equal(
          (
            await control.query(
              "select count(*)::int n from public.px_businesses where owner_id=$1",
              [rep],
            )
          ).rows[0].n,
          7,
        );
      },
    );
    await t.test("competing reps never receive the same business", async () => {
      await Promise.all(
        clients.map((c, i) => identity(c, i % 2 ? second : third)),
      );
      const results = successful(
        await contend(
          "select id from public.px_reps where id=any($1::uuid[]) for update",
          [[second, third]],
          (c) => rpc(c, "px_action", "claim", { count: 20 }),
        ),
      );
      assert.equal(
        results.reduce((n, r) => n + r.claimed, 0),
        40,
      );
      const counts = (
        await control.query(
          "select owner_id,count(*)::int n from public.px_businesses where owner_id=any($1::uuid[]) group by owner_id",
          [[second, third]],
        )
      ).rows;
      assert.deepEqual(
        counts.map((r) => r.n),
        [20, 20],
      );
      assert.equal(
        (
          await control.query(
            "select count(*)::int n from (select business_id from public.px_assignments where action='claim' group by business_id having count(*)>1) duplicate",
          )
        ).rows[0].n,
        0,
      );
    });
    const lead = (
      await control.query(
        "select id from public.px_businesses where owner_id=$1 limit 1",
        [rep],
      )
    ).rows[0].id;
    await t.test(
      "concurrent retries persist one call and one qualifying award",
      async () => {
        await Promise.all(clients.map((c) => identity(c, rep)));
        const p = {
          business_id: lead,
          request_id: crypto.randomUUID(),
          outcome: "conversation",
          notes: "Concurrent accepted retry",
        };
        const results = successful(
          await contend(
            "select id from public.px_reps where id=$1 for update",
            [rep],
            (c) => rpc(c, "px_action", "call", p),
          ),
        );
        assert.equal(new Set(results.map((r) => r.id)).size, 1);
        assert.equal(
          (
            await control.query(
              "select count(*)::int n from public.px_calls where request_id=$1",
              [p.request_id],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await control.query(
              "select count(*)::int n from public.px_xp where source='call' and source_id=$1",
              [results[0].id],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    const pkg = (
      await control.query(
        "select * from public.px_packages where code='launch' and active",
      )
    ).rows[0];
    const deal = await rpc(clients[0], "px_action", "deal", {
      business_id: lead,
      package_id: pkg.id,
      customer_email: "customer@example.test",
    });
    await Promise.all(clients.map((c) => identity(c, null)));
    await rpc(clients[0], "px_service", "checkout_attach", {
      deal_id: deal.id,
      checkout_id: "cs_test_concurrent",
      url: "https://checkout.stripe.com/test",
    });
    await t.test(
      "duplicate payment events create one commission, award and fulfillment handoff",
      async () => {
        const p = {
          event_id: "evt_concurrent",
          event_type: "checkout.session.completed",
          deal_id: deal.id,
          rep_id: rep,
          package_id: pkg.id,
          checkout_id: "cs_test_concurrent",
          payment_intent: "pi_concurrent",
          charge_id: "ch_concurrent",
          amount_cents: 79900,
          currency: "usd",
          refunded_cents: 0,
          disputed: false,
          settled: true,
          available_at: new Date().toISOString(),
        };
        successful(
          await contend(
            "select id from public.px_deals where id=$1 for update",
            [deal.id],
            (c) => rpc(c, "px_service", "payment", p),
          ),
        );
        for (const table of ["px_payments", "px_commissions", "px_fulfillment"])
          assert.equal(
            (
              await control.query(
                `select count(*)::int n from public.${table} where deal_id=$1`,
                [deal.id],
              )
            ).rows[0].n,
            1,
          );
        assert.equal(
          (
            await control.query(
              "select count(*)::int n from public.px_xp where source='sale' and source_id=$1",
              [deal.id],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await control.query(
              "select amount_cents from public.px_commissions where deal_id=$1",
              [deal.id],
            )
          ).rows[0].amount_cents,
          12500,
        );
      },
    );
    const comm = (
      await control.query(
        "select id from public.px_commissions where deal_id=$1",
        [deal.id],
      )
    ).rows[0].id;
    await rpc(clients[0], "px_service", "connect", {
      rep_id: rep,
      account_id: "acct_concurrent",
      transfers_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    });
    await control.query(
      "update public.px_commissions set hold_until=now()-interval '1 day' where id=$1",
      [comm],
    );
    await t.test(
      "concurrent finance submissions reserve one transfer",
      async () => {
        await Promise.all(clients.map((c) => identity(c, owner)));
        const results = successful(
          await contend(
            "select id from public.px_commissions where id=$1 for update",
            [comm],
            (c) =>
              rpc(c, "px_action", "queue_transfer", {
                id: comm,
                reason: "Isolated contention verification",
              }),
          ),
        );
        assert.equal(new Set(results.map((r) => r.id)).size, 1);
        assert.equal(
          (
            await control.query(
              "select count(*)::int n from public.px_transfer_requests where commission_id=$1",
              [comm],
            )
          ).rows[0].n,
          1,
        );
        await identity(clients[0], null);
        await rpc(clients[0], "px_service", "transfer_result", {
          request_id: results[0].id,
          transfer_id: "tr_concurrent",
        });
      },
    );
    await t.test(
      "simultaneous reversal reservations cannot exceed the transferred balance",
      async () => {
        await Promise.all(clients.map((c) => identity(c, null)));
        const results = await contend(
          "select id from public.px_commissions where id=$1 for update",
          [comm],
          (c) =>
            rpc(c, "px_service", "reversal_begin", {
              commission_id: comm,
              request_id: crypto.randomUUID(),
              amount_cents: 2000,
              reason: "Isolated competing reversal",
            }),
        );
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 6);
        for (const r of results)
          if (r.status === "rejected")
            assert.match(String(r.reason), /unreserved/);
        assert.equal(
          Number(
            (
              await control.query(
                "select sum(amount_cents) n from public.px_reversal_requests where commission_id=$1",
                [comm],
              )
            ).rows[0].n,
          ),
          12000,
        );
      },
    );
    await t.test(
      "concurrent email workers acquire one lease for one notification",
      async () => {
        await control.query(
          "insert into px_notifications(rep_id,title,body,event_key) values($1,'Your workspace is ready','Isolated activation','activated')",
          [rep],
        );
        await Promise.all(clients.map((c) => identity(c, null)));
        const results = successful(
          await contend(
            "lock table px_private.mail_outbox in access exclusive mode",
            [],
            (c) => rpc(c, "px_mail", "claim"),
          ),
        );
        assert.equal(results.filter(Boolean).length, 1);
        assert.equal(
          (
            await control.query(
              "select attempts from px_private.mail_outbox where rep_id=$1",
              [rep],
            )
          ).rows[0].attempts,
          1,
        );
      },
    );
    await t.test(
      "concurrent document completion is idempotent and replacement wins over stale review",
      async () => {
        await identity(clients[0], rep);
        const first = await rpc(clients[0], "px_tax", "upload_begin", {
          request_id: crypto.randomUUID(),
          bytes: 200,
          sha256: "a".repeat(64),
        });
        await control.query(
          "insert into storage.objects(bucket_id,name) values('pixelalty-tax-documents',$1)",
          [first.object_key],
        );
        await Promise.all(clients.map((c) => identity(c, null)));
        const completed = successful(
          await contend(
            "select id from px_reps where id=$1 for update",
            [rep],
            (c) =>
              c.query("select public.px_tax_complete($1::jsonb)", [
                JSON.stringify({ id: first.id }),
              ]),
          ),
        );
        assert.equal(completed.length, clients.length);
        assert.equal(
          (
            await control.query(
              "select count(*)::int n from px_private.tax_events where document_id=$1 and event='uploaded'",
              [first.id],
            )
          ).rows[0].n,
          1,
        );
        await identity(clients[0], owner);
        await rpc(clients[0], "px_tax", "download", { id: first.id });
        await identity(clients[0], rep);
        const secondDoc = await rpc(clients[0], "px_tax", "upload_begin", {
          request_id: crypto.randomUUID(),
          bytes: 250,
          sha256: "b".repeat(64),
        });
        await control.query(
          "insert into storage.objects(bucket_id,name) values('pixelalty-tax-documents',$1)",
          [secondDoc.object_key],
        );
        await Promise.all(
          clients.map((c, i) => identity(c, i % 2 ? owner : null)),
        );
        const raced = await contend(
          "select id from px_reps where id=$1 for update",
          [rep],
          (c, i) =>
            i % 2
              ? rpc(c, "px_tax", "verify", { id: first.id })
              : c.query("select public.px_tax_complete($1::jsonb)", [
                  JSON.stringify({ id: secondDoc.id }),
                ]),
        );
        for (const result of raced)
          if (result.status === "rejected")
            assert.match(
              String(result.reason),
              /replaced or archived|Review the current submitted/,
            );
        const current = (
          await control.query(
            "select id,status from px_private.tax_documents where rep_id=$1 and current",
            [rep],
          )
        ).rows;
        assert.deepEqual(current, [{ id: secondDoc.id, status: "submitted" }]);
        assert.equal(
          (
            await control.query(
              "select tax_status from px_rep_private where rep_id=$1",
              [rep],
            )
          ).rows[0].tax_status,
          "pending",
        );
        assert.equal(
          (
            await control.query(
              "select count(*)::int n from px_private.tax_events where rep_id=$1 and event='replaced'",
              [rep],
            )
          ).rows[0].n,
          1,
        );
      },
    );
  } finally {
    await Promise.allSettled(clients.map((c) => c.end()));
    await control.end();
  }
});
