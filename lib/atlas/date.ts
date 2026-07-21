export function centralDateIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDaysIso(dateIso: string, days: number) {
  if (!isIsoDate(dateIso) || !Number.isInteger(days)) {
    throw new Error("Valid ISO date and whole-day offset required.");
  }

  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function monthBoundsIso(anchorIso: string) {
  if (!isIsoDate(anchorIso)) throw new Error("Valid month anchor required.");
  const [year, month] = anchorIso.split("-").map(Number);
  const start = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0, 12));
  return { start, end: endDate.toISOString().slice(0, 10) };
}

export function prettyFarmDate(dateIso: string | null | undefined, includeWeekday = false) {
  if (!dateIso || !isIsoDate(dateIso)) return dateIso || "No date";
  const date = new Date(`${dateIso}T12:00:00Z`);
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: includeWeekday ? "long" : undefined,
    month: "short",
    day: "numeric",
  });
}
