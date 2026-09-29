import test from "node:test";
import assert from "node:assert/strict";
import {
  importMappingError,
  inspectImport,
  suggestImportMapping,
} from "../src/shared/imports";

test("the actual Pixelalty lead headers map Main Phone instead of the row number", () => {
  const mapping = suggestImportMapping(
    ["name", "phone", "contact", "timezone", "website_assessment"],
    [
      "#",
      "Business Name",
      "Main Phone",
      "Ask For",
      "Timezone",
      "Website Status",
    ],
  );
  assert.deepEqual(mapping, {
    name: "Business Name",
    phone: "Main Phone",
    contact: "Ask For",
    timezone: "Timezone",
    website_assessment: "Website Status",
  });
});

test("imports require explicit business, phone and timezone mapping before staging", () => {
  assert.match(importMappingError({}, ""), /business name/);
  assert.match(importMappingError({ name: "Business" }), /telephone/);
  assert.match(
    importMappingError({ name: "Business", phone: "Phone" }),
    /timezone/,
  );
  assert.match(
    importMappingError({ name: "Business", phone: "Business" }, "UTC"),
    /mapped once/,
  );
  assert.match(
    importMappingError({ name: "Business", phone: "Phone" }, "EST"),
    /valid default timezone/,
  );
  assert.equal(
    importMappingError({ name: "Business", phone: "Phone", timezone: "Zone" }),
    "",
  );
  assert.equal(
    importMappingError(
      { name: "Business", phone: "Phone" },
      "America/New_York",
    ),
    "",
  );
});

test("row-number phone mapping and missing timezone produce actionable preview errors", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    "#": i + 1,
    Business: `Business ${i + 1}`,
    Phone: "2125550123",
  }));
  const missing = inspectImport(rows, { name: "Business", phone: "#" });
  assert.equal(missing.valid, 0);
  assert.equal(missing.invalidPhones, 50);
  assert.match(missing.issues[0].message, /timezone/);
  const wrongPhone = inspectImport(
    rows,
    { name: "Business", phone: "#" },
    "America/New_York",
  );
  assert.equal(wrongPhone.valid, 0);
  assert.match(wrongPhone.issues[0].message, /phone/);
  const corrected = inspectImport(
    rows,
    { name: "Business", phone: "Phone" },
    "America/New_York",
  );
  assert.equal(corrected.valid, 50);
  assert.equal(corrected.preview[0].phone, "+12125550123");
  assert.equal(corrected.preview[0].row, 2);
  assert.equal(corrected.preview.length, 5);
});

test("mixed imports preserve valid rows and flag formulas and invalid optional data", () => {
  const preview = inspectImport(
    [
      { Name: "Valid", Phone: "(212) 555-0123", Zone: "America/New_York" },
      { Name: "Bad phone", Phone: "3", Zone: "UTC" },
      {
        Name: "Formula",
        Phone: "2125550123",
        Zone: "UTC",
        Extra: "#FORMULA_NOT_ALLOWED",
      },
      { Name: "Bad email", Phone: "2125550123", Zone: "UTC", Email: "wrong" },
    ],
    { name: "Name", phone: "Phone", timezone: "Zone", email: "Email" },
  );
  assert.equal(preview.valid, 1);
  assert.equal(preview.invalid, 3);
  assert.equal(preview.issues.length, 3);
});
