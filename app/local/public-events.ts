import { createClient } from "@supabase/supabase-js";

import { getAtlasSupabaseConfig } from "@/lib/supabase/config";

export type CalendarEvent = {
  public_id: string;
  source_system: "atlas" | "local_intel";
  source_stable_key: string | null;
  is_elm_owned: boolean;
  title: string;
  event_kind: string | null;
  starts_at: string;
  ends_at: string | null;
  time_precision: "exact" | "date_only" | "conditional";
  host_name: string | null;
  venue_name: string | null;
  city: string | null;
  state: string | null;
  cost: Record<string, unknown> | null;
  audience: Record<string, unknown> | null;
  categories: string[];
  featured_rank: number | null;
  featured_note: string | null;
  series_key: string | null;
  series_title: string | null;
  series_summary: string | null;
  public_url: string | null;
  details: Record<string, unknown> | null;
  last_verified_at: string | null;
};

export type Category = {
  key: string;
  label: string;
};

export const CATEGORIES: Category[] = [
  { key: "kids-family", label: "Kids + Family" },
  { key: "free", label: "Free" },
  { key: "markets-festivals", label: "Markets + Festivals" },
  { key: "food", label: "Food" },
  { key: "music", label: "Music" },
  { key: "arts-theater", label: "Arts + Theater" },
  { key: "classes-workshops", label: "Classes + Workshops" },
  { key: "outdoors", label: "Outdoors" },
  { key: "sports", label: "Sports" },
  { key: "community", label: "Community" },
];

export const DATE_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const DATE_HEADING = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  weekday: "long",
  month: "long",
  day: "numeric",
});

export const DATE_BADGE_MONTH = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
});

export const DATE_BADGE_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  day: "numeric",
});

export const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
});

export const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

export const TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "numeric",
  minute: "2-digit",
});

const VERIFIED_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const SELECT_FIELDS = "public_id,source_system,source_stable_key,is_elm_owned,title,event_kind,starts_at,ends_at,time_precision,host_name,venue_name,city,state,cost,audience,categories,featured_rank,featured_note,series_key,series_title,series_summary,public_url,details,last_verified_at";

export function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function localDateKey(value: Date) {
  const parts = DATE_PARTS.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

export function addDays(dateKey: string, amount: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}

export function dayOfWeek(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function weekendRange(today: string, offsetWeeks = 0) {
  const weekday = dayOfWeek(today);
  let saturday: string;
  if (weekday === 6) saturday = today;
  else if (weekday === 0) saturday = addDays(today, -1);
  else saturday = addDays(today, 6 - weekday);
  if (offsetWeeks) saturday = addDays(saturday, offsetWeeks * 7);
  return { start: saturday, end: addDays(saturday, 1) };
}

export function timeLabel(event: CalendarEvent) {
  if (event.time_precision === "date_only") return "Time TBA";
  if (event.time_precision === "conditional") return "Conditional timing";

  const startDate = new Date(event.starts_at);
  const start = TIME_FORMAT.format(startDate);
  if (!event.ends_at) return start;

  const endDate = new Date(event.ends_at);
  if (localDateKey(startDate) !== localDateKey(endDate)) {
    return `${SHORT_DATE.format(startDate)}–${SHORT_DATE.format(endDate)}`;
  }

  return `${start}–${TIME_FORMAT.format(endDate)}`;
}

export function longDateLabel(event: CalendarEvent) {
  const startDate = new Date(event.starts_at);
  if (!event.ends_at) return LONG_DATE.format(startDate);
  const endDate = new Date(event.ends_at);
  if (localDateKey(startDate) === localDateKey(endDate)) return LONG_DATE.format(startDate);
  return `${LONG_DATE.format(startDate)} – ${LONG_DATE.format(endDate)}`;
}

export function costLabel(event: CalendarEvent) {
  if (event.categories.includes("free")) return "Free";
  const amount = event.cost?.amount;
  if (typeof amount === "number") {
    const unit = typeof event.cost?.unit === "string" ? `/${event.cost.unit}` : "";
    return `$${amount}${unit}`;
  }
  if (event.cost && "ticket_types" in event.cost) return "Ticketed";
  if (event.event_kind === "ticketed_seasonal_evening") return "Ticketed";
  return null;
}

export function eventDetail(event: CalendarEvent) {
  const detail = event.details?.program_detail;
  return typeof detail === "string" ? detail : null;
}

export function publicDetailRows(event: CalendarEvent) {
  const details = event.details ?? {};
  const candidates: Array<[string, unknown]> = [
    ["Format", details.public_format],
    ["Theme", details.public_theme],
    ["What to expect", details.program_detail],
    ["Sport", details.sport],
    ["Food pairing", details.baked_good_pairing],
    ["Timing note", details.start_note],
    ["Publication note", details.publication_note],
  ];
  return candidates.filter((row): row is [string, string] => typeof row[1] === "string" && row[1].trim().length > 0);
}

export function categoryLabel(key: string) {
  return CATEGORIES.find((category) => category.key === key)?.label ?? key;
}

export function discoveryIdentity(event: CalendarEvent) {
  return event.series_key ? `series:${event.series_key}` : `event:${event.public_id}`;
}

export function eventHref(event: CalendarEvent) {
  return `/local/event/${encodeURIComponent(event.public_id)}`;
}

export function seriesHref(seriesKey: string) {
  return `/local/series/${encodeURIComponent(seriesKey)}`;
}

export function verifiedLabel(event: CalendarEvent) {
  if (!event.last_verified_at) return null;
  return `Source checked ${VERIFIED_DATE.format(new Date(event.last_verified_at))}`;
}

function publicClient() {
  const { url, publishableKey } = getAtlasSupabaseConfig();
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export async function loadEvents(daysAhead = 120) {
  const supabase = publicClient();
  const lowerBound = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString();
  const upperBound = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("elm_local_calendar_events_v1")
    .select(SELECT_FIELDS)
    .gte("starts_at", lowerBound)
    .lte("starts_at", upperBound)
    .order("starts_at", { ascending: true });

  return { events: (data ?? []) as CalendarEvent[], error: error?.message ?? null };
}

export async function loadEvent(publicId: string) {
  const supabase = publicClient();
  const { data, error } = await supabase
    .from("elm_local_calendar_events_v1")
    .select(SELECT_FIELDS)
    .eq("public_id", publicId)
    .maybeSingle();

  return { event: (data as CalendarEvent | null) ?? null, error: error?.message ?? null };
}

export async function loadSeries(seriesKey: string) {
  const supabase = publicClient();
  const { data, error } = await supabase
    .from("elm_local_calendar_events_v1")
    .select(SELECT_FIELDS)
    .eq("series_key", seriesKey)
    .gte("starts_at", new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString())
    .order("starts_at", { ascending: true });

  return { events: (data ?? []) as CalendarEvent[], error: error?.message ?? null };
}
