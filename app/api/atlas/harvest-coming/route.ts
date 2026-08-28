import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const HORIZON_DAYS = 60;

type ForecastRow = {
  crop_cycle_id: string;
  farm_id: string;
  object_stable_key: string | null;
  object_label: string | null;
  crop_profile_id: string | null;
  crop_label: string | null;
  variety: string | null;
  expected_harvest_watch_start: string | null;
  expected_harvest_watch_end: string | null;
  lifecycle_status: string | null;
  cycle_state: string | null;
};

type CycleRow = {
  id: string;
  harvest_started_date: string | null;
  last_harvest_date: string | null;
};

type ProfileRow = {
  id: string;
  crop_family: string | null;
  harvest_pattern: string | null;
};

type ExpectationRow = {
  id: string;
  farm_id: string;
  crop_cycle_id: string;
  expected_date: string;
  estimated_quantity: number | null;
  unit: string | null;
  source_kind: "worker_assertion" | "owner_assertion" | "manager_assertion";
  confidence: "possible" | "likely" | "confident";
  note: string | null;
  created_at: string;
};

type FarmRow = { id: string; stable_key: string; name: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function localToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function displayCrop(cropLabel: string | null, variety: string | null) {
  const crop = cropLabel?.trim() || "Crop";
  const cultivar = variety?.trim();
  if (!cultivar || cultivar.toLowerCase() === crop.toLowerCase()) return crop;
  return `${crop} · ${cultivar}`;
}

function latestByCycle(rows: ExpectationRow[]) {
  const map = new Map<string, ExpectationRow>();
  for (const row of rows) {
    if (!map.has(row.crop_cycle_id)) map.set(row.crop_cycle_id, row);
  }
  return map;
}

function isTerminal(state: string | null) {
  return ["failed", "cleared", "finished", "finished_harvest"].includes((state || "").toLowerCase());
}

export async function GET() {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "unauthorized" }, 401);

  const asOf = localToday();
  const horizonEnd = addDays(asOf, HORIZON_DAYS);
  const farmIds = Array.from(new Set(session.memberships.map((membership) => membership.farmId)));
  const supabase = await createAtlasServerClient();

  const [farmsResult, forecastResult] = await Promise.all([
    supabase.from("farms").select("id, stable_key, name").in("id", farmIds),
    supabase
      .from("crop_cycle_yield_forecast")
      .select("crop_cycle_id, farm_id, object_stable_key, object_label, crop_profile_id, crop_label, variety, expected_harvest_watch_start, expected_harvest_watch_end, lifecycle_status, cycle_state")
      .in("farm_id", farmIds)
      .eq("lifecycle_status", "active")
      .not("expected_harvest_watch_start", "is", null)
      .lte("expected_harvest_watch_start", horizonEnd)
      .order("expected_harvest_watch_start", { ascending: true }),
  ]);

  if (farmsResult.error || forecastResult.error) {
    return privateJson({ ok: false, error: "Coming harvests could not be loaded." }, 500);
  }

  const forecasts = ((forecastResult.data ?? []) as ForecastRow[]).filter((row) => (
    !row.object_stable_key?.startsWith("grow_room_") && !isTerminal(row.cycle_state)
  ));
  const cycleIds = forecasts.map((row) => row.crop_cycle_id);
  const profileIds = Array.from(new Set(forecasts.map((row) => row.crop_profile_id).filter((value): value is string => Boolean(value))));

  let cycles: CycleRow[] = [];
  let profiles: ProfileRow[] = [];
  let expectations: ExpectationRow[] = [];

  if (cycleIds.length) {
    const [cyclesResult, expectationsResult] = await Promise.all([
      supabase.from("crop_cycles").select("id, harvest_started_date, last_harvest_date").in("id", cycleIds),
      supabase
        .from("crop_harvest_expectations")
        .select("id, farm_id, crop_cycle_id, expected_date, estimated_quantity, unit, source_kind, confidence, note, created_at")
        .in("crop_cycle_id", cycleIds)
        .gte("expected_date", asOf)
        .order("expected_date", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);
    if (cyclesResult.error || expectationsResult.error) {
      return privateJson({ ok: false, error: "Coming harvest evidence could not be loaded." }, 500);
    }
    cycles = (cyclesResult.data ?? []) as CycleRow[];
    expectations = (expectationsResult.data ?? []) as ExpectationRow[];
  }

  if (profileIds.length) {
    const profilesResult = await supabase
      .from("crop_profiles")
      .select("id, crop_family, harvest_pattern")
      .in("id", profileIds);
    if (profilesResult.error) {
      return privateJson({ ok: false, error: "Harvest measurement profiles could not be loaded." }, 500);
    }
    profiles = (profilesResult.data ?? []) as ProfileRow[];
  }

  const cycleById = new Map(cycles.map((row) => [row.id, row]));
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const humanByCycle = latestByCycle(expectations);

  const farms = ((farmsResult.data ?? []) as FarmRow[]).map((farm) => {
    const items = forecasts
      .filter((row) => row.farm_id === farm.id)
      .map((row) => {
        const cycle = cycleById.get(row.crop_cycle_id);
        const profile = row.crop_profile_id ? profileById.get(row.crop_profile_id) : undefined;
        const human = humanByCycle.get(row.crop_cycle_id);
        const activelyHarvesting = Boolean(cycle?.harvest_started_date || ["harvest_watch", "harvestable", "harvesting", "peak_harvest"].includes((row.cycle_state || "").toLowerCase()));
        const continuationDate = activelyHarvesting && cycle?.last_harvest_date
          ? addDays(cycle.last_harvest_date, 1)
          : null;
        const systemDate = continuationDate || row.expected_harvest_watch_start || asOf;
        const expectedDate = human?.expected_date || systemDate;
        const sourceKind = human?.source_kind || (continuationDate ? "system_continuation" : "system_window");
        const confidence = human?.confidence || (continuationDate ? "confident" : "possible");

        return {
          cropCycleId: row.crop_cycle_id,
          cropLabel: displayCrop(row.crop_label, row.variety),
          baseCropLabel: row.crop_label?.trim() || "Crop",
          variety: row.variety?.trim() || null,
          objectLabel: row.object_label?.trim() || "Growing area",
          objectKey: row.object_stable_key,
          expectedDate,
          sourceKind,
          confidence,
          note: human?.note || null,
          estimatedQuantity: human?.estimated_quantity ?? null,
          unit: human?.unit ?? null,
          harvestPattern: profile?.harvest_pattern ?? null,
          cropFamily: profile?.crop_family ?? null,
          lastHarvestDate: cycle?.last_harvest_date ?? null,
          harvestStartedDate: cycle?.harvest_started_date ?? null,
          windowStart: row.expected_harvest_watch_start,
          windowEnd: row.expected_harvest_watch_end,
          overdue: expectedDate < asOf,
          humanExpectationId: human?.id ?? null,
        };
      })
      .filter((item) => item.expectedDate <= horizonEnd)
      .sort((left, right) => left.expectedDate.localeCompare(right.expectedDate) || left.cropLabel.localeCompare(right.cropLabel) || left.objectLabel.localeCompare(right.objectLabel, undefined, { numeric: true }));

    return { id: farm.id, key: farm.stable_key, name: farm.name, items };
  }).filter((farm) => farm.items.length);

  return privateJson({
    ok: true,
    contractVersion: "harvest_pipeline_coming_v1",
    asOf,
    horizonEnd,
    farms,
  });
}
