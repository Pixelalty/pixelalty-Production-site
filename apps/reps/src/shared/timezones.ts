export const usTimezones = [
  ["America/New_York", "Eastern Time (ET)"],
  ["America/Chicago", "Central Time (CT)"],
  ["America/Denver", "Mountain Time (MT)"],
  ["America/Phoenix", "Arizona (no daylight saving)"],
  ["America/Los_Angeles", "Pacific Time (PT)"],
  ["America/Anchorage", "Alaska Time"],
  ["America/Adak", "Aleutian Time"],
  ["Pacific/Honolulu", "Hawaii (no daylight saving)"],
  ["America/Puerto_Rico", "Puerto Rico & U.S. Virgin Islands"],
  ["Pacific/Guam", "Guam & Northern Mariana Islands"],
  ["Pacific/Pago_Pago", "American Samoa"],
] as const;
export function timezoneOptions(current?: string) {
  const options: { value: string; label: string }[] = usTimezones.map(
    ([value, name]) => ({
      value,
      label: `${name} — ${value}`,
    }),
  );
  // Preserve existing valid choices without silently changing a saved timezone.
  if (current && !options.some((x) => x.value === current)) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: current });
      options.push({
        value: current,
        label: `Current timezone — ${current}`,
      });
    } catch {
      /* Invalid existing preferences are replaced through the selector. */
    }
  }
  return options;
}

// Resolve a wall-clock input in its chosen IANA zone, rather than the device zone.
// A repeated fall-back hour must be disambiguated; a missing spring-forward hour
// is rejected instead of silently moving a customer's appointment.
export function scheduledInstant(
  value: string,
  zone: string,
  occurrence: "earlier" | "later" = "earlier",
) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw Error("Choose a date and time.");
  const target = Date.parse(value + ":00Z");
  if (!Number.isFinite(target)) throw Error("Choose a valid date and time.");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const wall = (date: Date) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  const offsets = new Set<number>();
  for (const h of [-36, 0, 36]) {
    const sample = new Date(target + h * 3600000);
    offsets.add(Date.parse(wall(sample) + ":00Z") - sample.getTime());
  }
  const matches = [...offsets]
    .map((offset) => new Date(target - offset))
    .filter((d) => wall(d) === value)
    .sort((a, b) => a.getTime() - b.getTime());
  if (!matches.length)
    throw Error(
      "That local time does not exist because the clocks change. Choose another time.",
    );
  return matches[occurrence === "later" ? matches.length - 1 : 0].toISOString();
}
