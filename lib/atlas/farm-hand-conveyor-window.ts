import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type { AtlasUniversalHomeModel, AtlasUniversalMove } from "@/lib/atlas/universal-home";

export const FARM_HAND_OUTDOOR_MORNING_END_HOUR = 11;
export const FARM_HAND_OUTDOOR_EVENING_START_HOUR = 19;

const ELM_LATITUDE = 37.3387;
const ELM_LONGITUDE = -92.9071;
const INDOOR_TERMS = ["grow room", "kitchen", "living room", "lounge", "bathroom", "basement", "garage freezer", "coffee bar", "inside", "indoor"];
const OUTDOOR_TERMS = ["field row", "field rows", "fr1", "fr2", "fr3", "fr4", "fr5", "fr6", "fr7", "fr8", "fr9", "fr10", "fr11", "fr12", "fr13", "fr14", "fr15", "fr16", "fr17", "fr18", "barn bed", "bb1", "bb2", "bb3", "bb4", "bb5", "bb6", "bb7", "bb8", "bb9", "berry walk", "main garden", "entry billboard", "curve garden", "follow me", "lilac haven", "hydrangea", "labyrinth", "crescent moon", "u-pick", "upick", "mailbox", "redbud", "orchard", "garden", "mow", "weed", "harvest", "transplant", "sow", "spray", "fishing line"];

type WeatherPoint = { hour: number; apparentTemperatureF: number | null; humidity: number | null; precipitationIn: number | null; cloudCover: number | null; weatherCode: number | null };
type OutdoorWeather = { current: WeatherPoint; hourly: WeatherPoint[] };

function centralHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", hourCycle: "h23" }).format(date));
}

function fallbackRhythmAllowsOutdoor(date = new Date()) {
  const hour = centralHour(date);
  return hour < FARM_HAND_OUTDOOR_MORNING_END_HOUR || hour >= FARM_HAND_OUTDOOR_EVENING_START_HOUR;
}

function weatherUrl() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(ELM_LATITUDE));
  url.searchParams.set("longitude", String(ELM_LONGITUDE));
  url.searchParams.set("current", "apparent_temperature,relative_humidity_2m,precipitation,cloud_cover,weather_code");
  url.searchParams.set("hourly", "apparent_temperature,relative_humidity_2m,precipitation,cloud_cover,weather_code");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", "America/Chicago");
  url.searchParams.set("forecast_days", "1");
  return url;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function readElmOutdoorWeather(date = new Date()): Promise<OutdoorWeather | null> {
  try {
    const response = await fetch(weatherUrl(), { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json() as { current?: Record<string, unknown>; hourly?: Record<string, unknown> };
    const currentHour = centralHour(date);
    const hourly = payload.hourly ?? {};
    const apparent = Array.isArray(hourly.apparent_temperature) ? hourly.apparent_temperature : [];
    const humidity = Array.isArray(hourly.relative_humidity_2m) ? hourly.relative_humidity_2m : [];
    const precipitation = Array.isArray(hourly.precipitation) ? hourly.precipitation : [];
    const cloud = Array.isArray(hourly.cloud_cover) ? hourly.cloud_cover : [];
    const codes = Array.isArray(hourly.weather_code) ? hourly.weather_code : [];
    const points = Array.from({ length: Math.max(apparent.length, humidity.length, precipitation.length, cloud.length, codes.length) }, (_, hour): WeatherPoint => ({
      hour,
      apparentTemperatureF: numberOrNull(apparent[hour]),
      humidity: numberOrNull(humidity[hour]),
      precipitationIn: numberOrNull(precipitation[hour]),
      cloudCover: numberOrNull(cloud[hour]),
      weatherCode: numberOrNull(codes[hour]),
    }));
    const current = payload.current ?? {};
    return {
      current: {
        hour: currentHour,
        apparentTemperatureF: numberOrNull(current.apparent_temperature),
        humidity: numberOrNull(current.relative_humidity_2m),
        precipitationIn: numberOrNull(current.precipitation),
        cloudCover: numberOrNull(current.cloud_cover),
        weatherCode: numberOrNull(current.weather_code),
      },
      hourly: points,
    };
  } catch {
    return null;
  }
}

function heatAdjustment(task: AtlasTaskCard | null) {
  const value = typeof task?.metadata?.heat_exposure === "string" ? task.metadata.heat_exposure.toLowerCase() : "medium";
  if (value === "high") return -4;
  if (value === "low") return 2;
  return 0;
}

function weatherAllowsOutdoor(point: WeatherPoint, task: AtlasTaskCard | null, date = new Date()) {
  const apparent = point.apparentTemperatureF;
  const humidity = point.humidity ?? 50;
  const precipitation = point.precipitationIn ?? 0;
  const cloud = point.cloudCover ?? 0;
  const code = point.weatherCode ?? 0;
  const adjustment = heatAdjustment(task);

  if (code >= 95 || precipitation >= 0.12) return false;
  if (apparent !== null && apparent >= 95 + adjustment) return false;
  if (apparent !== null && apparent >= 90 + adjustment && humidity >= 55) return false;

  const hour = point.hour;
  const rhythmWindow = hour < FARM_HAND_OUTDOOR_MORNING_END_HOUR || hour >= FARM_HAND_OUTDOOR_EVENING_START_HOUR;
  if (rhythmWindow) return apparent === null || apparent < 91 + adjustment;
  if (apparent !== null && apparent <= 80 + adjustment && precipitation < 0.05) return true;
  if (apparent !== null && apparent <= 84 + adjustment && cloud >= 70 && humidity < 70 && precipitation < 0.05) return true;
  return false;
}

export async function atlasFarmHandOutdoorEligibleNow(date = new Date()) {
  const weather = await readElmOutdoorWeather(date);
  return weather ? weatherAllowsOutdoor(weather.current, null, date) : fallbackRhythmAllowsOutdoor(date);
}

export function atlasTaskIsOutdoor(task: AtlasTaskCard) {
  const explicit = task.metadata?.work_environment ?? task.metadata?.environment ?? task.metadata?.work_location_type;
  if (typeof explicit === "string") {
    const normalized = explicit.trim().toLowerCase();
    if (["indoor", "inside", "covered_indoor"].includes(normalized)) return false;
    if (["outdoor", "outside", "field"].includes(normalized)) return true;
  }
  if (task.metadata?.outdoor === true || task.metadata?.outside === true) return true;
  if (task.metadata?.indoor === true || task.metadata?.inside === true) return false;
  const haystack = [task.title, task.task_type, task.action_key, task.work_class, task.zone_key, task.zone_label, ...task.objects.map((object) => `${object.object_key} ${object.object_label} ${object.object_type}`)].filter(Boolean).join(" ").toLowerCase();
  if (INDOOR_TERMS.some((term) => haystack.includes(term))) return false;
  return OUTDOOR_TERMS.some((term) => haystack.includes(term));
}

function taskIdFromMove(move: AtlasUniversalMove) {
  if (move.kind !== "farm_task" || !move.key.startsWith("farm-task:")) return null;
  return move.key.split(":").at(-1) ?? null;
}

function taskForMove(home: AtlasUniversalHomeModel, move: AtlasUniversalMove) {
  const taskId = taskIdFromMove(move);
  if (!taskId) return null;
  return home.farms.flatMap((farm) => farm.taskCards).find((candidate) => candidate.task_id === taskId) ?? null;
}

export function atlasFarmHandMoveIsOutdoor(home: AtlasUniversalHomeModel, move: AtlasUniversalMove) {
  const task = taskForMove(home, move);
  return task ? atlasTaskIsOutdoor(task) : false;
}

function nextOutdoorWindowLabel(weather: OutdoorWeather, task: AtlasTaskCard | null, date = new Date()) {
  const nowHour = centralHour(date);
  const next = weather.hourly.find((point) => point.hour > nowHour && weatherAllowsOutdoor(point, task, date));
  if (!next) return "later when conditions improve";
  const suffix = next.hour >= 12 ? "pm" : "am";
  const hour = next.hour % 12 || 12;
  return `around ${hour}${suffix}`;
}

function outdoorWindowClosingSoon(weather: OutdoorWeather, task: AtlasTaskCard | null, date = new Date()) {
  const nowHour = centralHour(date);
  if (!weatherAllowsOutdoor(weather.current, task, date)) return false;
  return weather.hourly.some((point) => point.hour > nowHour && point.hour <= nowHour + 3 && !weatherAllowsOutdoor(point, task, date));
}

export async function atlasFarmHandConveyorMoves(home: AtlasUniversalHomeModel, date = new Date()) {
  const weather = await readElmOutdoorWeather(date);
  if (!weather) {
    if (fallbackRhythmAllowsOutdoor(date)) return home.moves;
    const available = home.moves.filter((move) => !atlasFarmHandMoveIsOutdoor(home, move));
    if (available.length || available.length === home.moves.length) return available;
    return [{ key: "farm-hand:outside-window", kind: "attention" as const, category: "Work window", title: "Indoor work for now", scopeLabel: home.activeFarm?.farmName ?? "Elm Farm", meta: "Outside work later", detail: "Weather is unavailable, so Atlas is using Anna's usual summer outdoor rhythm.", href: "/work/today", date: home.window.doneDate, state: "waiting" as const, farmId: home.activeFarm?.farmId ?? null, projectId: null, priority: 0 }];
  }

  const available = home.moves.filter((move) => {
    const task = taskForMove(home, move);
    return !task || !atlasTaskIsOutdoor(task) || weatherAllowsOutdoor(weather.current, task, date);
  });
  const heldOutdoor = home.moves.filter((move) => !available.includes(move) && atlasFarmHandMoveIsOutdoor(home, move));

  if (available.length) {
    const firstOutdoor = available.find((move) => atlasFarmHandMoveIsOutdoor(home, move));
    const firstOutdoorTask = firstOutdoor ? taskForMove(home, firstOutdoor) : null;
    if (firstOutdoor && outdoorWindowClosingSoon(weather, firstOutdoorTask, date)) return [firstOutdoor, ...available.filter((move) => move !== firstOutdoor)];
    return available;
  }
  if (!heldOutdoor.length) return available;

  const heldTask = taskForMove(home, heldOutdoor[0]);
  const nextWindow = nextOutdoorWindowLabel(weather, heldTask, date);
  const apparent = weather.current.apparentTemperatureF;
  return [{ key: "farm-hand:outside-weather-window", kind: "attention" as const, category: "Weather window", title: "Indoor work for now", scopeLabel: home.activeFarm?.farmName ?? "Elm Farm", meta: `Outside looks better ${nextWindow}`, detail: apparent === null ? "Atlas is holding outside work for a better weather window." : `It feels like ${Math.round(apparent)}° outside. Atlas is holding field work for a better window.`, href: "/work/today", date: home.window.doneDate, state: "waiting" as const, farmId: home.activeFarm?.farmId ?? null, projectId: null, priority: 0 }];
}
