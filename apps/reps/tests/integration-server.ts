// Isolated integration transport. Runs production Worker/UI/SQL unchanged.
// Supabase Auth, PostgREST HTTP, Turnstile and Stripe are local provider boundaries;
// passing this suite does not certify external credentials, SMTP or hosted webhooks.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { database } from "./helpers";
import worker from "../src/server/index";
import type { Env } from "../src/server/types";
export async function startIntegration() {
  const userMetadata = new Map<string, Record<string, unknown>>();
  const db = await database(),
    owner = crypto.randomUUID(),
    rep = crypto.randomUUID(),
    newRep = crypto.randomUUID();
  const users = [
    { id: owner, email: "owner@example.test", name: "Owner", role: "owner" },
    { id: rep, email: "rep@example.test", name: "Jordan", role: "rep" },
    { id: newRep, email: "new@example.test", name: "Alex", role: "rep" },
  ];
  for (const u of users) {
    await db.query("insert into auth.users values($1,$2,now())", [
      u.id,
      u.email,
    ]);
    if (u.id !== owner) {
      await db.query(
        "insert into public.px_reps(id,name,status,timezone) values($1,$2,$3,'UTC')",
        [u.id, u.name, u.id === newRep ? "onboarding" : "active"],
      );
      await db.query(
        "insert into public.px_rep_private(rep_id,email,classification,tax_status) values($1,$2,'contractor','pending')",
        [u.id, u.email],
      );
    }
  }
  await db.query("insert into public.px_roles values($1,'owner')", [owner]);
  await db.query(
    "insert into public.px_businesses(name,phone,email,timezone,owner_id,expires_at) values ('Beacon Services','+12125550101','buyer@example.test','UTC',$1,now()+interval '14 days'),('Cedar Services','+12125550102','','UTC',$1,now()+interval '14 days'),('Elm Services','+12125550103','','UTC',null,null)",
    [rep],
  );
  let serial = 0;
  const providerCalls: any[] = [],
    realFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init),
      u = new URL(req.url);
    if (u.hostname === "challenges.cloudflare.com")
      return Response.json({
        success: true,
        hostname: "127.0.0.1",
        action: "apply",
      });
    if (u.hostname === "api.stripe.com") {
      const data = new URLSearchParams(await req.text());
      providerCalls.push({
        path: u.pathname,
        data: Object.fromEntries(data),
        method: req.method,
      });
      if (u.pathname === "/v1/checkout/sessions" && req.method === "POST")
        return Response.json({
          id: "cs_test_local_" + ++serial,
          object: "checkout.session",
          url: "https://checkout.stripe.com/c/pay/cs_test_local_" + serial,
          status: "open",
          livemode: false,
        });
      if (u.pathname.startsWith("/v1/checkout/sessions/cs_test_local_"))
        return Response.json({
          id: u.pathname.split("/").at(-1),
          url:
            "https://checkout.stripe.com/c/pay/" + u.pathname.split("/").at(-1),
          status: "open",
          livemode: false,
        });
      return Response.json(
        {
          error: {
            message:
              "Provider operation not configured in this isolated fixture",
          },
        },
        { status: 400 },
      );
    }
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost")
      throw Error(
        "External network prohibited in isolated acceptance tests: " +
          u.hostname,
      );
    return realFetch(input, init);
  };
  let dbQueue: Promise<any> = Promise.resolve();
  const withDb = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = dbQueue.then(fn, fn);
    dbQueue = next.catch(() => {});
    return next;
  };
  const claims = (token: string) => {
    try {
      return JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString(),
      );
    } catch {
      return { role: token === "service_fixture" ? "service_role" : "anon" };
    }
  };
  function session(u: any) {
    const payload = {
      sub: u.id,
      role: "authenticated",
      aal: u.role === "owner" ? "aal2" : "aal1",
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    return {
      access_token:
        Buffer.from("{}").toString("base64url") +
        "." +
        Buffer.from(JSON.stringify(payload)).toString("base64url") +
        ".isolated-test",
      refresh_token: "fixture:" + u.id,
      expires_in: 3600,
      token_type: "bearer",
      user: {
        ...u,
        aud: "authenticated",
        app_metadata: {},
        user_metadata: userMetadata.get(u.id) || {},
        created_at: new Date().toISOString(),
      },
    };
  }
  const env = {
    APP_URL: "",
    SUPABASE_URL: "",
    SUPABASE_PUBLISHABLE_KEY: "public_fixture",
    SUPABASE_SERVICE_ROLE_KEY: "service_fixture",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: "sk_test_local_fixture",
    STRIPE_WEBHOOK_SECRET: "whsec_local_fixture",
    STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_connect_local_fixture",
    TURNSTILE_SITE_KEY: "public-turnstile-fixture",
    TURNSTILE_SECRET_KEY: "secret-turnstile-fixture",
    ASSETS: {
      fetch: async (req: Request) => {
        let p = new URL(req.url).pathname;
        if (!extname(p)) p = "/index.html";
        const base = resolve("dist"),
          file = resolve(base, "." + p);
        if (!file.startsWith(base + "/"))
          return new Response("Not found", { status: 404 });
        try {
          const data = await readFile(file);
          return new Response(data, {
            headers: {
              "content-type":
                (
                  {
                    ".html": "text/html",
                    ".js": "text/javascript",
                    ".css": "text/css",
                    ".woff2": "font/woff2",
                    ".svg": "image/svg+xml",
                  } as any
                )[extname(file)] || "application/octet-stream",
            },
          });
        } catch {
          return new Response("Not found", { status: 404 });
        }
      },
    },
  } as unknown as Env;
  const identifier = (v: string) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(v))
      throw Error("Invalid test SQL identifier");
    return '"' + v + '"';
  };
  const split = (s: string) => {
    const a: string[] = [];
    let depth = 0,
      start = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++;
      if (s[i] === ")") depth--;
      if (s[i] === "," && !depth) {
        a.push(s.slice(start, i));
        start = i + 1;
      }
    }
    a.push(s.slice(start));
    return a;
  };
  async function rest(req: Request, u: URL) {
    return withDb(async () => {
      const token =
          req.headers.get("authorization")?.replace(/^Bearer /i, "") || "",
        c = claims(token);
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify(c),
      ]);
      await db.exec(
        "set role " +
          (c.role === "service_role"
            ? "service_role"
            : c.sub
              ? "authenticated"
              : "anon"),
      );
      try {
        if (u.pathname.includes("/rpc/")) {
          const name = u.pathname.split("/").at(-1)!;
          if (
            ![
              "px_action",
              "px_context",
              "px_report",
              "px_service",
              "px_public_config",
            ].includes(name)
          )
            throw Error("Unknown RPC");
          const p = (await req.json()) as any;
          const args =
            name === "px_context" || name === "px_public_config"
              ? []
              : [p.action || p.kind, p.p || {}];
          const sql = `select public.${name}(${args.length ? "$1,$2::jsonb" : ""}) result`;
          return Response.json((await db.query<any>(sql, args)).rows[0].result);
        }
        const table = u.pathname.split("/").at(-1)!;
        if (!table.startsWith("px_")) throw Error("Unknown table");
        const params: any[] = [],
          where: string[] = [];
        const value = (v: any) => {
          params.push(v);
          return "$" + params.length;
        };
        const filter = (col: string, raw: string) => {
          const dot = raw.indexOf("."),
            op = raw.slice(0, dot),
            v = raw.slice(dot + 1),
            column = "t." + identifier(col);
          if (op === "is")
            return (
              column +
              (v === "null"
                ? " is null"
                : " is " + (v === "true" ? "true" : "false"))
            );
          if (op === "in") {
            const items = v.slice(1, -1).split(",").filter(Boolean);
            return items.length
              ? column +
                  " in (" +
                  items.map((x) => value(x.replace(/^"|"$/g, ""))).join(",") +
                  ")"
              : "false";
          }
          const operators: any = {
            eq: "=",
            neq: "<>",
            gt: ">",
            gte: ">=",
            lt: "<",
            lte: "<=",
            ilike: "ilike",
          };
          if (!operators[op]) throw Error("Unsupported filter " + op);
          return column + " " + operators[op] + " " + value(v);
        };
        for (const [key, v] of u.searchParams)
          if (!["select", "order", "offset", "limit", "or"].includes(key))
            where.push(filter(key, v));
        if (u.searchParams.has("or"))
          where.push(
            "(" +
              split(u.searchParams.get("or")!.slice(1, -1))
                .map((s) => {
                  const dot = s.indexOf(".");
                  return filter(s.slice(0, dot), s.slice(dot + 1));
                })
                .join(" or ") +
              ")",
          );
        const selection = u.searchParams.get("select") || "*";
        function selectExpr(spec: string, alias = "t"): string {
          return split(spec)
            .map((part) => {
              const m = part.match(/^(\w+):(px_\w+)\((.*)\)$/);
              if (m) {
                const [_s, key, target, inner] = m,
                  foreign =
                    target === "px_businesses"
                      ? "business_id"
                      : target === "px_reps"
                        ? "rep_id"
                        : target === "px_deals"
                          ? "deal_id"
                          : "";
                if (!foreign) throw Error("Unsupported test join");
                const nestedAlias = alias + "_" + key;
                return `(select row_to_json(j) from (select ${selectExpr(inner, nestedAlias)} from ${identifier(target)} ${nestedAlias} where ${nestedAlias}.id=${alias}.${foreign}) j) as ${identifier(key)}`;
              }
              return part === "*"
                ? alias + ".*"
                : alias + "." + identifier(part);
            })
            .join(",");
        }
        const w = where.length ? " where " + where.join(" and ") : "",
          count = (
            await db.query<any>(
              `select count(*)::int n from ${identifier(table)} t${w}`,
              params,
            )
          ).rows[0].n;
        const order = split(u.searchParams.get("order") || "")
          .filter(Boolean)
          .map((x) => {
            const [col, direction] = x.split(".");
            return (
              "t." + identifier(col) + (direction === "desc" ? " desc" : " asc")
            );
          })
          .join(",");
        const offset = Math.max(0, Number(u.searchParams.get("offset") || 0)),
          limit = Math.min(
            10000,
            Math.max(0, Number(u.searchParams.get("limit") || 1000)),
          );
        const rows = (
          await db.query<any>(
            `select ${selectExpr(selection)} from ${identifier(table)} t${w}${order ? " order by " + order : ""} limit ${limit} offset ${offset}`,
            params,
          )
        ).rows;
        if (req.headers.get("accept")?.includes("vnd.pgrst.object")) {
          if (rows.length !== 1)
            return Response.json(
              { code: "PGRST116", message: "Expected one row" },
              { status: 406 },
            );
          return Response.json(rows[0]);
        }
        return Response.json(rows, {
          headers: {
            "content-range": `${offset}-${offset + rows.length - 1}/${count}`,
          },
        });
      } catch (e: any) {
        return Response.json(
          { message: e.message, code: e.code || "P0001" },
          { status: 400 },
        );
      } finally {
        await db.exec("reset role");
      }
    });
  }
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const url = env.APP_URL + incoming.url,
        headers = new Headers();
      for (const [k, v] of Object.entries(incoming.headers))
        if (v) headers.set(k, Array.isArray(v) ? v.join(",") : v);
      const req = new Request(url, {
        method: incoming.method,
        headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      const u = new URL(url);
      let response: Response;
      if (u.pathname.startsWith("/rest/v1/")) response = await rest(req, u);
      else if (u.pathname.startsWith("/auth/v1/")) {
        const c = claims(req.headers.get("authorization")?.slice(7) || "");
        if (u.pathname.endsWith("/invite")) {
          const p = (await req.json()) as any;
          const invited = {
            id: crypto.randomUUID(),
            email: p.email,
            name: "Invited Rep",
            role: "rep",
          };
          users.push(invited);
          await withDb(async () => {
            await db.exec("reset role");
            await db.query("insert into auth.users values($1,$2,null)", [
              invited.id,
              invited.email,
            ]);
          });
          response = Response.json(session(invited).user);
        } else if (u.pathname.endsWith("/token")) {
          const p = (await req.json()) as any;
          const person = users.find(
            (x) => x.email === p.email || "fixture:" + x.id === p.refresh_token,
          );
          response =
            person && (!p.password || p.password === "Valid-password-123")
              ? Response.json(session(person))
              : Response.json(
                  {
                    error_code: "invalid_credentials",
                    msg: "Invalid login credentials",
                  },
                  { status: 400 },
                );
        } else if (u.pathname.endsWith("/logout")) response = Response.json({});
        else {
          const person = users.find((x) => x.id === c.sub);
          if (person && u.pathname.endsWith("/user") && req.method === "PUT") {
            const attributes = (await req.json()) as any;
            if (attributes.data)
              userMetadata.set(person.id, {
                ...userMetadata.get(person.id),
                ...attributes.data,
              });
          }
          response = person
            ? Response.json({
                ...session(person).user,
                user: session(person).user,
              })
            : Response.json({ message: "Invalid token" }, { status: 401 });
        }
      } else response = await worker.fetch(req, env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (e: any) {
      outgoing.writeHead(500, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: e.message }));
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address() as any;
  env.APP_URL = env.SUPABASE_URL = "http://127.0.0.1:" + address.port;
  return {
    db,
    base: env.APP_URL,
    owner,
    rep,
    newRep,
    providerCalls,
    session,
    users,
    userMetadata,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      globalThis.fetch = realFetch;
      await db.close();
    },
  };
}
