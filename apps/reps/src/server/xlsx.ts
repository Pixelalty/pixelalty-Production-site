import JSZip from "jszip";
import { SaxesParser, type SaxesTagNS } from "saxes";
import { HttpError } from "./types";

const sheetNS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const strictNS = "http://purl.oclc.org/ooxml/spreadsheetml/main";
const fail = () =>
  new HttpError(
    400,
    "This workbook could not be read. Save it as a new XLSX or CSV file and try again.",
    "IMPORT_WORKBOOK_INVALID",
  );

// Read values, never evaluate formulas or follow external relationships. XML
// namespace URIs matter, not a producer's choice of prefix (x:, s:, or none).
function xml(
  source: string,
  open: (tag: SaxesTagNS) => void,
  text: (value: string) => void,
  close: (tag: SaxesTagNS) => void,
) {
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => {
    throw fail();
  });
  parser.on("error", () => {
    throw fail();
  });
  parser.on("opentag", open);
  parser.on("text", text);
  parser.on("cdata", text);
  parser.on("closetag", close);
  parser.write(source).close();
}
function attr(tag: SaxesTagNS, name: string) {
  return (
    Object.values(tag.attributes).find((a) => a.local === name)?.value || ""
  );
}
const spreadsheet = (tag: SaxesTagNS) => [sheetNS, strictNS].includes(tag.uri);

export async function workbookRows(bytes: Uint8Array): Promise<string[][]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let expanded = 0,
    entries = 0;
  for (let i = 0; i <= bytes.length - 46; i++) {
    if (view.getUint32(i, true) === 0x02014b50) {
      expanded += view.getUint32(i + 24, true);
      entries++;
    }
  }
  if (!entries || entries > 10000 || expanded > 40 * 1024 * 1024)
    throw new HttpError(413, "Workbook is invalid or expands beyond 40 MB.");
  const zip = await JSZip.loadAsync(bytes).catch(() => {
    throw fail();
  });
  const read = async (path: string) => {
    const file = zip.file(path);
    if (!file) throw fail();
    const value = await file.async("string");
    if (value.length > 40 * 1024 * 1024) throw fail();
    return value;
  };
  let sheetId = "";
  xml(
    await read("xl/workbook.xml"),
    (tag) => {
      if (spreadsheet(tag) && tag.local === "sheet" && !sheetId)
        sheetId = attr(tag, "id");
    },
    () => {},
    () => {},
  );
  let sheetPath = "";
  xml(
    await read("xl/_rels/workbook.xml.rels"),
    (tag) => {
      if (
        tag.local === "Relationship" &&
        attr(tag, "Id") === sheetId &&
        attr(tag, "TargetMode") !== "External"
      ) {
        const target = attr(tag, "Target");
        if (!/^(?:\/)?(?:xl\/)?worksheets\/[\w.-]+\.xml$/.test(target))
          throw fail();
        sheetPath = target.startsWith("/")
          ? target.slice(1)
          : target.startsWith("xl/")
            ? target
            : "xl/" + target;
      }
    },
    () => {},
    () => {},
  );
  if (!sheetPath) throw fail();
  const strings: string[] = [];
  if (zip.file("xl/sharedStrings.xml")) {
    let value = "",
      inText = false;
    xml(
      await read("xl/sharedStrings.xml"),
      (tag) => {
        if (!spreadsheet(tag)) return;
        if (tag.local === "si") value = "";
        if (tag.local === "t") inText = true;
      },
      (text) => {
        if (inText) value += text;
      },
      (tag) => {
        if (!spreadsheet(tag)) return;
        if (tag.local === "t") inText = false;
        if (tag.local === "si") strings.push(value);
      },
    );
  }
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    cellType = "",
    column = 0,
    capture = false,
    formula = false,
    count = 0;
  xml(
    await read(sheetPath),
    (tag) => {
      if (!spreadsheet(tag)) return;
      if (tag.local === "row") {
        row = [];
        if (rows.length >= 25001)
          throw new HttpError(413, "Import at most 25,000 rows per file.");
      }
      if (tag.local === "c") {
        const ref = attr(tag, "r").match(/^([A-Z]+)\d+$/);
        column = ref
          ? [...ref[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
          : row.length;
        if (column > 255 || ++count > 1000000)
          throw new HttpError(
            413,
            "Workbook contains too many columns or cells.",
          );
        cell = "";
        cellType = attr(tag, "t");
        formula = false;
      }
      if (tag.local === "f") formula = true;
      if (["v", "t"].includes(tag.local)) capture = true;
    },
    (text) => {
      if (capture) cell += text;
    },
    (tag) => {
      if (!spreadsheet(tag)) return;
      if (["v", "t"].includes(tag.local)) capture = false;
      if (tag.local === "c") {
        row[column] = formula
          ? "#FORMULA_NOT_ALLOWED"
          : cellType === "s"
            ? (strings[Number(cell)] ?? "")
            : cell;
      }
      if (tag.local === "row" && row.some((value) => value.trim()))
        rows.push(row);
    },
  );
  return rows;
}
