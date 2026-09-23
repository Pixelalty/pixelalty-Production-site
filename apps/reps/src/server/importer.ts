import Papa from "papaparse";
import ExcelJS from "exceljs";
import { HttpError } from "./types";
import type { Row } from "../shared/core";
export async function parseUpload(name: string, bytes: Uint8Array) {
  if (bytes.length > 8 * 1024 * 1024)
    throw new HttpError(413, "Use a file smaller than 8 MB.");
  let headers: string[] = [],
    rows: Row[] = [];
  if (/\.xlsx$/i.test(name)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let expanded = 0,
      entries = 0;
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        expanded += view.getUint32(i + 24, true);
        entries++;
      }
    }
    if (!entries || entries > 10000 || expanded > 40 * 1024 * 1024)
      throw new HttpError(413, "Workbook is invalid or expands beyond 40 MB.");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as any);
    const sheet = book.worksheets[0];
    if (!sheet) throw new HttpError(400, "No worksheet found.");
    if (sheet.rowCount > 25001)
      throw new HttpError(413, "Import at most 25,000 rows per file.");
    sheet.eachRow((row, n) => {
      const vals = Array.from({ length: row.cellCount }, (_, i) => {
        const v = row.getCell(i + 1);
        if (v.type === ExcelJS.ValueType.Formula) return "#FORMULA_NOT_ALLOWED";
        return v.text.trim();
      });
      if (n === 1) headers = vals;
      else
        rows.push(
          Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""])),
        );
    });
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
