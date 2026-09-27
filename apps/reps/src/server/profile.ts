import type { SupabaseClient } from "@supabase/supabase-js";
import { client, rpc } from "./db";
import { HttpError, type Env } from "./types";
import { inspectProfileImage } from "../shared/profile-media";

export const PROFILE_BUCKET = "pixelalty-profile-media";
export async function expireProfileMedia(env: Env) {
  const reps = await rpc(client(env, undefined, true), "px_profile_service", {
    action: "expire",
    p: {},
  });
  for (const repId of reps) await cleanupProfileMedia(env, repId);
}
export async function cleanupProfileMedia(env: Env, repId: string) {
  const admin = client(env, undefined, true);
  const pending = await rpc(admin, "px_profile_service", {
    action: "cleanup",
    p: { rep_id: repId },
  });
  for (const asset of pending) {
    const result = await admin.storage
      .from(PROFILE_BUCKET)
      .remove([asset.object_key, asset.static_key]);
    if (result.error)
      throw new HttpError(
        502,
        "The image was hidden, but file removal needs a retry.",
      );
    await rpc(admin, "px_profile_service", {
      action: "removed",
      p: { id: asset.id },
    });
  }
}
export async function uploadProfileMedia(
  env: Env,
  db: SupabaseClient,
  userId: string,
  form: FormData,
) {
  const file = form.get("image"),
    still = form.get("still"),
    kind = form.get("kind");
  if (
    !(file instanceof File) ||
    !(still instanceof File) ||
    !["avatar", "banner"].includes(String(kind))
  )
    throw new HttpError(400, "Choose an image and a profile placement.");
  const original = new Uint8Array(await file.arrayBuffer()),
    preview = new Uint8Array(await still.arrayBuffer());
  let info;
  try {
    info = inspectProfileImage(original, file.type, file.name);
    const staticInfo = inspectProfileImage(preview, still.type, still.name);
    if (
      staticInfo.mime !== "image/png" ||
      staticInfo.animated ||
      staticInfo.width > 1600 ||
      staticInfo.height > 1600
    )
      throw Error(
        "The static image preview is invalid. Select the image again.",
      );
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  const asset = await rpc(db, "px_profile", {
    action: "reserve",
    p: { kind, ...info, bytes: original.length },
  });
  const admin = client(env, undefined, true);
  try {
    const put = await admin.storage
      .from(PROFILE_BUCKET)
      .upload(asset.object_key, original, {
        contentType: info.mime,
        upsert: false,
      });
    if (put.error) throw Error("Image upload failed.");
    const thumb = await admin.storage
      .from(PROFILE_BUCKET)
      .upload(asset.static_key, preview, {
        contentType: "image/png",
        upsert: false,
      });
    if (thumb.error) throw Error("Image preview upload failed.");
    return await rpc(admin, "px_profile_service", {
      action: "complete",
      p: { id: asset.id },
    });
  } catch {
    await rpc(db, "px_profile", { action: "remove", p: { id: asset.id } });
    await cleanupProfileMedia(env, userId);
    throw new HttpError(
      502,
      "Your image was not saved. Please try uploading it again.",
    );
  }
}
export async function readProfileMedia(
  env: Env,
  db: SupabaseClient,
  id: string,
  still: boolean,
) {
  if (!/^[a-f0-9-]{36}$/i.test(id))
    throw new HttpError(404, "Image not found.");
  const asset = await rpc(db, "px_profile", { action: "asset", p: { id } });
  const result = await client(env, undefined, true)
    .storage.from(PROFILE_BUCKET)
    .download(still ? asset.static_key : asset.object_key);
  if (result.error || !result.data)
    throw new HttpError(404, "This profile image is unavailable.");
  return new Response(result.data, {
    headers: {
      "Content-Type": still ? "image/png" : asset.mime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
