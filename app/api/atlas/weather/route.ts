import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type GeoResult = {
  name?: string;
  latitude?: number;
  longitude?: number;
  country_code?: string;
  admin1?: string;
};

type ForecastResponse = {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
  };
};

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

async function resolveMarshfield() {
  const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geoUrl.searchParams.set("name", "Marshfield");
  geoUrl.searchParams.set("count", "10");
  geoUrl.searchParams.set("language", "en");
  geoUrl.searchParams.set("format", "json");

  const response = await fetch(geoUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("Weather location lookup failed.");

  const payload = (await response.json()) as { results?: GeoResult[] };
  const match = payload.results?.find((result) => result.country_code === "US" && result.admin1 === "Missouri") ?? payload.results?.[0];
  if (typeof match?.latitude !== "number" || typeof match.longitude !== "number") throw new Error("Marshfield weather location not found.");

  return { latitude: match.latitude, longitude: match.longitude };
}

export async function GET() {
  try {
    const { latitude, longitude } = await resolveMarshfield();
    const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
    forecastUrl.searchParams.set("latitude", String(latitude));
    forecastUrl.searchParams.set("longitude", String(longitude));
    forecastUrl.searchParams.set("current", "temperature_2m,weather_code");
    forecastUrl.searchParams.set("temperature_unit", "fahrenheit");
    forecastUrl.searchParams.set("timezone", "America/Chicago");

    const response = await fetch(forecastUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("Weather forecast lookup failed.");

    const payload = (await response.json()) as ForecastResponse;
    const temp = payload.current?.temperature_2m;
    const roundedTemp = typeof temp === "number" ? Math.round(temp) : null;
    const condition = weatherLabel(payload.current?.weather_code);
    const label = roundedTemp === null ? `${condition} · Marshfield` : `${condition} · ${roundedTemp}° · Marshfield`;

    return NextResponse.json({ ok: true, label, condition, temperatureF: roundedTemp });
  } catch (error) {
    console.error("Atlas weather load failed:", error);
    return NextResponse.json(
      { ok: false, error: "weather unavailable", details: error instanceof Error ? error.message : "Unknown weather error." },
      { status: 502 },
    );
  }
}
