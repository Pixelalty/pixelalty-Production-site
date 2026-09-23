import { z } from "zod";
import { client, identity, rpc, service } from "./db";
import { type Env, HttpError } from "./types";
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
import { csv, header, normalizeLead, type Row } from "../shared/core";
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
];
const application = z.object({
  name: z.string().trim().min(2).max(150),
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
  if (
    post &&
    (!env.APP_URL || req.headers.get("origin") !== new URL(env.APP_URL).origin)
  )
    throw new HttpError(403, "This request must come from the application.");
  if (path === "/api/config")
    return json({
      supabaseUrl: env.SUPABASE_URL || "",
      publishableKey: env.SUPABASE_PUBLISHABLE_KEY || "",
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
      mode: env.STRIPE_MODE || "test",
      configured: !!(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY),
    });
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
      result.hostname !== new URL(env.APP_URL).hostname ||
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
        p: { id: u.searchParams.get("id") },
      }),
    );
  if (path === "/api/table") {
    const table = u.searchParams.get("name") || "";
    if (!TABLES.includes(table)) throw new HttpError(404, "Table not found.");
    const page = Math.max(
      0,
      Math.min(10000, Number(u.searchParams.get("page")) || 0),
    );
    let q = db.from("px_" + table).select("*", { count: "exact" });
    const order = ["roles", "settings", "rep_private", "connect"].includes(
      table,
    )
      ? ["settings"].includes(table)
        ? "id"
        : ["rep_private", "connect"].includes(table)
          ? "rep_id"
          : "user_id"
      : table === "import_rows"
        ? "row_num"
        : table === "payouts"
          ? "updated_at"
          : "created_at";
    q = q
      .order(order, { ascending: table === "import_rows" })
      .range(page * 50, page * 50 + 49);
    for (const [param, column] of [
      ["id", "id"],
      ["rep", "rep_id"],
      ["business", "business_id"],
      ["batch", "batch_id"],
      ["applicant", "applicant_id"],
      ["status", "status"],
      ["kind", "kind"],
      ["stage", "stage"],
    ] as const) {
      const v = u.searchParams.get(param);
      if (v) q = q.eq(column, v);
    }
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
      q = q.ilike("name", `%${search}%`);
    const result = await q;
    if (result.error) throw new HttpError(400, "Unable to load this view.");
    return json({ rows: result.data, total: result.count, page });
  }
  if (path === "/api/action" && post) {
    const p = await body(req, 256 * 1024);
    return json(await rpc(db, "px_action", { action: p.action, p: p.p || {} }));
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
          redirectTo: `${env.APP_URL}/onboarding`,
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
    });
  }
  throw new HttpError(404, "API route not found.");
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let response: Response;
    const requestId = crypto.randomUUID();
    try {
      response = new URL(req.url).pathname.startsWith("/api/")
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
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("X-Frame-Options", "DENY");
    headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    headers.set("X-Request-ID", requestId);
    headers.set("Cache-Control", "no-store");
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.supabase.co; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    if (new URL(req.url).pathname !== "/apply")
      headers.set("X-Robots-Tag", "noindex, nofollow");
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        await service(env, "tick", {});
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
