import Papa from "papaparse";
import { workbookRows } from "./xlsx";
import { HttpError } from "./types";
import type { Row } from "../shared/core";
export async function parseUpload(name: string, bytes: Uint8Array) {
  if (bytes.length > 8 * 1024 * 1024)
    throw new HttpError(413, "Use a file smaller than 8 MB.");
  let headers: string[], rows: Row[];
  if (/\.xlsx$/i.test(name)) {
    const data = await workbookRows(bytes);
    headers = Array.from(data[0] || [], (v) => (v || "").trim());
    rows = data
      .slice(1)
      .map((values) =>
        Object.fromEntries(
          headers.map((h, i) => [h, (values[i] || "").trim()]),
        ),
      );
  } else if (/\.(csv|tsv)$/i.test(name)) {
    const parsed = Papa.parse<Row>(new TextDecoder().decode(bytes), {
      header: true,
      skipEmptyLines: "greedy",
      delimiter: /\.tsv$/i.test(name) ? "\t" : "",
      transformHeader: (h) => h.trim(),
    });
    if (parsed.errors.length)
      throw new HttpError(
        400,
        "CSV has inconsistent columns or malformed quotes.",
      );
    headers = parsed.meta.fields || [];
    rows = parsed.data;
  } else
    throw new HttpError(
      400,
      "Upload .csv, .tsv, or .xlsx. Convert older .xls files to .xlsx first.",
    );
  if (
    !headers.length ||
    headers.some((h) => !h) ||
    new Set(headers).size !== headers.length
  )
    throw new HttpError(400, "Column headers must be nonempty and unique.");
  if (!rows.length || rows.length > 25000)
    throw new HttpError(400, "A file must contain 1–25,000 business rows.");
  return { headers, rows };
}
