import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { actor, database, rpc, service } from "./helpers";
import { parseUpload } from "../src/server/importer";
import {
  importFields,
  suggestImportMapping,
  inspectImport,
} from "../src/shared/imports";
import { normalizeLead } from "../src/shared/core";
import { leadLocation } from "../src/shared/lead-location";
import { diagnosticError } from "../src/server/diagnostics";

const demoPath = new URL(
  "./fixtures/demo-business-leads.xlsx",
  import.meta.url,
);
async function demo() {
  const bytes = await readFile(demoPath);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "134b4f7cb585e21e89262a55d350c1be16b4779dc95f3cece61b9d370b5b0179",
  );
  const parsed = await parseUpload(
    "Demo_Business_Lead_Spreadsheet.xlsx",
    bytes,
  );
  return {
    ...parsed,
    mapping: suggestImportMapping(importFields, parsed.headers),
  };
}
test("the exact namespace-prefixed 25-row workbook and its CSV/TSV exports normalize identically", async () => {
  const { headers, rows, mapping } = await demo();
  assert.equal(headers.length, 23);
  assert.equal(rows.length, 25);
  const normalized = rows.map((row) => normalizeLead(row, mapping));
  assert.equal(inspectImport(rows, mapping).valid, 25);
  assert.equal(normalized[0].domain, "");
  assert.equal(normalized[0].metadata.decision_maker, "Alex Carter");
  assert.equal(normalized[0].metadata.founded_year, 2014);
  assert.equal(normalized[6].timezone, "America/Phoenix");
  assert.equal(normalized[18].timezone, "America/Indiana/Indianapolis");
  assert.equal(normalized[19].timezone, "America/Kentucky/Louisville");
  for (const [ext, delimiter] of [
    ["csv", ","],
    ["tsv", "\t"],
  ]) {
    const csv = [headers, ...rows.map((row) => headers.map((h) => row[h]))]
      .map((row) =>
        row
          .map((value) => '"' + String(value).replaceAll('"', '""') + '"')
          .join(delimiter),
      )
      .join("\r\n");
    const copy = await parseUpload(
      "demo." + ext,
      new TextEncoder().encode(csv),
    );
    assert.deepEqual(
      copy.rows.map((row) => normalizeLead(row, mapping)),
      normalized,
    );
  }
});
test("location lookup preserves ZIP zeroes, ZIP+4 and split states; ambiguous rows stay isolated", () => {
  const locate = (zip: string, city = "", state = "", address = "") =>
    leadLocation({
      zip,
      city,
      state,
      address,
      cityState: "",
      timezone: "",
      defaultZone: "",
    });
  assert.equal(locate("2108").zip, "02108");
  assert.equal(
    locate("32501-1234", "Pensacola", "FL").timezone,
    "America/Chicago",
  );
  assert.equal(locate("79901", "El Paso", "TX").timezone, "America/Denver");
  assert.equal(locate("", "Phoenix", "AZ").timezone, "America/Phoenix");
  assert.equal(
    locate("", "", "", "12 Main St, Tampa, FL 33602").timezone,
    "America/New_York",
  );
  assert.throws(() => locate("", "", "FL"), /Timezone needs review/);
  assert.throws(() => locate("85001", "Tampa", "FL"), /disagree/);
  const rows = [
    { Name: "Good", Phone: "239-555-0101", ZIP: "33901" },
    { Name: "Review", Phone: "239-555-0102", ZIP: "99999" },
  ];
  assert.equal(
    inspectImport(rows, { name: "Name", phone: "Phone", zip: "ZIP" }).valid,
    1,
  );
});
test("unexpected diagnostics retain the error cause without credentials or email", () => {
  const result = diagnosticError(
    new TypeError(
      "Cannot read properties of undefined (reading 'sheets') token=secret user@example.com Bearer abc.def.ghi",
    ),
  );
  assert.match(result.detail, /reading 'sheets'/);
  assert.equal(result.error_type, "TypeError");
  assert.doesNotMatch(result.detail, /secret|user@|abc\.def/);
});

test("operational workflows use the real migrated database and preserve protected records", async (t) => {
  const db = await database(),
    owner = crypto.randomUUID(),
    rep = crypto.randomUUID(),
    second = crypto.randomUUID();
  t.after(() => db.close());
  for (const [id, name] of [
    [owner, "Owner"],
    [rep, "Rep"],
    [second, "Second"],
  ]) {
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, id + "@example.test"],
    );
    await db.query(
      "insert into public.px_reps(id,name,status,capacity) values($1,$2,'active',20)",
      [id, name],
    );
    await db.query(
      "insert into public.px_rep_private(rep_id,email) values($1,$2)",
      [id, id + "@example.test"],
    );
  }
  await db.query(
    "insert into public.px_roles(user_id,role) values($1,'owner')",
    [owner],
  );
  const { rows, mapping } = await demo();
  let batch: any, claimed: any;
  await t.test(
    "stage, check and commit exact demo data once into the shared pool",
    async () => {
      await actor(db, owner, "aal2");
      batch = await rpc(db, "px_action", "import_start", {
        filename: "Demo_Business_Lead_Spreadsheet.xlsx",
        total: rows.length,
        mapping,
        reason: "Exact demo acceptance",
      });
      await rpc(db, "px_action", "import_stage", {
        id: batch.id,
        rows: rows.map((row, i) => ({
          row_num: i + 1,
          data: normalizeLead(row, mapping),
        })),
        reason: "Validate demo",
      });
      await rpc(db, "px_action", "import_review", {
        id: batch.id,
        reason: "Review demo",
      });
      const commit = await rpc(db, "px_action", "import_commit", {
        id: batch.id,
        reason: "Commit demo",
      });
      assert.equal(commit.accepted, 25);
      const again = await rpc(db, "px_action", "import_commit", {
        id: batch.id,
        reason: "Retry identical demo",
      });
      assert.equal(again.accepted, 25);
      await actor(db, rep);
      const pool = await rpc(db, "px_report", "available_leads");
      assert.equal(pool.rows.length, 25);
      claimed = pool.rows[0];
      await rpc(db, "px_action", "claim_selected", { id: claimed.id });
      await actor(db, second);
      await assert.rejects(
        rpc(db, "px_action", "claim_selected", { id: claimed.id }),
        /just claimed/,
      );
      assert.equal(
        (await rpc(db, "px_report", "available_leads")).rows.length,
        24,
      );
    },
  );
  await t.test(
    "package settings create a prospective version and protect historical amounts",
    async () => {
      await actor(db, owner, "aal2");
      const catalog = await rpc(db, "px_report", "package_catalog"),
        pkg = catalog.rows[0];
      assert.deepEqual(
        catalog.rows.map((x: any) => x.code),
        ["launch", "growth", "premium", "advanced"],
      );
      await db.exec("reset role");
      const deal = await db.query<any>(
        "insert into public.px_deals(rep_id,business_id,package_id,package_name,price_cents,commission_cents,sale_xp,customer_email) values($1,$2,$3,$4,$5,$6,100,'customer@example.test') returning id",
        [
          rep,
          claimed.id,
          pkg.id,
          pkg.name,
          pkg.price_cents,
          pkg.commission_cents,
        ],
      );
      await actor(db, owner, "aal2");
      const updated = await rpc(db, "px_action", "package_settings", {
        ...pkg,
        name: "Launch refreshed",
        price_cents: 89900,
        commission_cents: 15000,
        reason: "Update prospective prices",
      });
      assert.notEqual(updated.id, pkg.id);
      const old = await db.query<any>(
        "select * from public.px_deals where id=$1",
        [deal.rows[0].id],
      );
      assert.equal(old.rows[0].price_cents, 79900);
      assert.equal(old.rows[0].commission_cents, 12500);
      await assert.rejects(
        rpc(db, "px_action", "package_settings", { ...pkg, display_order: 40 }),
        /changed|order/,
      );
      await actor(db, rep);
      await assert.rejects(
        rpc(db, "px_action", "package_settings", { ...pkg }),
        /administrator/,
      );
    },
  );
  await t.test(
    "delayed webhooks use the historical catalog; retries retain the original commission",
    async () => {
      await db.exec("reset role");
      await db.exec(
        "update public.px_packages set created_at=now()-interval '2 days',retired_at=now()-interval '1 day' where code='launch' and version=1; update public.px_packages set created_at=now()-interval '1 day' where code='launch' and version=2",
      );
      await actor(db, owner, "aal2");
      await rpc(db, "px_action", "sales_code_save", {
        id: second,
        code: "OPS2",
      });
      const sale = {
        payment_intent: "pi_ops_historical",
        checkout_id: "cs_ops_historical",
        charge_id: "ch_ops_historical",
        event_id: "evt_ops_historical",
        event_type: "checkout.session.completed",
        currency: "usd",
        package_code: "launch",
        promotion_code: "OPS2",
        promotion_code_id: "promo_ops",
        discount_valid: true,
        subtotal_cents: 79900,
        discount_cents: 1598,
        amount_cents: 78302,
        refunded_cents: 0,
        disputed: false,
        settled: true,
        available_at: new Date().toISOString(),
        paid_at: new Date(Date.now() - 36 * 3600000).toISOString(),
      };
      await service(db);
      const saved = await rpc(db, "px_service", "verified_sale", sale);
      assert.equal(saved.attribution, "attributed");
      assert.equal(
        (await rpc(db, "px_service", "verified_sale", sale)).duplicate,
        true,
      );
      await db.exec("reset role");
      const snapshot = (
        await db.query<any>(
          "select package_name,commission_cents from public.px_verified_sales where id=$1",
          [saved.sale_id],
        )
      ).rows[0];
      assert.equal(snapshot.package_name, "Launch");
      assert.equal(snapshot.commission_cents, 12500);
      assert.equal(
        (
          await db.query<any>(
            "select count(*)::int n from public.px_commissions where sale_id=$1",
            [saved.sale_id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "support configuration is dynamic, validated and admin-only",
    async () => {
      await actor(db, owner, "aal2");
      const card = {
        card_id: "discord",
        title: "Rep community",
        description: "Meet the team",
        type: "link",
        url: "https://discord.com/invite/pixelalty",
        email: "",
        button_text: "Open Discord",
        qr_path: "",
        qr_alt: "",
        display_order: 15,
        active: true,
        icon: "users",
      };
      await rpc(db, "px_action", "support_card_save", card);
      await actor(db, rep);
      assert.ok(
        (await rpc(db, "px_report", "support_hub")).rows.some(
          (r: any) => r.id === "discord",
        ),
      );
      await assert.rejects(
        rpc(db, "px_action", "support_card_save", card),
        /administrator/,
      );
      await actor(db, owner, "aal2");
      await assert.rejects(
        rpc(db, "px_action", "support_card_save", {
          ...card,
          url: "javascript:alert(1)",
        }),
        /HTTPS/,
      );
      await rpc(db, "px_action", "support_card_save", {
        ...card,
        active: false,
      });
      await actor(db, rep);
      assert.ok(
        !(await rpc(db, "px_report", "support_hub")).rows.some(
          (r: any) => r.id === "discord",
        ),
      );
      await actor(db, owner, "aal2");
      await rpc(db, "px_action", "support_card_delete", card);
    },
  );
  await t.test(
    "QR cleanup cannot remove referenced media or race a card save",
    async () => {
      const path = "support/" + crypto.randomUUID() + ".png";
      await db.exec("reset role");
      await db.query(
        "insert into storage.objects(bucket_id,name,created_at) values('pixelalty-profile-media',$1,now()-interval '2 days')",
        [path],
      );
      const card = {
        card_id: "cleanup-test",
        title: "QR test",
        type: "link",
        url: "https://pixelalty.com/",
        button_text: "Open",
        qr_path: path,
        qr_alt: "Pixelalty QR",
        display_order: 99,
        active: true,
        icon: "globe",
      };
      await actor(db, owner, "aal2");
      await rpc(db, "px_action", "support_card_save", card);
      await service(db);
      assert.ok(
        !(await rpc(db, "px_service", "support_media_cleanup")).includes(path),
      );
      await actor(db, owner, "aal2");
      await rpc(db, "px_action", "support_card_delete", card);
      await service(db);
      assert.ok(
        (await rpc(db, "px_service", "support_media_cleanup")).includes(path),
      );
      await actor(db, owner, "aal2");
      await assert.rejects(
        rpc(db, "px_action", "support_card_save", card),
        /retired|upload/i,
      );
      await service(db);
      await assert.rejects(
        rpc(db, "px_service", "support_media_removed", { path }),
        /storage removal/,
      );
      await db.exec("reset role");
      await db.query("delete from storage.objects where name=$1", [path]);
      await service(db);
      await rpc(db, "px_service", "support_media_removed", { path });
      assert.deepEqual(
        await rpc(db, "px_service", "support_media_cleanup"),
        [],
      );
    },
  );
  await t.test(
    "single and bulk deletion are real, idempotent and preserve protected deal evidence",
    async () => {
      await actor(db, owner, "aal2");
      const all = await db.query<any>(
        "select id from public.px_businesses where import_id=$1 order by id",
        [batch.id],
      );
      const ordinary = all.rows
        .filter((r) => r.id !== claimed.id)
        .slice(0, 2)
        .map((r) => r.id);
      const request = {
        ids: [claimed.id, ...ordinary],
        request_id: crypto.randomUUID(),
        confirmation: "DELETE 3 LEADS",
        reason: "Remove selected demos",
      };
      const first = await rpc(db, "px_action", "leads_delete", request);
      assert.deepEqual(
        {
          deleted: first.deleted,
          protected: first.protected,
          failed: first.failed,
        },
        { deleted: 2, protected: 1, failed: 0 },
      );
      assert.deepEqual(
        await rpc(db, "px_action", "leads_delete", request),
        first,
      );
      await db.exec("reset role");
      assert.equal(
        (
          await db.query<any>(
            "select count(*)::int n from public.px_businesses where id=any($1::uuid[])",
            [ordinary],
          )
        ).rows[0].n,
        0,
      );
      const evidence = (
        await db.query<any>(
          "select name,phone,deleted_at from public.px_businesses where id=$1",
          [claimed.id],
        )
      ).rows[0];
      assert.equal(evidence.name, "Removed business");
      assert.equal(evidence.phone, "");
      assert.ok(evidence.deleted_at);
      assert.equal(
        (
          await db.query<any>(
            "select count(*)::int n from public.px_deals where business_id=$1",
            [claimed.id],
          )
        ).rows[0].n,
        1,
      );
      await actor(db, second);
      assert.equal((await rpc(db, "px_report", "available_leads")).total, 22);
      await assert.rejects(
        rpc(db, "px_action", "leads_delete", request),
        /administrator/,
      );
      await assert.rejects(
        rpc(db, "px_report", "business", { id: claimed.id }),
        /removed/,
      );
    },
  );
  await t.test(
    "archive preserves a lead and removes it from the shared pool",
    async () => {
      await actor(db, second);
      const row = (await rpc(db, "px_report", "available_leads")).rows[0];
      await actor(db, owner, "aal2");
      await rpc(db, "px_action", "leads_archive", {
        ids: [row.id],
        reason: "Archive demo",
      });
      assert.equal(
        (
          await db.query<any>(
            "select archived from public.px_businesses where id=$1",
            [row.id],
          )
        ).rows[0].archived,
        true,
      );
      await actor(db, second);
      assert.equal((await rpc(db, "px_report", "available_leads")).total, 21);
    },
  );
  await t.test(
    "deleted reps immediately lose access while account history remains readable by Admin",
    async () => {
      await actor(db, owner, "aal2");
      const target = (
        await db.query<any>("select code from public.px_reps where id=$1", [
          rep,
        ])
      ).rows[0];
      await rpc(db, "px_action", "account_delete_begin", {
        id: rep,
        confirmation: "DELETE " + target.code,
        reason: "Delete demo account",
      });
      const history = await rpc(db, "px_report", "deleted_account", {
        id: rep,
      });
      assert.equal(history.account.former_name, "Rep");
      assert.equal(history.deals.length, 1);
      assert.ok(
        (await rpc(db, "px_report", "deleted_accounts")).rows.some(
          (r: any) => r.id === rep,
        ),
      );
      await actor(db, rep);
      await assert.rejects(
        rpc(db, "px_report", "available_leads"),
        /session has ended/,
      );
      await actor(db, second);
      await assert.rejects(
        rpc(db, "px_report", "deleted_accounts"),
        /administrator/,
      );
    },
  );
  await t.test(
    "request diagnostics preserve the redacted root error and action",
    async () => {
      await service(db);
      const id = crypto.randomUUID();
      await rpc(db, "px_service", "diagnostic", {
        id,
        user_id: owner,
        route: "/api/import/preview",
        status: 500,
        category: "UNEXPECTED_ERROR",
        action: "import_preview",
        error_type: "TypeError",
        provider_detail:
          "Cannot read properties of undefined (reading 'sheets')",
        safe_context: { extension: "xlsx", bytes: 10844 },
      });
      await actor(db, owner, "aal2");
      const saved = (
        await db.query<any>("select * from px_diagnostics where id=$1", [id])
      ).rows[0];
      assert.equal(saved.action, "import_preview");
      assert.equal(saved.safe_context.bytes, 10844);
      assert.match(saved.provider_detail, /sheets/);
      await actor(db, second);
      assert.equal(
        (await db.query("select * from px_diagnostics")).rows.length,
        0,
      );
    },
  );
});
