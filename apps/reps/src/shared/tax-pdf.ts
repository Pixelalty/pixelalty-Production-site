import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFStream,
  ParseSpeeds,
  type PDFObject,
} from "pdf-lib";
export class TaxPdfError extends Error {
  constructor(
    public status: number,
    message: string,
    public category = "TAX_PDF_INVALID",
  ) {
    super(message);
  }
}

export const TAX_MAX_BYTES = 5 * 1024 * 1024;
export const INTERACTIVE_PDF_MESSAGE =
  "This appears to be the interactive IRS form. After completing it, choose Print → Save as PDF, then upload the newly saved PDF.";
const invalid = () =>
  new TaxPdfError(
    400,
    "Choose a readable PDF of your completed, signed W-9 (up to 5 MB). For an interactive form, use Print → Save as PDF and check that your entries and signature are visible. Passwords, scripts and attachments are not accepted.",
  );

// Parse structure without rendering, evaluating scripts, extracting form fields,
// or rewriting the signed bytes. Filenames and tax values are never recorded.
export async function validateTaxPdf(bytes: Uint8Array, contentType: string) {
  if (bytes.byteLength > TAX_MAX_BYTES)
    throw new TaxPdfError(413, "Your PDF must be 5 MB or smaller.");
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
    const openAction = pdf.catalog.lookup(PDFName.of("OpenAction"));
    if (openAction) {
      const destination =
        openAction instanceof PDFArray ? openAction.asArray() : [];
      if (
        !(destination[0] instanceof PDFRef) ||
        !(destination[1] instanceof PDFName) ||
        ![
          "Fit",
          "FitH",
          "FitV",
          "FitR",
          "FitB",
          "FitBH",
          "FitBV",
          "XYZ",
        ].includes(destination[1].decodeText()) ||
        !pdf
          .getPages()
          .some((page) => page.ref.toString() === destination[0].toString())
      )
        throw invalid();
    }
    const form = pdf.catalog.lookup(PDFName.of("AcroForm"));
    const names = pdf.catalog.lookup(PDFName.of("Names"));
    if (
      (form instanceof PDFDict && form.has(PDFName.of("XFA"))) ||
      (names instanceof PDFDict && names.has(PDFName.of("JavaScript")))
    )
      throw new TaxPdfError(
        400,
        INTERACTIVE_PDF_MESSAGE,
        "TAX_PDF_INTERACTIVE",
      );
    const pending: PDFObject[] = pdf.context
      .enumerateIndirectObjects()
      .map(([, value]) => value);
    const seen = new Set<PDFObject>();
    while (pending.length) {
      const value = pending.pop()!;
      if (seen.has(value)) continue;
      seen.add(value);
      if (seen.size > 30000) throw invalid();
      if (value instanceof PDFName && forbidden.has(value.decodeText())) {
        if (["XFA", "JavaScript", "JS"].includes(value.decodeText()))
          throw new TaxPdfError(
            400,
            INTERACTIVE_PDF_MESSAGE,
            "TAX_PDF_INTERACTIVE",
          );
        throw invalid();
      }
      if (value instanceof PDFStream) pending.push(value.dict);
      else if (value instanceof PDFDict) {
        for (const [key, child] of value.entries()) {
          if (["XFA", "JS", "JavaScript"].includes(key.decodeText()))
            throw new TaxPdfError(
              400,
              INTERACTIVE_PDF_MESSAGE,
              "TAX_PDF_INTERACTIVE",
            );
          if (forbidden.has(key.decodeText())) throw invalid();
          pending.push(child);
        }
      } else if (value instanceof PDFArray) pending.push(...value.asArray());
    }
  } catch (error) {
    if (error instanceof TaxPdfError) throw error;
    throw invalid();
  }
}
