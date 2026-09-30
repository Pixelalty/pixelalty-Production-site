import type { SupabaseClient } from "@supabase/supabase-js";
import { client, rpc } from "./db";
import { HttpError, type Env } from "./types";

export const RECORDINGS_BUCKET = "call-recordings";

export async function recordingUrl(
  env: Env,
  db: SupabaseClient,
  id: string,
  download = false,
) {
  if (!/^[0-9a-f-]{36}$/i.test(id))
    throw new HttpError(404, "Recording not found.");
  const access = await rpc(db, "px_action", {
    action: "recording_access",
    p: { id, download },
  });
  const extension =
    access.mime_type === "audio/ogg"
      ? "ogg"
      : access.mime_type === "audio/mp4"
        ? "mp4"
        : "webm";
  const result = await client(env, undefined, true)
    .storage.from(RECORDINGS_BUCKET)
    .createSignedUrl(
      access.object_key,
      download ? 300 : 3600,
      download
        ? { download: `pixelalty-call-recording.${extension}` }
        : undefined,
    );
  if (result.error || !result.data?.signedUrl)
    throw new HttpError(
      502,
      "This recording is temporarily unavailable. Please try again.",
      "RECORDING_PLAYBACK_UNAVAILABLE",
    );
  return {
    url: result.data.signedUrl,
    expires_in: download ? 300 : 3600,
    mime_type: access.mime_type,
  };
}

export async function deleteRecording(
  env: Env,
  db: SupabaseClient,
  p: Record<string, unknown>,
) {
  const reservation = await rpc(db, "px_action", {
    action: "recording_delete_begin",
    p,
  });
  const admin = client(env, undefined, true);
  const removed = await admin.storage
    .from(RECORDINGS_BUCKET)
    .remove([reservation.object_key]);
  if (removed.error) {
    await rpc(db, "px_action", {
      action: "recording_delete_restore",
      p: { id: reservation.id },
    });
    throw new HttpError(
      502,
      "The recording was not deleted. Nothing was changed; please retry.",
      "RECORDING_DELETE_FAILED",
    );
  }
  await rpc(db, "px_action", {
    action: "recording_delete_complete",
    p: { id: reservation.id },
  });
  return { deleted: true };
}
