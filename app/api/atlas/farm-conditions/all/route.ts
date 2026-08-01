import { NextRequest, NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { readTriangulatedRainfall } from "@/lib/atlas/triangulated-rainfall";
import { createAtlasServerClient } from "@/lib/supabase/server";
import { GET as readFarmConditions } from "../route";

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
  rain?: {
    statusLabel?: string;
    areaEstimate?: unknown;
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
    const childUrl = new URL("/api/atlas/farm-conditions", request.url);
    childUrl.searchParams.set("farmId", farmId);
    const response = await readFarmConditions(new NextRequest(childUrl));
    if (!response.ok) continue;
    const payload = await response.json() as ConditionsPayload;
    if (!payload?.ok) continue;

    const metadata = metadataByFarm.get(farmId) ?? {};
    const observedDate = payload.observedDate;
    const timezone = payload.farm?.timezone;
    if (observedDate && timezone) {
      try {
        const triangulated = await readTriangulatedRainfall(metadata, observedDate, timezone);
        if (triangulated && payload.rain) {
          payload.rain.areaEstimate = triangulated;
          payload.rain.statusLabel = triangulatedStatus(triangulated.daysSinceWateringRain);
        }
      } catch {
        // Keep the single-location estimate from the base farm-conditions endpoint.
      }
    }

    conditions.push(payload);
  }

  return NextResponse.json({ ok: true, conditions });
}
