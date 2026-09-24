import test from "node:test";
import assert from "node:assert/strict";
import { database, actor, service, rpc } from "./helpers";
test("V1 completion uses real SQL, authorization and persistent state", async (t) => {
  const db = await database(),
    owner = crypto.randomUUID(),
    rep = crypto.randomUUID(),
    other = crypto.randomUUID();
  const act = (a: string, p: any = {}) => rpc(db, "px_action", a, p),
    report = (k: string, p: any = {}) => rpc(db, "px_report", k, p);
  const scalar = async (sql: string, args: any[] = []) => {
    await db.exec("reset role");
    return (await db.query<any>(sql, args)).rows[0];
  };
  const business = async (name = "V1 business", who = rep) => {
    const r = await scalar(
      "insert into public.px_businesses(name,phone,timezone,owner_id,expires_at) values($1,$2,'UTC',$3,now()+interval '14 days') returning *",
      [name, "+1212" + String(++serial).padStart(7, "0"), who],
    );
    await actor(db, rep);
    return r;
  };
  let serial = 800;
  try {
    for (const [id, name] of [
      [owner, "Owner"],
      [rep, "Rep"],
      [other, "Other"],
    ]) {
      await db.query("insert into auth.users values($1,$2,now())", [
        id,
        name.toLowerCase() + "@example.test",
      ]);
      if (id !== owner) {
        await db.query(
          "insert into public.px_reps(id,name,status,timezone) values($1,$2,'active','UTC')",
          [id, name],
        );
        await db.query(
          "insert into public.px_rep_private(rep_id,email) values($1,$2)",
          [id, name + "@example.test"],
        );
      }
    }
    await db.query("insert into public.px_roles values($1,'owner')", [owner]);
    const lead = await business();
    await t.test(
      "owner needs MFA; validated settings preserve explicit gates",
      async () => {
        await actor(db, owner);
        await assert.rejects(
          act("settings", {
            value: { streak_target: 2 },
            reason: "Update test policy",
          }),
          /permission|role|MFA|Access/i,
        );
        await actor(db, owner, "aal2");
        await act("settings", {
          value: { streak_target: 2, raw_xp_cap: 5, xp_attempt: 2 },
          reason: "Update test policy",
        });
        await assert.rejects(
          act("settings", {
            value: { auto_transfers: true },
            reason: "Invalid automation",
          }),
          /Invalid/,
        );
      },
    );
    await t.test(
      "profiles, goals and preferences persist and reject invalid timezone",
      async () => {
        await actor(db, rep);
        await assert.rejects(
          act("profile", { name: "Rep", timezone: "Nowhere" }),
          /timezone/,
        );
        await act("profile", {
          name: "Rep One",
          timezone: "UTC",
          income_goal: 100000,
        });
        await act("preferences", {
          value: {
            sales_goal: 5,
            calls_goal: 100,
            shortcuts: false,
            frame: "auto",
          },
        });
        const r = await scalar("select * from public.px_reps where id=$1", [
          rep,
        ]);
        assert.ok(r.profile_completed_at);
        assert.equal(r.preferences.sales_goal, 5);
        await actor(db, rep);
        await assert.rejects(
          act("preferences", { value: { frame: "locked-elite" } }),
          /available/,
        );
      },
    );
    await t.test(
      "notes retain history and private notes cannot leak to another rep",
      async () => {
        const note = await act("note", {
          business_id: lead.id,
          body: "Original context",
          visibility: "private",
        });
        await act("note", {
          business_id: lead.id,
          body: "Corrected context",
          visibility: "private",
          supersedes_id: note.id,
        });
        await assert.rejects(
          act("note", {
            business_id: lead.id,
            body: "Second conflicting revision",
            visibility: "private",
            supersedes_id: note.id,
          }),
          /revis|unique|already/i,
        );
        await assert.rejects(
          db.query("update public.px_notes set body='changed'"),
          /permission denied/,
        );
        await actor(db, other);
        assert.equal(
          (await db.query("select * from public.px_notes")).rows.length,
          0,
        );
        await assert.rejects(
          report("business", { id: lead.id }),
          /available|access|permission/i,
        );
        await actor(db, rep);
      },
    );
    await t.test("favorites toggle idempotently", async () => {
      await act("favorite", { business_id: lead.id, enabled: true });
      await act("favorite", { business_id: lead.id, enabled: true });
      assert.equal(
        (await db.query("select * from public.px_favorites")).rows.length,
        1,
      );
      await act("favorite", { business_id: lead.id, enabled: false });
      assert.equal(
        (await db.query("select * from public.px_favorites")).rows.length,
        0,
      );
    });
    await t.test(
      "focus sessions persist pause, resume, outcomes and summary with capped local-day XP",
      async () => {
        const first = await act("session_start", {
          target_calls: 5,
          target_minutes: 15,
        });
        assert.equal((await act("session_start", {})).id, first.id);
        await act("session_pause");
        await assert.rejects(
          act("call", {
            business_id: lead.id,
            request_id: crypto.randomUUID(),
            outcome: "conversation",
            session_id: first.id,
          }),
          /Resume/,
        );
        await act("session_resume");
        const p = {
          business_id: lead.id,
          request_id: crypto.randomUUID(),
          outcome: "conversation",
          session_id: first.id,
          notes: "Spoke to owner",
        };
        await act("call", p);
        assert.ok((await act("call", p)).duplicate);
        await assert.rejects(
          act("call", { ...p, notes: "Changed" }),
          /cannot be changed/,
        );
        await act("call", { ...p, request_id: crypto.randomUUID() });
        const next = await business();
        await act("call", {
          business_id: next.id,
          request_id: crypto.randomUUID(),
          outcome: "interested",
          session_id: first.id,
        });
        const sum = await report("session");
        assert.equal(sum.calls, 3);
        assert.equal(sum.xp, 5);
        assert.equal(sum.conversations, 3);
        await act("session_end");
        assert.ok((await report("session")).ended_at);
        const dash = await report("dashboard");
        assert.equal(dash.streak.today, 2);
        assert.equal(dash.streak.target, 2);
        assert.equal(dash.month_calls, 2);
        assert.ok(dash.xp >= 15);
      },
    );
    await t.test(
      "DNC retry succeeds without reopening contact and wrong numbers leave queue eligibility",
      async () => {
        const p = {
          business_id: lead.id,
          request_id: crypto.randomUUID(),
          outcome: "do_not_call",
        };
        await act("call", p);
        assert.ok((await act("call", p)).duplicate);
        await assert.rejects(
          act("call", { ...p, request_id: crypto.randomUUID() }),
          /not available/,
        );
        const b = await business();
        await act("call", {
          business_id: b.id,
          request_id: crypto.randomUUID(),
          outcome: "wrong_number",
        });
        const r = await scalar(
          "select stage,bad_number from public.px_businesses where id=$1",
          [b.id],
        );
        assert.equal(r.stage, "lost");
        assert.equal(r.bad_number, true);
      },
    );
    await t.test(
      "followups require activity, persist rescheduling and award once",
      async () => {
        const b = await business(),
          f = await act("followup", {
            business_id: b.id,
            due_at: new Date(Date.now() + 86400000).toISOString(),
            timezone: "UTC",
            note: "Discuss proposal",
            priority: "high",
            channel: "phone",
          });
        await assert.rejects(act("followup_complete", { id: f.id }), /Log/);
        await act("followup_update", {
          id: f.id,
          due_at: new Date(Date.now() + 2 * 86400000).toISOString(),
          timezone: "UTC",
          note: "Rescheduled",
          priority: "high",
        });
        await act("call", {
          business_id: b.id,
          request_id: crypto.randomUUID(),
          outcome: "conversation",
        });
        await act("followup_complete", { id: f.id });
        await act("followup_complete", { id: f.id });
        const rows = (
          await db.query<any>(
            "select * from public.px_xp where source='followup'",
          )
        ).rows;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].amount, 3);
      },
    );
    await t.test(
      "Advanced quotes retain attribution and package snapshots; only admin approves",
      async () => {
        const b = await business(),
          q = await act("quote_request", {
            business_id: b.id,
            customer_email: "buyer@example.test",
            requirements: "Custom multi-page website scope",
          });
        await assert.rejects(
          act("quote_approve", {
            id: q.id,
            price_cents: 350000,
            reason: "Approved test scope",
          }),
          /permission|role|Access|MFA/i,
        );
        await actor(db, owner, "aal2");
        await assert.rejects(
          act("quote_approve", {
            id: q.id,
            price_cents: 100,
            reason: "Below minimum price",
          }),
          /minimum/,
        );
        const d = await act("quote_approve", {
          id: q.id,
          price_cents: 350000,
          reason: "Approved test scope",
        });
        const row = await scalar("select * from public.px_deals where id=$1", [
          d.id,
        ]);
        assert.equal(row.rep_id, rep);
        assert.equal(row.commission_cents, 60000);
        assert.equal(row.price_cents, 350000);
        await actor(db, rep);
        await act("deal_cancel", {
          id: d.id,
          reason: "Customer chose another scope",
        });
        assert.equal(
          (
            await db.query<any>(
              "select stage from public.px_deals where id=$1",
              [d.id],
            )
          ).rows[0].stage,
          "cancelled",
        );
      },
    );
    await t.test(
      "quiz grading stays private and new versions retain history",
      async () => {
        await actor(db, owner, "aal2");
        const c = await act("content", {
          kind: "quiz",
          slug: "v1-qa-quiz",
          title: "V1 readiness quiz",
          body: JSON.stringify([
            {
              question: "What verifies a sale?",
              options: ["Manual report", "Verified payment"],
            },
          ]),
          answers: [1],
          required: true,
          reason: "Publish QA quiz",
        });
        await actor(db, rep);
        await assert.rejects(
          db.query("select * from px_private.quiz_keys"),
          /permission denied/,
        );
        const r = await act("quiz", { content_id: c.id, answers: [1] });
        assert.equal(r.passed, true);
        assert.equal(r.score, 100);
        await assert.rejects(
          act("quiz", { content_id: c.id, answers: [0] }),
          /Wait/,
        );
      },
    );
    await t.test(
      "training awards XP once; notifications read state persists for admin-only users",
      async () => {
        await actor(db, owner, "aal2");
        const c = await act("content", {
          kind: "lesson",
          slug: "v1-qa-lesson",
          title: "Practical lesson",
          body: "Complete this lesson in the isolated QA database.",
          required: false,
          reason: "Publish lesson",
        });
        await actor(db, rep);
        await act("lesson", { content_id: c.id });
        await act("lesson", { content_id: c.id });
        assert.equal(
          (
            await db.query<any>(
              "select count(*)::int n from public.px_xp where source='training' and source_id=$1",
              [c.id],
            )
          ).rows[0].n,
          1,
        );
        await scalar(
          "insert into public.px_notifications(rep_id,title,body) values($1,'Test','Test notice')",
          [owner],
        );
        await actor(db, owner, "aal2");
        await act("notification_read", { all: true });
        assert.ok(
          (
            await db.query<any>(
              "select read_at from public.px_notifications where rep_id=$1",
              [owner],
            )
          ).rows[0].read_at,
        );
      },
    );
    await t.test(
      "import preview classifies DNC and duplicates before commit",
      async () => {
        await actor(db, owner, "aal2");
        const batch = await act("import_start", {
          filename: "qa.csv",
          mapping: { name: "Name", phone: "Phone" },
          total: 3,
          reason: "Create QA import",
        });
        await act("import_stage", {
          id: batch.id,
          reason: "Stage QA import",
          rows: [
            {
              row_num: 1,
              data: { name: "DNC", phone: lead.phone, timezone: "UTC" },
            },
            {
              row_num: 2,
              data: {
                name: "New business",
                phone: "+13035550123",
                domain: "",
                timezone: "UTC",
              },
            },
            {
              row_num: 3,
              data: {
                name: "Duplicate",
                phone: "+13035550123",
                domain: "",
                timezone: "UTC",
              },
            },
          ],
        });
        await act("import_review", {
          id: batch.id,
          reason: "Review QA import",
        });
        const summary = await report("import", { id: batch.id });
        assert.equal(summary.ready, 1);
        await act("import_commit", {
          id: batch.id,
          reason: "Commit QA import",
        });
        const row = await scalar(
          "select count(*)::int n from public.px_businesses where phone=$1",
          ["+13035550123"],
        );
        assert.equal(row.n, 1);
      },
    );
    await t.test(
      "agreement receipt is server-authenticated append-only evidence",
      async () => {
        await actor(db, owner, "aal2");
        const a = await act("content", {
          kind: "agreement",
          slug: "qa-agreement",
          title: "QA agreement",
          body: "Isolated test only, not a usable legal agreement.",
          required: true,
          reason: "Test acceptance evidence",
        });
        await actor(db, rep);
        await act("agreement", {
          content_id: a.id,
          signature: "Rep One",
          accepted: true,
        });
        await assert.rejects(
          rpc(db, "px_service", "agreement_receipt", {
            rep_id: rep,
            content_id: a.id,
          }),
          /permission|Service/i,
        );
        await service(db);
        await rpc(db, "px_service", "agreement_receipt", {
          rep_id: rep,
          content_id: a.id,
          ip: "192.0.2.1",
        });
        await rpc(db, "px_service", "agreement_receipt", {
          rep_id: rep,
          content_id: a.id,
          ip: "192.0.2.1",
        });
        const row = await scalar(
          "select count(*)::int n from public.px_audit where action='agreement_receipt'",
        );
        assert.equal(row.n, 1);
      },
    );
    await t.test(
      "ambiguous imports require explicit review and preserve mapped context",
      async () => {
        await actor(db, owner, "aal2");
        const b = await act("import_start", {
          filename: "metadata.csv",
          mapping: { name: "Name", phone: "Phone" },
          total: 1,
          reason: "Import reviewed metadata",
        });
        await scalar(
          "update public.px_businesses set email='match@example.test' where id=$1",
          [lead.id],
        );
        await actor(db, owner, "aal2");
        await act("import_stage", {
          id: b.id,
          reason: "Stage reviewed metadata",
          rows: [
            {
              row_num: 1,
              data: {
                name: "Independent branch",
                phone: "+13035550888",
                timezone: "UTC",
                email: "match@example.test",
                external_id: "place-reviewed",
                source: "Licensed list",
                tags: ["Pilot"],
                metadata: { rating: 4.8, review_count: 42, country: "US" },
              },
            },
          ],
        });
        await act("import_review", {
          id: b.id,
          reason: "Check possible duplicates",
        });
        assert.equal(
          (await report("import", { id: b.id })).possible_duplicates,
          1,
        );
        await act("import_row_decision", {
          id: b.id,
          row_num: 1,
          keep: true,
          reason: "Separate branch verified by administrator",
        });
        await act("import_commit", {
          id: b.id,
          reason: "Import reviewed branch",
        });
        const row = await scalar(
          "select metadata,tags,source,external_id from public.px_businesses where phone='+13035550888'",
        );
        assert.equal(row.metadata.rating, 4.8);
        assert.deepEqual(row.tags, ["Pilot"]);
        assert.equal(row.external_id, "place-reviewed");
      },
    );
    await t.test(
      "uncertain Connect creation cannot produce a second account after key expiry",
      async () => {
        await actor(db, owner, "aal2");
        await act("rep_classification", {
          id: rep,
          classification: "contractor",
          tax_status: "pending",
          reason: "Set test contractor classification",
        });
        await service(db);
        await rpc(db, "px_service", "connect_begin", { rep_id: rep });
        await rpc(db, "px_service", "connect_begin", { rep_id: rep });
        await scalar(
          "update public.px_connect_requests set started_at=now()-interval '25 hours' where rep_id=$1",
          [rep],
        );
        await service(db);
        await assert.rejects(
          rpc(db, "px_service", "connect_begin", { rep_id: rep }),
          /Reconcile/,
        );
        await rpc(db, "px_service", "connect", {
          rep_id: rep,
          account_id: "acct_verified_fixture",
          transfers_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
        });
        await rpc(db, "px_service", "connect_begin", { rep_id: rep });
        await assert.rejects(
          rpc(db, "px_service", "connect", {
            rep_id: rep,
            account_id: "acct_wrong_fixture",
            transfers_enabled: true,
            payouts_enabled: true,
            details_submitted: true,
          }),
          /different connected account/,
        );
      },
    );
    await t.test(
      "operational reports run without leaking another rep money",
      async () => {
        await actor(db, rep);
        for (const k of [
          "dashboard",
          "leaderboard",
          "money",
          "onboarding",
          "leads",
        ])
          assert.ok(await report(k));
        await actor(db, owner, "aal2");
        for (const k of ["admin", "finance"]) assert.ok(await report(k));
      },
    );
  } finally {
    await db.close();
  }
});
