import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const HARVESTED_DAYS = 21;

type FarmRow = {
  id: string;
  stable_key: string;
  name: string;
};

type HarvestObservationRow = {
  id: string;
  farm_id: string;
  crop_cycle_id: string;
  observed_date: string;
  bucket_band: string;
  bucket_equivalent_floor: number | string;
  more_available: boolean;
  note: string | null;
  created_at: string;
};

type CropCycleRow = {
  id: string;
  crop_label: string | null;
  variety: string | null;
};

type HarvestedEntry = {
  id: string;
  cropCycleId: string;
  cropLabel: string;
  variety: string | null;
  observedDate: string;
  bucketEquivalentFloor: number;
  lowerBound: boolean;
  moreAvailable: boolean;
  observationCount: number;
  note: string | null;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function isoDate(value: string | null | undefined) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function meaningfulVariety(value: string | null | undefined, cropLabel: string) {
  const variety = value?.trim() || null;
  if (!variety) return null;
  if (variety.toLowerCase() === cropLabel.trim().toLowerCase()) return null;
  return variety;
}

export async function GET(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "unauthorized" }, 401);

  const requestedDate = isoDate(new URL(request.url).searchParams.get("asOf"));
  const asOf = requestedDate ?? localToday();
  const rangeStart = addDays(asOf, -(HARVESTED_DAYS - 1));
  const farmIds = Array.from(new Set(session.memberships.map((membership) => membership.farmId)));
  const supabase = await createAtlasServerClient();

  const [farmResult, observationResult] = await Promise.all([
    supabase.from("farms").select("id, stable_key, name").in("id", farmIds),
    supabase
      .from("flower_harvest_bucket_observations")
      .select("id, farm_id, crop_cycle_id, observed_date, bucket_band, bucket_equivalent_floor, more_available, note, created_at")
      .in("farm_id", farmIds)
      .gte("observed_date", rangeStart)
      .lte("observed_date", asOf)
      .order("observed_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (farmResult.error || observationResult.error) {
    return privateJson({ ok: false, error: "Harvested flower output could not be loaded." }, 500);
  }

  const observations = (observationResult.data ?? []) as HarvestObservationRow[];
  const cycleIds = Array.from(new Set(observations.map((row) => row.crop_cycle_id)));
  let cropCycles: CropCycleRow[] = [];

  if (cycleIds.length) {
    const cycleResult = await supabase
      .from("crop_cycles")
      .select("id, crop_label, variety")
      .in("id", cycleIds);
    if (cycleResult.error) {
      return privateJson({ ok: false, error: "Harvested crop identity could not be loaded." }, 500);
    }
    cropCycles = (cycleResult.data ?? []) as CropCycleRow[];
  }

  const cropById = new Map(cropCycles.map((cycle) => [cycle.id, cycle]));
  const entriesByFarm = new Map<string, Map<string, HarvestedEntry>>();

  for (const row of observations) {
    const crop = cropById.get(row.crop_cycle_id);
    const cropLabel = crop?.crop_label?.trim() || "Harvested crop";
    const variety = meaningfulVariety(crop?.variety, cropLabel);
    const key = `${row.observed_date}:${row.crop_cycle_id}`;
    const farmEntries = entriesByFarm.get(row.farm_id) ?? new Map<string, HarvestedEntry>();
    const existing = farmEntries.get(key);
    const floor = Number(row.bucket_equivalent_floor);
    const safeFloor = Number.isFinite(floor) ? Math.max(0, floor) : 0;

    if (existing) {
      existing.bucketEquivalentFloor += safeFloor;
      existing.lowerBound = existing.lowerBound || row.bucket_band === "more_than_one";
      existing.observationCount += 1;
      if (!existing.note && row.note?.trim()) existing.note = row.note.trim();
    } else {
      farmEntries.set(key, {
        id: key,
        cropCycleId: row.crop_cycle_id,
        cropLabel,
        variety,
        observedDate: row.observed_date,
        bucketEquivalentFloor: safeFloor,
        lowerBound: row.bucket_band === "more_than_one",
        moreAvailable: row.more_available,
        observationCount: 1,
        note: row.note?.trim() || null,
      });
    }
    entriesByFarm.set(row.farm_id, farmEntries);
  }

  const farms = ((farmResult.data ?? []) as FarmRow[])
    .map((farm) => {
      const entries = Array.from(entriesByFarm.get(farm.id)?.values() ?? [])
        .sort((left, right) => right.observedDate.localeCompare(left.observedDate) || left.cropLabel.localeCompare(right.cropLabel));
      const bucketEquivalentFloor = entries.reduce((sum, entry) => sum + entry.bucketEquivalentFloor, 0);
      return {
        id: farm.id,
        key: farm.stable_key,
        name: farm.name,
        entries,
        totals: {
          bucketEquivalentFloor,
          lowerBound: entries.some((entry) => entry.lowerBound),
          observationCount: entries.reduce((sum, entry) => sum + entry.observationCount, 0),
        },
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return privateJson({
    ok: true,
    asOf,
    rangeStart,
    rangeDays: HARVESTED_DAYS,
    farms,
  });
}
