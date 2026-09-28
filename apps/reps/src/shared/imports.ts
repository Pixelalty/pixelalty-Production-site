import { normalizeLead, normalizePhone, timezone, type Row } from "./core";

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
