import { NextRequest, NextResponse } from "next/server";

import { getAtlasSession, membershipForFarm } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DEFAULT_LATITUDE = 37.3387;
const DEFAULT_LONGITUDE = -92.9071;
const DEFAULT_TIMEZONE = "America/Chicago";
const WATERING_RAIN_THRESHOLD_IN = 0.2;
const DAY_MS = 86_400_000;

const weatherCodeLabels: Record<number, string> = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy",
  45: "Fog", 48: "Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
  56: "Freezing drizzle", 57: "Freezing drizzle", 61: "Rain", 63: "Rain",
  65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain", 71: "Snow",
  73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Showers",
  82: "Heavy showers", 85: "Snow showers", 86: "Snow showers", 95: "Thunderstorm",
  96: "Thunderstorm", 99: "Thunderstorm",
};

type FarmRow = { id: string; name: string; metadata: Record<string, unknown> | null };
type RainRow = {
  id: string;
  observation_date: string;
  amount_in: number | string;
  source_type: string;
  note: string | null;
  created_at: string;
};
type OpenMeteoResponse = {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
  };
  daily?: {
    time?: string[];
    precipitation_sum?: number[];
    precipitation_probability_max?: number[];
  };
};

function text(metadata: Record<string, unknown>, key: string, fallback = "") {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function numberValue(metadata: Record<string, unknown>, key: string, fallback: number) {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
function isoInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function addDaysIso(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function daysBetween(olderIso: string, newerIso: string) {
  const older = new Date(`${olderIso}T12:00:00Z`).getTime();
  const newer = new Date(`${newerIso}T12:00:00Z`).getTime();
  return Math.max(0, Math.round((newer - older) / DAY_MS));
}
function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
function numeric(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function weatherUrl(latitude: number, longitude: number, timezone: string) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code");
  url.searchParams.set("daily", "precipitation_sum,precipitation_probability_max");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", timezone);
  url.searchParams.set("past_days", "14");
  url.searchParams.set("forecast_days", "3");
  return url;
}
async function readWeather(latitude: number, longitude: number, timezone: string, todayIso: string) {
  const response = await fetch(weatherUrl(latitude, longitude, timezone), {
    headers: { Accept: "application/json" }, next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error("Farm weather lookup failed.");
  const payload = await response.json() as OpenMeteoResponse;
  const dates = payload.daily?.time ?? [];
  const precipitation = payload.daily?.precipitation_sum ?? [];
  const probability = payload.daily?.precipitation_probability_max ?? [];
  const start7Iso = addDaysIso(todayIso, -6);
  const pastRows = dates.map((date, index) => ({
    date, amount: numeric(precipitation[index]), chance: numeric(probability[index]),
  })).filter((row) => row.date <= todayIso);
  const todayIndex = dates.indexOf(todayIso);
  const tomorrowIso = addDaysIso(todayIso, 1);
  const tomorrowIndex = dates.indexOf(tomorrowIso);
  const lastWateringRain = [...pastRows].reverse().find((row) => row.amount >= WATERING_RAIN_THRESHOLD_IN) ?? null;
  return {
    condition: weatherCodeLabels[payload.current?.weather_code ?? -1] ?? "Weather",
    temperatureF: typeof payload.current?.temperature_2m === "number" ? Math.round(payload.current.temperature_2m) : null,
    feelsLikeF: typeof payload.current?.apparent_temperature === "number" ? Math.round(payload.current.apparent_temperature) : null,
    humidityPct: typeof payload.current?.relative_humidity_2m === "number" ? Math.round(payload.current.relative_humidity_2m) : null,
    windMph: typeof payload.current?.wind_speed_10m === "number" ? Math.round(payload.current.wind_speed_10m) : null,
    todayEstimateIn: todayIndex >= 0 ? round(numeric(precipitation[todayIndex])) : 0,
    sevenDayEstimateIn: round(pastRows.filter((row) => row.date >= start7Iso && row.date <= todayIso).reduce((sum, row) => sum + row.amount, 0)),
    forecast48hIn: round((todayIndex >= 0 ? numeric(precipitation[todayIndex]) : 0) + (tomorrowIndex >= 0 ? numeric(precipitation[tomorrowIndex]) : 0)),
    forecastChancePct: Math.round(Math.max(todayIndex >= 0 ? numeric(probability[todayIndex]) : 0, tomorrowIndex >= 0 ? numeric(probability[tomorrowIndex]) : 0)),
    daysSinceEstimatedWateringRain: lastWateringRain ? daysBetween(lastWateringRain.date, todayIso) : null,
  };
}
function gaugeSummary(rows: RainRow[], todayIso: string) {
  const start7Iso = addDaysIso(todayIso, -6);
  const latest = rows[0] ?? null;
  const sevenDayTotalIn = round(rows.filter((row) => row.observation_date >= start7Iso && row.observation_date <= todayIso).reduce((sum, row) => sum + numeric(row.amount_in), 0));
  const lastWateringRain = rows.find((row) => numeric(row.amount_in) >= WATERING_RAIN_THRESHOLD_IN) ?? null;
  return {
    hasGaugeData: Boolean(latest),
    latest: latest ? { observationDate: latest.observation_date, amountIn: round(numeric(latest.amount_in)), note: latest.note, recordedAt: latest.created_at } : null,
    sevenDayTotalIn,
    daysSinceWateringRain: lastWateringRain ? daysBetween(lastWateringRain.observation_date, todayIso) : null,
    wateringRainThresholdIn: WATERING_RAIN_THRESHOLD_IN,
  };
}
function rainStatusLabel(gauge: ReturnType<typeof gaugeSummary>, weather: Awaited<ReturnType<typeof readWeather>> | null) {
  if (gauge.latest) {
    const age = daysBetween(gauge.latest.observationDate, new Date().toISOString().slice(0, 10));
    return age === 0 ? `${gauge.latest.amountIn.toFixed(2)}\" gauge reading today` : `${age} ${age === 1 ? "day" : "days"} since gauge read`;
  }
  if (weather?.daysSinceEstimatedWateringRain === 0) return "Area model shows watering rain today";
  if (weather?.daysSinceEstimatedWateringRain === 1) return "Area model shows watering rain yesterday";
  if (typeof weather?.daysSinceEstimatedWateringRain === "number") return `${weather.daysSinceEstimatedWateringRain} days since estimated watering rain`;
  return "Elm gauge has not been read";
}

export async function GET(request: NextRequest) {
  const session = await getAtlasSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const requestedFarmId = request.nextUrl.searchParams.get("farmId");
  const farmId = requestedFarmId && membershipForFarm(session, requestedFarmId) ? requestedFarmId : session.activeFarmId;
  if (!farmId || !membershipForFarm(session, farmId)) {
    return NextResponse.json({ ok: false, error: "farm membership required" }, { status: 403 });
  }

  const supabase = await createAtlasServerClient();
  const { data: farmData, error: farmError } = await supabase.from("farms").select("id, name, metadata").eq("id", farmId).single();
  if (farmError || !farmData) return NextResponse.json({ ok: false, error: "farm unavailable" }, { status: 404 });
  const farm = farmData as FarmRow;
  const metadata = farm.metadata ?? {};
  const latitude = numberValue(metadata, "condition_latitude", DEFAULT_LATITUDE);
  const longitude = numberValue(metadata, "condition_longitude", DEFAULT_LONGITUDE);
  const timezone = text(metadata, "timezone", DEFAULT_TIMEZONE);
  const locationLabel = text(metadata, "condition_location_label", text(metadata, "location_label", farm.name));
  const todayIso = isoInTimezone(new Date(), timezone);

  const [weatherResult, rainResult] = await Promise.all([
    readWeather(latitude, longitude, timezone, todayIso).catch(() => null),
    supabase.from("farm_rain_observations").select("id, observation_date, amount_in, source_type, note, created_at").eq("farm_id", farmId).lte("observation_date", todayIso).order("observation_date", { ascending: false }).order("created_at", { ascending: false }).limit(60),
  ]);
  const rainRows = rainResult.error ? [] : (rainResult.data ?? []) as RainRow[];
  const gauge = gaugeSummary(rainRows, todayIso);

  return NextResponse.json({
    ok: true,
    farm: { id: farm.id, name: farm.name, locationLabel, timezone },
    observedDate: todayIso,
    headerLabel: weatherResult?.temperatureF === null || weatherResult?.temperatureF === undefined
      ? weatherResult?.condition ?? "Farm conditions"
      : `${weatherResult.condition} · ${weatherResult.temperatureF}°`,
    weather: weatherResult ? { ...weatherResult, sourceType: "area_model_estimate", sourceLabel: `${locationLabel} weather model` } : null,
    rain: {
      gauge,
      statusLabel: rainStatusLabel(gauge, weatherResult),
      areaEstimate: weatherResult ? { todayIn: weatherResult.todayEstimateIn, sevenDayIn: weatherResult.sevenDayEstimateIn, daysSinceWateringRain: weatherResult.daysSinceEstimatedWateringRain } : null,
      forecast: weatherResult ? { next48hIn: weatherResult.forecast48hIn, chancePct: weatherResult.forecastChancePct } : null,
    },
  });
}
