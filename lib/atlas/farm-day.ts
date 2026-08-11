export const DEFAULT_ATLAS_FARM_TIME_ZONE = "America/Chicago";

function validIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

export function atlasFarmDateIso(
  at: Date = new Date(),
  timeZone: string = DEFAULT_ATLAS_FARM_TIME_ZONE,
) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function atlasNormalizeFarmDate(
  value: string | null | undefined,
  fallback = atlasFarmDateIso(),
) {
  return value && validIsoDate(value) ? value : fallback;
}

export function atlasShiftFarmDate(dateIso: string, days: number) {
  const normalized = atlasNormalizeFarmDate(dateIso);
  const date = new Date(`${normalized}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function atlasFarmWeekStartMonday(dateIso: string) {
  const normalized = atlasNormalizeFarmDate(dateIso);
  const date = new Date(`${normalized}T12:00:00Z`);
  const day = date.getUTCDay();
  return atlasShiftFarmDate(normalized, -(day === 0 ? 6 : day - 1));
}

export function atlasFarmWeekWindow(dateIso: string) {
  const start = atlasFarmWeekStartMonday(dateIso);
  return { start, end: atlasShiftFarmDate(start, 6) };
}

export function atlasFarmMonthEnd(dateIso: string) {
  const normalized = atlasNormalizeFarmDate(dateIso);
  const [year, month] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10);
}

export function atlasFarmDateLabel(
  dateIso: string,
  options: Intl.DateTimeFormatOptions,
  locale = "en-US",
) {
  const normalized = atlasNormalizeFarmDate(dateIso);
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options })
    .format(new Date(`${normalized}T12:00:00Z`));
}
