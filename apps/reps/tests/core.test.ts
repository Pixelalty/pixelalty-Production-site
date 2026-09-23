import test from "node:test";
import assert from "node:assert/strict";
import {
  PACKAGES,
  normalizePhone,
  normalizeDomain,
  normalizeLead,
  callingWindow,
  csvCell,
} from "../src/shared/core";
import { parseUpload } from "../src/server/importer";
import ExcelJS from "exceljs";
test("default commissions remain exact, including Advanced", () => {
  assert.deepEqual(
    PACKAGES.map((p) => [p.price, p.commission]),
    [
      [79900, 12500],
      [129900, 25000],
      [199900, 40000],
      [299900, 60000],
    ],
  );
});
test("lead normalization preserves meaningful identifiers and rejects unsafe input", () => {
  assert.equal(normalizePhone("(212) 555-0100"), "+12125550100");
  assert.equal(normalizeDomain("https://www.example.com/path"), "example.com");
  assert.throws(() => normalizePhone("call tomorrow"));
  assert.throws(() => normalizeDomain("javascript:alert(1)"));
  assert.throws(() =>
    normalizeLead(
      { Business: "Example", Phone: "2125550100" },
      { name: "Business", phone: "Phone" },
      "",
    ),
  );
  assert.equal(
    normalizeLead(
      { Business: "Example", Phone: "2125550100" },
      { name: "Business", phone: "Phone" },
      "America/New_York",
    ).timezone,
    "America/New_York",
  );
});
test("call windows handle DST, weekends, and unknown configuration", () => {
  assert.equal(
    callingWindow("America/New_York", true, new Date("2026-07-06T13:00Z"))
      .allowed,
    true,
  );
  assert.equal(
    callingWindow("America/New_York", true, new Date("2026-01-05T13:00Z"))
      .allowed,
    false,
  );
  assert.equal(
    callingWindow("America/New_York", true, new Date("2026-07-05T15:00Z"))
      .allowed,
    false,
  );
  assert.equal(callingWindow("Unknown", true).allowed, false);
  assert.equal(callingWindow("UTC").allowed, false);
});
test("spreadsheet exports neutralize formula injection", () => {
  for (const s of ["=1+1", "+SUM(A1)", "  @evil", "\t-123"])
    assert.match(csvCell(s), /^"'/);
  assert.equal(csvCell('a"b'), '"a""b"');
});
test("CSV parser handles quoted commas and rejects unsupported formats", async () => {
  const x = await parseUpload(
    "leads.csv",
    new TextEncoder().encode('Business,Phone\n"One, Two",2125550100'),
  );
  assert.equal(x.rows[0].Business, "One, Two");
  await assert.rejects(
    parseUpload("old.xls", new Uint8Array()),
    /Convert older/,
  );
  await assert.rejects(
    parseUpload("bomb.xlsx", new Uint8Array([0, 0])),
    /invalid/,
  );
  await assert.rejects(
    parseUpload("big.csv", new Uint8Array(9 * 1024 * 1024)),
    /smaller/,
  );
});
test("XLSX import reads worksheet values and marks formulas for row rejection", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Leads");
  sheet.addRow(["Business", "Phone"]);
  sheet.addRow(["Example café", "2125550100"]);
  const valid = await parseUpload(
    "leads.xlsx",
    new Uint8Array(await workbook.xlsx.writeBuffer()),
  );
  assert.equal(valid.rows[0].Business, "Example café");
  sheet.getCell("A2").value = { formula: "1+1", result: 2 };
  const formula = await parseUpload(
    "formula.xlsx",
    new Uint8Array(await workbook.xlsx.writeBuffer()),
  );
  assert.equal(formula.rows[0].Business, "#FORMULA_NOT_ALLOWED");
});
