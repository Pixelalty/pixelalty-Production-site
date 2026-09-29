import { normalizeLead, normalizePhone, timezone, type Row } from "./core";

const importAliases: Record<string, string[]> = {
  name: ["business", "businessname", "company", "companyname", "name"],
  phone: [
    "phone",
    "phonenumber",
    "telephone",
    "telephonenumber",
    "mainphone",
    "mainbusinessphone",
    "businessphone",
    "businessphonenumber",
    "mobile",
    "mobilephone",
    "tel",
  ],
  website: ["website", "url", "domain"],
  timezone: ["timezone", "tz"],
  contact: ["contact", "contactname", "askfor", "owner", "decisionmaker"],
  external_id: ["externalid", "placeid", "googleplaceid"],
  google_url: ["googleurl", "googlebusinessurl", "businessprofile"],
  rating: ["rating", "googlerating"],
  review_count: ["reviews", "reviewcount"],
  zip: ["zip", "zipcode", "postalcode"],
  source: ["source", "leadsource"],
  tags: ["tags", "tag"],
  website_assessment: [
    "websitenotes",
    "websiteassessment",
    "websitestatus",
  ],
};

export function suggestImportMapping(fields: string[], headers: string[]) {
  const normalized = headers.map((value) => ({
    value,
    key: value.toLowerCase().replace(/[^a-z0-9]/g, ""),
  }));
  return Object.fromEntries(
    fields.map((field) => [
      field,
      normalized.find((candidate) =>
        (importAliases[field] || [field]).includes(candidate.key),
      )?.value || "",
    ]),
  );
}

export function importMappingError(mapping: Record<string, string>, zone = "") {
  if (!mapping.name) return "Choose the column containing each business name.";
  if (!mapping.phone)
    return "Choose the column containing telephone numbers, not the spreadsheet row number.";
  const columns = Object.entries(mapping)
    .filter(([key, value]) => !key.startsWith("_") && value)
    .map(([, value]) => value);
  if (new Set(columns).size !== columns.length)
    return "Each spreadsheet column can be mapped once. Remove the duplicate mapping.";
  if (zone && !timezone(zone))
    return "Choose a valid default timezone, such as America/New_York.";
  if (!mapping.timezone && !zone)
    return "Choose a default timezone or map a Timezone column before staging. Use the businesses’ timezone, not your own.";
  return "";
}

// Preview uses the same normalizer as the server. Database duplicate/DNC checks
// still run during staging and again at commit; this never marks a lead imported.
export function inspectImport(
  rows: Row[],
  mapping: Record<string, string>,
  zone = "",
) {
  const issues = new Map<string, number>();
  const preview: Row[] = [];
  let valid = 0,
    invalidPhones = 0;
  for (const [index, row] of rows.entries()) {
    let data: Row = {},
      error = "";
    if (mapping.phone) {
      try {
        normalizePhone(String(row[mapping.phone] ?? ""));
      } catch {
        invalidPhones++;
      }
    }
    try {
      if (Object.values(row).some((v) => String(v) === "#FORMULA_NOT_ALLOWED"))
        throw Error("Formulas are not imported. Paste values first.");
      data = normalizeLead(row, mapping, zone);
      valid++;
    } catch (e) {
      error = e instanceof Error ? e.message : "Invalid row";
      issues.set(error, (issues.get(error) || 0) + 1);
    }
    if (index < 5)
      preview.push({
        row: index + 2,
        name: data.name || String(row[mapping.name] ?? ""),
        phone: data.phone || String(row[mapping.phone] ?? ""),
        timezone: data.timezone || String(row[mapping.timezone] ?? zone),
        result: error || "Ready for duplicate and DNC checks",
      });
  }
  return {
    valid,
    invalid: rows.length - valid,
    invalidPhones,
    preview,
    issues: [...issues].map(([message, count]) => ({ message, count })),
  };
}
