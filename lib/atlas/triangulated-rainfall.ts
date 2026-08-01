const DAY_MS = 86_400_000;
const WATERING_RAIN_THRESHOLD_IN = 0.2;

type FarmMetadata = Record<string, unknown>;

type OpenMeteoDaily = {
  daily?: {
    time?: string[];
    precipitation_sum?: number[];
  };
};

export type AtlasRainfallStationPoint = {
  key: string;
  label: string;
  latitude: number;
  longitude: number;
};

export type AtlasRainfallStationReading = AtlasRainfallStationPoint & {
  distanceMiles: number;
  weight: number;
  todayIn: number;
  sevenDayIn: number;
  daysSinceWateringRain: number | null;
};

export type AtlasTriangulatedRainfall = {
  method: "inverse_distance_weighted_three_point";
  sourceLabel: string;
  stationCount: 3;
  todayIn: number;
  sevenDayIn: number;
  daysSinceWateringRain: number | null;
  spreadSevenDayIn: number;
  confidence: "high" | "moderate" | "low";
  stations: AtlasRainfallStationReading[];
};

type DailyReading = {
  date: string;
  amount: number;
};

type StationWeather = AtlasRainfallStationPoint & {
  daily: DailyReading[];
};

function numeric(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function addDaysIso(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(olderIso: string, newerIso: string) {
  const older = new Date(`${olderIso}T12:00:00Z`).getTime();
  const newer = new Date(`${newerIso}T12:00:00Z`).getTime();
  if (!Number.isFinite(older) || !Number.isFinite(newer)) return 0;
  return Math.max(0, Math.round((newer - older) / DAY_MS));
}

function radians(value: number) {
  return value * Math.PI / 180;
}

function distanceMiles(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const earthRadiusMiles = 3958.8;
  const deltaLatitude = radians(latitudeB - latitudeA);
  const deltaLongitude = radians(longitudeB - longitudeA);
  const latitude1 = radians(latitudeA);
  const latitude2 = radians(latitudeB);
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function rainfallPoints(metadata: FarmMetadata): AtlasRainfallStationPoint[] {
  const raw = metadata.rainfall_station_points;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const row = entry as Record<string, unknown>;
      const latitude = numeric(row.latitude, Number.NaN);
      const longitude = numeric(row.longitude, Number.NaN);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return {
        key: text(row.key, `station_${index + 1}`),
        label: text(row.label, `Station ${index + 1}`),
        latitude,
        longitude,
      } satisfies AtlasRainfallStationPoint;
    })
    .filter((entry): entry is AtlasRainfallStationPoint => Boolean(entry))
    .slice(0, 3);
}

function stationWeatherUrl(point: AtlasRainfallStationPoint, timezone: string) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(point.latitude));
  url.searchParams.set("longitude", String(point.longitude));
  url.searchParams.set("daily", "precipitation_sum");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", timezone);
  url.searchParams.set("past_days", "14");
  url.searchParams.set("forecast_days", "2");
  return url;
}

async function readStationWeather(point: AtlasRainfallStationPoint, timezone: string): Promise<StationWeather> {
  const response = await fetch(stationWeatherUrl(point, timezone), {
    headers: { Accept: "application/json" },
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`Rainfall point ${point.key} failed.`);
  const payload = await response.json() as OpenMeteoDaily;
  const dates = payload.daily?.time ?? [];
  const amounts = payload.daily?.precipitation_sum ?? [];
  return {
    ...point,
    daily: dates.map((date, index) => ({ date, amount: Math.max(0, numeric(amounts[index])) })),
  };
}

function weightedAverage(values: Array<{ value: number; weight: number }>) {
  const totalWeight = values.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= 0) return 0;
  return values.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight;
}

function stationDailyAmount(station: StationWeather, dateIso: string) {
  return station.daily.find((row) => row.date === dateIso)?.amount ?? 0;
}

function mostRecentWateringRain(
  stations: StationWeather[],
  weights: number[],
  todayIso: string,
) {
  for (let offset = 0; offset <= 14; offset += 1) {
    const dateIso = addDaysIso(todayIso, -offset);
    const amount = weightedAverage(stations.map((station, index) => ({
      value: stationDailyAmount(station, dateIso),
      weight: weights[index] ?? 0,
    })));
    if (amount >= WATERING_RAIN_THRESHOLD_IN) return daysBetween(dateIso, todayIso);
  }
  return null;
}

function stationWateringRainAge(station: StationWeather, todayIso: string) {
  const latest = [...station.daily]
    .filter((row) => row.date <= todayIso && row.amount >= WATERING_RAIN_THRESHOLD_IN)
    .sort((left, right) => right.date.localeCompare(left.date))[0];
  return latest ? daysBetween(latest.date, todayIso) : null;
}

export async function readTriangulatedRainfall(
  metadata: FarmMetadata,
  todayIso: string,
  timezone: string,
): Promise<AtlasTriangulatedRainfall | null> {
  const points = rainfallPoints(metadata);
  if (points.length !== 3) return null;

  const farmLatitude = numeric(metadata.condition_latitude, Number.NaN);
  const farmLongitude = numeric(metadata.condition_longitude, Number.NaN);
  if (!Number.isFinite(farmLatitude) || !Number.isFinite(farmLongitude)) return null;

  const stations = await Promise.all(points.map((point) => readStationWeather(point, timezone)));
  const distances = stations.map((station) => Math.max(1, distanceMiles(
    farmLatitude,
    farmLongitude,
    station.latitude,
    station.longitude,
  )));
  const rawWeights = distances.map((distance) => 1 / (distance ** 2));
  const weightTotal = rawWeights.reduce((sum, weight) => sum + weight, 0);
  const normalizedWeights = rawWeights.map((weight) => weight / weightTotal);
  const start7Iso = addDaysIso(todayIso, -6);

  const readings = stations.map((station, index): AtlasRainfallStationReading => {
    const sevenDayIn = station.daily
      .filter((row) => row.date >= start7Iso && row.date <= todayIso)
      .reduce((sum, row) => sum + row.amount, 0);
    return {
      key: station.key,
      label: station.label,
      latitude: station.latitude,
      longitude: station.longitude,
      distanceMiles: round(distances[index], 1),
      weight: round(normalizedWeights[index], 3),
      todayIn: round(stationDailyAmount(station, todayIso)),
      sevenDayIn: round(sevenDayIn),
      daysSinceWateringRain: stationWateringRainAge(station, todayIso),
    };
  });

  const todayIn = weightedAverage(readings.map((reading) => ({
    value: reading.todayIn,
    weight: reading.weight,
  })));
  const sevenDayIn = weightedAverage(readings.map((reading) => ({
    value: reading.sevenDayIn,
    weight: reading.weight,
  })));
  const sevenDayValues = readings.map((reading) => reading.sevenDayIn);
  const spreadSevenDayIn = Math.max(...sevenDayValues) - Math.min(...sevenDayValues);
  const confidence = spreadSevenDayIn <= 0.15
    ? "high"
    : spreadSevenDayIn <= 0.4
      ? "moderate"
      : "low";

  return {
    method: "inverse_distance_weighted_three_point",
    sourceLabel: "Three-station triangulated estimate",
    stationCount: 3,
    todayIn: round(todayIn),
    sevenDayIn: round(sevenDayIn),
    daysSinceWateringRain: mostRecentWateringRain(stations, normalizedWeights, todayIso),
    spreadSevenDayIn: round(spreadSevenDayIn),
    confidence,
    stations: readings,
  };
}
