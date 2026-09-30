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
    await control.query(
      "create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,created_at timestamptz not null default now());",
    );
    await control.query(storageSchema);
    await control.query(
      "create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete cascade,status text);",
    );
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
      "simultaneous independent XP awards preserve the full peak unlock balance",
      async () => {
        const xpRep = crypto.randomUUID();
        await control.query(
          "insert into auth.users values($1,'xp-contention@example.test',now())",
          [xpRep],
        );
        await control.query(
          "insert into px_reps(id,name,status) values($1,'XP contention','active')",
          [xpRep],
        );
        await Promise.all(clients.map((c) => c.query("reset role")));
        successful(
          await contend(
            "select id from px_reps where id=$1 for update",
            [xpRep],
            (c) =>
              c.query(
                "insert into px_xp(rep_id,source,source_id,amount) values($1,'isolated_concurrency',gen_random_uuid(),100)",
                [xpRep],
              ),
          ),
        );
        const peak = (
          await control.query(
            "select earned_xp,(select sum(amount) from px_xp where rep_id=$1) total from px_profile_styles where rep_id=$1",
            [xpRep],
          )
        ).rows[0];
        assert.equal(Number(peak.earned_xp), 1200);
        assert.equal(Number(peak.total), 1200);
      },
    );
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
      "manual sales-code assignment cannot give one active code to two reps",
      async () => {
        await Promise.all(clients.map((c) => identity(c, owner)));
        const results = await contend(
          "lock table public.px_sales_codes in access exclusive mode",
          [],
          (c, i) =>
            rpc(c, "px_action", "sales_code_save", {
              id: i % 2 ? second : third,
              code: "RACE2",
            }),
        );
        assert.ok(results.some((r) => r.status === "fulfilled"));
        for (const r of results)
          if (r.status === "rejected")
            assert.match(String(r.reason), /already assigned/);
        assert.equal(
          (
            await control.query(
              "select count(*)::int n from px_sales_codes where code='RACE2' and active",
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "simultaneous Payment Link events create one sale, fixed commission and XP",
      async () => {
        await identity(clients[0], owner);
        await rpc(clients[0], "px_action", "sales_code_save", {
          id: rep,
          code: "CONCURRENT2",
        });
        await Promise.all(clients.map((c) => identity(c, null)));
        const snapshot = {
          payment_intent: "pi_manual_race",
          checkout_id: "cs_manual_race",
          charge_id: "ch_manual_race",
          package_code: "launch",
          promotion_code: "CONCURRENT2",
          promotion_code_id: "promo_race",
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
          event_type: "checkout.session.completed",
        };
        const results = successful(
          await contend(
            "select pg_advisory_xact_lock(hashtextextended('pixelalty-payment:'||$1,0))",
            [snapshot.payment_intent],
            (c, i) =>
              rpc(c, "px_service", "verified_sale", {
                ...snapshot,
                event_id: "evt_manual_race_" + i,
              }),
          ),
        );
        assert.equal(new Set(results.map((r) => r.sale_id)).size, 1);
        const saleId = results[0].sale_id;
        assert.equal(
          (
            await control.query(
              "select count(*)::int n from px_commissions where sale_id=$1",
              [saleId],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await control.query(
              "select count(*)::int n from px_xp where source='sale' and source_id=$1",
              [saleId],
            )
          ).rows[0].n,
          1,
        );
        await control.query(
          "update px_commissions set hold_until=now()-interval '1 day',status='payable' where sale_id=$1",
          [saleId],
        );
        await control.query(
          "insert into px_payout_setup(rep_id,email,phone,legal_first_name,legal_last_name,status) values($1,'race@example.test','+12125550198','Race','Rep','ready')",
          [rep],
        );
        const commissionId = (
          await control.query(
            "select id from px_commissions where sale_id=$1",
            [saleId],
          )
        ).rows[0].id;
        await Promise.all(clients.map((c) => identity(c, owner)));
        const paid = await contend(
          "select id from px_payments where sale_id=$1 for update",
          [saleId],
          (c) =>
            rpc(c, "px_action", "manual_mark_paid", {
              commission_ids: [commissionId],
              amount_cents: 12500,
              paid_at: new Date().toISOString(),
              confirmed: true,
              request_id: crypto.randomUUID(),
            }),
        );
        assert.equal(
          paid.filter((r) => r.status === "fulfilled").length,
          1,
          "Only one actual-payout ledger record may claim this commission",
        );
        for (const r of paid)
          if (r.status === "rejected")
            assert.match(String(r.reason), /no longer payable/);
        assert.equal(
          (
            await control.query(
              "select count(*)::int n from px_manual_payout_items where commission_id=$1",
              [commissionId],
            )
          ).rows[0].n,
          1,
        );
        const recorded = (
          paid.find(
            (r) => r.status === "fulfilled",
          ) as PromiseFulfilledResult<any>
        ).value;
        const retries = successful(
          await contend(
            "select pg_advisory_xact_lock(hashtextextended('pixelalty-manual-payout:'||$1,0))",
            [recorded.id],
            (c) =>
              rpc(c, "px_action", "manual_mark_paid", {
                commission_ids: [commissionId],
                amount_cents: 12500,
                paid_at: recorded.paid_at,
                confirmed: true,
                request_id: recorded.id,
              }),
          ),
        );
        assert.equal(new Set(retries.map((r) => r.id)).size, 1);
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
    await t.test(
      "recording reservations count pending bytes and retry once under contention",
      async () => {
        await control.query(
          "update px_settings set value=jsonb_set(value,'{recording_quota_bytes}','100000000') where id",
        );
        await Promise.all(clients.map((c) => identity(c, rep)));
        const recording = (request_id: string) => ({
          request_id,
          title: "Concurrency recording fixture",
          note: "",
          markers: [],
          mime_type: "audio/webm",
          codec: "opus",
          size_bytes: 45_000_000,
          duration_seconds: 3000,
          device_label: "Test microphone",
          recorded_at: new Date().toISOString(),
          consent_confirmed: true,
        });
        const reservations = await contend(
          "select id from px_settings where id for update",
          [],
          (c) =>
            rpc(
              c,
              "px_action",
              "recording_begin",
              recording(crypto.randomUUID()),
            ),
        );
        assert.equal(
          reservations.filter((r) => r.status === "fulfilled").length,
          2,
        );
        for (const result of reservations)
          if (result.status === "rejected")
            assert.match(String(result.reason), /storage is full/);
        assert.equal(
          Number(
            (
              await control.query(
                "select sum(size_bytes) n from px_call_recordings where status='uploading'",
              )
            ).rows[0].n,
          ),
          90_000_000,
        );
        const first = reservations.find(
          (r) => r.status === "fulfilled",
        ) as PromiseFulfilledResult<any>;
        const retries = successful(
          await contend(
            "select id from px_settings where id for update",
            [],
            (c) =>
              rpc(
                c,
                "px_action",
                "recording_begin",
                recording(first.value.request_id),
              ),
          ),
        );
        assert.ok(retries.every((r) => r.id === first.value.id));
        assert.equal(
          (
            await control.query(
              "select count(*)::int n from px_call_recordings",
            )
          ).rows[0].n,
          2,
        );
      },
    );
    await t.test(
      "simultaneous selected-lead claims have exactly one winner",
      async () => {
        const reps = [crypto.randomUUID(), crypto.randomUUID()];
        for (const id of reps) {
          await control.query("insert into auth.users values($1,$2,now())", [
            id,
            id + "@example.test",
          ]);
          await control.query(
            "insert into px_reps(id,name,status,capacity) values($1,'Selected claim test','active',1)",
            [id],
          );
        }
        const lead = (
          await control.query(
            "insert into px_businesses(name,phone,timezone) values('Selected contention','+16465559001','America/New_York') returning id",
          )
        ).rows[0].id;
        await Promise.all(clients.map((c, i) => identity(c, reps[i % 2])));
        const results = await contend(
          "select id from px_businesses where id=$1 for update",
          [lead],
          (c) => rpc(c, "px_action", "claim_selected", { id: lead }),
        );
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        for (const result of results)
          if (result.status === "rejected")
            assert.match(result.reason.message, /just claimed/);
        const saved = (
          await control.query(
            "select owner_id,(select count(*)::int from px_assignments where business_id=$1) assignments from px_businesses where id=$1",
            [lead],
          )
        ).rows[0];
        assert.ok(reps.includes(saved.owner_id));
        assert.equal(saved.assignments, 1);
        const capacityRep = reps.find((id) => id !== saved.owner_id)!;
        const candidates = (
          await control.query(
            "insert into px_businesses(name,phone,timezone) select 'Capacity selection '||n,'+16465559'||lpad(n::text,3,'0'),'America/New_York' from generate_series(2,13)n returning id",
          )
        ).rows;
        await Promise.all(clients.map((c) => identity(c, capacityRep)));
        const capacity = await contend(
          "select id from px_reps where id=$1 for update",
          [capacityRep],
          (c, i) =>
            rpc(c, "px_action", "claim_selected", { id: candidates[i].id }),
        );
        assert.equal(
          capacity.filter((r) => r.status === "fulfilled").length,
          1,
        );
        for (const result of capacity)
          if (result.status === "rejected")
            assert.match(result.reason.message, /capacity/);
        assert.equal(
          (
            await control.query(
              "select count(*)::int n from px_businesses where owner_id=$1",
              [capacityRep],
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
