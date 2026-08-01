const DAY_MS = 86_400_000;
const WATERING_RAIN_THRESHOLD_IN = 0.2;
const MAX_OBSERVATION_AGE_MS = 4 * 60 * 60 * 1000;

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

type FarmMetadata = Record<string, unknown>;

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

type NwsMeasure = {
  value?: number | null;
  unitCode?: string | null;
};

type NwsObservationResponse = {
  properties?: {
    timestamp?: string | null;
    textDescription?: string | null;
    temperature?: NwsMeasure;
    heatIndex?: NwsMeasure;
    windChill?: NwsMeasure;
    relativeHumidity?: NwsMeasure;
    windSpeed?: NwsMeasure;
  };
};

export type AtlasRainfallStationPoint = {
  key: string;
  stationId: string;
  label: string;
  latitude: number;
  longitude: number;
};

export type AtlasRainfallStationReading = AtlasRainfallStationPoint & {
  distanceMiles: number;
  weight: number;
  weatherSource: "nws_observation" | "model_fallback";
  observedAt: string | null;
  condition: string;
  temperatureF: number | null;
  feelsLikeF: number | null;
  humidityPct: number | null;
  windMph: number | null;
  todayIn: number;
  sevenDayIn: number;
  forecast48hIn: number;
  forecastChancePct: number;
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

export type AtlasTriangulatedWeather = {
  sourceType: "three_station_triangulation";
  sourceLabel: string;
  method: "inverse_distance_weighted_three_point";
  stationCount: 3;
  condition: string;
  temperatureF: number | null;
  feelsLikeF: number | null;
  humidityPct: number | null;
  windMph: number | null;
  todayEstimateIn: number;
  sevenDayEstimateIn: number;
  forecast48hIn: number;
  forecastChancePct: number;
  daysSinceEstimatedWateringRain: number | null;
  confidence: "high" | "moderate" | "low";
  temperatureSpreadF: number | null;
  stations: AtlasRainfallStationReading[];
};

export type AtlasTriangulatedFarmConditions = {
  weather: AtlasTriangulatedWeather;
  rainfall: AtlasTriangulatedRainfall;
};

type DailyReading = {
  date: string;
  amount: number;
  chance: number;
};

type StationModel = AtlasRainfallStationPoint & {
  current: {
    condition: string;
    temperatureF: number | null;
    feelsLikeF: number | null;
    humidityPct: number | null;
    windMph: number | null;
  };
  daily: DailyReading[];
};

type StationCurrent = {
  weatherSource: "nws_observation" | "model_fallback";
  observedAt: string | null;
  condition: string;
  temperatureF: number | null;
  feelsLikeF: number | null;
  humidityPct: number | null;
  windMph: number | null;
};

type StationConditions = StationModel & StationCurrent;

function numeric(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function stationPoints(metadata: FarmMetadata): AtlasRainfallStationPoint[] {
  const raw = metadata.condition_station_points
    ?? metadata.weather_station_points
    ?? metadata.rainfall_station_points;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const row = entry as Record<string, unknown>;
      const latitude = numeric(row.latitude, Number.NaN);
      const longitude = numeric(row.longitude, Number.NaN);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      const stationId = text(row.station_id ?? row.stationId ?? row.key, `station_${index + 1}`).toUpperCase();
      return {
        key: text(row.key, stationId.toLowerCase()),
        stationId,
        label: text(row.label, stationId),
        latitude,
        longitude,
      } satisfies AtlasRainfallStationPoint;
    })
    .filter((entry): entry is AtlasRainfallStationPoint => Boolean(entry))
    .slice(0, 3);
}

function stationModelUrl(point: AtlasRainfallStationPoint, timezone: string) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(point.latitude));
  url.searchParams.set("longitude", String(point.longitude));
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

function nwsObservationUrl(point: AtlasRainfallStationPoint) {
  return new URL(`https://api.weather.gov/stations/${encodeURIComponent(point.stationId)}/observations/latest`);
}

async function readStationModel(point: AtlasRainfallStationPoint, timezone: string): Promise<StationModel> {
  const response = await fetch(stationModelUrl(point, timezone), {
    headers: { Accept: "application/json" },
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`Weather point ${point.key} failed.`);
  const payload = await response.json() as OpenMeteoResponse;
  const dates = payload.daily?.time ?? [];
  const amounts = payload.daily?.precipitation_sum ?? [];
  const chances = payload.daily?.precipitation_probability_max ?? [];
  return {
    ...point,
    current: {
      condition: weatherCodeLabels[payload.current?.weather_code ?? -1] ?? "Weather",
      temperatureF: nullableNumeric(payload.current?.temperature_2m),
      feelsLikeF: nullableNumeric(payload.current?.apparent_temperature),
      humidityPct: nullableNumeric(payload.current?.relative_humidity_2m),
      windMph: nullableNumeric(payload.current?.wind_speed_10m),
    },
    daily: dates.map((date, index) => ({
      date,
      amount: Math.max(0, numeric(amounts[index])),
      chance: Math.max(0, numeric(chances[index])),
    })),
  };
}

function measureToFahrenheit(measure: NwsMeasure | undefined) {
  const value = nullableNumeric(measure?.value);
  if (value === null) return null;
  const unit = measure?.unitCode ?? "";
  if (unit.includes("degF")) return value;
  return value * 9 / 5 + 32;
}

function measureToMph(measure: NwsMeasure | undefined) {
  const value = nullableNumeric(measure?.value);
  if (value === null) return null;
  const unit = measure?.unitCode ?? "";
  if (unit.includes("mi_h-1")) return value;
  if (unit.includes("m_s-1")) return value * 2.236936;
  return value * 0.621371;
}

async function readStationCurrent(model: StationModel): Promise<StationCurrent> {
  try {
    const response = await fetch(nwsObservationUrl(model), {
      headers: {
        Accept: "application/geo+json, application/json",
        "User-Agent": "Atlas Farm Conditions (atlas.elmfarm.co)",
      },
      next: { revalidate: 600 },
    });
    if (!response.ok) throw new Error(`NWS station ${model.stationId} failed.`);
    const payload = await response.json() as NwsObservationResponse;
    const properties = payload.properties;
    const observedAt = properties?.timestamp ?? null;
    const observedMs = observedAt ? Date.parse(observedAt) : Number.NaN;
    if (!Number.isFinite(observedMs) || Date.now() - observedMs > MAX_OBSERVATION_AGE_MS) {
      throw new Error(`NWS station ${model.stationId} is stale.`);
    }
    const temperatureF = measureToFahrenheit(properties?.temperature);
    const heatIndexF = measureToFahrenheit(properties?.heatIndex);
    const windChillF = measureToFahrenheit(properties?.windChill);
    return {
      weatherSource: "nws_observation",
      observedAt,
      condition: text(properties?.textDescription, model.current.condition),
      temperatureF: temperatureF ?? model.current.temperatureF,
      feelsLikeF: heatIndexF ?? windChillF ?? model.current.feelsLikeF,
      humidityPct: nullableNumeric(properties?.relativeHumidity?.value) ?? model.current.humidityPct,
      windMph: measureToMph(properties?.windSpeed) ?? model.current.windMph,
    };
  } catch {
    return {
      weatherSource: "model_fallback",
      observedAt: null,
      ...model.current,
    };
  }
}

async function readStationConditions(
  point: AtlasRainfallStationPoint,
  timezone: string,
): Promise<StationConditions> {
  const model = await readStationModel(point, timezone);
  const current = await readStationCurrent(model);
  return { ...model, ...current };
}

function weightedAverage(values: Array<{ value: number; weight: number }>) {
  const totalWeight = values.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= 0) return 0;
  return values.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight;
}

function weightedNullable(values: Array<{ value: number | null; weight: number }>) {
  const available = values.filter((row): row is { value: number; weight: number } => row.value !== null);
  if (!available.length) return null;
  return weightedAverage(available);
}

function stationDaily(station: StationConditions, dateIso: string) {
  return station.daily.find((row) => row.date === dateIso) ?? { date: dateIso, amount: 0, chance: 0 };
}

function mostRecentWateringRain(
  stations: StationConditions[],
  weights: number[],
  todayIso: string,
) {
  for (let offset = 0; offset <= 14; offset += 1) {
    const dateIso = addDaysIso(todayIso, -offset);
    const amount = weightedAverage(stations.map((station, index) => ({
      value: stationDaily(station, dateIso).amount,
      weight: weights[index] ?? 0,
    })));
    if (amount >= WATERING_RAIN_THRESHOLD_IN) return daysBetween(dateIso, todayIso);
  }
  return null;
}

function stationWateringRainAge(station: StationConditions, todayIso: string) {
  const latest = [...station.daily]
    .filter((row) => row.date <= todayIso && row.amount >= WATERING_RAIN_THRESHOLD_IN)
    .sort((left, right) => right.date.localeCompare(left.date))[0];
  return latest ? daysBetween(latest.date, todayIso) : null;
}

function spread(values: Array<number | null>) {
  const available = values.filter((value): value is number => value !== null);
  return available.length ? Math.max(...available) - Math.min(...available) : null;
}

function rainfallConfidence(spreadSevenDayIn: number) {
  if (spreadSevenDayIn <= 0.15) return "high" as const;
  if (spreadSevenDayIn <= 0.4) return "moderate" as const;
  return "low" as const;
}

function weatherConfidence(stations: StationConditions[], temperatureSpreadF: number | null) {
  const observedCount = stations.filter((station) => station.weatherSource === "nws_observation").length;
  if (observedCount === 3 && (temperatureSpreadF ?? 0) <= 8) return "high" as const;
  if (observedCount >= 2 && (temperatureSpreadF ?? 0) <= 15) return "moderate" as const;
  return "low" as const;
}

export async function readTriangulatedFarmConditions(
  metadata: FarmMetadata,
  todayIso: string,
  timezone: string,
): Promise<AtlasTriangulatedFarmConditions | null> {
  const points = stationPoints(metadata);
  if (points.length !== 3) return null;

  const farmLatitude = numeric(metadata.condition_latitude, Number.NaN);
  const farmLongitude = numeric(metadata.condition_longitude, Number.NaN);
  if (!Number.isFinite(farmLatitude) || !Number.isFinite(farmLongitude)) return null;

  const stations = await Promise.all(points.map((point) => readStationConditions(point, timezone)));
  const distances = stations.map((station) => Math.max(1, distanceMiles(
    farmLatitude,
    farmLongitude,
    station.latitude,
    station.longitude,
  )));
  const rawWeights = distances.map((distance) => 1 / (distance ** 2));
  const weightTotal = rawWeights.reduce((sum, weight) => sum + weight, 0);
  const weights = rawWeights.map((weight) => weight / weightTotal);
  const start7Iso = addDaysIso(todayIso, -6);
  const tomorrowIso = addDaysIso(todayIso, 1);

  const readings = stations.map((station, index): AtlasRainfallStationReading => {
    const sevenDayIn = station.daily
      .filter((row) => row.date >= start7Iso && row.date <= todayIso)
      .reduce((sum, row) => sum + row.amount, 0);
    const today = stationDaily(station, todayIso);
    const tomorrow = stationDaily(station, tomorrowIso);
    return {
      key: station.key,
      stationId: station.stationId,
      label: station.label,
      latitude: station.latitude,
      longitude: station.longitude,
      distanceMiles: round(distances[index], 1),
      weight: round(weights[index], 3),
      weatherSource: station.weatherSource,
      observedAt: station.observedAt,
      condition: station.condition,
      temperatureF: station.temperatureF === null ? null : Math.round(station.temperatureF),
      feelsLikeF: station.feelsLikeF === null ? null : Math.round(station.feelsLikeF),
      humidityPct: station.humidityPct === null ? null : Math.round(station.humidityPct),
      windMph: station.windMph === null ? null : Math.round(station.windMph),
      todayIn: round(today.amount),
      sevenDayIn: round(sevenDayIn),
      forecast48hIn: round(today.amount + tomorrow.amount),
      forecastChancePct: Math.round(Math.max(today.chance, tomorrow.chance)),
      daysSinceWateringRain: stationWateringRainAge(station, todayIso),
    };
  });

  const todayIn = weightedAverage(readings.map((reading, index) => ({
    value: reading.todayIn,
    weight: weights[index],
  })));
  const sevenDayIn = weightedAverage(readings.map((reading, index) => ({
    value: reading.sevenDayIn,
    weight: weights[index],
  })));
  const forecast48hIn = weightedAverage(readings.map((reading, index) => ({
    value: reading.forecast48hIn,
    weight: weights[index],
  })));
  const forecastChancePct = weightedAverage(readings.map((reading, index) => ({
    value: reading.forecastChancePct,
    weight: weights[index],
  })));
  const temperatureF = weightedNullable(readings.map((reading, index) => ({
    value: reading.temperatureF,
    weight: weights[index],
  })));
  const feelsLikeF = weightedNullable(readings.map((reading, index) => ({
    value: reading.feelsLikeF,
    weight: weights[index],
  })));
  const humidityPct = weightedNullable(readings.map((reading, index) => ({
    value: reading.humidityPct,
    weight: weights[index],
  })));
  const windMph = weightedNullable(readings.map((reading, index) => ({
    value: reading.windMph,
    weight: weights[index],
  })));
  const sevenDayValues = readings.map((reading) => reading.sevenDayIn);
  const spreadSevenDayIn = Math.max(...sevenDayValues) - Math.min(...sevenDayValues);
  const temperatureSpreadF = spread(readings.map((reading) => reading.temperatureF));
  const nearestIndex = weights.indexOf(Math.max(...weights));
  const observedCount = stations.filter((station) => station.weatherSource === "nws_observation").length;
  const weatherSourceLabel = observedCount === 3
    ? "Three-station NWS observation blend"
    : observedCount > 0
      ? "Three-station blend with NWS observations and model fallback"
      : "Three-station weather-model blend";
  const daysSinceWateringRain = mostRecentWateringRain(stations, weights, todayIso);

  return {
    weather: {
      sourceType: "three_station_triangulation",
      sourceLabel: weatherSourceLabel,
      method: "inverse_distance_weighted_three_point",
      stationCount: 3,
      condition: readings[nearestIndex]?.condition ?? "Weather",
      temperatureF: temperatureF === null ? null : Math.round(temperatureF),
      feelsLikeF: feelsLikeF === null ? null : Math.round(feelsLikeF),
      humidityPct: humidityPct === null ? null : Math.round(humidityPct),
      windMph: windMph === null ? null : Math.round(windMph),
      todayEstimateIn: round(todayIn),
      sevenDayEstimateIn: round(sevenDayIn),
      forecast48hIn: round(forecast48hIn),
      forecastChancePct: Math.round(forecastChancePct),
      daysSinceEstimatedWateringRain: daysSinceWateringRain,
      confidence: weatherConfidence(stations, temperatureSpreadF),
      temperatureSpreadF: temperatureSpreadF === null ? null : round(temperatureSpreadF, 1),
      stations: readings,
    },
    rainfall: {
      method: "inverse_distance_weighted_three_point",
      sourceLabel: "Three-station model rainfall estimate",
      stationCount: 3,
      todayIn: round(todayIn),
      sevenDayIn: round(sevenDayIn),
      daysSinceWateringRain,
      spreadSevenDayIn: round(spreadSevenDayIn),
      confidence: rainfallConfidence(spreadSevenDayIn),
      stations: readings,
    },
  };
}

export async function readTriangulatedRainfall(
  metadata: FarmMetadata,
  todayIso: string,
  timezone: string,
): Promise<AtlasTriangulatedRainfall | null> {
  return (await readTriangulatedFarmConditions(metadata, todayIso, timezone))?.rainfall ?? null;
}
