import type { SupabaseClient } from "@supabase/supabase-js";
import type { Row } from "../shared/core";
import { client, rpc } from "./db";
import { HttpError, type Env } from "./types";
import { TAX_BUCKET } from "./tax";
import { deploymentUrls } from "./urls";
import { cleanupProfileMedia } from "./profile";

export async function deleteAccount(env: Env, db: SupabaseClient, p: Row) {
  const prepared = await rpc(db, "px_action", {
    action: p.purge === true ? "account_purge_begin" : "account_delete_begin",
    p,
  });
  if (prepared.status === "complete")
    return { deleted: true, mode: prepared.mode };
  const admin = client(env, undefined, true);
  await cleanupProfileMedia(env, p.id);
  const keys = await rpc(admin, "px_account_cleanup_files", {
    p: { id: p.id },
  });
  if (keys.length) {
    const removed = await admin.storage.from(TAX_BUCKET).remove(keys);
    if (removed.error)
      throw new HttpError(
        502,
        "Access is revoked. Private document cleanup needs a retry; use Delete Account again.",
        "ACCOUNT_FILE_CLEANUP",
      );
  }
  const removed = await admin.auth.admin.deleteUser(p.id);
  if (removed.error && removed.error.status !== 404)
    throw new HttpError(
      502,
      "Access is revoked. Account deletion needs a retry; use Delete Account again.",
      "ACCOUNT_AUTH_DELETE",
    );
  return rpc(admin, "px_account_complete", { p: { id: p.id } });
}
export async function resetAccountPassword(
  env: Env,
  db: SupabaseClient,
  p: Row,
) {
  const context = await rpc(db, "px_context");
  if (context.aal !== "aal2" || !context.roles.includes("owner"))
    throw new HttpError(403, "Owner access with MFA is required.");
  const target = await db
    .from("px_rep_private")
    .select("email")
    .eq("rep_id", p.id)
    .single();
  if (target.error || !target.data?.email)
    throw new HttpError(404, "Account not found.");
  await rpc(db, "px_action", { action: "account_revoke", p });
  const result = await client(env, undefined, true).auth.resetPasswordForEmail(
    target.data.email,
    { redirectTo: deploymentUrls(env, env.APP_URL).app + "/recover" },
  );
  if (result.error)
    throw new HttpError(
      502,
      "Sessions were revoked, but the reset email could not be sent. Please retry.",
      "ACCOUNT_RESET_EMAIL",
    );
  return { sent: true };
}
