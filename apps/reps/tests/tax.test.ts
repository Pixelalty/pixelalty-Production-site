import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName } from "pdf-lib";
import { validateTaxPdf, TAX_MAX_BYTES } from "../src/server/tax";
import { actor, database, rpc, service, submitTaxFixture } from "./helpers";
import { startIntegration } from "./integration-server";

async function samplePdf() {
  const doc = await PDFDocument.create();
  doc.addPage().drawText("ISOLATED TEST DOCUMENT. No real tax information.");
  return doc;
}
test("tax PDF validation accepts ordinary printed PDFs and rejects scripts, attachments, encryption and arbitrary bytes", async () => {
  const valid = await (await samplePdf()).save();
  await validateTaxPdf(valid, "application/pdf");
  await assert.rejects(validateTaxPdf(valid, "text/html"), /readable PDF/);
  await assert.rejects(
    validateTaxPdf(new Uint8Array(TAX_MAX_BYTES + 1), "application/pdf"),
    /5 MB/,
  );
  await assert.rejects(
    validateTaxPdf(
      new TextEncoder().encode("<script>not a PDF</script>"),
      "application/pdf",
    ),
    /readable PDF/,
  );
  await assert.rejects(
    validateTaxPdf(valid.subarray(0, valid.length - 20), "application/pdf"),
    /readable PDF/,
  );
  const script = await samplePdf();
  script.addJavaScript("untrusted", "app.alert('unsafe')");
  await assert.rejects(
    validateTaxPdf(await script.save(), "application/pdf"),
    /Print → Save as PDF/,
  );
  const attachment = await samplePdf();
  await attachment.attach(
    new TextEncoder().encode("arbitrary bytes"),
    "hidden.txt",
  );
  await assert.rejects(
    validateTaxPdf(await attachment.save(), "application/pdf"),
    /readable PDF/,
  );
  const encrypted = await samplePdf();
  encrypted.context.trailerInfo.Encrypt = encrypted.context.register(
    encrypted.context.obj({ Filter: "Standard" }),
  );
  await assert.rejects(
    validateTaxPdf(await encrypted.save(), "application/pdf"),
    /readable PDF/,
  );
  const action = await samplePdf();
  action.catalog.set(
    PDFName.of("OpenAction"),
    action.context.obj({ S: "Launch", F: "program.exe" }),
  );
  await assert.rejects(
    validateTaxPdf(await action.save(), "application/pdf"),
    /readable PDF/,
  );
  const long = await samplePdf();
  for (let i = 0; i < 20; i++) long.addPage();
  await assert.rejects(
    validateTaxPdf(await long.save(), "application/pdf"),
    /readable PDF/,
  );
});

test("private tax documents, role separation, replacement and activation use real SQL", async (t) => {
  const db = await database();
  const ids = Object.fromEntries(
    [
      "owner",
      "finance_admin",
      "sales_admin",
      "compliance_admin",
      "rep",
      "other",
    ].map((name) => [name, crypto.randomUUID()]),
  );
  const tax = (action: string, p: unknown = {}) => rpc(db, "px_tax", action, p);
  const action = (name: string, p: unknown = {}) =>
    rpc(db, "px_action", name, p);
  const report = (name: string, p: unknown = {}) =>
    rpc(db, "px_report", name, p);
  let document: any, replacement: any;
  try {
    for (const [name, id] of Object.entries(ids)) {
      await db.query("insert into auth.users values($1,$2,now())", [
        id,
        name + "@example.test",
      ]);
      await db.query(
        "insert into public.px_reps(id,name,status,timezone) values($1,$2,'onboarding','UTC')",
        [id, name],
      );
      await db.query(
        "insert into public.px_rep_private(rep_id,email) values($1,$2)",
        [id, name + "@example.test"],
      );
      if (!["rep", "other"].includes(name))
        await db.query("insert into public.px_roles values($1,$2)", [id, name]);
    }
    await t.test(
      "bucket and metadata deny direct reads even with an unrelated permissive storage policy",
      async () => {
        const bucket = (
          await db.query<any>(
            "select * from storage.buckets where id='pixelalty-tax-documents'",
          )
        ).rows[0];
        assert.equal(bucket.public, false);
        assert.equal(bucket.file_size_limit, TAX_MAX_BYTES);
        await db.query(
          "insert into storage.objects(bucket_id,name) values('pixelalty-tax-documents','private-fixture.pdf')",
        );
        await db.exec(
          "create policy unrelated_public_policy on storage.objects for select to anon,authenticated using(true)",
        );
        for (const name of ["rep", "finance_admin", "owner"]) {
          await actor(db, ids[name], "aal2");
          assert.equal(
            (await db.query("select * from storage.objects")).rows.length,
            0,
          );
          await assert.rejects(
            db.query("select * from px_private.tax_documents"),
            /permission/,
          );
          await assert.rejects(
            db.query(
              "insert into storage.objects(bucket_id,name) values('pixelalty-tax-documents','attack.pdf')",
            ),
            /row-level/,
          );
        }
        await db.exec("reset role;set role anon");
        assert.equal(
          (await db.query("select * from storage.objects")).rows.length,
          0,
        );
        await assert.rejects(tax("summary"), /permission/);
      },
    );
    await t.test(
      "classification is admin-only; neither rep nor Sales can mark tax verified",
      async () => {
        await actor(db, ids.rep);
        const readiness = await report("onboarding");
        assert.equal(
          readiness.steps.find((s: any) => s.key === "agreement").message,
          "Waiting for Pixelalty to publish your agreement.",
        );
        assert.equal(
          readiness.steps.find((s: any) => s.key === "classification").actor,
          "admin",
        );
        await assert.rejects(
          action("rep_classification", {
            id: ids.rep,
            classification: "contractor",
            reason: "Unauthorized self classification",
          }),
          /role|MFA|Access/i,
        );
        await assert.rejects(
          tax("upload_begin", {
            request_id: crypto.randomUUID(),
            bytes: 200,
            sha256: "b".repeat(64),
          }),
          /classification/,
        );
        await actor(db, ids.sales_admin, "aal2");
        await assert.rejects(
          action("rep_classification", {
            id: ids.rep,
            classification: "contractor",
            tax_status: "verified",
            reason: "Cannot bypass tax review",
          }),
          /Finance review/,
        );
        await action("rep_classification", {
          id: ids.rep,
          classification: "contractor",
          reason: "Test classification reviewed",
        });
        const state = await report("onboarding", { id: ids.rep });
        assert.equal(
          state.steps.find((s: any) => s.key === "tax").actor,
          "rep",
        );
        assert.equal(state.classification_history.length, 1);
        await assert.rejects(
          action("rep_activate", {
            id: ids.rep,
            reason: "Activation must remain blocked",
          }),
          /Can't activate yet.*Tax setup/,
        );
      },
    );
    await t.test(
      "uploads are owned, idempotent and cannot become submitted until Storage and server confirm them",
      async () => {
        await actor(db, ids.rep);
        const payload = {
          request_id: crypto.randomUUID(),
          bytes: 200,
          sha256: "b".repeat(64),
          rep_id: ids.other,
        };
        document = await tax("upload_begin", payload);
        assert.ok(document.object_key.startsWith(ids.rep + "/"));
        assert.deepEqual(await tax("upload_begin", payload), document);
        await assert.rejects(
          tax("upload_begin", { ...payload, sha256: "c".repeat(64) }),
          /different file/,
        );
        await assert.rejects(
          db.query("select public.px_tax_complete($1::jsonb)", [
            JSON.stringify({ id: document.id }),
          ]),
          /permission/,
        );
        await service(db);
        await assert.rejects(
          db.query("select public.px_tax_complete($1::jsonb)", [
            JSON.stringify({ id: document.id }),
          ]),
          /not complete/,
        );
        await db.query(
          "insert into storage.objects(bucket_id,name) values('pixelalty-tax-documents',$1)",
          [document.object_key],
        );
        for (let i = 0; i < 2; i++)
          await db.query("select public.px_tax_complete($1::jsonb)", [
            JSON.stringify({ id: document.id }),
          ]);
        await actor(db, ids.rep);
        const own = await tax("summary");
        assert.equal(own.status, "submitted");
        assert.equal(own.history, undefined);
        assert.equal(own.document.object_key, undefined);
        assert.equal(own.document.sha256, undefined);
        assert.equal(own.document.filename, undefined);
        await assert.rejects(
          tax("summary", { rep_id: ids.other }),
          /authorized/,
        );
      },
    );
    await t.test(
      "only Owner or Finance with MFA can download or review; failed/stale access is denied",
      async () => {
        for (const [name, aal] of [
          ["rep", "aal1"],
          ["other", "aal1"],
          ["sales_admin", "aal2"],
          ["compliance_admin", "aal2"],
          ["owner", "aal1"],
          ["finance_admin", "aal1"],
        ]) {
          await actor(db, ids[name], aal);
          await assert.rejects(
            tax("download", { id: document.id }),
            /role|MFA|Access/i,
          );
          await assert.rejects(
            tax("verify", { id: document.id }),
            /role|MFA|Access/i,
          );
        }
        await actor(db, ids.finance_admin, "aal2");
        await assert.rejects(
          tax("verify", { id: document.id }),
          /Download and review/,
        );
        await tax("download", { id: document.id });
        await tax("start_review", { id: document.id });
        assert.equal(
          (await tax("summary", { rep_id: ids.rep })).status,
          "under_review",
        );
        await assert.rejects(
          tax("request_correction", {
            id: document.id,
            reason_code: "123-45-private",
          }),
          /Select a correction/,
        );
        await tax("request_correction", {
          id: document.id,
          reason_code: "signature",
        });
        await actor(db, ids.rep);
        const own = await tax("summary");
        assert.equal(own.status, "needs_correction");
        assert.match(own.document.correction_reason, /signature/);
        assert.equal(
          (
            await db.query(
              "select * from px_notifications where title='Tax document needs correction'",
            )
          ).rows.length,
          1,
        );
        replacement = await submitTaxFixture(db, ids.rep);
        await actor(db, ids.finance_admin, "aal2");
        await assert.rejects(
          tax("verify", { id: document.id }),
          /replaced or archived/,
        );
        await tax("download", { id: replacement.id });
        await tax("verify", { id: replacement.id });
        const summary = await tax("summary", { rep_id: ids.rep });
        assert.equal(summary.status, "verified");
        assert.equal(summary.history.length, 2);
        for (const event of [
          "uploaded",
          "downloaded",
          "under_review",
          "needs_correction",
          "replaced",
          "verified",
        ])
          assert.ok(
            summary.events.some((e: any) => e.event === event),
            event,
          );
        assert.equal(
          summary.events.filter((e: any) => e.event === "uploaded").length,
          2,
        );
        await assert.rejects(
          db.query("update px_private.tax_events set reason='changed'"),
          /permission/,
        );
        await service(db);
        await assert.rejects(
          db.query("delete from px_private.tax_events"),
          /immutable|append-only/i,
        );
      },
    );
    await t.test(
      "replacement/archive reset verified gates and classification changes cannot revive old verification",
      async () => {
        const next = await submitTaxFixture(db, ids.rep);
        await actor(db, ids.owner, "aal2");
        assert.equal(
          (await report("onboarding", { id: ids.rep })).steps.find(
            (s: any) => s.key === "tax",
          ).complete,
          false,
        );
        await tax("download", { id: next.id });
        await tax("verify", { id: next.id });
        await tax("archive", { id: next.id, reason_code: "incorrect" });
        assert.equal(
          (await tax("summary", { rep_id: ids.rep })).status,
          "not_submitted",
        );
        await tax("download", { id: next.id }); // restricted history remains available to Finance
        const fourth = await submitTaxFixture(db, ids.rep);
        await actor(db, ids.owner, "aal2");
        await tax("download", { id: fourth.id });
        await tax("verify", { id: fourth.id });
        for (const classification of ["employee", "contractor"])
          await action("rep_classification", {
            id: ids.rep,
            classification,
            reason: "Classification change review",
          });
        assert.equal(
          (await tax("summary", { rep_id: ids.rep })).status,
          "not_submitted",
        );
        await assert.rejects(
          action("rep_payroll", {
            id: ids.rep,
            tax_verified: true,
            payout_verified: true,
            reason: "Bypass attempt rejected",
          }),
          /Contractor tax/,
        );
      },
    );
    await t.test(
      "operations queues and tax review are role protected; public config contains no commission table",
      async () => {
        await actor(db, ids.rep);
        await assert.rejects(report("operations"), /role|MFA|Access/i);
        await assert.rejects(report("tax_queue"), /role|MFA|Access/i);
        await actor(db, ids.sales_admin, "aal2");
        const ops = await report("operations");
        assert.ok(ops.reps.length);
        assert.equal(ops.tax_review, null);
        assert.equal(ops.can_review_tax, false);
        await assert.rejects(report("tax_queue"), /role|MFA|Access/i);
        await actor(db, ids.finance_admin, "aal2");
        assert.ok((await report("tax_queue")).rows);
        assert.equal((await report("operations")).can_review_tax, true);
        await db.exec("reset role;set role anon");
        const config = (await db.query<any>("select px_public_config() config"))
          .rows[0].config;
        assert.equal(config.packages, undefined);
        assert.ok(!JSON.stringify(config).includes("commission_cents"));
      },
    );
  } finally {
    await db.close();
  }
});

test("real Worker tax endpoints validate PDFs, persist private objects, enforce roles and return safe authorized downloads", async () => {
  const f = await startIntegration();
  const token = (id: string) =>
    f.session(f.users.find((u) => u.id === id)!).access_token;
  const call = (path: string, id = f.rep, data?: unknown) =>
    fetch(f.base + "/api" + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        authorization: "Bearer " + token(id),
        origin: f.base,
        "content-type": "application/json",
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  const pdf = await (await samplePdf()).save(),
    requestId = crypto.randomUUID();
  const upload = (bytes: Uint8Array = pdf, origin = f.base) =>
    fetch(f.base + "/api/tax/upload", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token(f.rep),
        "content-type": "application/pdf",
        "x-upload-id": requestId,
        origin,
      },
      body: bytes as Uint8Array<ArrayBuffer>,
    });
  try {
    assert.equal((await upload(pdf, "https://evil.example.test")).status, 403);
    assert.equal((await fetch(f.base + "/api/tax")).status, 401);
    assert.equal(
      (await upload(new TextEncoder().encode("not a pdf"))).status,
      400,
    );
    assert.equal((await upload()).status, 200);
    assert.equal((await upload()).status, 200);
    assert.equal(f.storedFiles.size, 1);
    const own = (await (await call("/tax")).json()) as any;
    assert.equal(own.status, "submitted");
    assert.equal((await call("/tax?rep=" + f.rep, f.newRep)).status, 403);
    assert.equal(
      (await call("/tax/document", f.rep, { id: own.document.id })).status,
      403,
    );
    assert.equal(
      (
        await call("/tax/review", f.owner, {
          id: own.document.id,
          action: "verify",
        })
      ).status,
      403,
    );
    const download = await call("/tax/document", f.owner, {
      id: own.document.id,
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/pdf");
    assert.match(download.headers.get("content-disposition")!, /attachment/);
    assert.match(download.headers.get("cache-control")!, /no-store/);
    assert.equal(
      download.headers.get("content-security-policy"),
      "sandbox; default-src 'none'",
    );
    assert.deepEqual(new Uint8Array(await download.arrayBuffer()), pdf);
    assert.equal(
      (
        await call("/tax/review", f.owner, {
          id: own.document.id,
          action: "verify",
        })
      ).status,
      200,
    );
    assert.equal(
      ((await (await call("/tax")).json()) as any).status,
      "verified",
    );
    assert.equal(
      (await call("/tax/document", f.owner, { id: "invalid" })).status,
      400,
    );
    assert.equal(
      (
        await call("/tax/review", f.owner, {
          id: own.document.id,
          action: "request_correction",
          reason_code: "unreadable",
        })
      ).status,
      200,
    );
    const state = (await (await call("/tax")).json()) as any;
    assert.equal(state.status, "needs_correction");
    assert.match(state.document.correction_reason, /readable/);
  } finally {
    await f.close();
  }
});
