import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFStream,
  ParseSpeeds,
  type PDFObject,
} from "pdf-lib";
import { client, rpc } from "./db";
import { HttpError, type Env } from "./types";

export const TAX_BUCKET = "pixelalty-tax-documents";
export const TAX_MAX_BYTES = 5 * 1024 * 1024;
const invalid = () =>
  new HttpError(
    400,
    "Choose a readable PDF of your completed, signed W-9 (up to 5 MB). For an interactive form, use Print → Save as PDF and check that your entries and signature are visible. Passwords, scripts and attachments are not accepted.",
  );

// Parse structure without rendering, evaluating scripts, extracting form fields,
// or rewriting the signed bytes. Filenames and tax values are never recorded.
export async function validateTaxPdf(bytes: Uint8Array, contentType: string) {
  if (bytes.byteLength > TAX_MAX_BYTES)
    throw new HttpError(413, "Your PDF must be 5 MB or smaller.");
  if (
    contentType.split(";")[0].trim().toLowerCase() !== "application/pdf" ||
    bytes.byteLength < 100 ||
    !/^%PDF-(?:1\.[0-7]|2\.0)/.test(
      new TextDecoder().decode(bytes.subarray(0, 12)),
    ) ||
    !/%%EOF\s*$/.test(new TextDecoder().decode(bytes.subarray(-2048)))
  )
    throw invalid();
  try {
    const pdf = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
      throwOnInvalidObject: true,
      parseSpeed: ParseSpeeds.Slow,
      capNumbers: true,
    });
    if (pdf.isEncrypted || pdf.getPageCount() < 1 || pdf.getPageCount() > 20)
      throw invalid();
    const forbidden = new Set([
      "JS",
      "JavaScript",
      "AA",
      "OpenAction",
      "EmbeddedFiles",
      "EmbeddedFile",
      "EF",
      "Launch",
      "RichMedia",
      "XFA",
      "Movie",
      "Sound",
      "SubmitForm",
      "ImportData",
      "GoToR",
    ]);
    const pending: PDFObject[] = pdf.context
      .enumerateIndirectObjects()
      .map(([, value]) => value);
    const seen = new Set<PDFObject>();
    while (pending.length) {
      const value = pending.pop()!;
      if (seen.has(value)) continue;
      seen.add(value);
      if (seen.size > 30000) throw invalid();
      if (value instanceof PDFName && forbidden.has(value.decodeText()))
        throw invalid();
      if (value instanceof PDFStream) pending.push(value.dict);
      else if (value instanceof PDFDict) {
        for (const [key, child] of value.entries()) {
          if (forbidden.has(key.decodeText())) throw invalid();
          pending.push(child);
        }
      } else if (value instanceof PDFArray) pending.push(...value.asArray());
    }
  } catch {
    throw invalid();
  }
}

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
  await validateTaxPdf(bytes, contentType);
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
