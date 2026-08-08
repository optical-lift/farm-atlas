import { NextRequest, NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { readTriangulatedFarmConditions } from "@/lib/atlas/triangulated-rainfall";
import { createAtlasServerClient } from "@/lib/supabase/server";
import { GET as readFarmWeatherRain } from "../../farm-weather-rain/route";

export const dynamic = "force-dynamic";

type FarmMetadataRow = {
  id: string;
  metadata: Record<string, unknown> | null;
};

type ConditionsPayload = {
  ok?: boolean;
  observedDate?: string;
  farm?: {
    id?: string;
    timezone?: string;
  };
  weather?: unknown;
  rain?: {
    statusLabel?: string;
    areaEstimate?: unknown;
    forecast?: unknown;
  };
};

function triangulatedStatus(daysSinceWateringRain: number | null) {
  if (daysSinceWateringRain === 0) return "Three-station estimate shows watering rain today";
  if (daysSinceWateringRain === 1) return "Three-station estimate shows watering rain yesterday";
  if (typeof daysSinceWateringRain === "number") {
    return `${daysSinceWateringRain} days since triangulated watering rain`;
  }
  return "No watering rain found in the three-station window";
}

export async function GET(request: NextRequest) {
  const session = await getAtlasSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const farmIds = Array.from(new Set(session.memberships.map((membership) => membership.farmId)));
  const supabase = await createAtlasServerClient();
  const { data: farmRows } = await supabase
    .from("farms")
    .select("id, metadata")
    .in("id", farmIds);
  const metadataByFarm = new Map(
    ((farmRows ?? []) as FarmMetadataRow[]).map((farm) => [farm.id, farm.metadata ?? {}]),
  );
  const conditions: ConditionsPayload[] = [];

  for (const farmId of farmIds) {
    const childUrl = new URL("/api/atlas/farm-weather-rain", request.url);
    childUrl.searchParams.set("farmId", farmId);
    const response = await readFarmWeatherRain(new NextRequest(childUrl));
    if (!response.ok) continue;
    const payload = await response.json() as ConditionsPayload;
    if (!payload?.ok) continue;

    const metadata = metadataByFarm.get(farmId) ?? {};
    const observedDate = payload.observedDate;
    const timezone = payload.farm?.timezone;
    if (observedDate && timezone) {
      try {
        const triangulated = await readTriangulatedFarmConditions(metadata, observedDate, timezone);
        if (triangulated) {
          payload.weather = triangulated.weather;
          if (payload.rain) {
            payload.rain.areaEstimate = triangulated.rainfall;
            payload.rain.forecast = {
              next48hIn: triangulated.weather.forecast48hIn,
              chancePct: triangulated.weather.forecastChancePct,
            };
            payload.rain.statusLabel = triangulatedStatus(triangulated.rainfall.daysSinceWateringRain);
          }
        }
      } catch {
        // Keep the farm-point weather estimate from the base endpoint if the three-station blend fails.
      }
    }

    conditions.push(payload);
  }

  return NextResponse.json({ ok: true, conditions });
}
