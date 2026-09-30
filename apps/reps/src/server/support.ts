import type { SupabaseClient } from "@supabase/supabase-js";
import { inspectProfileImage } from "../shared/profile-media";
import { client, rpc, service } from "./db";
import { PROFILE_BUCKET } from "./profile";
import { HttpError, type Env } from "./types";

export async function requireSupportAdmin(db: SupabaseClient) {
  const ctx = await rpc(db, "px_context");
  if (
    ctx.aal !== "aal2" ||
    !ctx.roles.some((r: string) =>
      ["owner", "sales_admin", "support"].includes(r),
    )
  )
    throw new HttpError(
      403,
      "Support administration and verification are required.",
    );
}
export async function uploadSupportImage(
  env: Env,
  db: SupabaseClient,
  form: FormData,
) {
  await requireSupportAdmin(db);
  const file = form.get("image");
  if (!(file instanceof File) || file.size > 2 * 1024 * 1024)
    throw new HttpError(400, "Choose a PNG, JPEG or WebP QR image up to 2 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let info;
  try {
    info = inspectProfileImage(bytes, file.type, file.name);
    if (
      info.animated ||
      !["image/png", "image/jpeg", "image/webp"].includes(info.mime) ||
      info.width > 1600 ||
      info.height > 1600
    )
      throw Error(
        "Use a static PNG, JPEG or WebP image up to 1600 × 1600 pixels.",
      );
  } catch (cause) {
    throw new HttpError(400, (cause as Error).message);
  }
  const key = `support/${crypto.randomUUID()}.${info.mime === "image/png" ? "png" : info.mime === "image/jpeg" ? "jpg" : "webp"}`;
  const result = await client(env, undefined, true)
    .storage.from(PROFILE_BUCKET)
    .upload(key, bytes, { contentType: info.mime, upsert: false });
  if (result.error)
    throw new HttpError(
      502,
      "The QR image could not be uploaded. Please retry.",
    );
  return { path: key };
}
export async function removeSupportImage(
  env: Env,
  db: SupabaseClient,
  key: string,
) {
  if (!/^support\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(key)) return;
  const reservation = await rpc(db, "px_action", {
    action: "support_media_retire",
    p: { path: key },
  });
  if (!reservation.removable) return;
  const result = await client(env, undefined, true)
    .storage.from(PROFILE_BUCKET)
    .remove([key]);
  if (result.error)
    throw new HttpError(
      502,
      "The support settings are saved. Old-image cleanup will retry automatically.",
    );
  await service(env, "support_media_removed", { path: key });
}
export async function readSupportImage(
  env: Env,
  db: SupabaseClient,
  cardId: string,
) {
  const settings = await rpc(db, "px_report", { kind: "support_hub", p: {} });
  const card = settings.rows.find((r: { id: string }) => r.id === cardId);
  if (!card?.qr_path?.startsWith("support/"))
    throw new HttpError(404, "QR image not found.");
  const result = await client(env, undefined, true)
    .storage.from(PROFILE_BUCKET)
    .download(card.qr_path);
  if (result.error || !result.data)
    throw new HttpError(404, "QR image is unavailable.");
  return new Response(result.data, {
    headers: {
      "Content-Type": result.data.type,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

export async function cleanupSupportMedia(env: Env) {
  const paths: string[] = await service(env, "support_media_cleanup", {});
  for (const path of paths) {
    const result = await client(env, undefined, true)
      .storage.from(PROFILE_BUCKET)
      .remove([path]);
    if (!result.error) await service(env, "support_media_removed", { path });
  }
}
