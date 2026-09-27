import type { SupabaseClient } from "@supabase/supabase-js";
import { client, rpc } from "./db";
import { HttpError, type Env } from "./types";
import { validateTaxPdf, TaxPdfError } from "../shared/tax-pdf";
export { validateTaxPdf, TAX_MAX_BYTES } from "../shared/tax-pdf";
export const TAX_BUCKET = "pixelalty-tax-documents";

export async function uploadTax(
  env: Env,
  db: SupabaseClient,
  bytes: Uint8Array,
  contentType: string,
  requestId: string,
) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      requestId,
    )
  )
    throw new HttpError(400, "Start a new document upload and try again.");
  try {
    await validateTaxPdf(bytes, contentType);
  } catch (e) {
    if (e instanceof TaxPdfError)
      throw new HttpError(e.status, e.message, e.category);
    throw e;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  const sha256 = Array.from(new Uint8Array(digest), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
  const reservation = await rpc(db, "px_tax", {
    action: "upload_begin",
    p: { request_id: requestId, bytes: bytes.byteLength, sha256 },
  });
  if (["archived", "failed"].includes(reservation.status))
    throw new HttpError(
      409,
      "This upload attempt is no longer current. Select your PDF again to submit it for a new review.",
    );
  if (reservation.status !== "uploading") return { status: reservation.status };
  const admin = client(env, undefined, true);
  const result = await admin.storage
    .from(TAX_BUCKET)
    .upload(reservation.object_key, bytes, {
      contentType: "application/pdf",
      cacheControl: "0",
      upsert: false,
    });
  // A retry may find the immutable object from a successful upload whose response
  // was lost. Its database reservation already matched the exact content hash.
  if (
    result.error &&
    String((result.error as { statusCode?: string }).statusCode) !== "409"
  )
    throw new HttpError(
      502,
      "Your document could not be stored. Keep this page open and retry the same file.",
      "TAX_STORAGE_WRITE",
    );
  return rpc(admin, "px_tax_complete", { p: { id: reservation.id } });
}

export async function downloadTax(env: Env, db: SupabaseClient, id: string) {
  const access = await rpc(db, "px_tax", {
    action: "download_authorize",
    p: { id },
  });
  const { data, error } = await client(env, undefined, true)
    .storage.from(TAX_BUCKET)
    .download(access.object_key);
  if (error || !data)
    throw new HttpError(
      502,
      "This document could not be downloaded. Please try again.",
    );
  await rpc(db, "px_tax", { action: "download", p: { id } });
  return new Response(data, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition":
        'attachment; filename="pixelalty-tax-document.pdf"',
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}
