import test from "node:test";
import assert from "node:assert/strict";
import { database, actor, service, rpc } from "./helpers";
import { drainMail, mailConfigured } from "../src/server/mail";
import type { Env } from "../src/server/types";
test("branded onboarding delivery uses private, authorized, retry-safe database state", async (t) => {
  const db = await database(),
    owner = crypto.randomUUID(),
    rep = crypto.randomUUID(),
    other = crypto.randomUUID();
  const mail = (action: string, p: any = {}) => rpc(db, "px_mail", action, p);
  const sql = async (query: string, args: any[] = []) => {
    await db.exec("reset role");
    return (await db.query<any>(query, args)).rows;
  };
  try {
    for (const [id, name] of [
      [owner, "Owner"],
      [rep, "Rep"],
      [other, "Other"],
    ]) {
      await sql("insert into auth.users values($1,$2,now())", [
        id,
        name.toLowerCase() + "@example.test",
      ]);
      if (id !== owner)
        await sql(
          "insert into px_reps(id,name,status,timezone) values($1,$2,'onboarding','UTC')",
          [id, name],
        );
    }
    await sql("insert into px_roles values($1,'owner')", [owner]);
    await t.test(
      "onboarding events queue once and delay reminders",
      async () => {
        for (let i = 0; i < 2; i++)
          await sql(
            "insert into px_notifications(rep_id,title,body) values($1,'Welcome to Pixelalty','Complete onboarding')",
            [rep],
          );
        const jobs = await sql("select * from px_private.mail_outbox");
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0].template, "onboarding");
        await service(db);
        assert.equal(await mail("claim"), null);
      },
    );
    await t.test(
      "rep and low-assurance admin cannot send invites, inspect delivery or claim work",
      async () => {
        for (const who of [rep, owner]) {
          await actor(db, who);
          for (const action of ["claim", "summary", "resend_begin"])
            await assert.rejects(
              mail(action, { id: rep, reason: "Replacement requested" }),
              /Service|MFA|permission|Access|role/i,
            );
          await assert.rejects(
            db.query("select * from px_private.mail_outbox"),
            /permission/,
          );
        }
        await actor(db, owner, "aal2");
        for (let i = 0; i < 3; i++)
          assert.equal(
            (
              await mail("resend_begin", {
                id: rep,
                reason: "Replacement requested",
              })
            ).email,
            "rep@example.test",
          );
        await assert.rejects(
          mail("resend_begin", { id: rep, reason: "Replacement requested" }),
          /Please wait/,
        );
        assert.equal((await mail("summary")).pending, 1);
        const audited = await sql(
          "select count(*)::int n from px_audit where action='rep_setup_email_requested'",
        );
        assert.equal(audited[0].n, 3);
      },
    );
    await t.test(
      "activation cancels stale reminders, requires confirmed email and excludes a second claimant",
      async () => {
        await sql("update px_reps set status='active' where id=$1", [rep]);
        await sql(
          "insert into px_notifications(rep_id,title,body,event_key) values($1,'Ready','Account active','activated')",
          [rep],
        );
        await sql("update auth.users set email_confirmed_at=null where id=$1", [
          rep,
        ]);
        await service(db);
        assert.equal(await mail("claim"), null);
        await sql(
          "update auth.users set email_confirmed_at=now() where id=$1",
          [rep],
        );
        await service(db);
        const job = await mail("claim");
        assert.equal(job.template, "activated");
        assert.equal(await mail("claim"), null);
        const key = { id: job.id, lease_token: job.lease_token };
        const payload = {
          from: "Pixelalty Sales <sales@pixelalty.com>",
          to: ["rep@example.test"],
          subject: "Active",
          html: "Approved",
          text: "Approved",
        };
        assert.deepEqual(await mail("prepare", { ...key, payload }), payload);
        assert.deepEqual(
          await mail("prepare", {
            ...key,
            payload: { ...payload, subject: "Different revision" },
          }),
          payload,
        );
        await assert.rejects(
          mail("sent", {
            id: job.id,
            lease_token: crypto.randomUUID(),
            provider_id: "provider_test",
          }),
          /lease/,
        );
        await mail("failed", { ...key, error_code: "provider_status_429" });
        assert.equal(await mail("claim"), null);
        await sql(
          "update px_private.mail_outbox set available_at=now() where id=$1",
          [job.id],
        );
        await service(db);
        const retry = await mail("claim");
        assert.equal(retry.id, job.id);
        assert.notEqual(retry.lease_token, job.lease_token);
        await assert.rejects(
          mail("sent", { ...key, provider_id: "provider_test" }),
          /lease/,
        );
        await mail("sent", {
          id: retry.id,
          lease_token: retry.lease_token,
          provider_id: "provider_test",
        });
        assert.equal(await mail("claim"), null);
        const states = await sql(
          "select template,status from px_private.mail_outbox order by template",
        );
        assert.deepEqual(states, [
          { template: "activated", status: "sent" },
          { template: "onboarding", status: "cancelled" },
        ]);
      },
    );
    await t.test(
      "uncertain delivery is not retried after the provider idempotency window",
      async () => {
        await sql(
          "insert into px_private.mail_outbox(event_key,rep_id,template,first_attempt_at) values('uncertain',$1,'onboarding',now()-interval '24 hours')",
          [other],
        );
        await service(db);
        assert.equal(await mail("claim"), null);
        assert.equal(
          (
            await sql(
              "select status from px_private.mail_outbox where event_key='uncertain'",
            )
          )[0].status,
          "review",
        );
      },
    );
  } finally {
    await db.close();
  }
});
test("email provider calls preserve idempotency, use frozen payloads and stop on throttling", async () => {
  const original = globalThis.fetch,
    calls: any[] = [];
  const env = {
    APP_URL: "https://reps.pixelalty.com",
    SUPABASE_URL: "https://isolated.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "fixture",
    SUPABASE_SERVICE_ROLE_KEY: "fixture_service",
    RESEND_API_KEY: "fixture_mail",
    EMAIL_FROM: "Pixelalty Sales <sales@pixelalty.com>",
  } as Env;
  const payload = {
    from: env.EMAIL_FROM,
    to: ["rep@example.test"],
    subject: "Frozen subject",
    html: "Frozen content",
    text: "Frozen content",
  };
  let status = 429,
    claims = 0;
  globalThis.fetch = async (input: any, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init),
      data = (await req.json()) as any;
    calls.push({ url: req.url, data, key: req.headers.get("idempotency-key") });
    if (req.url === "https://api.resend.com/emails")
      return Response.json(
        status === 200
          ? { id: "delivery_receipt" }
          : { message: "provider internal" },
        { status },
      );
    if (data.action === "claim") {
      claims++;
      return Response.json({
        id: "job-fixture",
        lease_token: "lease-fixture",
        email: "rep@example.test",
        template: "activated",
      });
    }
    return Response.json(data.action === "prepare" ? payload : {});
  };
  try {
    assert.equal(
      mailConfigured({ ...env, EMAIL_FROM: "Unbranded <x@example.test>" }),
      false,
    );
    assert.equal(
      mailConfigured({
        ...env,
        APP_URL: "https://pixelalty-sales-staging.elore-marketing.workers.dev",
      }),
      false,
    );
    assert.equal(
      mailConfigured({ ...env, APP_URL: "http://localhost:8787" }),
      false,
    );
    await drainMail(env, 3);
    assert.equal(claims, 1);
    assert.deepEqual(
      calls.find((c) => c.url === "https://api.resend.com/emails").data,
      payload,
    );
    assert.equal(calls.at(-1).data.action, "failed");
    assert.equal(calls.at(-1).data.p.permanent, false);
    status = 200;
    await drainMail(env, 1);
    const deliveries = calls.filter(
      (c) => c.url === "https://api.resend.com/emails",
    );
    assert.equal(deliveries.length, 2);
    assert.equal(deliveries[0].key, deliveries[1].key);
    assert.deepEqual(deliveries[0].data, deliveries[1].data);
    assert.equal(calls.at(-1).data.action, "sent");
  } finally {
    globalThis.fetch = original;
  }
});
