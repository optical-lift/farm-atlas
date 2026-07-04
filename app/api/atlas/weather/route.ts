import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ForecastResponse = {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
  };
  daily?: {
    time?: string[];
    precipitation_sum?: number[];
  };
};

type RainPoint = {
  name: string;
  latitude: number;
  longitude: number;
};

const realRainThresholdIn = 0.2;

const rainPoints: RainPoint[] = [
  { name: "Marshfield", latitude: 37.3387, longitude: -92.9071 },
  { name: "Niangua", latitude: 37.3898, longitude: -92.8310 },
  { name: "Conway", latitude: 37.5020, longitude: -92.8227 },
  { name: "Strafford", latitude: 37.2684, longitude: -93.1171 },
  { name: "Rogersville", latitude: 37.1170, longitude: -93.0557 },
];

const weatherCodeLabels: Record<number, string> = {
  0: "clear",
  1: "mostly clear",
  2: "partly cloudy",
  3: "cloudy",
  45: "fog",
  48: "fog",
  51: "drizzle",
  53: "drizzle",
  55: "drizzle",
  56: "freezing drizzle",
  57: "freezing drizzle",
  61: "rain",
  63: "rain",
  65: "heavy rain",
  66: "freezing rain",
  67: "freezing rain",
  71: "snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "showers",
  81: "showers",
  82: "heavy showers",
  85: "snow showers",
  86: "snow showers",
  95: "thunderstorm",
  96: "thunderstorm",
  99: "thunderstorm",
};

function weatherLabel(code: number | undefined) {
  if (typeof code !== "number") return "weather";
  return weatherCodeLabels[code] ?? "weather";
}

function forecastUrlFor(point: RainPoint) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(point.latitude));
  url.searchParams.set("longitude", String(point.longitude));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("daily", "precipitation_sum");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", "America/Chicago");
  url.searchParams.set("past_days", "14");
  url.searchParams.set("forecast_days", "1");
  return url;
}

function dryLabel(daysSinceRain: number | null) {
  if (daysSinceRain === null) return "rain age unknown";
  if (daysSinceRain === 0) return "rained today";
  if (daysSinceRain === 1) return "rained yesterday";
  return `${daysSinceRain} days dry`;
}

function daysBetween(dateIso: string, todayIso: string) {
  const oneDay = 24 * 60 * 60 * 1000;
  const date = new Date(`${dateIso}T12:00:00`);
  const today = new Date(`${todayIso}T12:00:00`);
  return Math.max(0, Math.round((today.getTime() - date.getTime()) / oneDay));
}

export async function GET() {
  try {
    const responses = await Promise.all(
      rainPoints.map(async (point) => {
        const response = await fetch(forecastUrlFor(point), { cache: "no-store" });
        if (!response.ok) throw new Error(`Weather lookup failed for ${point.name}.`);
        return (await response.json()) as ForecastResponse;
      }),
    );

    const primary = responses[0];
    const temp = primary.current?.temperature_2m;
    const roundedTemp = typeof temp === "number" ? Math.round(temp) : null;
    const condition = weatherLabel(primary.current?.weather_code);
    const dates = primary.daily?.time ?? [];
    const todayIso = dates[dates.length - 1] ?? new Date().toISOString().slice(0, 10);

    const averagedRain = dates.map((date, index) => {
      const values = responses
        .map((payload) => payload.daily?.precipitation_sum?.[index])
        .filter((value): value is number => typeof value === "number");
      const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      return { date, average };
    });

    const lastRealRain = [...averagedRain].reverse().find((day) => day.average >= realRainThresholdIn);
    const daysSinceRain = lastRealRain ? daysBetween(lastRealRain.date, todayIso) : null;
    const rainAge = dryLabel(daysSinceRain);
    const label = roundedTemp === null ? `${condition} · ${rainAge}` : `${condition} · ${roundedTemp}° · ${rainAge}`;

    return NextResponse.json({
      ok: true,
      label,
      condition,
      temperatureF: roundedTemp,
      rainAge,
      daysSinceRain,
      realRainThresholdIn,
      averagedRain,
      rainPoints: rainPoints.map((point) => point.name),
    });
  } catch (error) {
    console.error("Atlas weather load failed:", error);
    return NextResponse.json(
      { ok: false, error: "weather unavailable", details: error instanceof Error ? error.message : "Unknown weather error." },
      { status: 502 },
    );
  }
}
