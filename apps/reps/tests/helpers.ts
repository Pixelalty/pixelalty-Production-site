import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
// Local stand-in for Supabase's Storage schema; object bytes are supplied by
// the integration transport. Access-control tests exercise real PostgreSQL RLS.
export const storageSchema = `create schema storage;
create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb default '{}',unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
grant all on storage.buckets to service_role;`;
export async function database() {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;`,
  );
  await db.exec(
    `create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;grant usage on schema auth to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;`,
  );
  await db.exec(storageSchema);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".sql")).sort())
    await db.exec(await readFile(new URL(f, dir), "utf8"));
  return db;
}
export async function actor(db: PGlite, id: string, aal = "aal1") {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: id, role: "authenticated", aal }),
  ]);
  await db.exec("set role authenticated");
}
export async function service(db: PGlite) {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claims',$1,false)`, [
    '{"role":"service_role"}',
  ]);
  await db.exec("set role service_role");
}
export async function rpc(
  db: PGlite,
  fn: string,
  action: string,
  p: unknown = {},
) {
  const q = await db.query<{ result: any }>(
    `select public.${fn}($1,$2::jsonb) result`,
    [action, JSON.stringify(p)],
  );
  return q.rows[0].result;
}

// SQL-only Storage boundary fixture; HTTP tests separately validate actual PDFs.
export async function submitTaxFixture(db: PGlite, repId: string) {
  await actor(db, repId);
  const doc = await rpc(db, "px_tax", "upload_begin", {
    request_id: crypto.randomUUID(),
    bytes: 200,
    sha256: "a".repeat(64),
  });
  await service(db);
  await db.query(
    "insert into storage.objects(bucket_id,name) values('pixelalty-tax-documents',$1)",
    [doc.object_key],
  );
  await db.query("select public.px_tax_complete($1::jsonb)", [
    JSON.stringify({ id: doc.id }),
  ]);
  return doc;
}
