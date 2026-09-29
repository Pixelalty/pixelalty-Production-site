import test from "node:test";
import assert from "node:assert/strict";
import { actor, database, rpc, service } from "./helpers";
import {
  estimatedRecordingBytes,
  RECORDING_MAX_BYTES,
  RECORDING_MAX_SECONDS,
  supportedRecordingFormat,
} from "../src/ui/recordings";

const rep = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const owner = "10000000-0000-4000-8000-000000000003";

test("recording format selection and quota estimates are deterministic", () => {
  assert.equal(
    supportedRecordingFormat((mime) => mime === "audio/webm;codecs=opus")
      ?.codec,
    "opus",
  );
  assert.equal(
    supportedRecordingFormat(() => false),
    null,
  );
  assert.equal(estimatedRecordingBytes(60), 720_000);
  assert.ok(
    estimatedRecordingBytes(RECORDING_MAX_SECONDS) < RECORDING_MAX_BYTES,
  );
});

test("Essentials and private call recordings persist with real SQL and RLS", async () => {
  const db = await database();
  try {
    for (const [id, email, name] of [
      [rep, "rep@example.test", "Recording Rep"],
      [other, "other@example.test", "Other Rep"],
      [owner, "owner@example.test", "Owner"],
    ]) {
      await db.query("insert into auth.users values($1,$2,now())", [id, email]);
      await db.query(
        "insert into public.px_reps(id,name,status,timezone) values($1,$2,'active','UTC')",
        [id, name],
      );
      await db.query(
        "insert into public.px_rep_private(rep_id,email,classification,tax_status) values($1,$2,'contractor','verified')",
        [id, email],
      );
    }
    await db.query("insert into public.px_roles values($1,'owner')", [owner]);
    const required = await db.query<{ kind: string; slug: string }>(
      "select kind,slug from public.px_content where active and required and kind in ('lesson','quiz')",
    );
    assert.deepEqual(required.rows, [
      { kind: "lesson", slug: "pixelalty-essentials" },
    ]);

    await actor(db, rep);
    await rpc(db, "px_action", "essentials_complete", { acknowledged: true });
    await rpc(db, "px_action", "essentials_complete", { acknowledged: true });
    const completions = await db.query<{ count: number }>(
      "select count(*)::int count from public.px_training t join public.px_content c on c.id=t.content_id where t.rep_id=$1 and c.slug='pixelalty-essentials'",
      [rep],
    );
    assert.equal(completions.rows[0].count, 1);
    const onboarding = await rpc(db, "px_report", "onboarding");
    assert.equal(onboarding.essentials_completed, true);
    const trainingXp = await db.query<{ total: string }>(
      "select coalesce(sum(amount),0)::text total from px_xp where rep_id=$1 and source='training'",
      [rep],
    );
    assert.equal(trainingXp.rows[0].total, "25");
    assert.equal(
      onboarding.steps.filter(
        (step: { key: string }) => step.key === "essentials",
      ).length,
      1,
    );
    assert.equal(
      onboarding.steps.some((step: { key: string }) => step.key === "quiz"),
      false,
    );

    await db.exec("reset role");
    const business = (
      await db.query<{ id: string }>(
        "insert into public.px_businesses(name,phone,timezone,owner_id,claimed_at,expires_at) values('Audio Test','+12125550199','UTC',$1,now(),now()+interval '7 days') returning id",
        [rep],
      )
    ).rows[0].id;
    await actor(db, rep);
    const requestId = crypto.randomUUID();
    await assert.rejects(
      rpc(db, "px_action", "recording_begin", {
        request_id: crypto.randomUUID(),
        business_id: business,
        call_id: null,
        deal_id: null,
        title: "Missing consent",
        note: "",
        markers: [],
        mime_type: "audio/webm",
        codec: "opus · 96 kbps mono",
        size_bytes: 12_000,
        duration_seconds: 1,
        device_label: "Test microphone",
        recorded_at: new Date().toISOString(),
      }),
      /consent/i,
    );
    const reservation = await rpc(db, "px_action", "recording_begin", {
      request_id: requestId,
      business_id: business,
      call_id: null,
      deal_id: null,
      title: "Consent confirmed test",
      note: "Private fixture",
      markers: [{ at: 2, label: "Marker 1" }],
      mime_type: "audio/webm",
      codec: "opus · 96 kbps mono",
      size_bytes: 12_000,
      duration_seconds: 1,
      device_label: "Test microphone",
      recorded_at: new Date().toISOString(),
      consent_confirmed: true,
    });
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('call-recordings',$1,$2::jsonb)",
      [
        reservation.object_key,
        JSON.stringify({ size: 12_000, mimetype: "audio/webm" }),
      ],
    );
    const duplicate = await rpc(db, "px_action", "recording_begin", {
      request_id: requestId,
      business_id: business,
      call_id: null,
      deal_id: null,
      title: "Consent confirmed test",
      note: "Private fixture",
      markers: [],
      mime_type: "audio/webm",
      codec: "opus · 96 kbps mono",
      size_bytes: 12_000,
      duration_seconds: 1,
      device_label: "Test microphone",
      recorded_at: new Date().toISOString(),
      consent_confirmed: true,
    });
    assert.equal(duplicate.id, reservation.id);
    assert.equal(duplicate.status, "ready");
    const saved = await rpc(db, "px_action", "recording_finalize", {
      id: reservation.id,
    });
    assert.equal(saved.status, "ready");
    const mine = await rpc(db, "px_report", "recordings", { admin: false });
    assert.equal(mine.rows.length, 1);
    assert.equal(mine.rows[0].business_name, "Audio Test");
    assert.ok(mine.rows[0].consent_confirmed_at);

    await actor(db, other);
    assert.equal(
      (await db.query("select id from public.px_call_recordings")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select id from storage.objects where bucket_id='call-recordings'",
        )
      ).rows.length,
      0,
    );

    await actor(db, owner, "aal2");
    await assert.rejects(
      rpc(db, "px_action", "content", {
        kind: "quiz",
        slug: "hidden-required-quiz",
        title: "Hidden requirement",
        body: "[]",
        answers: [0],
        required: true,
        reason: "Attempt hidden onboarding requirement",
      }),
      /only required rep training/i,
    );
    const adminView = await rpc(db, "px_report", "recordings", { admin: true });
    assert.equal(adminView.rows.length, 1);
    assert.ok(adminView.reps.some((row: { id: string }) => row.id === rep));
    const filtered = await rpc(db, "px_report", "recordings", {
      admin: true,
      rep_id: rep,
      business: "Audio",
      date_from: new Date().toISOString().slice(0, 10),
      date_to: new Date().toISOString().slice(0, 10),
      min_duration: 1,
      max_duration: 2,
      sort: "duration",
      direction: "asc",
    });
    assert.equal(filtered.rows.length, 1);
    await rpc(db, "px_action", "recording_quota", {
      quota_bytes: 800_000_000,
    });
    const changed = await rpc(db, "px_report", "recordings", { admin: true });
    assert.equal(changed.usage.quota_bytes, 800_000_000);

    await actor(db, rep);
    await rpc(db, "px_action", "recording_delete_begin", {
      id: reservation.id,
      confirmed: true,
    });
    await service(db);
    await db.query(
      "delete from storage.objects where bucket_id='call-recordings' and name=$1",
      [reservation.object_key],
    );
    await actor(db, rep);
    await rpc(db, "px_action", "recording_delete_complete", {
      id: reservation.id,
    });
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from public.px_call_recordings where id=$1",
          [reservation.id],
        )
      ).rows[0].status,
      "deleted",
    );
  } finally {
    await db.close();
  }
});
