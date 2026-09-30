import { leadLocation } from "./lead-location";
export type Row = Record<string, any>;
export const PACKAGES = [
  { code: "launch", name: "Launch", price: 79900, commission: 12500, xp: 100 },
  { code: "growth", name: "Growth", price: 129900, commission: 25000, xp: 150 },
  {
    code: "premium",
    name: "Premium",
    price: 199900,
    commission: 40000,
    xp: 225,
  },
  {
    code: "advanced",
    name: "Advanced",
    price: 299900,
    commission: 60000,
    xp: 300,
  },
] as const;
export const OUTCOMES = [
  "no_answer",
  "voicemail",
  "gatekeeper",
  "decision_maker_unavailable",
  "conversation",
  "send_information",
  "interested",
  "follow_up",
  "meeting",
  "proposal",
  "not_interested",
  "wrong_number",
  "disconnected",
  "business_closed",
  "do_not_call",
  "sale_reported",
] as const;
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (cents || 0) / 100,
  );
export const label = (s: string) =>
  (s || "").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
export function timezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}
export function localParts(date: Date, zone: string) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(p.map((x) => [x.type, x.value]));
}
export function callingWindow(
  zone: string,
  enabled = false,
  date = new Date(),
  start = 9,
  end = 17,
) {
  if (!enabled)
    return {
      allowed: false,
      reason: "Calling hours have not been approved by an administrator.",
    };
  if (!timezone(zone))
    return {
      allowed: false,
      reason: "Verify the prospect’s timezone before calling.",
    };
  const p = localParts(date, zone);
  const allowed =
    !["Sat", "Sun"].includes(p.weekday) &&
    Number(p.hour) >= start &&
    Number(p.hour) < end;
  return {
    allowed,
    reason: allowed
      ? `${p.hour}:${p.minute} · ${zone}`
      : `Outside approved hours · ${p.weekday} ${p.hour}:${p.minute} · ${zone}`,
  };
}
export function normalizePhone(raw: string) {
  const s = raw.trim();
  let d = s.replace(/\D/g, "");
  if (d.length === 10) d = "1" + d;
  if (
    !/^\+?[\d\s().-]+$/.test(s) ||
    !/^\d{11,15}$/.test(d) ||
    (d.length !== 11 && !s.startsWith("+"))
  )
    throw Error("Provide a valid phone with country code.");
  return "+" + d;
}
export function normalizeDomain(raw: string) {
  if (!raw.trim()) return "";
  const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : "https://" + raw);
  if (
    !["https:", "http:"].includes(u.protocol) ||
    !u.hostname.includes(".") ||
    u.username ||
    u.password
  )
    throw Error("Invalid website address.");
  return u.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}
export const header = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "");
export function csvCell(v: unknown) {
  let s = String(v ?? "");
  let prefix = s;
  while (prefix && (prefix.charCodeAt(0) < 33 || !prefix[0].trim()))
    prefix = prefix.slice(1);
  if (/^[=+@-]/.test(prefix)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export const csv = (rows: unknown[][]) =>
  rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
export function normalizeLead(
  raw: Row,
  mapping: Record<string, string>,
  defaultZone = "",
) {
  const get = (key: string) => String(raw[mapping[key]] ?? "").trim();
  const name = get("name");
  const optional = (key: string) =>
    /^(?:not found|n\/?a|none|null|-)$/i.test(get(key)) ? "" : get(key);
  const location = leadLocation({
    zip: get("zip"),
    city: get("city"),
    state: get("state"),
    cityState: get("city_state"),
    address: get("address"),
    timezone: get("timezone"),
    defaultZone,
  });
  const zone = location.timezone;
  if (!name || name.length > 200)
    throw Error("Business name is required (maximum 200 characters).");
  if (!timezone(zone)) throw Error("A verified IANA timezone is required.");
  const email = optional("email").toLowerCase();
  const ownerEmail = optional("decision_maker_email").toLowerCase();
  if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail))
    throw Error("Invalid decision-maker email.");
  const integer = (key: string, max: number) => {
    const value = optional(key);
    if (!value) return null;
    if (
      !Number.isInteger(Number(value)) ||
      Number(value) < 0 ||
      Number(value) > max
    )
      throw Error(label(key) + " must be a valid non-negative whole number.");
    return Number(value);
  };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw Error("Invalid email.");
  const rating = get("rating"),
    reviews = get("review_count");
  if (
    rating &&
    (!Number.isFinite(Number(rating)) ||
      Number(rating) < 0 ||
      Number(rating) > 5)
  )
    throw Error("Rating must be between 0 and 5.");
  if (reviews && (!Number.isInteger(Number(reviews)) || Number(reviews) < 0))
    throw Error("Review count must be a non-negative integer.");
  const google = get("google_url");
  if (google && !/^https?:\/\//.test(google))
    throw Error("Business profile URL must use http or https.");
  return {
    name,
    phone: normalizePhone(get("phone")),
    domain: normalizeDomain(optional("website")),
    email,
    timezone: zone,
    city: location.city,
    state: location.state,
    industry: get("industry"),
    contact: get("contact"),
    notes: get("notes").slice(0, 3000),
    source: get("source").slice(0, 200),
    external_id: get("external_id").slice(0, 250),
    tags: [get("tags"), mapping._batch_tag || ""]
      .join(",")
      .split(/[;,]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20),
    metadata: {
      address: get("address").slice(0, 500),
      zip: location.zip,
      timezone_source: location.source,
      category: get("category"),
      decision_maker: get("decision_maker"),
      decision_maker_title: get("decision_maker_title"),
      decision_maker_email: ownerEmail,
      years_in_business: integer("years_in_business", 1000),
      founded_year: integer("founded_year", new Date().getFullYear()),
      business_description: get("business_description").slice(0, 5000),
      services: get("services").slice(0, 5000),
      areas_served: get("areas_served").slice(0, 3000),
      locations: get("locations").slice(0, 3000),
      other_decision_makers: get("other_decision_makers").slice(0, 3000),
      website_status: get("website_status"),
      website_age: optional("website_age"),
      country: get("country").slice(0, 100),
      google_url: google.slice(0, 2000),
      rating: rating ? Number(rating) : null,
      review_count: reviews ? Number(reviews) : null,
      website_assessment: get("website_assessment").slice(0, 3000),
    },
  };
}
