import { NextRequest, NextResponse } from "next/server";

import {
  approximateMoon,
  localNoonUtc,
  lunarGuidance,
  lunarTaskHint,
  moonDirection,
  tropicalMoonSign,
  type AtlasLunarClock,
  type AtlasLunarTaskInput,
} from "@/lib/atlas/farm-lunar-clock";
import { getAtlasSession, membershipForFarm } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DEFAULT_LATITUDE = 37.3387;
const DEFAULT_LONGITUDE = -92.9071;
const DEFAULT_TIMEZONE = "America/Chicago";
const WATERING_RAIN_THRESHOLD_IN = 0.2;
const DAY_MS = 86_400_000;

const weatherCodeLabels: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Cloudy",
  45: "Fog",
  48: "Fog",
  51: "Drizzle",
  53: "Drizzle",
  55: "Drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Showers",
  81: "Showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm",
  99: "Thunderstorm",
};

const taskPriorityRank: Record<string, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

const taskConditionRank: Record<string, number> = {
  severe: 0,
  reset: 0,
  heavy: 1,
  moderate: 2,
  medium: 2,
  light: 3,
  low: 3,
  maintained: 4,
};

const lunarFitRank = { favored: 0, neutral: 1, caution: 2 } as const;

type FarmRow = {
  id: string;
  name: string;
  metadata: Record<string, unknown> | null;
};

type RainRow = {
  id: string;
  observation_date: string;
  amount_in: number | string;
  source_type: string;
  note: string | null;
  created_at: string;
};

type TaskRow = {
  id: string;
  title: string;
  priority: string | null;
  action_key: string | null;
  task_type: string | null;
  due_date: string | null;
  metadata: Record<string, unknown> | null;
};

type LunarTaskCandidate = {
  row: TaskRow;
  hint: NonNullable<ReturnType<typeof lunarTaskHint>>;
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

type UsnoMoonData = {
  curphase?: string;
  fracillum?: string | number;
  closestphase?: {
    phase?: string;
    year?: number | string;
    month?: number | string;
    day?: number | string;
    time?: string;
  };
  moondata?: Array<{ phen?: string; time?: string | null }>;
};

type UsnoResponse = {
  properties?: {
    data?: UsnoMoonData;
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

function booleanValue(metadata: Record<string, unknown>, key: string, fallback: boolean) {
  const value = metadata[key];
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "yes" || value === 1) return true;
  if (value === "false" || value === "no" || value === 0) return false;
  return fallback;
}

function isoInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
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
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code",
  );
  url.searchParams.set("daily", "precipitation_sum,precipitation_probability_max");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", timezone);
  url.searchParams.set("past_days", "14");
  url.searchParams.set("forecast_days", "3");
  return url;
}

async function readWeather(
  latitude: number,
  longitude: number,
  timezone: string,
  todayIso: string,
) {
  const response = await fetch(weatherUrl(latitude, longitude, timezone), {
    headers: { Accept: "application/json" },
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error("Farm weather lookup failed.");
  const payload = await response.json() as OpenMeteoResponse;
  const dates = payload.daily?.time ?? [];
  const precipitation = payload.daily?.precipitation_sum ?? [];
  const probability = payload.daily?.precipitation_probability_max ?? [];
  const start7Iso = addDaysIso(todayIso, -6);
  const pastRows = dates.map((date, index) => ({
    date,
    amount: numeric(precipitation[index]),
    chance: numeric(probability[index]),
  })).filter((row) => row.date <= todayIso);
  const todayIndex = dates.indexOf(todayIso);
  const tomorrowIso = addDaysIso(todayIso, 1);
  const tomorrowIndex = dates.indexOf(tomorrowIso);
  const lastWateringRain = [...pastRows].reverse().find((row) => row.amount >= WATERING_RAIN_THRESHOLD_IN) ?? null;

  return {
    condition: weatherCodeLabels[payload.current?.weather_code ?? -1] ?? "Weather",
    temperatureF: typeof payload.current?.temperature_2m === "number"
      ? Math.round(payload.current.temperature_2m)
      : null,
    feelsLikeF: typeof payload.current?.apparent_temperature === "number"
      ? Math.round(payload.current.apparent_temperature)
      : null,
    humidityPct: typeof payload.current?.relative_humidity_2m === "number"
      ? Math.round(payload.current.relative_humidity_2m)
      : null,
    windMph: typeof payload.current?.wind_speed_10m === "number"
      ? Math.round(payload.current.wind_speed_10m)
      : null,
    todayEstimateIn: todayIndex >= 0 ? round(numeric(precipitation[todayIndex])) : 0,
    sevenDayEstimateIn: round(
      pastRows
        .filter((row) => row.date >= start7Iso && row.date <= todayIso)
        .reduce((sum, row) => sum + row.amount, 0),
    ),
    forecast48hIn: round(
      (todayIndex >= 0 ? numeric(precipitation[todayIndex]) : 0)
        + (tomorrowIndex >= 0 ? numeric(precipitation[tomorrowIndex]) : 0),
    ),
    forecastChancePct: Math.round(Math.max(
      todayIndex >= 0 ? numeric(probability[todayIndex]) : 0,
      tomorrowIndex >= 0 ? numeric(probability[tomorrowIndex]) : 0,
    )),
    daysSinceEstimatedWateringRain: lastWateringRain
      ? daysBetween(lastWateringRain.date, todayIso)
      : null,
  };
}

function usnoUrl(
  dateIso: string,
  latitude: number,
  longitude: number,
  standardOffsetHours: number,
  usesUsDaylightTime: boolean,
) {
  const url = new URL("https://aa.usno.navy.mil/api/rstt/oneday");
  url.searchParams.set("date", dateIso);
  url.searchParams.set("coords", `${latitude},${longitude}`);
  url.searchParams.set("tz", String(standardOffsetHours));
  if (usesUsDaylightTime) url.searchParams.set("dst", "true");
  return url;
}

function parseIllumination(value: string | number | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value <= 1 ? value * 100 : value);
  }
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.replace("%", "").trim());
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed <= 1 ? parsed * 100 : parsed);
}

function phaseDateIso(phase: UsnoMoonData["closestphase"]) {
  if (!phase?.year || !phase.month || !phase.day) return null;
  const year = String(phase.year).padStart(4, "0");
  const month = String(phase.month).padStart(2, "0");
  const day = String(phase.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function moonPhenomenon(data: UsnoMoonData, phenomenon: "rise" | "set") {
  const match = data.moondata?.find((entry) => entry.phen?.toLowerCase() === phenomenon);
  return typeof match?.time === "string" && match.time ? match.time : null;
}

async function readMoon(
  dateIso: string,
  latitude: number,
  longitude: number,
  standardOffsetHours: number,
  usesUsDaylightTime: boolean,
): Promise<AtlasLunarClock> {
  const sign = tropicalMoonSign(dateIso, standardOffsetHours, usesUsDaylightTime);
  try {
    const response = await fetch(
      usnoUrl(dateIso, latitude, longitude, standardOffsetHours, usesUsDaylightTime),
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Atlas Farm Conditions (atlas.elmfarm.co)",
        },
        next: { revalidate: 21_600 },
      },
    );
    if (!response.ok) throw new Error("USNO lunar lookup failed.");
    const payload = await response.json() as UsnoResponse;
    const data = payload.properties?.data;
    if (!data?.curphase) throw new Error("USNO lunar response was incomplete.");
    return {
      dateIso,
      phase: data.curphase,
      illuminationPct: parseIllumination(data.fracillum),
      direction: moonDirection(data.curphase),
      moonrise: moonPhenomenon(data, "rise"),
      moonset: moonPhenomenon(data, "set"),
      closestPhase: data.closestphase?.phase
        ? {
            phase: data.closestphase.phase,
            dateIso: phaseDateIso(data.closestphase),
            time: data.closestphase.time ?? null,
          }
        : null,
      sign: sign.name,
      signSymbol: sign.symbol,
      signQuality: sign.quality,
      signBasis: "tropical_local_noon",
      source: "usno",
    };
  } catch {
    const fallback = approximateMoon(dateIso);
    return {
      dateIso,
      phase: fallback.phase,
      illuminationPct: fallback.illuminationPct,
      direction: moonDirection(fallback.phase),
      moonrise: null,
      moonset: null,
      closestPhase: null,
      sign: sign.name,
      signSymbol: sign.symbol,
      signQuality: sign.quality,
      signBasis: "tropical_local_noon",
      source: "calculated_fallback",
    };
  }
}

function gaugeSummary(rows: RainRow[], todayIso: string) {
  const start7Iso = addDaysIso(todayIso, -6);
  const latest = rows[0] ?? null;
  const sevenDayTotalIn = round(
    rows
      .filter((row) => row.observation_date >= start7Iso && row.observation_date <= todayIso)
      .reduce((sum, row) => sum + numeric(row.amount_in), 0),
  );
  const lastWateringRain = rows.find((row) => numeric(row.amount_in) >= WATERING_RAIN_THRESHOLD_IN) ?? null;
  return {
    hasGaugeData: Boolean(latest),
    latest: latest
      ? {
          observationDate: latest.observation_date,
          amountIn: round(numeric(latest.amount_in)),
          note: latest.note,
          recordedAt: latest.created_at,
        }
      : null,
    sevenDayTotalIn,
    daysSinceWateringRain: lastWateringRain
      ? daysBetween(lastWateringRain.observation_date, todayIso)
      : null,
    wateringRainThresholdIn: WATERING_RAIN_THRESHOLD_IN,
  };
}

function rainStatusLabel(
  gauge: ReturnType<typeof gaugeSummary>,
  weather: Awaited<ReturnType<typeof readWeather>> | null,
) {
  if (gauge.latest) {
    const age = daysBetween(gauge.latest.observationDate, new Date().toISOString().slice(0, 10));
    return age === 0
      ? `${gauge.latest.amountIn.toFixed(2)}\" gauge reading today`
      : `${age} ${age === 1 ? "day" : "days"} since gauge read`;
  }
  if (weather?.daysSinceEstimatedWateringRain === 0) return "Area model shows watering rain today";
  if (weather?.daysSinceEstimatedWateringRain === 1) return "Area model shows watering rain yesterday";
  if (typeof weather?.daysSinceEstimatedWateringRain === "number") {
    return `${weather.daysSinceEstimatedWateringRain} days since estimated watering rain`;
  }
  return "Elm gauge has not been read";
}

function taskInput(row: TaskRow): AtlasLunarTaskInput {
  return {
    id: row.id,
    title: row.title,
    actionKey: row.action_key,
    taskType: row.task_type,
    dueDate: row.due_date,
    metadata: row.metadata,
  };
}

function taskMetadataNumber(row: TaskRow, key: string) {
  const value = row.metadata?.[key];
  return typeof value === "number" || typeof value === "string" ? numeric(value) : 0;
}

function taskMetadataText(row: TaskRow, key: string) {
  const value = row.metadata?.[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function compareLunarTaskCandidates(
  a: LunarTaskCandidate,
  b: LunarTaskCandidate,
  todayIso: string,
) {
  const dynamicPriorityDifference = taskMetadataNumber(b.row, "dynamic_priority_score")
    - taskMetadataNumber(a.row, "dynamic_priority_score");
  if (dynamicPriorityDifference !== 0) return dynamicPriorityDifference;

  const priorityDifference = (taskPriorityRank[a.row.priority ?? "normal"] ?? 1)
    - (taskPriorityRank[b.row.priority ?? "normal"] ?? 1);
  if (priorityDifference !== 0) return priorityDifference;

  const conditionDifference = (taskConditionRank[taskMetadataText(a.row, "condition")] ?? 3)
    - (taskConditionRank[taskMetadataText(b.row, "condition")] ?? 3);
  if (conditionDifference !== 0) return conditionDifference;

  const aOverdue = a.row.due_date && a.row.due_date < todayIso ? 0 : 1;
  const bOverdue = b.row.due_date && b.row.due_date < todayIso ? 0 : 1;
  if (aOverdue !== bOverdue) return aOverdue - bOverdue;

  const dueDifference = (a.row.due_date ?? "9999-12-31")
    .localeCompare(b.row.due_date ?? "9999-12-31");
  if (dueDifference !== 0) return dueDifference;

  const fitDifference = lunarFitRank[a.hint.fit] - lunarFitRank[b.hint.fit];
  if (fitDifference !== 0) return fitDifference;

  return a.row.title.localeCompare(b.row.title);
}

async function readFarmConditions(requestedFarmId: string | null) {
  const session = await getAtlasSession();
  if (!session) return { error: "unauthorized" as const, status: 401 };
  const farmId = requestedFarmId && membershipForFarm(session, requestedFarmId)
    ? requestedFarmId
    : session.activeFarmId;
  if (!farmId || !membershipForFarm(session, farmId)) {
    return { error: "farm membership required" as const, status: 403 };
  }

  const supabase = await createAtlasServerClient();
  const { data: farmData, error: farmError } = await supabase
    .from("farms")
    .select("id, name, metadata")
    .eq("id", farmId)
    .single();
  if (farmError || !farmData) return { error: "farm unavailable" as const, status: 404 };
  const farm = farmData as FarmRow;
  const metadata = farm.metadata ?? {};
  const latitude = numberValue(metadata, "condition_latitude", DEFAULT_LATITUDE);
  const longitude = numberValue(metadata, "condition_longitude", DEFAULT_LONGITUDE);
  const timezone = text(metadata, "timezone", DEFAULT_TIMEZONE);
  const standardOffsetHours = numberValue(metadata, "utc_standard_offset_hours", -6);
  const usesUsDaylightTime = booleanValue(metadata, "uses_us_daylight_time", true);
  const locationLabel = text(metadata, "condition_location_label", text(metadata, "location_label", farm.name));
  const todayIso = isoInTimezone(new Date(), timezone);
  const dueThrough = addDaysIso(todayIso, 21);

  const [weatherResult, moon, rainResult, taskResult] = await Promise.all([
    readWeather(latitude, longitude, timezone, todayIso).catch(() => null),
    readMoon(todayIso, latitude, longitude, standardOffsetHours, usesUsDaylightTime),
    supabase
      .from("farm_rain_observations")
      .select("id, observation_date, amount_in, source_type, note, created_at")
      .eq("farm_id", farmId)
      .lte("observation_date", todayIso)
      .order("observation_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("tasks")
      .select("id, title, priority, action_key, task_type, due_date, metadata")
      .eq("farm_id", farmId)
      .in("status", ["open", "blocked"])
      .lte("due_date", dueThrough)
      .order("due_date", { ascending: true })
      .limit(300),
  ]);

  const rainRows = rainResult.error ? [] : (rainResult.data ?? []) as RainRow[];
  const taskRows = taskResult.error ? [] : (taskResult.data ?? []) as TaskRow[];
  const gauge = gaugeSummary(rainRows, todayIso);
  const guidance = lunarGuidance(moon);
  const taskHints = taskRows
    .map((row): LunarTaskCandidate | null => {
      const hint = lunarTaskHint(taskInput(row), moon);
      return hint ? { row, hint } : null;
    })
    .filter((candidate): candidate is LunarTaskCandidate => candidate !== null)
    .sort((a, b) => compareLunarTaskCandidates(a, b, todayIso))
    .slice(0, 4)
    .map((candidate) => candidate.hint);

  const headerLabel = weatherResult?.temperatureF === null || weatherResult?.temperatureF === undefined
    ? `${weatherResult?.condition ?? "Farm conditions"} · ${moon.phase}`
    : `${weatherResult.condition} · ${weatherResult.temperatureF}° · ${moon.phase}`;

  return {
    status: 200,
    payload: {
      ok: true,
      farm: {
        id: farm.id,
        name: farm.name,
        locationLabel,
        timezone,
      },
      observedDate: todayIso,
      headerLabel,
      weather: weatherResult
        ? {
            ...weatherResult,
            sourceType: "area_model_estimate",
            sourceLabel: `${locationLabel} weather model`,
          }
        : null,
      rain: {
        gauge,
        statusLabel: rainStatusLabel(gauge, weatherResult),
        areaEstimate: weatherResult
          ? {
              todayIn: weatherResult.todayEstimateIn,
              sevenDayIn: weatherResult.sevenDayEstimateIn,
              daysSinceWateringRain: weatherResult.daysSinceEstimatedWateringRain,
            }
          : null,
        forecast: weatherResult
          ? {
              next48hIn: weatherResult.forecast48hIn,
              chancePct: weatherResult.forecastChancePct,
            }
          : null,
      },
      moon: {
        ...moon,
        localNoonUtc: localNoonUtc(todayIso, standardOffsetHours, usesUsDaylightTime).toISOString(),
        guidance,
        astronomySourceLabel: moon.source === "usno"
          ? "U.S. Naval Observatory"
          : "Atlas calculated fallback",
        ruleSourceLabel: "Elm Almanac v1 · traditional phase and Moon-sign rules",
      },
      lunarTaskHints: taskHints,
      precedence: ["crop window", "field readiness", "weather", "lunar preference"],
    },
  };
}

export async function GET(request: NextRequest) {
  const result = await readFarmConditions(request.nextUrl.searchParams.get("farmId"));
  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.payload);
}

export async function POST(request: NextRequest) {
  const session = await getAtlasSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const requestedFarmId = typeof body.farmId === "string" ? body.farmId : session.activeFarmId;
  if (!requestedFarmId || !membershipForFarm(session, requestedFarmId)) {
    return NextResponse.json({ ok: false, error: "farm membership required" }, { status: 403 });
  }

  const amountIn = typeof body.amountIn === "number" ? body.amountIn : Number(body.amountIn);
  if (!Number.isFinite(amountIn) || amountIn < 0 || amountIn > 30) {
    return NextResponse.json({ ok: false, error: "rain amount must be between 0 and 30 inches" }, { status: 400 });
  }

  const supabase = await createAtlasServerClient();
  const { data: farmData } = await supabase
    .from("farms")
    .select("metadata")
    .eq("id", requestedFarmId)
    .single();
  const metadata = (farmData?.metadata ?? {}) as Record<string, unknown>;
  const timezone = text(metadata, "timezone", DEFAULT_TIMEZONE);
  const observationDate = typeof body.observationDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.observationDate)
    ? body.observationDate
    : isoInTimezone(new Date(), timezone);
  const note = typeof body.note === "string" ? body.note : null;

  const { data, error } = await supabase.rpc("record_farm_rain_observation_v1", {
    p_farm_id: requestedFarmId,
    p_observation_date: observationDate,
    p_amount_in: amountIn,
    p_note: note,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: "rain observation could not be recorded", details: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, observation: data });
}
