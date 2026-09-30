import raw from "./data/us-timezones.json";

const data = raw as unknown as {
  zones: string[];
  zipRanges: [string, number, string][];
  cities: Record<string, number[]>;
  states: Record<string, number[]>;
};
const stateNames: Record<string, string> = Object.fromEntries(
  "Alabama:AL|Alaska:AK|Arizona:AZ|Arkansas:AR|California:CA|Colorado:CO|Connecticut:CT|Delaware:DE|District of Columbia:DC|Florida:FL|Georgia:GA|Hawaii:HI|Idaho:ID|Illinois:IL|Indiana:IN|Iowa:IA|Kansas:KS|Kentucky:KY|Louisiana:LA|Maine:ME|Maryland:MD|Massachusetts:MA|Michigan:MI|Minnesota:MN|Mississippi:MS|Missouri:MO|Montana:MT|Nebraska:NE|Nevada:NV|New Hampshire:NH|New Jersey:NJ|New Mexico:NM|New York:NY|North Carolina:NC|North Dakota:ND|Ohio:OH|Oklahoma:OK|Oregon:OR|Pennsylvania:PA|Rhode Island:RI|South Carolina:SC|South Dakota:SD|Tennessee:TN|Texas:TX|Utah:UT|Vermont:VT|Virginia:VA|Washington:WA|West Virginia:WV|Wisconsin:WI|Wyoming:WY|Puerto Rico:PR"
    .split("|")
    .map((pair) => pair.toUpperCase().split(":")),
);
const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
let zips: Map<string, { state: string; zones: Set<number> }> | undefined;
function zipIndex() {
  if (zips) return zips;
  zips = new Map();
  for (const [state, zone, ranges] of data.zipRanges) {
    for (const range of ranges.split(",")) {
      const [start, finish] = range.split("-").map(Number);
      for (let n = start; n <= (finish ?? start); n++) {
        const key = String(n).padStart(5, "0"),
          entry = zips.get(key) || { state, zones: new Set<number>() };
        entry.zones.add(zone);
        zips.set(key, entry);
      }
    }
  }
  return zips;
}
export function normalizeZip(value: string) {
  const compact = value.trim().replace(/\s+/g, "");
  if (!compact) return "";
  if (/^\d{1,5}$/.test(compact)) return compact.padStart(5, "0");
  if (/^\d{9}$/.test(compact))
    return compact.slice(0, 5) + "-" + compact.slice(5);
  if (/^\d{5}-\d{4}$/.test(compact)) return compact;
  throw Error("ZIP must contain five digits, or ZIP+4.");
}
export function leadLocation(input: {
  zip: string;
  city: string;
  state: string;
  cityState: string;
  address: string;
  timezone: string;
  defaultZone: string;
}) {
  const combined =
    input.cityState.trim().match(/^(.*?),\s*([A-Za-z ]+)$/) ||
    input.cityState.trim().match(/^(.*?)[\s]+([A-Za-z]{2})$/);
  const address = input.address.match(
    /,\s*([^,]+),?\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/,
  );
  const city =
    input.city.trim() || combined?.[1]?.trim() || address?.[1]?.trim() || "";
  let state = (
    input.state.trim() ||
    combined?.[2] ||
    address?.[2] ||
    ""
  ).toUpperCase();
  state = stateNames[state] || state;
  const zip = normalizeZip(input.zip || address?.[3] || "");
  if (input.timezone)
    return { city, state, zip, timezone: input.timezone, source: "provided" };
  const exact = zip ? zipIndex().get(zip.slice(0, 5)) : undefined;
  if (exact && state && state !== exact.state)
    throw Error("ZIP and state disagree. Review this row’s location.");
  if (exact) {
    state ||= exact.state;
    if (exact.zones.size === 1)
      return {
        city,
        state,
        zip,
        timezone: data.zones[[...exact.zones][0]],
        source: "ZIP",
      };
    throw Error(
      "This ZIP spans timezones. Enter this business’s IANA timezone.",
    );
  }
  const cityZones = data.cities[state + ":" + clean(city)];
  if (cityZones?.length === 1)
    return {
      city,
      state,
      zip,
      timezone: data.zones[cityZones[0]],
      source: "city/state",
    };
  // A split state never chooses a guessed timezone. Only the affected row needs review.
  if (!cityZones && data.states[state]?.length === 1)
    return {
      city,
      state,
      zip,
      timezone: data.zones[data.states[state][0]],
      source: "state",
    };
  if (input.defaultZone)
    return {
      city,
      state,
      zip,
      timezone: input.defaultZone,
      source: "reviewed default",
    };
  throw Error(
    "Timezone needs review. Add a valid ZIP, city/state, or this business’s IANA timezone.",
  );
}
