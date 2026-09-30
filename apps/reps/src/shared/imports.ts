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
  website: ["website", "url", "domain", "websiteurl", "websiteurlifany"],
  email: ["email", "businessemail", "businessemailiftheyhaveone"],
  city_state: ["citystate", "cityandstate"],
  decision_maker: ["decisionmakerowner", "ownername"],
  decision_maker_title: ["decisionmakertitle"],
  decision_maker_email: ["decisionmakerbusinessemail", "decisionmakeremail"],
  years_in_business: ["yearsinbusiness"],
  founded_year: ["foundedyear", "yearfounded"],
  business_description: ["businessdescription", "description"],
  areas_served: ["areasserved"],
  other_decision_makers: ["otherdecisionmakers"],
  website_status: ["websitestatus"],
  website_age: ["websiteage"],
  timezone: ["timezone", "tz"],
  contact: [
    "contact",
    "contactname",
    "askfor",
    "persontoaskfor",
    "owner",
    "decisionmaker",
  ],
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
    "websiteproblemsopportunity",
    "websitestatus",
  ],
};

export function suggestImportMapping(fields: string[], headers: string[]) {
  const normalized = headers.map((value) => ({
    value,
    key: value.toLowerCase().replace(/[^a-z0-9]/g, ""),
  }));
  const used = new Set<string>();
  return Object.fromEntries(
    fields.map((field) => {
      const match = normalized.find(
        (candidate) =>
          !used.has(candidate.value) &&
          (importAliases[field] || [field.replace(/[^a-z0-9]/g, "")]).includes(
            candidate.key,
          ),
      );
      if (match) used.add(match.value);
      return [field, match?.value || ""];
    }),
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
    if (index < 100)
      preview.push({
        row: index + 2,
        name: data.name || String(row[mapping.name] ?? ""),
        phone: data.phone || String(row[mapping.phone] ?? ""),
        city: data.city || "",
        state: data.state || "",
        timezone_source: data.metadata?.timezone_source || "",
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

export const importFields = [
  "name",
  "phone",
  "contact",
  "industry",
  "category",
  "city_state",
  "city",
  "state",
  "zip",
  "address",
  "decision_maker",
  "decision_maker_title",
  "years_in_business",
  "founded_year",
  "business_description",
  "services",
  "areas_served",
  "locations",
  "other_decision_makers",
  "email",
  "decision_maker_email",
  "website",
  "website_status",
  "website_age",
  "website_assessment",
  "timezone",
  "notes",
  "source",
  "tags",
  "country",
  "external_id",
  "google_url",
  "rating",
  "review_count",
];
