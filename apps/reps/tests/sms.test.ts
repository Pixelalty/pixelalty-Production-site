import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { actor, database, rpc, service } from "./helpers";
import { drainSms, smsConfigured, validSmsSignature } from "../src/server/sms";
import type { Env } from "../src/server/types";

test("optional SMS is inert without credentials and verifies signed opt-out requests", async () => {
  assert.equal(smsConfigured({} as Env), false);
  await drainSms({} as Env);
  const url = "https://reps.pixelalty.com/api/webhooks/sms",
    token = "isolated-test-token";
  const params = new URLSearchParams({
    Body: "STOP",
    From: "+12125550198",
    To: "+12125550199",
  });
  const signature = createHmac("sha1", token)
    .update(url + "BodySTOPFrom+12125550198To+12125550199")
    .digest("base64");
  assert.equal(await validSmsSignature(token, url, params, signature), true);
  assert.equal(
    await validSmsSignature(
      token,
      url,
      new URLSearchParams({ ...Object.fromEntries(params), Body: "START" }),
      signature,
    ),
    false,
  );
  assert.equal(
    await validSmsSignature(token, url + "?unexpected=1", params, signature),
    false,
  );
});

test("SMS consent, approval, one-time claims, opt-out and authorization use private SQL", async () => {
  const db = await database(),
    rep = crypto.randomUUID();
  try {
    await db.query(
      "insert into auth.users values($1,'rep@example.test',now())",
      [rep],
    );
    await db.query(
      "insert into px_reps(id,name,status) values($1,'Rep','onboarding')",
      [rep],
    );
    await db.query(
      "insert into px_applicants(email,name,details) values('no@example.test','No consent','{}')",
    );
    await db.query(
      "update px_applicants set rep_id=$1 where email='no@example.test'",
      [rep],
    );
    assert.equal(
      (await db.query("select * from px_private.sms_jobs")).rows.length,
      0,
    );
    await db.query(
      "insert into px_applicants(email,name,details) values('yes@example.test','Consent',$1)",
      [
        {
          phone: "+12125550198",
          sms_opt_in: true,
          sms_opt_in_at: new Date().toISOString(),
          sms_consent_source: "application_optional_checkbox",
        },
      ],
    );
    await db.query(
      "update px_applicants set rep_id=$1 where email='yes@example.test'",
      [rep],
    );
    await actor(db, rep);
    await assert.rejects(rpc(db, "px_sms", "claim"), /permission denied/);
    await assert.rejects(
      db.query("select * from px_private.sms_jobs"),
      /permission denied/,
    );
    await service(db);
    const job = await rpc(db, "px_sms", "claim");
    assert.equal(job.phone, "+12125550198");
    assert.equal(await rpc(db, "px_sms", "claim"), null);
    await rpc(db, "px_sms", "review", { id: job.id });
    assert.equal(
      await rpc(db, "px_sms", "claim"),
      null,
      "Uncertain sends must not repeat",
    );
    await rpc(db, "px_sms", "stop", { phone: job.phone });
    await db.exec("update px_private.sms_jobs set status='pending'");
    assert.equal(await rpc(db, "px_sms", "claim"), null);
    assert.equal(
      (await db.query<any>("select status from px_private.sms_jobs")).rows[0]
        .status,
      "cancelled",
    );
  } finally {
    await db.close();
  }
});
