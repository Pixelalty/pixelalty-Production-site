import { z } from "zod";
import { client, identity, rpc, service } from "./db";
import { type Env, HttpError } from "./types";
import {
  canonicalLocation,
  deploymentUrls,
  mutationOriginAllowed,
} from "./urls";
import { drainMail, mailConfigured } from "./mail";
import { downloadTax, TAX_MAX_BYTES, uploadTax } from "./tax";
import {
  checkout,
  connectAccount,
  webhook,
  transfer,
  reverse,
  reconcile,
  reconcilePayment,
  stripe,
} from "./payments";
import { parseUpload } from "./importer";
import {
  csv,
  header,
  normalizeLead,
  normalizePhone,
  type Row,
} from "../shared/core";
const json = (value: unknown, status = 200) => Response.json(value, { status });
async function bytes(req: Request, max: number) {
  if (Number(req.headers.get("content-length")) > max)
    throw new HttpError(413, "Request is too large.");
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, "Request is too large.");
    }
    chunks.push(r.value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
async function body(req: Request, max = 64 * 1024): Promise<Row> {
  try {
    return z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(new TextDecoder().decode(await bytes(req, max))));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "Invalid request body.");
  }
}
const TABLES = [
  "reps",
  "rep_private",
  "teams",
  "roles",
  "applicants",
  "applicant_notes",
  "businesses",
  "calls",
  "followups",
  "deals",
  "packages",
  "content",
  "training",
  "agreements",
  "connect",
  "connect_requests",
  "commissions",
  "commission_events",
  "payments",
  "transfer_requests",
  "reversal_requests",
  "payouts",
  "stripe_events",
  "notifications",
  "support",
  "audit",
  "imports",
  "import_rows",
  "saved_views",
  "dnc",
  "fulfillment",
  "jobs",
  "settings",
  "notes",
  "favorites",
  "assignments",
  "focus_sessions",
  "quote_requests",
];
const application = z.object({
  name: z.string().trim().min(2).max(150),
  preferred_name: z.string().trim().max(100).optional(),
  email: z.email().max(254),
  phone: z.string().min(10).max(30),
  state: z.string().min(2).max(100),
  country: z.string().min(2).max(100),
  timezone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }),
  age_confirmed: z.literal(true),
  compensation_ack: z.literal(true),
  outbound_ready: z.boolean(),
  computer: z.boolean(),
  internet: z.boolean(),
  headset: z.boolean(),
  experience: z.string().max(3000),
  cold_calling_experience: z.string().max(2000).optional(),
  customer_service_experience: z.string().max(2000).optional(),
  availability: z.coerce.number().min(1).max(80),
  motivation: z.string().min(10).max(3000),
  token: z.string().min(1),
  website: z.string().optional(),
});
async function api(req: Request, env: Env) {
  const u = new URL(req.url),
    path = u.pathname,
    post = req.method === "POST";
  if (path.startsWith("/api/webhooks/")) {
    if (!post) throw new HttpError(405, "POST required.");
    return json(
      await webhook(
        env,
        new TextDecoder().decode(await bytes(req, 1024 * 1024)),
        req.headers.get("stripe-signature") || "",
        path.endsWith("/connect"),
      ),
    );
  }
  if (!["GET", "POST"].includes(req.method))
    throw new HttpError(405, "Method not allowed.");
  if (post && !mutationOriginAllowed(req, env, path))
    throw new HttpError(403, "This request must come from the application.");
  if (path === "/api/config") {
    const urls = deploymentUrls(env, req.url);
    return json({
      appUrl: urls.app,
      recruitingUrl: urls.recruiting,
      publicRecruitingHost:
        u.origin === urls.recruitingOrigin && u.origin !== urls.app,
      supabaseUrl: env.SUPABASE_URL || "",
      publishableKey: env.SUPABASE_PUBLISHABLE_KEY || "",
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
      mode: env.STRIPE_MODE || "test",
      configured: !!(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY),
    });
  }
  if (path === "/api/recruiting")
    return json(await rpc(client(env), "px_public_config"));
  if (path === "/api/apply" && post) {
    if (!env.TURNSTILE_SECRET_KEY)
      throw new HttpError(
        503,
        "Applications are not configured yet. Please return later.",
      );
    const parsed = application.safeParse(await body(req));
    if (!parsed.success)
      throw new HttpError(400, "Complete all required application fields.");
    const p = parsed.data;
    try {
      p.phone = normalizePhone(p.phone);
    } catch {
      throw new HttpError(400, "Enter a valid phone number with country code.");
    }
    if (p.website) return json({ received: true });
    const captcha = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: p.token,
          remoteip: req.headers.get("cf-connecting-ip"),
        }),
      },
    );
    const result = (await captcha.json()) as Row;
    if (
      !result.success ||
      result.hostname !== u.hostname ||
      result.action !== "apply"
    )
      throw new HttpError(
        400,
        "Please complete the verification and try again.",
      );
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(req.headers.get("cf-connecting-ip") || "local"),
    );
    const ip_hash = Array.from(new Uint8Array(digest), (x) =>
      x.toString(16).padStart(2, "0"),
    ).join("");
    const { token: _token, website: _website, ...details } = p;
    return json(
      await service(env, "application", {
        name: p.name,
        email: p.email,
        details,
        ip_hash,
      }),
    );
  }
  const { db, user } = await identity(req, env);
  if (path === "/api/me") return json(await rpc(db, "px_context"));
  if (path === "/api/report")
    return json(
      await rpc(db, "px_report", {
        kind: u.searchParams.get("kind") || "dashboard",
        p: Object.fromEntries(u.searchParams),
      }),
    );
  if (path === "/api/table") {
    const table = u.searchParams.get("name") || "";
    if (!TABLES.includes(table)) throw new HttpError(404, "Table not found.");
    if (table === "businesses" && u.searchParams.get("own") === "true")
      return json(
        await rpc(db, "px_report", {
          kind: "leads",
          p: Object.fromEntries(u.searchParams),
        }),
      );
    const page = Math.floor(
      Math.max(0, Math.min(10000, Number(u.searchParams.get("page")) || 0)),
    );
    const joins: Record<string, string> = {
      applicants: "*,rep:px_reps(code,status)",
      followups: "*,business:px_businesses(name,code)",
      calls: "*,business:px_businesses(name,code)",
      deals: "*,business:px_businesses(name,code)",
      quote_requests:
        "*,business:px_businesses(name,code),rep:px_reps(name,code)",
      commissions:
        "*,deal:px_deals(code,package_name,price_cents,business:px_businesses(name))",
      fulfillment:
        "*,deal:px_deals(code,package_name,business:px_businesses(name))",
    };
    let q = db
      .from("px_" + table)
      .select(joins[table] || "*", { count: "exact" });
    const order = [
      "roles",
      "settings",
      "rep_private",
      "connect",
      "connect_requests",
    ].includes(table)
      ? ["settings"].includes(table)
        ? "id"
        : ["rep_private", "connect", "connect_requests"].includes(table)
          ? "rep_id"
          : "user_id"
      : table === "import_rows"
        ? "row_num"
        : table === "payouts"
          ? "updated_at"
          : "created_at";
    const sort = u.searchParams.get("sort");
    const sortable: Record<string, string[]> = {
      businesses: ["name", "stage", "created_at", "expires_at"],
      reps: ["name", "code", "status", "created_at"],
      applicants: ["name", "stage", "created_at"],
      followups: ["due_at", "created_at"],
      deals: ["code", "price_cents", "stage", "created_at"],
      content: ["title", "kind", "created_at"],
    };
    q = q
      .order(sort && sortable[table]?.includes(sort) ? sort : order, {
        ascending:
          table === "import_rows" || u.searchParams.get("direction") === "asc",
      })
      .range(page * 50, page * 50 + 49);
    if (
      ![
        "roles",
        "settings",
        "rep_private",
        "connect",
        "connect_requests",
        "import_rows",
        "favorites",
      ].includes(table)
    )
      q = q.order("id", { ascending: true });
    for (const [param, column] of [
      ["id", "id"],
      ["rep", "rep_id"],
      ["business", "business_id"],
      ["batch", "batch_id"],
      ["applicant", "applicant_id"],
      ["status", "status"],
      ["kind", "kind"],
      ["stage", "stage"],
      ["owner", "owner_id"],
      ["import", "import_id"],
      ["state", "state"],
      ["industry", "industry"],
    ] as const) {
      const v = u.searchParams.get(param);
      if (v) q = q.eq(column, v);
    }
    if (u.searchParams.has("active"))
      q = q.eq("active", u.searchParams.get("active") === "true");
    if (table === "businesses") {
      if (u.searchParams.get("available") === "true")
        q = q
          .is("owner_id", null)
          .eq("dnc", false)
          .eq("customer", false)
          .eq("archived", false)
          .eq("bad_number", false);
      if (u.searchParams.get("queue") === "true")
        q = q
          .eq("dnc", false)
          .eq("customer", false)
          .eq("archived", false)
          .eq("bad_number", false)
          .neq("stage", "lost")
          .gt("expires_at", new Date().toISOString());
      if (u.searchParams.get("favorite") === "true") {
        const favorites = await db
          .from("px_favorites")
          .select("business_id")
          .eq("rep_id", user.id);
        if (favorites.error)
          throw new HttpError(500, "Favorites could not be loaded.");
        q = q.in(
          "id",
          favorites.data.map((r) => r.business_id),
        );
      }
    }
    if (table === "followups" && u.searchParams.get("due") === "true")
      q = q.lte("due_at", new Date().toISOString());
    if (u.searchParams.get("own") === "true")
      q = q.eq(
        table === "businesses"
          ? "owner_id"
          : table === "reps"
            ? "id"
            : "rep_id",
        user.id,
      );
    const search = u.searchParams
      .get("q")
      ?.replace(/[^\p{L}\p{N}\s-]/gu, "")
      .slice(0, 100);
    if (search && ["businesses", "reps", "applicants"].includes(table))
      q = q.or(`name.ilike.%${search}%,code.ilike.%${search}%`);
    if (search && table === "content")
      q = q.or(`title.ilike.%${search}%,body.ilike.%${search}%`);
    if (search && table === "deals") q = q.ilike("code", `%${search}%`);
    const result = await q;
    if (result.error) throw new HttpError(400, "Unable to load this view.");
    const rows = (result.data as Row[]).map((r) => ({
      ...r,
      business_name: r.business?.name || r.deal?.business?.name || r.data?.name,
      phone: r.phone || r.data?.phone,
      rep_name: r.rep?.name,
      rep_code: r.rep?.code,
      rep_status: r.rep?.status,
      deal_code: r.deal?.code,
      package_name: r.package_name || r.deal?.package_name,
      sale_cents: r.deal?.price_cents,
    }));
    return json({ rows, total: result.count, page });
  }
  if (path === "/api/action" && post) {
    const p = await body(req, 256 * 1024);
    const result = await rpc(db, "px_action", {
      action: p.action,
      p: p.p || {},
    });
    if (p.action === "agreement")
      await service(env, "agreement_receipt", {
        rep_id: user.id,
        content_id: p.p.content_id,
        ip: req.headers.get("cf-connecting-ip") || null,
      });
    return json(result);
  }
  if (path === "/api/tax" && !post)
    return json(
      await rpc(db, "px_tax", {
        action: "summary",
        p: { rep_id: u.searchParams.get("rep") || user.id },
      }),
    );
  if (path === "/api/tax/upload" && post)
    return json(
      await uploadTax(
        env,
        db,
        await bytes(req, TAX_MAX_BYTES),
        req.headers.get("content-type") || "",
        req.headers.get("x-upload-id") || "",
      ),
    );
  if (path === "/api/tax/document" && post) {
    const p = await body(req);
    if (!z.uuid().safeParse(p.id).success)
      throw new HttpError(400, "Select a tax document.");
    return downloadTax(env, db, p.id);
  }
  if (path === "/api/tax/review" && post) {
    const p = await body(req);
    if (
      !["start_review", "verify", "request_correction", "archive"].includes(
        p.action,
      )
    )
      throw new HttpError(400, "Choose a review action.");
    return json(await rpc(db, "px_tax", { action: p.action, p }));
  }
  if (path === "/api/approve" && post) {
    const p = await body(req);
    const app = await rpc(db, "px_action", { action: "approval_begin", p });
    if (app.rep_id) return json({ rep_id: app.rep_id });
    try {
      const admin = client(env, undefined, true);
      let account = await service(env, "approval_identity", {
        applicant_id: app.id,
      });
      if (!account?.user_id) {
        const invited = await admin.auth.admin.inviteUserByEmail(app.email, {
          redirectTo: `${deploymentUrls(env, req.url).app}/welcome`,
        });
        if (invited.error || !invited.data.user)
          throw new HttpError(
            502,
            "Invitation could not be sent. Check email delivery configuration, then retry.",
          );
        account = { user_id: invited.data.user.id };
      }
      return json(
        await service(env, "approval_complete", {
          applicant_id: app.id,
          user_id: account.user_id,
        }),
      );
    } catch (e) {
      await service(env, "approval_error", { id: app.id });
      throw e;
    }
  }
  if (path === "/api/invite/resend" && post) {
    const recipient = await rpc(db, "px_mail", {
      action: "resend_begin",
      p: await body(req),
    });
    const result = await client(
      env,
      undefined,
      true,
    ).auth.resetPasswordForEmail(recipient.email, {
      redirectTo: deploymentUrls(env, req.url).app + "/recover",
    });
    if (result.error)
      throw new HttpError(
        502,
        "The setup email could not be sent. Please try again or contact Pixelalty support.",
      );
    return json({ sent: true });
  }
  if (path === "/api/checkout" && post) {
    const p = await body(req);
    return json(await checkout(env, db, user.id, p.id));
  }
  if (path === "/api/connect" && post) {
    const p = await body(req);
    return json(await connectAccount(env, db, user.id, !!p.refresh));
  }
  if (path === "/api/transfer" && post)
    return json(await transfer(env, db, await body(req)));
  if (path === "/api/reverse" && post)
    return json(await reverse(env, db, await body(req)));
  if (path === "/api/reconcile" && post)
    return json(await reconcile(env, db, await body(req)));
  if (path === "/api/import/preview" && post) {
    const ctx = await rpc(db, "px_context");
    if (
      ctx.aal !== "aal2" ||
      !ctx.roles.some((x: string) => ["owner", "sales_admin"].includes(x))
    )
      throw new HttpError(403, "Sales administration and MFA are required.");
    const raw = await bytes(req, 9 * 1024 * 1024),
      form = await new Request(req.url, {
        method: "POST",
        headers: req.headers,
        body: raw,
      }).formData(),
      file = form.get("file");
    if (!file || typeof file === "string")
      throw new HttpError(400, "Choose a file.");
    const parsed = await parseUpload(
      file.name,
      new Uint8Array(await file.arrayBuffer()),
    );
    return json({ ...parsed, filename: file.name });
  }
  if (path === "/api/import/prepare" && post) {
    const p = await body(req, 12 * 1024 * 1024),
      rows = p.rows as Row[],
      mapping = p.mapping as Record<string, string>;
    if (
      !Array.isArray(rows) ||
      rows.length < 1 ||
      rows.length > 25000 ||
      !mapping?.name ||
      !mapping?.phone ||
      new Set(Object.values(mapping).filter(Boolean)).size !==
        Object.values(mapping).filter(Boolean).length
    )
      throw new HttpError(400, "Choose distinct columns for name and phone.");
    const batch = await rpc(db, "px_action", {
      action: "import_start",
      p: {
        filename: p.filename,
        mapping,
        total: rows.length,
        reason: "Stage mapped business import",
      },
    });
    for (let i = 0; i < rows.length; i += 250) {
      const staged = rows.slice(i, i + 250).map((r, j) => {
        try {
          if (
            Object.values(r).some((v) => String(v) === "#FORMULA_NOT_ALLOWED")
          )
            throw Error("Formulas are not imported. Paste values first.");
          return {
            row_num: i + j + 1,
            data: normalizeLead(r, mapping, p.defaultZone || ""),
          };
        } catch (e) {
          return {
            row_num: i + j + 1,
            data: {},
            error: e instanceof Error ? e.message : "Invalid row",
          };
        }
      });
      await rpc(db, "px_action", {
        action: "import_stage",
        p: {
          id: batch.id,
          rows: staged,
          reason: "Stage validated import rows",
        },
      });
    }
    return json(batch);
  }
  if (path === "/api/import/start" && post) {
    const p = await body(req);
    const mapping = z.record(z.string(), z.string()).parse(p.mapping);
    if (
      !mapping.name ||
      !mapping.phone ||
      new Set(Object.values(mapping).filter(Boolean)).size !==
        Object.values(mapping).filter(Boolean).length
    )
      throw new HttpError(
        400,
        "Map distinct columns for business name and phone.",
      );
    return json(
      await rpc(db, "px_action", {
        action: "import_start",
        p: {
          filename: p.filename,
          total: p.total,
          mapping: {
            ...mapping,
            _batch_tag:
              typeof p.batchTag === "string" ? p.batchTag.slice(0, 100) : "",
            _default_zone: p.defaultZone || "",
            _fingerprint: p.fingerprint || "",
          },
          reason: "Start reviewed spreadsheet import",
        },
      }),
    );
  }
  if (path === "/api/import/stage" && post) {
    const p = await body(req, 1024 * 1024);
    const existing = await db
      .from("px_imports")
      .select("*")
      .eq("id", p.id)
      .single();
    if (existing.error) throw new HttpError(404, "Import not found.");
    const batch = existing.data;
    if (["ready", "complete"].includes(batch.status))
      return json({ staged: batch.total });
    if (
      !Array.isArray(p.rows) ||
      p.rows.length > 250 ||
      !Number.isInteger(p.offset) ||
      p.offset < 0 ||
      p.offset + p.rows.length > batch.total
    )
      throw new HttpError(400, "Invalid import chunk.");
    const rows = p.rows.map((r: Row, j: number) => {
      try {
        if (Object.values(r).some((v) => String(v) === "#FORMULA_NOT_ALLOWED"))
          throw Error("Formulas are not imported. Paste values first.");
        return {
          row_num: p.offset + j + 1,
          data: normalizeLead(
            r,
            batch.mapping,
            batch.mapping._default_zone || "",
          ),
        };
      } catch (e) {
        return {
          row_num: p.offset + j + 1,
          data: {},
          error: (e as Error).message,
        };
      }
    });
    await rpc(db, "px_action", {
      action: "import_stage",
      p: { id: p.id, rows, reason: "Stage validated import chunk" },
    });
    return json({ staged: p.offset + rows.length });
  }
  if (path === "/api/export/businesses") {
    await rpc(db, "px_action", {
      action: "export",
      p: { reason: "Export authorized business records" },
    });
    const rows: Row[] = [];
    for (let offset = 0; offset < 10000; offset += 1000) {
      const r = await db
        .from("px_businesses")
        .select(
          "code,name,phone,domain,email,timezone,city,state,industry,stage,source",
        )
        .order("id")
        .range(offset, offset + 999);
      if (r.error) throw new HttpError(500, "Export could not be completed.");
      rows.push(...r.data);
      if (r.data.length < 1000) break;
    }
    const columns = [
      "code",
      "name",
      "phone",
      "domain",
      "email",
      "timezone",
      "city",
      "state",
      "industry",
      "stage",
      "source",
    ];
    return new Response(
      csv([columns, ...rows.map((r) => columns.map((c) => r[c]))]),
      {
        headers: {
          "content-type": "text/csv",
          "content-disposition":
            'attachment; filename="pixelalty-businesses.csv"',
        },
      },
    );
  }
  if (path === "/api/import/template")
    return new Response(
      csv([
        [
          "Business Name",
          "Phone",
          "Website",
          "Email",
          "Timezone",
          "City",
          "State",
          "Industry",
          "Contact",
          "Notes",
        ],
      ]),
      {
        headers: {
          "content-type": "text/csv",
          "content-disposition":
            'attachment; filename="pixelalty-import-template.csv"',
        },
      },
    );
  if (path === "/api/import/report") {
    const batch = u.searchParams.get("id");
    await rpc(db, "px_action", {
      action: "export",
      p: { id: batch, reason: "Download import validation report" },
    });
    let rows: Row[] = [];
    for (let i = 0; i < 25000; i += 1000) {
      const r = await db
        .from("px_import_rows")
        .select("*")
        .eq("batch_id", batch)
        .order("row_num")
        .range(i, i + 999);
      if (r.error) throw new HttpError(500, "Report could not be loaded.");
      rows = rows.concat(r.data);
      if (r.data.length < 1000) break;
    }
    return new Response(
      csv([
        ["Row", "Status", "Reason"],
        ...rows.map((r) => [r.row_num, r.status, r.error || ""]),
      ]),
      {
        headers: {
          "content-type": "text/csv",
          "content-disposition":
            'attachment; filename="pixelalty-import-report.csv"',
        },
      },
    );
  }
  if (path === "/api/health") {
    const ctx = await rpc(db, "px_context");
    if (ctx.aal !== "aal2" || !ctx.roles.includes("owner"))
      throw new HttpError(403, "Owner access with MFA is required.");
    return json({
      database: true,
      payments: !!env.STRIPE_SECRET_KEY,
      webhooks: !!env.STRIPE_WEBHOOK_SECRET,
      connectWebhooks: !!env.STRIPE_CONNECT_WEBHOOK_SECRET,
      applicationProtection: !!env.TURNSTILE_SECRET_KEY,
      mode: env.STRIPE_MODE,
      automaticTransfers: false,
      calling: ctx.settings.calling_enabled,
      brandedNotifications: mailConfigured(env),
      emailDelivery: await rpc(db, "px_mail", { action: "summary", p: {} }),
    });
  }
  throw new HttpError(404, "API route not found.");
}
export default {
  async fetch(
    req: Request,
    env: Env,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    let response: Response;
    const requestId = crypto.randomUUID();
    try {
      const u = new URL(req.url),
        urls = deploymentUrls(env, req.url);
      const recruitingHost =
        u.origin === urls.recruitingOrigin && u.origin !== urls.app;
      const internalUi =
        u.hostname.endsWith(".workers.dev") &&
        u.origin !== urls.app &&
        ["GET", "HEAD"].includes(req.method) &&
        !/^\/(api|assets|fonts)(\/|$)/.test(u.pathname) &&
        !/\.[a-z0-9]{1,8}$/i.test(u.pathname);
      if (
        recruitingHost &&
        u.pathname.startsWith("/api/") &&
        !["/api/config", "/api/recruiting", "/api/apply"].includes(u.pathname)
      )
        throw new HttpError(404, "This page is not available here.");
      if (internalUi) {
        const recruiting = ["/apply", "/apply/"].includes(u.pathname);
        response = Response.redirect(
          canonicalLocation(
            u,
            recruiting ? urls.recruiting : urls.app,
            recruiting ? new URL(urls.recruiting).pathname : u.pathname,
          ),
          302,
        );
      } else if (
        recruitingHost &&
        !["/", "/apply", "/apply/"].includes(u.pathname) &&
        !/^\/(api|assets|fonts)\//.test(u.pathname)
      )
        response = Response.redirect(canonicalLocation(u, urls.app), 302);
      else if (
        u.origin === urls.app &&
        ["/apply", "/apply/"].includes(u.pathname) &&
        urls.recruitingOrigin !== urls.app
      )
        response = Response.redirect(urls.recruiting, 302);
      else
        response = u.pathname.startsWith("/api/")
          ? await api(req, env)
          : await env.ASSETS.fetch(req);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500)
        console.error(
          "request_failed",
          requestId,
          e instanceof Error ? e.name : "Error",
        );
      response = json(
        {
          error:
            e instanceof HttpError
              ? e.message
              : "The operation could not be completed. Try again or contact support.",
          requestId,
        },
        status,
      );
    }
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Frame-Options", "DENY");
    if (new URL(req.url).protocol === "https:")
      headers.set(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    headers.set("X-Request-ID", requestId);
    headers.set("Cache-Control", "no-store");
    if (!headers.has("Content-Security-Policy"))
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.supabase.co; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      );
    const currentUrl = new URL(req.url);
    if (
      currentUrl.pathname !== "/apply" &&
      !(
        env.RECRUITING_URL &&
        URL.canParse(env.RECRUITING_URL) &&
        currentUrl.origin === new URL(env.RECRUITING_URL).origin &&
        currentUrl.pathname === "/"
      )
    )
      headers.set("X-Robots-Tag", "noindex, nofollow");
    if (
      ctx &&
      req.method === "POST" &&
      response.ok &&
      ["/api/action", "/api/approve"].includes(currentUrl.pathname)
    )
      ctx.waitUntil(
        drainMail(env).catch(() => console.error("mail_queue_unavailable")),
      );
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        await service(env, "tick", {});
        await drainMail(env, 10).catch(() =>
          console.error("mail_queue_unavailable"),
        );
        const db = client(env, undefined, true),
          payments = await db
            .from("px_payments")
            .select("payment_intent")
            .eq("settled", false)
            .limit(20);
        if (payments.error)
          throw Error("Scheduled reconciliation query failed");
        if (payments.data.length && env.STRIPE_SECRET_KEY) {
          const s = stripe(env);
          for (const p of payments.data)
            try {
              await reconcilePayment(
                env,
                s,
                p.payment_intent,
                `scheduled:${crypto.randomUUID()}`,
                "scheduled.reconciliation",
              );
            } catch {
              console.error("scheduled_payment_reconciliation_failed");
            }
        }
      })(),
    );
  },
};
export { header };
