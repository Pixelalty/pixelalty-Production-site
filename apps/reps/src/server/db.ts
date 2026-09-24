import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type Env, HttpError } from "./types";
import type { Row } from "../shared/core";
export function client(env: Env, token?: string, admin = false) {
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_PUBLISHABLE_KEY ||
    (admin && !env.SUPABASE_SERVICE_ROLE_KEY)
  )
    throw new HttpError(
      503,
      "Pixelalty is temporarily unavailable. Please try again later.",
    );
  return createClient(
    env.SUPABASE_URL,
    admin ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: token
        ? { headers: { Authorization: `Bearer ${token}` } }
        : undefined,
    },
  );
}
export async function rpc(db: SupabaseClient, name: string, args: Row = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    if (error.code === "42501")
      throw new HttpError(
        403,
        "This action is not available for your account.",
      );
    if (
      error.code === "P0001" &&
      error.message.length < 260 &&
      !/supabase|schema|relation|constraint|px_|SQLSTATE|service_role/i.test(
        error.message,
      )
    )
      throw new HttpError(403, error.message);
    if (["23505", "23514", "22023", "22P02", "22003"].includes(error.code))
      throw new HttpError(
        409,
        "The request conflicts with the current data or contains an invalid value.",
      );
    console.error("database_error", error.code);
    throw new HttpError(
      500,
      "This change could not be saved. Please try again or contact Pixelalty support.",
    );
  }
  return data;
}
export async function identity(req: Request, env: Env) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token) throw new HttpError(401, "Sign in to continue.");
  const db = client(env, token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user)
    throw new HttpError(401, "Your session has expired. Sign in again.");
  return { db, user: data.user, token };
}
export function service(env: Env, action: string, p: Row) {
  return rpc(client(env, undefined, true), "px_service", { action, p });
}
